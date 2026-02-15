"""
End-to-end tests requiring a running Ollama instance.
Run with: make test-e2e (requires Ollama running locally)
Excluded from: make test (via --ignore)
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


def recv_until(ws, msg_type, max_messages=100):
    """Receive WS messages until we get the expected type."""
    for _ in range(max_messages):
        data = ws.receive_json()
        if data.get("type") == msg_type:
            return data
    raise TimeoutError(f"Never received {msg_type} after {max_messages} messages")


def generate_pack(vibe="party", num_prompts=5, custom_theme=""):
    """Generate a prompt pack via the API and return (pack_id, pack_data)."""
    payload = {"vibe": vibe, "num_prompts": num_prompts, "provider": "ollama"}
    if custom_theme:
        payload["custom_theme"] = custom_theme
    res = client.post("/prompts/generate", json=payload)
    assert res.status_code == 200, f"Generation failed: {res.text}"
    data = res.json()
    return data["pack_id"], data["pack"]


def validate_pack(pack_data, expected_min_prompts=1):
    """Assert pack structure is valid."""
    assert isinstance(pack_data, dict)
    assert "title" in pack_data
    assert isinstance(pack_data["title"], str)
    assert len(pack_data["title"]) > 0
    assert "prompts" in pack_data
    prompts = pack_data["prompts"]
    assert isinstance(prompts, list)
    assert len(prompts) >= expected_min_prompts
    for p in prompts:
        assert "id" in p
        assert "text" in p
        assert isinstance(p["text"], str)
        assert len(p["text"]) >= 10


# =====================================================================
# Prompt generation E2E (with Ollama)
# =====================================================================

class TestPromptGenerationE2E:
    def test_generate_party_vibe(self):
        """Generate party prompts and validate structure."""
        pack_id, pack = generate_pack(vibe="party", num_prompts=5)
        print(f"\n  Party pack: '{pack['title']}' ({len(pack['prompts'])} prompts)")
        for p in pack["prompts"][:3]:
            print(f"    - {p['text']}")
        validate_pack(pack, expected_min_prompts=3)

    def test_generate_wholesome_vibe(self):
        """Generate wholesome prompts and validate structure."""
        pack_id, pack = generate_pack(vibe="wholesome", num_prompts=5)
        print(f"\n  Wholesome pack: '{pack['title']}' ({len(pack['prompts'])} prompts)")
        for p in pack["prompts"][:3]:
            print(f"    - {p['text']}")
        validate_pack(pack, expected_min_prompts=3)

    def test_generate_work_vibe(self):
        """Generate work prompts and validate structure."""
        pack_id, pack = generate_pack(vibe="work", num_prompts=5)
        print(f"\n  Work pack: '{pack['title']}' ({len(pack['prompts'])} prompts)")
        for p in pack["prompts"][:3]:
            print(f"    - {p['text']}")
        validate_pack(pack, expected_min_prompts=3)

    def test_generate_spicy_vibe(self):
        """Generate spicy prompts and validate structure."""
        pack_id, pack = generate_pack(vibe="spicy", num_prompts=5)
        print(f"\n  Spicy pack: '{pack['title']}' ({len(pack['prompts'])} prompts)")
        for p in pack["prompts"][:3]:
            print(f"    - {p['text']}")
        validate_pack(pack, expected_min_prompts=3)

    def test_generate_custom_theme(self):
        """Generate prompts with a custom theme."""
        pack_id, pack = generate_pack(
            vibe="custom", num_prompts=5,
            custom_theme="camping trip with friends in the mountains",
        )
        print(f"\n  Custom pack: '{pack['title']}' ({len(pack['prompts'])} prompts)")
        for p in pack["prompts"][:3]:
            print(f"    - {p['text']}")
        validate_pack(pack, expected_min_prompts=3)


# =====================================================================
# Full game E2E
# =====================================================================

class TestFullGameE2E:
    def test_full_game_flow(self):
        """
        Complete game flow:
        1. Generate prompts with Ollama
        2. Create room
        3. Connect organizer + 3 players
        4. Play all rounds
        5. Verify PODIUM with leaderboard and superlatives
        """
        # 1. Generate prompts
        pack_id, pack = generate_pack(vibe="party", num_prompts=3)
        num_prompts = len(pack["prompts"])
        print(f"\n  Generated pack: '{pack['title']}' ({num_prompts} prompts)")

        # 2. Create room
        res = client.post("/room/create", json={
            "pack_id": pack_id, "timer_seconds": 30, "show_votes": True,
        })
        assert res.status_code == 200
        room_code = res.json()["room_code"]
        token = res.json()["organizer_token"]
        print(f"  Room created: {room_code}")

        # 3. Connect organizer
        org_ws = client.websocket_connect(
            f"/ws/{room_code}/org-1?organizer=true&token={token}"
        ).__enter__()
        org_ws.receive_json()  # ROOM_CREATED

        # Connect 3 players
        player_wss = []
        names = ["Alice", "Bob", "Charlie"]
        for i, name in enumerate(names):
            p_ws = client.websocket_connect(f"/ws/{room_code}/p{i}").__enter__()
            p_ws.receive_json()  # JOINED_ROOM
            p_ws.send_json({"type": "JOIN", "nickname": name, "avatar": "😀"})
            recv_until(org_ws, "PLAYER_JOINED")
            player_wss.append(p_ws)
        print(f"  Players joined: {names}")

        # 4. Start game
        org_ws.send_json({"type": "START_GAME"})
        recv_until(org_ws, "QUESTION")
        for ws in player_wss:
            recv_until(ws, "QUESTION")

        # Play all rounds
        for round_num in range(num_prompts):
            if round_num > 0:
                for ws in player_wss:
                    recv_until(ws, "QUESTION")

            # Alice and Bob vote for Charlie, Charlie votes for Alice
            player_wss[0].send_json({"type": "VOTE", "target_nickname": "Charlie"})
            player_wss[1].send_json({"type": "VOTE", "target_nickname": "Charlie"})
            player_wss[2].send_json({"type": "VOTE", "target_nickname": "Alice"})

            result = recv_until(org_ws, "ROUND_RESULT")
            assert result["majority_winner"] == "Charlie"
            assert result["prompt_number"] == round_num + 1
            print(f"  Round {round_num + 1}: winner = {result['majority_winner']}, "
                  f"votes = {result.get('votes', [])}")

            if round_num < num_prompts - 1:
                org_ws.send_json({"type": "NEXT_QUESTION"})
                recv_until(org_ws, "QUESTION")
            else:
                # Last round — advance to podium
                org_ws.send_json({"type": "NEXT_QUESTION"})

        # 5. Verify PODIUM
        podium = recv_until(org_ws, "PODIUM")
        assert "prediction_leaderboard" in podium
        assert "superlatives" in podium
        assert "round_history" in podium
        assert len(podium["round_history"]) == num_prompts

        lb = podium["prediction_leaderboard"]
        print(f"\n  Prediction leaderboard:")
        for entry in lb:
            print(f"    {entry['rank']}. {entry['nickname']}: {entry['score']} pts")

        sups = podium["superlatives"]
        print(f"\n  Superlatives:")
        for s in sups:
            print(f"    {s['title']}: {s['winner']} — {s['detail']}")

        # "Most Likely To Everything" should be Charlie (got all majority votes)
        sup_titles = {s["title"]: s for s in sups}
        assert "Most Likely To Everything" in sup_titles
        assert sup_titles["Most Likely To Everything"]["winner"] == "Charlie"

        # Cleanup
        for ws in player_wss:
            ws.__exit__(None, None, None)
        org_ws.__exit__(None, None, None)


# =====================================================================
# Custom theme E2E
# =====================================================================

class TestCustomThemeE2E:
    def test_custom_theme_game(self):
        """Generate custom theme prompts and play 1 round."""
        pack_id, pack = generate_pack(
            vibe="custom", num_prompts=3,
            custom_theme="90s nostalgia night",
        )
        print(f"\n  Custom pack: '{pack['title']}'")
        for p in pack["prompts"]:
            print(f"    - {p['text']}")

        res = client.post("/room/create", json={"pack_id": pack_id, "timer_seconds": 30})
        assert res.status_code == 200
        room_code = res.json()["room_code"]
        token = res.json()["organizer_token"]

        org_ws = client.websocket_connect(
            f"/ws/{room_code}/org-1?organizer=true&token={token}"
        ).__enter__()
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

        # Play 1 round
        player_wss[0].send_json({"type": "VOTE", "target_nickname": "Bob"})
        player_wss[1].send_json({"type": "VOTE", "target_nickname": "Bob"})
        player_wss[2].send_json({"type": "VOTE", "target_nickname": "Alice"})

        result = recv_until(org_ws, "ROUND_RESULT")
        assert result["majority_winner"] == "Bob"
        print(f"  Round 1 winner: {result['majority_winner']}")

        for ws in player_wss:
            ws.__exit__(None, None, None)
        org_ws.__exit__(None, None, None)


# =====================================================================
# Reconnection E2E
# =====================================================================

class TestReconnectionE2E:
    def test_player_reconnects_mid_game(self):
        """Player disconnects after voting, reconnects and keeps score."""
        pack_id, pack = generate_pack(vibe="party", num_prompts=3)
        print(f"\n  Pack: '{pack['title']}'")

        res = client.post("/room/create", json={"pack_id": pack_id, "timer_seconds": 30})
        assert res.status_code == 200
        room_code = res.json()["room_code"]
        token = res.json()["organizer_token"]

        org_ws = client.websocket_connect(
            f"/ws/{room_code}/org-1?organizer=true&token={token}"
        ).__enter__()
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

        # Round 1 — all vote for Charlie
        for ws in player_wss:
            ws.send_json({"type": "VOTE", "target_nickname": "Charlie"})
        result = recv_until(org_ws, "ROUND_RESULT")
        assert result["majority_winner"] == "Charlie"
        print(f"  Round 1 winner: Charlie")

        # Alice's score should be PREDICTION_POINTS
        alice_points = result["prediction_points"].get("Alice", 0)
        assert alice_points == config.PREDICTION_POINTS

        # Alice disconnects
        player_wss[0].__exit__(None, None, None)
        print("  Alice disconnected")

        # Alice reconnects with new client_id
        new_alice = client.websocket_connect(f"/ws/{room_code}/p-new").__enter__()
        new_alice.receive_json()  # JOINED_ROOM
        new_alice.send_json({"type": "JOIN", "nickname": "Alice", "avatar": "😀"})
        reconnected = recv_until(new_alice, "RECONNECTED")
        assert reconnected["score"] == config.PREDICTION_POINTS
        print(f"  Alice reconnected with score: {reconnected['score']}")

        new_alice.__exit__(None, None, None)
        for ws in player_wss[1:]:
            ws.__exit__(None, None, None)
        org_ws.__exit__(None, None, None)
