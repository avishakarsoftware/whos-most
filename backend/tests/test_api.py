"""
HTTP endpoint integration tests using FastAPI TestClient.
Tests: health, providers, pack CRUD, prompt generation, room creation, rate limiting.
"""
import sys
import os
import uuid
import time

import pytest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from fastapi.testclient import TestClient
from main import app, packs, pack_timestamps, _rate_limit_store
from socket_manager import socket_manager, Room
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
        "title": "Test Pack",
        "prompts": [
            {"id": i + 1, "text": f"Who is most likely to test prompt {i + 1}"}
            for i in range(num_prompts)
        ],
    }
    pack_id = str(uuid.uuid4())
    packs[pack_id] = pack_data
    pack_timestamps[pack_id] = time.time()
    return pack_id


# =====================================================================
# Health endpoints
# =====================================================================

class TestHealthEndpoints:
    def test_root(self):
        res = client.get("/")
        assert res.status_code == 200
        assert "running" in res.json()["message"].lower()

    def test_health(self):
        res = client.get("/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["game"] == "WhosMost"

    def test_system_info(self):
        res = client.get("/system/info")
        assert res.status_code == 200
        assert "ip" in res.json()


# =====================================================================
# Providers
# =====================================================================

class TestProviders:
    def test_get_providers(self):
        res = client.get("/providers")
        assert res.status_code == 200
        providers = res.json()["providers"]
        assert isinstance(providers, list)
        ids = [p["id"] for p in providers]
        assert "ollama" in ids

    def test_provider_structure(self):
        res = client.get("/providers")
        for p in res.json()["providers"]:
            assert "id" in p
            assert "name" in p
            assert "description" in p
            assert "available" in p


# =====================================================================
# Pack CRUD
# =====================================================================

class TestPackCRUD:
    def test_get_existing_pack(self):
        pack_id = seed_pack(5)
        res = client.get(f"/prompts/{pack_id}")
        assert res.status_code == 200
        assert res.json()["title"] == "Test Pack"
        assert len(res.json()["prompts"]) == 5

    def test_get_nonexistent_pack(self):
        res = client.get("/prompts/nonexistent")
        assert res.status_code == 404

    def test_update_pack_success(self):
        pack_id = seed_pack(5)
        new_data = {
            "title": "Updated Pack",
            "prompts": [
                {"id": i + 1, "text": f"Who is most likely to updated prompt {i + 1}"}
                for i in range(4)
            ],
        }
        res = client.put(f"/prompts/{pack_id}", json=new_data)
        assert res.status_code == 200
        assert res.json()["pack"]["title"] == "Updated Pack"
        # Verify persisted
        get_res = client.get(f"/prompts/{pack_id}")
        assert get_res.json()["title"] == "Updated Pack"

    def test_update_pack_not_found(self):
        res = client.put("/prompts/nonexistent", json={
            "title": "T",
            "prompts": [{"id": i, "text": f"Who is most likely to prompt {i}"} for i in range(3)],
        })
        assert res.status_code == 404

    def test_update_pack_too_few_prompts(self):
        pack_id = seed_pack(5)
        res = client.put(f"/prompts/{pack_id}", json={
            "title": "T",
            "prompts": [{"id": 1, "text": "Only one prompt here"}],
        })
        assert res.status_code == 422

    def test_update_pack_invalid_prompt_format(self):
        pack_id = seed_pack(5)
        res = client.put(f"/prompts/{pack_id}", json={
            "title": "T",
            "prompts": [{"missing_id": True}, {"missing_id": True}, {"missing_id": True}],
        })
        assert res.status_code == 422

    def test_delete_prompt_success(self):
        pack_id = seed_pack(5)
        res = client.delete(f"/prompts/{pack_id}/prompt/1")
        assert res.status_code == 200
        remaining_ids = [p["id"] for p in res.json()["pack"]["prompts"]]
        assert 1 not in remaining_ids
        assert len(remaining_ids) == 4

    def test_delete_prompt_not_found(self):
        pack_id = seed_pack(5)
        res = client.delete(f"/prompts/{pack_id}/prompt/999")
        assert res.status_code == 404

    def test_delete_pack_not_found(self):
        res = client.delete("/prompts/nonexistent/prompt/1")
        assert res.status_code == 404

    def test_delete_below_minimum_rejected(self):
        pack_id = seed_pack(config.MIN_PROMPTS)
        res = client.delete(f"/prompts/{pack_id}/prompt/1")
        assert res.status_code == 400


# =====================================================================
# Prompt generation (mocked AI)
# =====================================================================

class TestPromptGeneration:
    @patch("main.prompt_engine.generate_prompts", new_callable=AsyncMock)
    def test_generate_prompts_success(self, mock_gen):
        mock_gen.return_value = {
            "title": "Mocked Pack",
            "prompts": [{"id": i, "text": f"Who is most likely to mock {i}"} for i in range(1, 6)],
        }
        res = client.post("/prompts/generate", json={"vibe": "party", "num_prompts": 5})
        assert res.status_code == 200
        assert "pack_id" in res.json()
        assert res.json()["pack"]["title"] == "Mocked Pack"

    @patch("main.prompt_engine.generate_prompts", new_callable=AsyncMock)
    def test_generate_prompts_failure(self, mock_gen):
        mock_gen.return_value = None
        res = client.post("/prompts/generate", json={"vibe": "party", "num_prompts": 5})
        assert res.status_code == 500

    def test_generate_prompts_validation_error(self):
        res = client.post("/prompts/generate", json={"vibe": "INVALID", "num_prompts": 5})
        assert res.status_code == 422


# =====================================================================
# Room creation
# =====================================================================

class TestRoomCreation:
    def test_create_room_success(self):
        pack_id = seed_pack(5)
        res = client.post("/room/create", json={"pack_id": pack_id, "timer_seconds": 30})
        assert res.status_code == 200
        data = res.json()
        assert len(data["room_code"]) == 6
        assert "organizer_token" in data

    def test_create_room_pack_not_found(self):
        res = client.post("/room/create", json={"pack_id": "nonexistent"})
        assert res.status_code == 404

    def test_create_room_invalid_timer(self):
        pack_id = seed_pack(5)
        res = client.post("/room/create", json={"pack_id": pack_id, "timer_seconds": 5})
        assert res.status_code == 422
        res = client.post("/room/create", json={"pack_id": pack_id, "timer_seconds": 200})
        assert res.status_code == 422

    def test_create_room_default_timer(self):
        pack_id = seed_pack(5)
        res = client.post("/room/create", json={"pack_id": pack_id})
        assert res.status_code == 200


# =====================================================================
# Rate limiting
# =====================================================================

class TestRateLimiting:
    @patch("main.prompt_engine.generate_prompts", new_callable=AsyncMock)
    def test_rate_limit_blocks_excess(self, mock_gen):
        mock_gen.return_value = {
            "title": "Pack",
            "prompts": [{"id": i, "text": f"Who is most likely to prompt {i}"} for i in range(1, 6)],
        }
        statuses = []
        for _ in range(config.RATE_LIMIT_MAX_REQUESTS + 1):
            res = client.post("/prompts/generate", json={"vibe": "party", "num_prompts": 5})
            statuses.append(res.status_code)
        assert statuses.count(200) == config.RATE_LIMIT_MAX_REQUESTS
        assert 429 in statuses

    def test_rate_limit_does_not_affect_other_endpoints(self):
        # Fill up rate limit for generate
        _rate_limit_store["testclient"] = [time.time()] * (config.RATE_LIMIT_MAX_REQUESTS + 5)
        # Other endpoints should still work
        res = client.get("/health")
        assert res.status_code == 200
        res = client.get("/providers")
        assert res.status_code == 200


# =====================================================================
# Max rooms limit
# =====================================================================

class TestMaxRoomsLimit:
    def test_too_many_rooms_rejected(self):
        pack_id = seed_pack(5)
        prompts = packs[pack_id]["prompts"]
        for i in range(config.MAX_ROOMS):
            code = f"RM{i:04d}"
            socket_manager.rooms[code] = Room(code, prompts, 30)
        res = client.post("/room/create", json={"pack_id": pack_id})
        assert res.status_code == 429
