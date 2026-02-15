"""WhosMost — Who's Most Likely To — Backend Server"""

from fastapi import FastAPI, WebSocket, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from typing import Dict
from collections import defaultdict
import re
import time
from contextlib import asynccontextmanager
import uvicorn
import uuid
import random
import string
import secrets
import logging
import socket as socketlib

import config
config.setup_logging()

from prompt_engine import prompt_engine, _sanitize_pack
from socket_manager import socket_manager

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting WhosMost backend")
    socket_manager.start_cleanup_loop()
    yield
    logger.info("Shutting down WhosMost backend")


app = FastAPI(title="WhosMost API", lifespan=lifespan)


def get_local_ip():
    try:
        s = socketlib.socket(socketlib.AF_INET, socketlib.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


@app.get("/system/info")
async def get_system_info():
    return {"ip": get_local_ip()}


# Rate limiter
_rate_limit_store: Dict[str, list] = defaultdict(list)


def _check_rate_limit(client_ip: str) -> bool:
    now = time.time()
    window = config.RATE_LIMIT_WINDOW
    _rate_limit_store[client_ip] = [
        t for t in _rate_limit_store[client_ip] if now - t < window
    ]
    if len(_rate_limit_store[client_ip]) >= config.RATE_LIMIT_MAX_REQUESTS:
        return False
    _rate_limit_store[client_ip].append(now)
    return True


# In-memory storage
packs: Dict[str, dict] = {}  # pack_id -> {title, prompts}
pack_timestamps: Dict[str, float] = {}


def _evict_old_packs():
    now = time.time()
    expired = [pid for pid, ts in pack_timestamps.items()
               if now - ts > config.PACK_TTL_SECONDS]
    for pid in expired:
        packs.pop(pid, None)
        pack_timestamps.pop(pid, None)
    while len(packs) >= config.MAX_PACKS and pack_timestamps:
        oldest_id = min(pack_timestamps, key=pack_timestamps.get)
        packs.pop(oldest_id, None)
        pack_timestamps.pop(oldest_id, None)


def generate_room_code() -> str:
    for _ in range(config.MAX_ROOM_CODE_ATTEMPTS):
        code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
        if code not in socket_manager.rooms:
            return code
    raise RuntimeError("Failed to generate unique room code")


# --- Request Models ---

class PromptGenerateRequest(BaseModel):
    vibe: str = "party"
    num_prompts: int = config.DEFAULT_NUM_PROMPTS
    provider: str = ""
    custom_theme: str = ""

    @field_validator('vibe')
    @classmethod
    def validate_vibe(cls, v: str) -> str:
        v = v.lower().strip()
        if v not in config.VALID_VIBES:
            raise ValueError(f'Vibe must be one of: {", ".join(config.VALID_VIBES)}')
        return v

    @field_validator('num_prompts')
    @classmethod
    def validate_num_prompts(cls, v: int) -> int:
        if v < config.MIN_PROMPTS or v > config.MAX_PROMPTS:
            raise ValueError(f'Number of prompts must be {config.MIN_PROMPTS}-{config.MAX_PROMPTS}')
        return v

    @field_validator('custom_theme')
    @classmethod
    def validate_custom_theme(cls, v: str) -> str:
        v = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', v)
        v = re.sub(r'<[^>]+>', '', v)
        v = v.strip()
        if len(v) > config.MAX_PROMPT_LENGTH:
            raise ValueError(f'Custom theme must be under {config.MAX_PROMPT_LENGTH} characters')
        injection_patterns = [
            r'ignore\s+(all\s+)?previous\s+instructions',
            r'ignore\s+(all\s+)?above',
            r'disregard\s+(all\s+)?previous',
            r'you\s+are\s+now\s+(?:a|an|in)',
            r'new\s+instructions?\s*:',
            r'system\s*:\s*',
            r'<\s*/?script',
            r'javascript\s*:',
        ]
        lower_v = v.lower()
        for pattern in injection_patterns:
            if re.search(pattern, lower_v):
                raise ValueError('Theme contains disallowed content')
        return v


class RoomCreateRequest(BaseModel):
    pack_id: str
    timer_seconds: int = config.DEFAULT_TIMER_SECONDS
    show_votes: bool = True

    @field_validator('timer_seconds')
    @classmethod
    def validate_timer(cls, v: int) -> int:
        if v < 15 or v > 120:
            raise ValueError('Timer must be between 15 and 120 seconds')
        return v


class PackUpdateRequest(BaseModel):
    title: str
    prompts: list

    @field_validator('prompts')
    @classmethod
    def validate_prompts(cls, v: list) -> list:
        if len(v) < config.MIN_PROMPTS:
            raise ValueError(f'Must have at least {config.MIN_PROMPTS} prompts')
        for p in v:
            if not isinstance(p, dict):
                raise ValueError('Each prompt must be an object')
            if not all(k in p for k in ('id', 'text')):
                raise ValueError('Prompt missing required fields (id, text)')
        return v


# --- Endpoints ---

@app.get("/providers")
async def get_providers():
    return {"providers": prompt_engine.get_available_providers()}


@app.post("/prompts/generate")
async def generate_prompts(request: PromptGenerateRequest, req: Request):
    client_ip = req.client.host if req.client else "unknown"
    if not _check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="Too many requests. Please wait.")

    pack_data = await prompt_engine.generate_prompts(
        vibe=request.vibe,
        num_prompts=request.num_prompts,
        provider=request.provider,
        custom_theme=request.custom_theme,
    )
    if not pack_data:
        raise HTTPException(status_code=500, detail="Failed to generate prompts")

    _evict_old_packs()
    pack_id = str(uuid.uuid4())
    packs[pack_id] = pack_data
    pack_timestamps[pack_id] = time.time()
    logger.info("Pack created: %s ('%s')", pack_id, pack_data.get("title", "Untitled"))
    return {"pack_id": pack_id, "pack": pack_data}


@app.get("/prompts/{pack_id}")
async def get_pack(pack_id: str):
    if pack_id not in packs:
        raise HTTPException(status_code=404, detail="Prompt pack not found")
    return packs[pack_id]


@app.put("/prompts/{pack_id}")
async def update_pack(pack_id: str, request: PackUpdateRequest):
    if pack_id not in packs:
        raise HTTPException(status_code=404, detail="Prompt pack not found")
    pack_data = {"title": request.title, "prompts": request.prompts}
    pack_data = _sanitize_pack(pack_data)
    packs[pack_id] = pack_data
    logger.info("Pack updated: %s ('%s'), %d prompts", pack_id, pack_data["title"], len(pack_data["prompts"]))
    return {"pack_id": pack_id, "pack": packs[pack_id]}


@app.delete("/prompts/{pack_id}/prompt/{prompt_id}")
async def delete_prompt(pack_id: str, prompt_id: int):
    if pack_id not in packs:
        raise HTTPException(status_code=404, detail="Prompt pack not found")
    pack = packs[pack_id]
    original_len = len(pack["prompts"])
    pack["prompts"] = [p for p in pack["prompts"] if p["id"] != prompt_id]
    if len(pack["prompts"]) == original_len:
        raise HTTPException(status_code=404, detail="Prompt not found")
    if len(pack["prompts"]) < config.MIN_PROMPTS:
        raise HTTPException(status_code=400, detail=f"Must keep at least {config.MIN_PROMPTS} prompts")
    return {"pack_id": pack_id, "pack": pack}


@app.post("/room/create")
async def create_room(request: RoomCreateRequest):
    if request.pack_id not in packs:
        raise HTTPException(status_code=404, detail="Prompt pack not found")

    if len(socket_manager.rooms) >= config.MAX_ROOMS:
        raise HTTPException(status_code=429, detail="Too many active rooms. Try again later.")

    room_code = generate_room_code()
    pack_data = packs[request.pack_id]
    organizer_token = secrets.token_urlsafe(32)

    socket_manager.create_room(
        room_code, pack_data["prompts"], request.timer_seconds,
        show_votes=request.show_votes, organizer_token=organizer_token,
    )
    logger.info("Room created: %s", room_code)
    return {"room_code": room_code, "organizer_token": organizer_token}


@app.websocket("/ws/{room_code}/{client_id}")
async def websocket_endpoint(websocket: WebSocket, room_code: str, client_id: str,
                             organizer: bool = False, spectator: bool = False,
                             token: str = ""):
    await socket_manager.connect(websocket, room_code, client_id,
                                 is_organizer=organizer, is_spectator=spectator,
                                 token=token)


# --- CORS ---

if config.ALLOWED_ORIGINS.strip():
    origins = [o.strip() for o in config.ALLOWED_ORIGINS.split(",")]
else:
    local_ip = get_local_ip()
    origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        f"http://{local_ip}:5173",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
)


@app.get("/")
async def root():
    return {"message": "WhosMost API is running"}


@app.get("/health")
async def health():
    return {"status": "ok", "game": "WhosMost"}


if __name__ == "__main__":
    uvicorn.run("main:app", host=config.HOST, port=config.PORT, reload=True)
