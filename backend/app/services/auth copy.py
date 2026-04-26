from __future__ import annotations

"""
Auth service — Redis-backed user store with token/credit system.
Each new user gets 1000 tokens. Each new video render costs 100 tokens.
Re-rendering an already-completed job is free (job_id is checked).
"""
import uuid
import json
import hashlib
import hmac
import base64
from datetime import datetime, timedelta, timezone
from typing import Optional

import redis.asyncio as aioredis

from app.config import get_settings
from app.models.auth_schemas import UserOut, SignupRequest

settings = get_settings()

SECRET = (settings.anthropic_api_key or settings.groq_api_key or "dev-secret-key")[:32].encode()
TOKEN_TTL_HOURS = 72

TOKENS_ON_SIGNUP = 1000   # credits given to every new user
TOKENS_PER_VIDEO = 100    # cost of each new video render


# ─── Password hashing ─────────────────────────────────────────────────────────

def _hash_password(password: str) -> str:
    salt = uuid.uuid4().hex
    h = hashlib.sha256((salt + password).encode()).hexdigest()
    return f"{salt}:{h}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        salt, h = stored.split(":", 1)
        return hmac.compare_digest(
            hashlib.sha256((salt + password).encode()).hexdigest(), h
        )
    except Exception:
        return False


# ─── Auth tokens ──────────────────────────────────────────────────────────────

def _make_token(user_id: str) -> str:
    payload = f"{user_id}:{datetime.now(timezone.utc).isoformat()}"
    sig = hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{payload}|{sig}".encode()).decode()


def _decode_token(token: str) -> Optional[str]:
    try:
        raw = base64.urlsafe_b64decode(token.encode()).decode()
        payload, sig = raw.rsplit("|", 1)
        expected = hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            return None
        user_id, ts = payload.split(":", 1)
        issued = datetime.fromisoformat(ts)
        if datetime.now(timezone.utc) - issued > timedelta(hours=TOKEN_TTL_HOURS):
            return None
        return user_id
    except Exception:
        return None


# ─── Redis keys ───────────────────────────────────────────────────────────────

def _user_key(user_id: str) -> str:
    return f"user:{user_id}"

def _email_index_key(email: str) -> str:
    return f"email_index:{email.lower()}"

def _user_jobs_key(user_id: str) -> str:
    """Set of job_ids the user has already been charged for."""
    return f"user:{user_id}:charged_jobs"


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _make_initials(name: str) -> str:
    parts = name.strip().split()
    if len(parts) >= 2:
        return (parts[0][0] + parts[-1][0]).upper()
    return name[:2].upper()


def _user_out(data: dict) -> UserOut:
    return UserOut(**{k: v for k, v in data.items() if k != "password_hash"})


# ─── CRUD ─────────────────────────────────────────────────────────────────────

async def create_user(redis: aioredis.Redis, req: SignupRequest) -> UserOut:
    existing = await redis.get(_email_index_key(req.email))
    if existing:
        raise ValueError("An account with this email already exists.")

    user_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    user_data = {
        "id": user_id,
        "full_name": req.full_name,
        "email": req.email.lower(),
        "password_hash": _hash_password(req.password),
        "avatar_initials": _make_initials(req.full_name),
        "plan": "free",
        "videos_created": 0,
        "tokens_remaining": TOKENS_ON_SIGNUP,
        "tokens_total": TOKENS_ON_SIGNUP,
        "created_at": now,
    }

    await redis.set(_user_key(user_id), json.dumps(user_data))
    await redis.set(_email_index_key(req.email), user_id)

    return _user_out(user_data)


async def authenticate_user(
    redis: aioredis.Redis, email: str, password: str
) -> Optional[UserOut]:
    user_id = await redis.get(_email_index_key(email.lower()))
    if not user_id:
        return None
    raw = await redis.get(_user_key(user_id))
    if not raw:
        return None
    data = json.loads(raw)
    # Back-fill token fields for existing users created before this feature
    if "tokens_remaining" not in data:
        data["tokens_remaining"] = TOKENS_ON_SIGNUP
        data["tokens_total"] = TOKENS_ON_SIGNUP
        await redis.set(_user_key(user_id), json.dumps(data))
    if not _verify_password(password, data["password_hash"]):
        return None
    return _user_out(data)


async def get_user_by_id(redis: aioredis.Redis, user_id: str) -> Optional[UserOut]:
    raw = await redis.get(_user_key(user_id))
    if not raw:
        return None
    data = json.loads(raw)
    if "tokens_remaining" not in data:
        data["tokens_remaining"] = TOKENS_ON_SIGNUP
        data["tokens_total"] = TOKENS_ON_SIGNUP
        await redis.set(_user_key(user_id), json.dumps(data))
    return _user_out(data)


async def update_user(
    redis: aioredis.Redis,
    user_id: str,
    full_name: str = None,
    email: str = None,
) -> Optional[UserOut]:
    raw = await redis.get(_user_key(user_id))
    if not raw:
        return None
    data = json.loads(raw)
    if full_name:
        data["full_name"] = full_name
        data["avatar_initials"] = _make_initials(full_name)
    if email:
        await redis.delete(_email_index_key(data["email"]))
        data["email"] = email.lower()
        await redis.set(_email_index_key(email), user_id)
    await redis.set(_user_key(user_id), json.dumps(data))
    return _user_out(data)


# ─── Token / credit system ────────────────────────────────────────────────────

async def get_token_balance(redis: aioredis.Redis, user_id: str) -> dict:
    """Return the user's current token balance."""
    raw = await redis.get(_user_key(user_id))
    if not raw:
        return {"tokens_remaining": 0, "tokens_total": 0, "videos_created": 0}
    data = json.loads(raw)
    return {
        "tokens_remaining": data.get("tokens_remaining", TOKENS_ON_SIGNUP),
        "tokens_total":     data.get("tokens_total", TOKENS_ON_SIGNUP),
        "videos_created":   data.get("videos_created", 0),
    }


async def check_can_render(redis: aioredis.Redis, user_id: str, job_id: str) -> dict:
    """
    Check if the user can render.
    Returns dict with: can_render, reason, tokens_remaining, is_re_render.
    A re-render (same job_id already charged) is always free.
    """
    # Check if this job_id was already charged — free re-render
    already_charged = await redis.sismember(_user_jobs_key(user_id), job_id)
    if already_charged:
        return {
            "can_render": True,
            "is_re_render": True,
            "reason": "Re-render of existing video — no tokens deducted",
            "tokens_remaining": (await get_token_balance(redis, user_id))["tokens_remaining"],
        }

    bal = await get_token_balance(redis, user_id)
    can = bal["tokens_remaining"] >= TOKENS_PER_VIDEO
    return {
        "can_render": can,
        "is_re_render": False,
        "reason": "" if can else f"Insufficient tokens. Need {TOKENS_PER_VIDEO}, have {bal['tokens_remaining']}.",
        "tokens_remaining": bal["tokens_remaining"],
    }


async def deduct_tokens(redis: aioredis.Redis, user_id: str, job_id: str) -> UserOut:
    """
    Deduct TOKENS_PER_VIDEO from the user's balance and record the job_id
    so the same job is never charged twice.
    Call this ONLY after the render completes successfully.
    """
    raw = await redis.get(_user_key(user_id))
    if not raw:
        raise ValueError("User not found")

    data = json.loads(raw)

    # Idempotency — never charge twice for the same job
    already_charged = await redis.sismember(_user_jobs_key(user_id), job_id)
    if not already_charged:
        current = data.get("tokens_remaining", TOKENS_ON_SIGNUP)
        data["tokens_remaining"] = max(0, current - TOKENS_PER_VIDEO)
        data["videos_created"] = data.get("videos_created", 0) + 1
        await redis.set(_user_key(user_id), json.dumps(data))
        # Mark this job as charged — TTL 90 days
        await redis.sadd(_user_jobs_key(user_id), job_id)
        await redis.expire(_user_jobs_key(user_id), 60 * 60 * 24 * 90)

    return _user_out(data)


async def add_tokens(redis: aioredis.Redis, user_id: str, amount: int) -> UserOut:
    """Add tokens to a user (for upgrades / admin top-ups)."""
    raw = await redis.get(_user_key(user_id))
    if not raw:
        raise ValueError("User not found")
    data = json.loads(raw)
    data["tokens_remaining"] = data.get("tokens_remaining", 0) + amount
    data["tokens_total"] = data.get("tokens_total", TOKENS_ON_SIGNUP) + amount
    await redis.set(_user_key(user_id), json.dumps(data))
    return _user_out(data)


# ─── Token helpers (API layer) ────────────────────────────────────────────────

def issue_token(user_id: str) -> str:
    return _make_token(user_id)


def verify_token(token: str) -> Optional[str]:
    return _decode_token(token)