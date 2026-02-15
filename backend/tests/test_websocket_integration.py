"""
WebSocket integration tests using FastAPI TestClient.
Tests: connection, join, voting, game flow, reconnection, spectator.
"""
import sys
import os
import uuid
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from fastapi.testclient import TestClient
from main import app, packs, pack_timestamps, _rate_limit_store
from socket_manager import socket_manager
import config


@pytest.fixture(autouse=True)
def clear_state():
    packs.clear()
    pack_timestamps.clear()
    _rate_limit_store.clear()
    socket_manager.rooms.clear()
    yield
    packs.clear()
    pack_timestamps.clear()
    _rate_limit_store.clear()
    socket_manager.rooms.clear()


client = TestClient(app)


def seed_pack(num_prompts=5):
    """Insert a prompt pack directly and return its id."""
    pack_data = {
        "title": "WS Test Pack",
        "prompts": [
            {"id": i + 1, "text": f"Who is most likely to ws test {i + 1}"}
            for i in range(num_prompts)
        ],
    }
    pack_id = str(uuid.uuid4())
    packs[pack_id] = pack_data
    pack_timestamps[pack_id] = time.time()
    return pack_id


def create_room(pack_id, timer_seconds=30, show_votes=True):
    """Create a room via HTTP and return (room_code, organizer_token)."""
    res = client.post("/room/create", json={
        "pack_id": pack_id, "timer_seconds": timer_seconds,
        "show_votes": show_votes,
    })
    assert res.status_code == 200
    data = res.json()
    return data["room_code"], data["organizer_token"]


def recv_until(ws, msg_type, max_messages=50):
    """Receive WS messages until we get the expected type."""
    for _ in range(max_messages):
        data = ws.receive_json()
        if data.get("type") == msg_type:
            return data
    raise TimeoutError(f"Never received {msg_type} after {max_messages} messages")


# =====================================================================
# Organizer connection
# =====================================================================

class TestOrganizerConnection:
    def test_organizer_receives_room_created(self):
        pack_id = seed_pack()
        room_code, token = create_room(pack_id)
        with client.websocket_connect(
            f"/ws/{room_code}/org-1?organizer=true&token={token}"
        ) as ws:
            msg = ws.receive_json()
            assert msg["type"] == "ROOM_CREATED"
            assert msg["room_code"] == room_code

    def test_organizer_invalid_token_rejected(self):
        pack_id = seed_pack()
        room_code, _ = create_room(pack_id)
        with client.websocket_connect(
            f"/ws/{room_code}/org-1?organizer=true&token=wrong-token"
        ) as ws:
            msg = ws.receive_json()
            assert msg["type"] == "ERROR"
            assert "token" in msg["message"].lower() or "invalid" in msg["message"].lower()

    def test_organizer_no_token_rejected(self):
        pack_id = seed_pack()
        room_code, _ = create_room(pack_id)
        with client.websocket_connect(
            f"/ws/{room_code}/org-1?organizer=true&token="
        ) as ws:
            msg = ws.receive_json()
            assert msg["type"] == "ERROR"

    def test_nonexistent_room_error(self):
        with client.websocket_connect(
            "/ws/NOROOM/org-1?organizer=true&token=fake"
        ) as ws:
            msg = ws.receive_json()
            assert msg["type"] == "ERROR"
            assert "not found" in msg["message"].lower()


# =====================================================================
# Player join
# =====================================================================

class TestPlayerJoin:
    def test_player_joins_successfully(self):
        pack_id = seed_pack()
        room_code, token = create_room(pack_id)
        with client.websocket_connect(f"/ws/{room_code}/org-1?organizer=true&token={token}") as org_ws:
            org_ws.receive_json()  # ROOM_CREATED
            with client.websocket_connect(f"/ws/{room_code}/p1") as p_ws:
                joined = p_ws.receive_json()  # JOINED_ROOM
                assert joined["type"] == "JOINED_ROOM"
                p_ws.send_json({"type": "JOIN", "nickname": "Alice", "avatar": "😀"})
                player_joined = recv_until(org_ws, "PLAYER_JOINED")
                assert player_joined["nickname"] == "Alice"
                assert player_joined["player_count"] == 1

    def test_player_join_broadcasts_to_organizer(self):
        pack_id = seed_pack()
        room_code, token = create_room(pack_id)
        with client.websocket_connect(f"/ws/{room_code}/org-1?organizer=true&token={token}") as org_ws:
            org_ws.receive_json()  # ROOM_CREATED
            with client.websocket_connect(f"/ws/{room_code}/p1") as p_ws:
                p_ws.receive_json()  # JOINED_ROOM
                p_ws.send_json({"type": "JOIN", "nickname": "Bob", "avatar": "🎸"})
                msg = recv_until(org_ws, "PLAYER_JOINED")
                assert msg["nickname"] == "Bob"
                assert msg["avatar"] == "🎸"
                assert "players" in msg
                assert "player_count" in msg

    def test_empty_nickname_rejected(self):
        pack_id = seed_pack()
        room_code, token = create_room(pack_id)
        with client.websocket_connect(f"/ws/{room_code}/org-1?organizer=true&token={token}") as org_ws:
            org_ws.receive_json()
            with client.websocket_connect(f"/ws/{room_code}/p1") as p_ws:
                p_ws.receive_json()
                p_ws.send_json({"type": "JOIN", "nickname": "", "avatar": ""})
                err = recv_until(p_ws, "ERROR")
                assert "nickname" in err["message"].lower() or "character" in err["message"].lower()

    def test_html_in_nickname_stripped(self):
        pack_id = seed_pack()
        room_code, token = create_room(pack_id)
        with client.websocket_connect(f"/ws/{room_code}/org-1?organizer=true&token={token}") as org_ws:
            org_ws.receive_json()
            with client.websocket_connect(f"/ws/{room_code}/p1") as p_ws:
                p_ws.receive_json()
                p_ws.send_json({"type": "JOIN", "nickname": "<b>Alice</b>", "avatar": "😀"})
                msg = recv_until(org_ws, "PLAYER_JOINED")
                assert "<b>" not in msg["nickname"]
                assert msg["nickname"] == "Alice"

    def test_three_players_join(self):
        pack_id = seed_pack()
        room_code, token = create_room(pack_id)
        with client.websocket_connect(f"/ws/{room_code}/org-1?organizer=true&token={token}") as org_ws:
            org_ws.receive_json()
            players = []
            for i, name in enumerate(["Alice", "Bob", "Charlie"]):
                ws = client.websocket_connect(f"/ws/{room_code}/p{i}")
                ws_ctx = ws.__enter__()
                ws_ctx.receive_json()  # JOINED_ROOM
                ws_ctx.send_json({"type": "JOIN", "nickname": name, "avatar": "😀"})
                msg = recv_until(org_ws, "PLAYER_JOINED")
                assert msg["player_count"] == i + 1
                players.append(ws_ctx)
            for ws_ctx in players:
                ws_ctx.__exit__(None, None, None)


# =====================================================================
# Game start
# =====================================================================

class TestGameStart:
    def _setup_room_with_players(self, num_prompts=5, num_players=3):
        """Helper to create room + organizer + players, return (org_ws, player_wss, room_code)."""
        pack_id = seed_pack(num_prompts)
        room_code, token = create_room(pack_id)
        org_ws = client.websocket_connect(f"/ws/{room_code}/org-1?organizer=true&token={token}").__enter__()
        org_ws.receive_json()  # ROOM_CREATED

        player_wss = []
        names = ["Alice", "Bob", "Charlie", "Dave", "Eve"][:num_players]
        for i, name in enumerate(names):
            p_ws = client.websocket_connect(f"/ws/{room_code}/p{i}").__enter__()
            p_ws.receive_json()  # JOINED_ROOM
            p_ws.send_json({"type": "JOIN", "nickname": name, "avatar": "😀"})
            recv_until(org_ws, "PLAYER_JOINED")
            player_wss.append(p_ws)

        return org_ws, player_wss, room_code

    def _cleanup(self, org_ws, player_wss):
        for ws in player_wss:
            ws.__exit__(None, None, None)
        org_ws.__exit__(None, None, None)

    def test_start_game_broadcasts_question(self):
        org_ws, player_wss, _ = self._setup_room_with_players()
        try:
            org_ws.send_json({"type": "START_GAME"})
            # All should get GAME_STARTING then QUESTION
            question = recv_until(org_ws, "QUESTION")
            assert question["prompt_number"] == 1
        finally:
            self._cleanup(org_ws, player_wss)

    def test_start_game_requires_min_players(self):
        pack_id = seed_pack()
        room_code, token = create_room(pack_id)
        with client.websocket_connect(f"/ws/{room_code}/org-1?organizer=true&token={token}") as org_ws:
            org_ws.receive_json()  # ROOM_CREATED
            # Only 1 player — below MIN_PLAYERS
            with client.websocket_connect(f"/ws/{room_code}/p1") as p_ws:
                p_ws.receive_json()
                p_ws.send_json({"type": "JOIN", "nickname": "Solo", "avatar": "😀"})
                recv_until(org_ws, "PLAYER_JOINED")
                org_ws.send_json({"type": "START_GAME"})
                err = recv_until(org_ws, "ERROR")
                assert "player" in err["message"].lower()

    def test_question_message_format(self):
        org_ws, player_wss, _ = self._setup_room_with_players()
        try:
            org_ws.send_json({"type": "START_GAME"})
            q = recv_until(player_wss[0], "QUESTION")
            assert "prompt" in q
            assert "id" in q["prompt"]
            assert "text" in q["prompt"]
            assert q["prompt_number"] == 1
            assert q["total_prompts"] == 5
            assert "timer_seconds" in q
            assert "players" in q
        finally:
            self._cleanup(org_ws, player_wss)


# =====================================================================
# Voting flow
# =====================================================================

class TestVotingFlow:
    def _setup_and_start(self, num_prompts=5):
        pack_id = seed_pack(num_prompts)
        room_code, token = create_room(pack_id)
        org_ws = client.websocket_connect(f"/ws/{room_code}/org-1?organizer=true&token={token}").__enter__()
        org_ws.receive_json()  # ROOM_CREATED

        player_wss = []
        for i, name in enumerate(["Alice", "Bob", "Charlie"]):
            p_ws = client.websocket_connect(f"/ws/{room_code}/p{i}").__enter__()
            p_ws.receive_json()
            p_ws.send_json({"type": "JOIN", "nickname": name, "avatar": "😀"})
            recv_until(org_ws, "PLAYER_JOINED")
            player_wss.append(p_ws)

        org_ws.send_json({"type": "START_GAME"})
        recv_until(org_ws, "QUESTION")
        for ws in player_wss:
            recv_until(ws, "QUESTION")

        return org_ws, player_wss, room_code

    def _cleanup(self, org_ws, player_wss):
        for ws in player_wss:
            ws.__exit__(None, None, None)
        org_ws.__exit__(None, None, None)

    def test_vote_broadcasts_count(self):
        org_ws, player_wss, _ = self._setup_and_start()
        try:
            player_wss[0].send_json({"type": "VOTE", "target_nickname": "Bob"})
            vote_count = recv_until(org_ws, "VOTE_COUNT")
            assert vote_count["voted"] == 1
            assert vote_count["total"] == 3
        finally:
            self._cleanup(org_ws, player_wss)

    def test_vote_confirmed_to_voter(self):
        org_ws, player_wss, _ = self._setup_and_start()
        try:
            player_wss[0].send_json({"type": "VOTE", "target_nickname": "Bob"})
            confirm = recv_until(player_wss[0], "VOTE_CONFIRMED")
            assert confirm["target"] == "Bob"
        finally:
            self._cleanup(org_ws, player_wss)

    def test_all_voted_ends_round(self):
        org_ws, player_wss, _ = self._setup_and_start()
        try:
            player_wss[0].send_json({"type": "VOTE", "target_nickname": "Charlie"})
            player_wss[1].send_json({"type": "VOTE", "target_nickname": "Charlie"})
            player_wss[2].send_json({"type": "VOTE", "target_nickname": "Alice"})
            result = recv_until(org_ws, "ROUND_RESULT")
            assert result["type"] == "ROUND_RESULT"
            assert "podium" in result
        finally:
            self._cleanup(org_ws, player_wss)

    def test_vote_for_self_allowed(self):
        org_ws, player_wss, _ = self._setup_and_start()
        try:
            player_wss[0].send_json({"type": "VOTE", "target_nickname": "Alice"})
            confirm = recv_until(player_wss[0], "VOTE_CONFIRMED")
            assert confirm["target"] == "Alice"
        finally:
            self._cleanup(org_ws, player_wss)

    def test_duplicate_vote_ignored(self):
        org_ws, player_wss, _ = self._setup_and_start()
        try:
            player_wss[0].send_json({"type": "VOTE", "target_nickname": "Bob"})
            recv_until(player_wss[0], "VOTE_CONFIRMED")
            # Second vote — should be silently ignored
            player_wss[0].send_json({"type": "VOTE", "target_nickname": "Charlie"})
            # Complete the round with other players
            player_wss[1].send_json({"type": "VOTE", "target_nickname": "Alice"})
            player_wss[2].send_json({"type": "VOTE", "target_nickname": "Bob"})
            result = recv_until(org_ws, "ROUND_RESULT")
            # Alice's vote should still be Bob (first vote), not Charlie
            votes = result.get("votes", [])
            alice_vote = next((v for v in votes if v["voter"] == "Alice"), None)
            if alice_vote:
                assert alice_vote["target"] == "Bob"
        finally:
            self._cleanup(org_ws, player_wss)

    def test_round_result_contains_podium(self):
        org_ws, player_wss, _ = self._setup_and_start()
        try:
            player_wss[0].send_json({"type": "VOTE", "target_nickname": "Charlie"})
            player_wss[1].send_json({"type": "VOTE", "target_nickname": "Charlie"})
            player_wss[2].send_json({"type": "VOTE", "target_nickname": "Alice"})
            result = recv_until(org_ws, "ROUND_RESULT")
            podium = result["podium"]
            assert len(podium) >= 1
            assert podium[0]["nickname"] == "Charlie"
            assert podium[0]["vote_count"] == 2
            assert podium[0]["rank"] == 1
        finally:
            self._cleanup(org_ws, player_wss)


# =====================================================================
# Round result details
# =====================================================================

class TestRoundResult:
    def _play_round(self, show_votes=True, num_prompts=5):
        pack_id = seed_pack(num_prompts)
        room_code, token = create_room(pack_id, show_votes=show_votes)
        org_ws = client.websocket_connect(f"/ws/{room_code}/org-1?organizer=true&token={token}").__enter__()
        org_ws.receive_json()

        player_wss = []
        for i, name in enumerate(["Alice", "Bob", "Charlie"]):
            p_ws = client.websocket_connect(f"/ws/{room_code}/p{i}").__enter__()
            p_ws.receive_json()
            p_ws.send_json({"type": "JOIN", "nickname": name, "avatar": "😀"})
            recv_until(org_ws, "PLAYER_JOINED")
            player_wss.append(p_ws)

        org_ws.send_json({"type": "START_GAME"})
        recv_until(org_ws, "QUESTION")
        for ws in player_wss:
            recv_until(ws, "QUESTION")

        # Alice and Bob vote Charlie, Charlie votes Alice
        player_wss[0].send_json({"type": "VOTE", "target_nickname": "Charlie"})
        player_wss[1].send_json({"type": "VOTE", "target_nickname": "Charlie"})
        player_wss[2].send_json({"type": "VOTE", "target_nickname": "Alice"})

        result = recv_until(org_ws, "ROUND_RESULT")
        return result, org_ws, player_wss

    def _cleanup(self, org_ws, player_wss):
        for ws in player_wss:
            ws.__exit__(None, None, None)
        org_ws.__exit__(None, None, None)

    def test_majority_winner_identified(self):
        result, org_ws, player_wss = self._play_round()
        try:
            assert result["majority_winner"] == "Charlie"
        finally:
            self._cleanup(org_ws, player_wss)

    def test_prediction_points_awarded(self):
        result, org_ws, player_wss = self._play_round()
        try:
            pp = result["prediction_points"]
            # Alice and Bob voted for Charlie (winner) — they get points
            assert pp["Alice"] == config.PREDICTION_POINTS
            assert pp["Bob"] == config.PREDICTION_POINTS
            # Charlie voted for Alice (not winner) — 0 points
            assert pp["Charlie"] == 0
        finally:
            self._cleanup(org_ws, player_wss)

    def test_vote_breakdown_when_show_votes(self):
        result, org_ws, player_wss = self._play_round(show_votes=True)
        try:
            assert "votes" in result
            assert len(result["votes"]) == 3
        finally:
            self._cleanup(org_ws, player_wss)

    def test_vote_breakdown_hidden(self):
        result, org_ws, player_wss = self._play_round(show_votes=False)
        try:
            assert "votes" not in result
        finally:
            self._cleanup(org_ws, player_wss)


# =====================================================================
# Multi-round flow
# =====================================================================

class TestMultiRoundFlow:
    def _setup_game(self, num_prompts=3):
        pack_id = seed_pack(num_prompts)
        room_code, token = create_room(pack_id)
        org_ws = client.websocket_connect(f"/ws/{room_code}/org-1?organizer=true&token={token}").__enter__()
        org_ws.receive_json()

        player_wss = []
        for i, name in enumerate(["Alice", "Bob", "Charlie"]):
            p_ws = client.websocket_connect(f"/ws/{room_code}/p{i}").__enter__()
            p_ws.receive_json()
            p_ws.send_json({"type": "JOIN", "nickname": name, "avatar": "😀"})
            recv_until(org_ws, "PLAYER_JOINED")
            player_wss.append(p_ws)

        org_ws.send_json({"type": "START_GAME"})
        recv_until(org_ws, "QUESTION")
        for ws in player_wss:
            recv_until(ws, "QUESTION")

        return org_ws, player_wss, room_code

    def _vote_all(self, player_wss, target="Charlie"):
        for ws in player_wss:
            ws.send_json({"type": "VOTE", "target_nickname": target})

    def _cleanup(self, org_ws, player_wss):
        for ws in player_wss:
            ws.__exit__(None, None, None)
        org_ws.__exit__(None, None, None)

    def test_next_question_advances(self):
        org_ws, player_wss, _ = self._setup_game(num_prompts=3)
        try:
            self._vote_all(player_wss)
            result = recv_until(org_ws, "ROUND_RESULT")
            assert result["prompt_number"] == 1

            org_ws.send_json({"type": "NEXT_QUESTION"})
            q2 = recv_until(org_ws, "QUESTION")
            assert q2["prompt_number"] == 2
        finally:
            self._cleanup(org_ws, player_wss)

    def test_full_game_to_podium(self):
        org_ws, player_wss, _ = self._setup_game(num_prompts=3)
        try:
            for round_num in range(3):
                # Drain QUESTION for players on rounds 2+
                if round_num > 0:
                    for ws in player_wss:
                        recv_until(ws, "QUESTION")

                self._vote_all(player_wss)
                result = recv_until(org_ws, "ROUND_RESULT")
                assert result["prompt_number"] == round_num + 1

                if round_num < 2:
                    org_ws.send_json({"type": "NEXT_QUESTION"})
                    recv_until(org_ws, "QUESTION")
                else:
                    # After last round, organizer sends NEXT_QUESTION → PODIUM
                    org_ws.send_json({"type": "NEXT_QUESTION"})

            podium = recv_until(org_ws, "PODIUM")
            assert "prediction_leaderboard" in podium
            assert "superlatives" in podium
            assert "round_history" in podium
            assert len(podium["round_history"]) == 3
        finally:
            self._cleanup(org_ws, player_wss)

    def test_podium_superlatives_present(self):
        org_ws, player_wss, _ = self._setup_game(num_prompts=3)
        try:
            for round_num in range(3):
                if round_num > 0:
                    for ws in player_wss:
                        recv_until(ws, "QUESTION")
                self._vote_all(player_wss)
                recv_until(org_ws, "ROUND_RESULT")
                if round_num < 2:
                    org_ws.send_json({"type": "NEXT_QUESTION"})
                    recv_until(org_ws, "QUESTION")
                else:
                    org_ws.send_json({"type": "NEXT_QUESTION"})

            podium = recv_until(org_ws, "PODIUM")
            assert isinstance(podium["superlatives"], list)
        finally:
            self._cleanup(org_ws, player_wss)


# =====================================================================
# Organizer controls
# =====================================================================

class TestOrganizerControls:
    def _setup_game(self, num_prompts=5):
        pack_id = seed_pack(num_prompts)
        room_code, token = create_room(pack_id)
        org_ws = client.websocket_connect(f"/ws/{room_code}/org-1?organizer=true&token={token}").__enter__()
        org_ws.receive_json()

        player_wss = []
        for i, name in enumerate(["Alice", "Bob", "Charlie"]):
            p_ws = client.websocket_connect(f"/ws/{room_code}/p{i}").__enter__()
            p_ws.receive_json()
            p_ws.send_json({"type": "JOIN", "nickname": name, "avatar": "😀"})
            recv_until(org_ws, "PLAYER_JOINED")
            player_wss.append(p_ws)

        org_ws.send_json({"type": "START_GAME"})
        recv_until(org_ws, "QUESTION")
        for ws in player_wss:
            recv_until(ws, "QUESTION")

        return org_ws, player_wss, room_code

    def _vote_all(self, player_wss, target="Charlie"):
        for ws in player_wss:
            ws.send_json({"type": "VOTE", "target_nickname": target})

    def _cleanup(self, org_ws, player_wss):
        for ws in player_wss:
            ws.__exit__(None, None, None)
        org_ws.__exit__(None, None, None)

    def test_skip_question(self):
        org_ws, player_wss, _ = self._setup_game()
        try:
            org_ws.send_json({"type": "SKIP_QUESTION"})
            q2 = recv_until(org_ws, "QUESTION")
            assert q2["prompt_number"] == 2
        finally:
            self._cleanup(org_ws, player_wss)

    def test_end_game_early(self):
        org_ws, player_wss, _ = self._setup_game()
        try:
            org_ws.send_json({"type": "END_GAME"})
            podium = recv_until(org_ws, "PODIUM")
            assert "prediction_leaderboard" in podium
        finally:
            self._cleanup(org_ws, player_wss)

    def test_next_question_only_during_reveal(self):
        """NEXT_QUESTION during QUESTION state should be ignored."""
        org_ws, player_wss, room_code = self._setup_game()
        try:
            # We're in QUESTION state. NEXT_QUESTION should be ignored.
            org_ws.send_json({"type": "NEXT_QUESTION"})
            # Now actually vote to complete the round
            self._vote_all(player_wss)
            result = recv_until(org_ws, "ROUND_RESULT")
            # Should still be prompt 1 (NEXT_QUESTION was ignored)
            assert result["prompt_number"] == 1
        finally:
            self._cleanup(org_ws, player_wss)

    def test_reset_room(self):
        org_ws, player_wss, _ = self._setup_game(num_prompts=3)
        try:
            # Play to PODIUM
            for round_num in range(3):
                if round_num > 0:
                    for ws in player_wss:
                        recv_until(ws, "QUESTION")
                self._vote_all(player_wss)
                recv_until(org_ws, "ROUND_RESULT")
                if round_num < 2:
                    org_ws.send_json({"type": "NEXT_QUESTION"})
                    recv_until(org_ws, "QUESTION")
                else:
                    org_ws.send_json({"type": "NEXT_QUESTION"})
            recv_until(org_ws, "PODIUM")

            # Now reset
            org_ws.send_json({"type": "RESET_ROOM"})
            reset = recv_until(org_ws, "ROOM_RESET")
            assert "players" in reset
            assert "player_count" in reset
            # Room state should be back to LOBBY
            room = socket_manager.rooms.get(reset["room_code"])
            assert room is not None
            assert room.state == "LOBBY"
        finally:
            self._cleanup(org_ws, player_wss)


# =====================================================================
# Reconnection
# =====================================================================

class TestReconnection:
    def test_player_reconnects_with_data(self):
        pack_id = seed_pack(3)
        room_code, token = create_room(pack_id)
        org_ws = client.websocket_connect(f"/ws/{room_code}/org-1?organizer=true&token={token}").__enter__()
        org_ws.receive_json()

        player_wss = []
        for i, name in enumerate(["Alice", "Bob", "Charlie"]):
            p_ws = client.websocket_connect(f"/ws/{room_code}/p{i}").__enter__()
            p_ws.receive_json()
            p_ws.send_json({"type": "JOIN", "nickname": name, "avatar": "😀"})
            recv_until(org_ws, "PLAYER_JOINED")
            player_wss.append(p_ws)

        # Start game, play 1 round so Alice gets a score
        org_ws.send_json({"type": "START_GAME"})
        recv_until(org_ws, "QUESTION")
        for ws in player_wss:
            recv_until(ws, "QUESTION")

        # All vote for Charlie — Alice and Bob get prediction points
        for ws in player_wss:
            ws.send_json({"type": "VOTE", "target_nickname": "Charlie"})
        recv_until(org_ws, "ROUND_RESULT")

        # Alice disconnects mid-game (during REVEAL)
        player_wss[0].__exit__(None, None, None)

        # Alice reconnects
        new_ws = client.websocket_connect(f"/ws/{room_code}/p-new").__enter__()
        new_ws.receive_json()  # JOINED_ROOM
        new_ws.send_json({"type": "JOIN", "nickname": "Alice", "avatar": "😀"})
        reconnected = recv_until(new_ws, "RECONNECTED")
        assert reconnected["score"] == config.PREDICTION_POINTS
        assert reconnected["state"] == "REVEAL"

        new_ws.__exit__(None, None, None)
        for ws in player_wss[1:]:
            ws.__exit__(None, None, None)
        org_ws.__exit__(None, None, None)

    def test_disconnect_in_lobby_removes_player(self):
        pack_id = seed_pack()
        room_code, token = create_room(pack_id)
        with client.websocket_connect(f"/ws/{room_code}/org-1?organizer=true&token={token}") as org_ws:
            org_ws.receive_json()
            with client.websocket_connect(f"/ws/{room_code}/p1") as p_ws:
                p_ws.receive_json()
                p_ws.send_json({"type": "JOIN", "nickname": "Alice", "avatar": "😀"})
                recv_until(org_ws, "PLAYER_JOINED")
            # p1 disconnected (exited context)
            room = socket_manager.rooms[room_code]
            assert "p1" not in room.players
            assert "Alice" not in room.disconnected_players

    def test_duplicate_nickname_kicks_old(self):
        pack_id = seed_pack()
        room_code, token = create_room(pack_id)
        org_ws = client.websocket_connect(f"/ws/{room_code}/org-1?organizer=true&token={token}").__enter__()
        org_ws.receive_json()

        # First Alice joins
        p1_ws = client.websocket_connect(f"/ws/{room_code}/p1").__enter__()
        p1_ws.receive_json()
        p1_ws.send_json({"type": "JOIN", "nickname": "Alice", "avatar": "😀"})
        recv_until(org_ws, "PLAYER_JOINED")

        # Second Alice joins with new client_id
        p2_ws = client.websocket_connect(f"/ws/{room_code}/p2").__enter__()
        p2_ws.receive_json()
        p2_ws.send_json({"type": "JOIN", "nickname": "Alice", "avatar": "😀"})

        # Old Alice gets KICKED
        kicked = recv_until(p1_ws, "KICKED")
        assert "another device" in kicked["message"].lower()

        # New Alice gets RECONNECTED
        reconnected = recv_until(p2_ws, "RECONNECTED")
        assert reconnected["score"] == 0

        p1_ws.__exit__(None, None, None)
        p2_ws.__exit__(None, None, None)
        org_ws.__exit__(None, None, None)

    def test_organizer_reconnects(self):
        pack_id = seed_pack()
        room_code, token = create_room(pack_id)

        # First connect
        org_ws = client.websocket_connect(f"/ws/{room_code}/org-1?organizer=true&token={token}").__enter__()
        org_ws.receive_json()  # ROOM_CREATED

        # Add a player so organizer sync has data
        p_ws = client.websocket_connect(f"/ws/{room_code}/p1").__enter__()
        p_ws.receive_json()
        p_ws.send_json({"type": "JOIN", "nickname": "Alice", "avatar": "😀"})
        recv_until(org_ws, "PLAYER_JOINED")

        # Organizer disconnects
        org_ws.__exit__(None, None, None)

        # Organizer reconnects
        org_ws2 = client.websocket_connect(f"/ws/{room_code}/org-2?organizer=true&token={token}").__enter__()
        sync = org_ws2.receive_json()
        assert sync["type"] == "ORGANIZER_RECONNECTED"
        assert sync["player_count"] == 1
        assert len(sync["players"]) == 1

        org_ws2.__exit__(None, None, None)
        p_ws.__exit__(None, None, None)


# =====================================================================
# Spectator
# =====================================================================

class TestSpectator:
    def test_spectator_receives_sync(self):
        pack_id = seed_pack()
        room_code, token = create_room(pack_id)
        with client.websocket_connect(f"/ws/{room_code}/org-1?organizer=true&token={token}") as org_ws:
            org_ws.receive_json()
            with client.websocket_connect(f"/ws/{room_code}/spec-1?spectator=true") as spec_ws:
                sync = spec_ws.receive_json()
                assert sync["type"] == "SPECTATOR_SYNC"
                assert sync["room_code"] == room_code
                assert sync["state"] == "LOBBY"
                assert "players" in sync
                assert "player_count" in sync

    def test_spectator_not_counted_as_player(self):
        pack_id = seed_pack()
        room_code, token = create_room(pack_id)
        with client.websocket_connect(f"/ws/{room_code}/org-1?organizer=true&token={token}") as org_ws:
            org_ws.receive_json()
            with client.websocket_connect(f"/ws/{room_code}/spec-1?spectator=true") as spec_ws:
                sync = spec_ws.receive_json()
                assert sync["player_count"] == 0

    def test_spectator_in_spectators_dict(self):
        pack_id = seed_pack()
        room_code, token = create_room(pack_id)
        with client.websocket_connect(f"/ws/{room_code}/org-1?organizer=true&token={token}") as org_ws:
            org_ws.receive_json()
            with client.websocket_connect(f"/ws/{room_code}/spec-1?spectator=true") as spec_ws:
                spec_ws.receive_json()
                room = socket_manager.rooms[room_code]
                assert "spec-1" in room.spectators
                assert "spec-1" not in room.players
