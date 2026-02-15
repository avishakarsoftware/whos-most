"""WebSocket game engine for Who's Most Likely To."""

from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, List, Optional
from collections import Counter
import json
import time
import asyncio
import logging
import re

import config

logger = logging.getLogger(__name__)


class Room:
    def __init__(self, room_code: str, prompts: list, timer_seconds: int = 30,
                 show_votes: bool = True, organizer_token: str = ""):
        self.room_code = room_code
        self.prompts = prompts  # list of {id, text}
        self.timer_seconds = timer_seconds
        self.show_votes = show_votes
        self.organizer_token = organizer_token
        self.players: Dict[str, dict] = {}  # client_id -> {nickname, avatar, score}
        self.organizer: Optional[WebSocket] = None
        self.organizer_id: Optional[str] = None
        self.spectators: Dict[str, WebSocket] = {}
        self.state = "LOBBY"  # LOBBY, QUESTION, REVEAL, PODIUM
        self.current_prompt_index = -1
        self.question_start_time: float = 0
        self.votes: Dict[str, str] = {}  # voter_client_id -> target_nickname (current round)
        self.connections: Dict[str, WebSocket] = {}
        self.timer_task: Optional[asyncio.Task] = None
        self.lock = asyncio.Lock()
        self.last_activity = time.time()
        self.disconnected_players: Dict[str, dict] = {}  # nickname -> {score, avatar}

        # Prediction scoring
        self.prediction_scores: Dict[str, int] = {}  # nickname -> total score

        # Round history
        self.round_history: List[dict] = []

        # WS rate limiting
        self.msg_timestamps: Dict[str, list] = {}

    def reset_for_new_game(self, new_prompts: list, new_timer: int, new_show_votes: bool):
        """Reset room for a new game, keeping players connected."""
        self.prompts = new_prompts
        self.timer_seconds = new_timer
        self.show_votes = new_show_votes
        self.state = "LOBBY"
        self.current_prompt_index = -1
        self.question_start_time = 0
        self.votes = {}
        self.round_history = []

        if self.timer_task:
            self.timer_task.cancel()
            self.timer_task = None

        # Reset scores
        for client_id in self.players:
            self.players[client_id]["score"] = 0
        self.prediction_scores = {p["nickname"]: 0 for p in self.players.values()}
        self.disconnected_players.clear()
        self.touch()

    def touch(self):
        self.last_activity = time.time()

    def is_expired(self) -> bool:
        return time.time() - self.last_activity > config.ROOM_TTL_SECONDS

    def get_player_list(self) -> list:
        """Get list of {nickname, avatar} for all connected players."""
        return [{"nickname": p["nickname"], "avatar": p.get("avatar", "")}
                for p in self.players.values()]

    def _remove_connection(self, client_id: str):
        self.connections.pop(client_id, None)
        self.spectators.pop(client_id, None)
        if client_id in self.players:
            nickname = self.players[client_id]["nickname"]
            if self.state == "LOBBY":
                del self.players[client_id]
                self.prediction_scores.pop(nickname, None)
                logger.info("Player '%s' left room %s", nickname, self.room_code)
            else:
                self.disconnected_players[nickname] = {
                    "score": self.players[client_id]["score"],
                    "avatar": self.players[client_id].get("avatar", ""),
                }
                del self.players[client_id]
                logger.info("Player '%s' disconnected from room %s (data preserved)",
                            nickname, self.room_code)
        if self.organizer_id == client_id:
            self.organizer = None
            self.organizer_id = None
            logger.info("Organizer disconnected from room %s", self.room_code)

    async def broadcast(self, message: dict):
        disconnected = []
        for client_id, ws in self.connections.items():
            try:
                await ws.send_json(message)
            except Exception:
                disconnected.append(client_id)
        spec_disconnected = []
        for client_id, ws in self.spectators.items():
            try:
                await ws.send_json(message)
            except Exception:
                spec_disconnected.append(client_id)
        for client_id in disconnected + spec_disconnected:
            self._remove_connection(client_id)

    async def send_to_organizer(self, message: dict):
        if self.organizer:
            try:
                await self.organizer.send_json(message)
            except Exception:
                self.organizer = None
                self.organizer_id = None


class SocketManager:
    def __init__(self):
        self.rooms: Dict[str, Room] = {}
        self._cleanup_task: Optional[asyncio.Task] = None

    def start_cleanup_loop(self):
        if self._cleanup_task is None:
            self._cleanup_task = asyncio.create_task(self._cleanup_expired_rooms())

    async def _cleanup_expired_rooms(self):
        while True:
            try:
                await asyncio.sleep(60)
                expired = [code for code, room in self.rooms.items() if room.is_expired()]
                for code in expired:
                    room = self.rooms.pop(code, None)
                    if room and room.timer_task:
                        room.timer_task.cancel()
                    logger.info("Cleaned up expired room %s", code)
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Error in room cleanup loop")

    def create_room(self, room_code: str, prompts: list, timer_seconds: int = 30,
                    show_votes: bool = True, organizer_token: str = "") -> Room:
        room = Room(room_code, prompts, timer_seconds, show_votes,
                    organizer_token=organizer_token)
        self.rooms[room_code] = room
        self.start_cleanup_loop()
        return room

    async def connect(self, websocket: WebSocket, room_code: str, client_id: str,
                      is_organizer: bool = False, is_spectator: bool = False,
                      token: str = ""):
        await websocket.accept()
        if room_code not in self.rooms:
            await websocket.send_json({"type": "ERROR", "message": "Room not found"})
            await websocket.close()
            return

        room = self.rooms[room_code]

        if is_organizer:
            if not token or token != room.organizer_token:
                await websocket.send_json({"type": "ERROR", "message": "Invalid organizer token"})
                await websocket.close()
                return

        room.touch()

        # Spectator: read-only
        if is_spectator:
            room.spectators[client_id] = websocket
            await websocket.send_json({
                "type": "SPECTATOR_SYNC",
                "room_code": room_code,
                "state": room.state,
                "player_count": len(room.players),
                "players": room.get_player_list(),
                "prompt_number": room.current_prompt_index + 1,
                "total_prompts": len(room.prompts),
                "prediction_leaderboard": self._get_prediction_leaderboard(room),
            })
            try:
                while True:
                    await websocket.receive_text()
            except (WebSocketDisconnect, Exception):
                pass
            finally:
                room._remove_connection(client_id)
            return

        room.connections[client_id] = websocket

        if is_organizer:
            if room.organizer_id and room.organizer_id != client_id:
                room.connections.pop(room.organizer_id, None)
            room.organizer = websocket
            room.organizer_id = client_id
            if room.current_prompt_index >= 0 or len(room.players) > 0:
                await self._send_organizer_sync(room)
            else:
                await websocket.send_json({"type": "ROOM_CREATED", "room_code": room_code})
        else:
            await websocket.send_json({"type": "JOINED_ROOM", "room_code": room_code})

        try:
            while True:
                data = await websocket.receive_text()

                if len(data) > config.MAX_WS_MESSAGE_SIZE:
                    await websocket.send_json({"type": "ERROR", "message": "Message too large"})
                    continue

                now = time.time()
                timestamps = room.msg_timestamps.setdefault(client_id, [])
                timestamps[:] = [t for t in timestamps if now - t < 1.0]
                if len(timestamps) >= config.WS_RATE_LIMIT_PER_SEC:
                    await websocket.send_json({"type": "ERROR", "message": "Too many messages"})
                    continue
                timestamps.append(now)

                try:
                    message = json.loads(data)
                except json.JSONDecodeError:
                    await websocket.send_json({"type": "ERROR", "message": "Invalid message format"})
                    continue

                room.touch()
                await self.handle_message(room, client_id, message, is_organizer)
        except WebSocketDisconnect:
            logger.info("Client %s disconnected from room %s", client_id, room_code)
        except Exception:
            logger.exception("WebSocket error for client %s in room %s", client_id, room_code)
        finally:
            room._remove_connection(client_id)

    async def _send_organizer_sync(self, room: Room):
        sync: dict = {
            "type": "ORGANIZER_RECONNECTED",
            "room_code": room.room_code,
            "state": room.state,
            "player_count": len(room.players),
            "players": room.get_player_list(),
            "prompt_number": room.current_prompt_index + 1,
            "total_prompts": len(room.prompts),
            "prediction_leaderboard": self._get_prediction_leaderboard(room),
            "timer_seconds": room.timer_seconds,
            "prompts": room.prompts,
        }
        if room.state == "QUESTION":
            sync["prompt"] = room.prompts[room.current_prompt_index]
            sync["voted_count"] = len(room.votes)
            elapsed = time.time() - room.question_start_time
            sync["time_remaining"] = max(0, room.timer_seconds - int(elapsed))
        await room.organizer.send_json(sync)
        logger.info("Organizer reconnected to room %s (state: %s)", room.room_code, room.state)

    async def handle_message(self, room: Room, client_id: str, message: dict,
                             is_organizer: bool):
        msg_type = message.get("type")

        if is_organizer:
            if msg_type == "START_GAME":
                if len(room.players) < config.MIN_PLAYERS:
                    await room.send_to_organizer({
                        "type": "ERROR",
                        "message": f"Need at least {config.MIN_PLAYERS} players to start"
                    })
                    return
                # Initialize prediction scores
                for p in room.players.values():
                    room.prediction_scores.setdefault(p["nickname"], 0)
                room.state = "QUESTION"
                await room.broadcast({"type": "GAME_STARTING"})
                await self.start_question(room)

            elif msg_type == "NEXT_QUESTION":
                if room.state == "REVEAL":
                    await self.start_question(room)

            elif msg_type == "SKIP_QUESTION":
                if room.state == "QUESTION":
                    if room.timer_task:
                        room.timer_task.cancel()
                        room.timer_task = None
                    await self.start_question(room)

            elif msg_type == "END_GAME":
                if room.state in ("QUESTION", "REVEAL"):
                    if room.timer_task:
                        room.timer_task.cancel()
                        room.timer_task = None
                    await self._send_podium(room)

            elif msg_type == "RESET_ROOM":
                if room.state != "PODIUM":
                    return
                new_prompts = message.get("prompts", room.prompts)
                new_timer = message.get("timer_seconds", room.timer_seconds)
                new_show_votes = message.get("show_votes", room.show_votes)
                room.reset_for_new_game(new_prompts, new_timer, new_show_votes)
                await room.broadcast({
                    "type": "ROOM_RESET",
                    "room_code": room.room_code,
                    "player_count": len(room.players),
                    "players": room.get_player_list(),
                })

        else:
            if msg_type == "JOIN":
                await self._handle_join(room, client_id, message)

            elif msg_type == "VOTE":
                await self._handle_vote(room, client_id, message)

    async def _handle_join(self, room: Room, client_id: str, message: dict):
        nickname = message.get("nickname", "").strip()
        nickname = re.sub(r'<[^>]+>', '', nickname).strip()
        if not nickname or len(nickname) > config.MAX_NICKNAME_LENGTH:
            ws = room.connections.get(client_id)
            if ws:
                await ws.send_json({
                    "type": "ERROR",
                    "message": f"Nickname must be 1-{config.MAX_NICKNAME_LENGTH} characters"
                })
            return

        avatar = message.get("avatar", "")
        if not isinstance(avatar, str):
            avatar = ""
        avatar = avatar[:config.MAX_AVATAR_LENGTH]

        # Reconnection (disconnected mid-game)
        if nickname in room.disconnected_players:
            saved = room.disconnected_players.pop(nickname)
            room.players[client_id] = {
                "nickname": nickname,
                "score": saved["score"],
                "avatar": saved.get("avatar", avatar),
            }
            logger.info("Player '%s' reconnected to room %s", nickname, room.room_code)
            ws = room.connections.get(client_id)
            if ws:
                state_info: dict = {
                    "type": "RECONNECTED",
                    "score": saved["score"],
                    "state": room.state,
                    "prompt_number": room.current_prompt_index + 1,
                    "total_prompts": len(room.prompts),
                    "avatar": saved.get("avatar", avatar),
                    "players": room.get_player_list(),
                }
                if room.state == "QUESTION":
                    state_info["prompt"] = room.prompts[room.current_prompt_index]
                    state_info["timer_seconds"] = room.timer_seconds
                await ws.send_json(state_info)
            return

        # Duplicate nickname: kick old connection
        existing_id = None
        for pid, pdata in room.players.items():
            if pdata["nickname"] == nickname:
                existing_id = pid
                break

        if existing_id:
            old_ws = room.connections.pop(existing_id, None)
            if old_ws:
                try:
                    await old_ws.send_json({"type": "KICKED", "message": "You joined from another device"})
                    await old_ws.close()
                except Exception:
                    pass
            player_data = room.players.pop(existing_id)
            room.players[client_id] = player_data
            ws = room.connections.get(client_id)
            if ws:
                await ws.send_json({
                    "type": "RECONNECTED",
                    "score": player_data["score"],
                    "state": room.state,
                    "prompt_number": room.current_prompt_index + 1,
                    "total_prompts": len(room.prompts),
                    "avatar": player_data.get("avatar", ""),
                    "players": room.get_player_list(),
                })
            return

        room.players[client_id] = {"nickname": nickname, "score": 0, "avatar": avatar}
        room.prediction_scores.setdefault(nickname, 0)
        await room.broadcast({
            "type": "PLAYER_JOINED",
            "nickname": nickname,
            "avatar": avatar,
            "player_count": len(room.players),
            "players": room.get_player_list(),
        })

    async def _handle_vote(self, room: Room, client_id: str, message: dict):
        target = (message.get("target_nickname") or message.get("target", "")).strip()
        if not target:
            return

        # Validate target is an actual player
        valid_nicknames = {p["nickname"] for p in room.players.values()}
        # Also include disconnected players (they're still in the game)
        valid_nicknames.update(room.disconnected_players.keys())
        if target not in valid_nicknames:
            return

        async with room.lock:
            if room.state != "QUESTION" or client_id in room.votes:
                return
            room.votes[client_id] = target
            all_voted = len(room.votes) >= len(room.players)

        # Notify everyone about vote progress (no spoilers)
        await room.broadcast({
            "type": "VOTE_COUNT",
            "voted": len(room.votes),
            "total": len(room.players),
        })

        # Confirm to the voter
        ws = room.connections.get(client_id)
        if ws:
            await ws.send_json({"type": "VOTE_CONFIRMED", "target": target})

        if all_voted:
            if room.timer_task:
                room.timer_task.cancel()
                room.timer_task = None
            await self._end_round(room)

    async def start_question(self, room: Room):
        if room.timer_task:
            room.timer_task.cancel()

        room.current_prompt_index += 1

        if room.current_prompt_index >= len(room.prompts):
            await self._send_podium(room)
            return

        room.state = "QUESTION"
        room.votes = {}

        prompt = room.prompts[room.current_prompt_index]

        await room.broadcast({
            "type": "QUESTION",
            "prompt": prompt,
            "prompt_number": room.current_prompt_index + 1,
            "total_prompts": len(room.prompts),
            "timer_seconds": room.timer_seconds,
            "players": room.get_player_list(),
        })

        room.question_start_time = time.time()
        room.timer_task = asyncio.create_task(self._question_timer(room))

    async def _question_timer(self, room: Room):
        try:
            for remaining in range(room.timer_seconds, 0, -1):
                await room.broadcast({"type": "TIMER", "remaining": remaining})
                await asyncio.sleep(1)
            await self._end_round(room)
        except asyncio.CancelledError:
            pass

    async def _end_round(self, room: Room):
        # Guard against double-fire
        if room.state != "QUESTION":
            return

        room.state = "REVEAL"

        if room.timer_task:
            room.timer_task.cancel()
            room.timer_task = None

        # Tally votes
        vote_tally = Counter(room.votes.values())

        # Build podium (sorted by vote count)
        player_avatars = {}
        for p in room.players.values():
            player_avatars[p["nickname"]] = p.get("avatar", "")
        for nick, data in room.disconnected_players.items():
            player_avatars[nick] = data.get("avatar", "")

        podium = []
        rank = 1
        sorted_entries = sorted(vote_tally.items(), key=lambda x: x[1], reverse=True)
        for i, (nickname, count) in enumerate(sorted_entries):
            if i > 0 and count < sorted_entries[i - 1][1]:
                rank = i + 1
            podium.append({
                "nickname": nickname,
                "avatar": player_avatars.get(nickname, ""),
                "vote_count": count,
                "rank": rank,
            })

        # Determine majority winner(s)
        max_votes = max(vote_tally.values()) if vote_tally else 0
        winners = [name for name, count in vote_tally.items() if count == max_votes] if max_votes > 0 else []

        # Calculate prediction points
        prediction_points: Dict[str, int] = {}
        for voter_cid, target in room.votes.items():
            voter_nick = room.players.get(voter_cid, {}).get("nickname")
            if not voter_nick:
                continue
            if target in winners:
                prediction_points[voter_nick] = config.PREDICTION_POINTS
                room.prediction_scores[voter_nick] = room.prediction_scores.get(voter_nick, 0) + config.PREDICTION_POINTS
                # Also update the player's score
                room.players[voter_cid]["score"] += config.PREDICTION_POINTS
            else:
                prediction_points[voter_nick] = 0

        # Players who didn't vote get 0
        for p in room.players.values():
            if p["nickname"] not in prediction_points:
                prediction_points[p["nickname"]] = 0

        # Build vote list (for breakdown)
        votes_list = []
        for voter_cid, target in room.votes.items():
            voter_nick = room.players.get(voter_cid, {}).get("nickname")
            if voter_nick:
                votes_list.append({"voter": voter_nick, "target": target})

        # Save round history
        prompt = room.prompts[room.current_prompt_index]
        round_result = {
            "prompt": prompt,
            "podium": podium,
            "votes": votes_list,
            "majority_winner": winners[0] if winners else "",
            "prediction_points": prediction_points,
        }
        room.round_history.append(round_result)

        is_final = room.current_prompt_index >= len(room.prompts) - 1

        # Broadcast results
        result_msg: dict = {
            "type": "ROUND_RESULT",
            "prompt": prompt,
            "podium": podium,
            "majority_winner": winners[0] if winners else "",
            "prediction_points": prediction_points,
            "prediction_leaderboard": self._get_prediction_leaderboard(room),
            "prompt_number": room.current_prompt_index + 1,
            "total_prompts": len(room.prompts),
            "is_final": is_final,
        }
        if room.show_votes:
            result_msg["votes"] = votes_list

        await room.broadcast(result_msg)

    async def _send_podium(self, room: Room):
        room.state = "PODIUM"
        superlatives = self._calculate_superlatives(room)
        await room.broadcast({
            "type": "PODIUM",
            "prediction_leaderboard": self._get_prediction_leaderboard(room),
            "superlatives": superlatives,
            "round_history": room.round_history,
        })

    def _get_prediction_leaderboard(self, room: Room) -> list:
        """Get leaderboard sorted by prediction score."""
        player_avatars = {}
        for p in room.players.values():
            player_avatars[p["nickname"]] = p.get("avatar", "")

        entries = []
        for nickname, score in room.prediction_scores.items():
            entries.append({
                "nickname": nickname,
                "avatar": player_avatars.get(nickname, ""),
                "score": score,
            })
        entries.sort(key=lambda x: x["score"], reverse=True)

        # Add ranks
        for i, entry in enumerate(entries):
            entry["rank"] = i + 1
        return entries

    def _calculate_superlatives(self, room: Room) -> list:
        """Calculate fun end-of-game superlatives."""
        superlatives = []

        if not room.round_history:
            return superlatives

        # "Most Likely To Everything" — most total votes received
        total_votes_received: Counter = Counter()
        for rnd in room.round_history:
            for vote in rnd.get("votes", []):
                total_votes_received[vote["target"]] += 1

        if total_votes_received:
            top_voted = total_votes_received.most_common(1)[0]
            player_avatars = {p["nickname"]: p.get("avatar", "") for p in room.players.values()}
            superlatives.append({
                "title": "Most Likely To Everything",
                "winner": top_voted[0],
                "avatar": player_avatars.get(top_voted[0], ""),
                "detail": f"Received {top_voted[1]} total votes",
            })

        # "Narcissist Award" — most self-votes
        self_votes: Counter = Counter()
        for rnd in room.round_history:
            for vote in rnd.get("votes", []):
                if vote["voter"] == vote["target"]:
                    self_votes[vote["voter"]] += 1

        if self_votes:
            top_narcissist = self_votes.most_common(1)[0]
            if top_narcissist[1] > 0:
                player_avatars = {p["nickname"]: p.get("avatar", "") for p in room.players.values()}
                superlatives.append({
                    "title": "Narcissist Award",
                    "winner": top_narcissist[0],
                    "avatar": player_avatars.get(top_narcissist[0], ""),
                    "detail": f"Voted for themselves {top_narcissist[1]} times",
                })

        # "Mind Reader" — highest prediction score
        if room.prediction_scores:
            top_predictor = max(room.prediction_scores.items(), key=lambda x: x[1])
            if top_predictor[1] > 0:
                player_avatars = {p["nickname"]: p.get("avatar", "") for p in room.players.values()}
                superlatives.append({
                    "title": "Mind Reader",
                    "winner": top_predictor[0],
                    "avatar": player_avatars.get(top_predictor[0], ""),
                    "detail": f"Predicted the majority {top_predictor[1] // config.PREDICTION_POINTS} times",
                })

        # "Most Controversial" — most rounds with close vote splits
        controversial_counts: Counter = Counter()
        for rnd in room.round_history:
            podium = rnd.get("podium", [])
            if len(podium) >= 2:
                top_two = sorted(podium, key=lambda x: x["vote_count"], reverse=True)[:2]
                if top_two[0]["vote_count"] - top_two[1]["vote_count"] <= 1:
                    # Close split — both top players get credit
                    controversial_counts[top_two[0]["nickname"]] += 1
                    controversial_counts[top_two[1]["nickname"]] += 1

        if controversial_counts:
            top_controversial = controversial_counts.most_common(1)[0]
            if top_controversial[1] > 0:
                player_avatars = {p["nickname"]: p.get("avatar", "") for p in room.players.values()}
                superlatives.append({
                    "title": "Most Controversial",
                    "winner": top_controversial[0],
                    "avatar": player_avatars.get(top_controversial[0], ""),
                    "detail": f"Part of {top_controversial[1]} close votes",
                })

        return superlatives


socket_manager = SocketManager()
