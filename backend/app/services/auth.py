from __future__ import annotations

"""
Auth service — Redis-backed user store with token/credit system.
Each new user gets 1000 tokens. Each new video render costs 100 tokens.
Re-rendering an already-completed job is free (job_id is checked).
"""
import uuid
import json
import hashlib
import logging

logger = logging.getLogger(__name__)
import hmac
import base64
from datetime import datetime, timedelta, timezone
from typing import Optional

import redis.asyncio as aioredis

from app.config import get_settings
from app.models.auth_schemas import UserOut, SignupRequest

settings = get_settings()

import random
import string

OTP_TTL_SECONDS = 900       # 15 minutes
OTP_RESEND_COOLDOWN = 60    # 60 seconds before resend allowed


def _otp_key(email: str) -> str:
    return f"otp:{email.lower()}"

def _otp_cooldown_key(email: str) -> str:
    return f"otp:cooldown:{email.lower()}"


def generate_otp() -> str:
    """Generate a 6-digit numeric OTP."""
    return "".join(random.choices(string.digits, k=6))


async def store_otp(redis: aioredis.Redis, email: str, otp: str) -> None:
    """Store OTP with 15-minute TTL and set resend cooldown."""
    await redis.set(_otp_key(email), otp, ex=OTP_TTL_SECONDS)
    await redis.set(_otp_cooldown_key(email), "1", ex=OTP_RESEND_COOLDOWN)


async def verify_otp(redis: aioredis.Redis, email: str, otp: str) -> bool:
    """Verify OTP. Returns True and deletes it if correct, False otherwise."""
    stored = await redis.get(_otp_key(email))
    if not stored:
        return False
    if stored != otp.strip():
        return False
    # Valid — delete OTP so it can't be reused
    await redis.delete(_otp_key(email))
    await redis.delete(_otp_cooldown_key(email))
    return True


async def can_resend_otp(redis: aioredis.Redis, email: str) -> tuple[bool, int]:
    """Returns (can_resend, seconds_remaining)."""
    ttl = await redis.ttl(_otp_cooldown_key(email))
    if ttl <= 0:
        return True, 0
    return False, ttl


async def mark_email_verified(redis: aioredis.Redis, user_id: str) -> None:
    """Mark user's email as verified."""
    raw = await redis.get(_user_key(user_id))
    if not raw:
        return
    data = json.loads(raw)
    data["email_verified"] = True
    await redis.set(_user_key(user_id), json.dumps(data))


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
    allowed = set(UserOut.model_fields.keys())
    filtered = {k: v for k, v in data.items() if k in allowed}
    return UserOut(**filtered)


async def get_user_out_with_workspace(redis: aioredis.Redis, user_id: str,
                                       data: dict) -> UserOut:
    """Build UserOut enriched with workspace_id and workspace_role."""
    user_out = _user_out(data)
    try:
        ws_id_raw = await redis.get(f"workspace:user:{user_id}")
        if ws_id_raw:
            ws_id = ws_id_raw if isinstance(ws_id_raw, str) else ws_id_raw.decode()
            role_raw = await redis.get(f"workspace:member:{ws_id}:{user_id}")
            role = (role_raw if isinstance(role_raw, str) else role_raw.decode()) if role_raw else None
            user_out.workspace_id   = ws_id
            user_out.workspace_role = role
            suspended_raw = await redis.get(f"workspace:suspended:{ws_id}:{user_id}")
            user_out.workspace_suspended = bool(suspended_raw)
    except Exception:
        pass
    return user_out


# ─── CRUD ─────────────────────────────────────────────────────────────────────

async def create_user(redis: aioredis.Redis, req: SignupRequest) -> UserOut:
    existing = await redis.get(_email_index_key(req.email))
    if existing:
        raise ValueError("An account with this email already exists.")

    user_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    # Check coupon code if provided
    bonus_tokens = 0
    coupon_used = None
    if hasattr(req, "coupon_code") and req.coupon_code:
        code = req.coupon_code.upper().strip()
        raw_coupon = await redis.get(f"coupon:{code}")
        if raw_coupon:
            coupon = json.loads(raw_coupon)
            max_uses = coupon.get("max_uses", 0)
            uses = coupon.get("uses", 0)
            if coupon.get("active") and (max_uses == 0 or uses < max_uses):
                bonus_tokens = coupon.get("tokens", 0)
                coupon_used = code
                coupon["uses"] = uses + 1
                if max_uses > 0 and coupon["uses"] >= max_uses:
                    coupon["active"] = False
                await redis.set(f"coupon:{code}", json.dumps(coupon))

    total_tokens = TOKENS_ON_SIGNUP + bonus_tokens

    user_data = {
        "id": user_id,
        "full_name": req.full_name,
        "email": req.email.lower(),
        "password_hash": _hash_password(req.password),
        "avatar_initials": _make_initials(req.full_name),
        "plan": "free",
        "videos_created": 0,
        "tokens_remaining": total_tokens,
        "tokens_total": total_tokens,
        "coupon_used": coupon_used,
        "email_verified": False,
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
        # Note: total_scenes_generated is updated separately via update_scene_stats()
        # Mark this job as charged — TTL 90 days
        await redis.sadd(_user_jobs_key(user_id), job_id)
        await redis.expire(_user_jobs_key(user_id), 60 * 60 * 24 * 90)

    return _user_out(data)


async def add_tokens(
    redis: aioredis.Redis,
    user_id: str,
    amount: int,
    plan: str = "",
) -> UserOut:
    """Add tokens to a user and optionally upgrade their plan."""
    raw = await redis.get(_user_key(user_id))
    if not raw:
        raise ValueError("User not found")
    data = json.loads(raw)
    data["tokens_remaining"] = data.get("tokens_remaining", 0) + amount
    data["tokens_total"] = data.get("tokens_total", TOKENS_ON_SIGNUP) + amount
    # Upgrade plan — only move up, never downgrade
    # Build rank dynamically from Redis so any admin-added plan is included.
    # Base order: free < starter < pro < studio < agency < any custom plan.
    # Custom plans added by admin get a rank of 10 (above all built-ins).
    _BASE_RANK = {"free": 0, "starter": 1, "pro": 2, "studio": 3, "agency": 4}
    try:
        _raw_plans = await redis.get("sceneforge:pricing:plans")
        if _raw_plans:
            _all_keys = list(json.loads(_raw_plans).keys())
            _dynamic_rank = dict(_BASE_RANK)
            for _k in _all_keys:
                if _k not in _dynamic_rank:
                    _dynamic_rank[_k] = 10   # custom admin plans rank above built-ins
            plan_rank = _dynamic_rank
        else:
            plan_rank = _BASE_RANK
    except Exception:
        plan_rank = _BASE_RANK
    if plan and plan_rank.get(plan, 10) > plan_rank.get(data.get("plan", "free"), 0):
        data["plan"] = plan
    await redis.set(_user_key(user_id), json.dumps(data))
    return _user_out(data)


# ─── Token helpers (API layer) ────────────────────────────────────────────────

def issue_token(user_id: str) -> str:
    return _make_token(user_id)


def verify_token(token: str) -> Optional[str]:
    return _decode_token(token)

async def update_plan(redis: aioredis.Redis, user_id: str, plan: str) -> None:
    """Update the user's plan label (free / starter / pro / studio / agency)."""
    raw = await redis.get(_user_key(user_id))
    if not raw:
        return
    data = json.loads(raw)
    data["plan"] = plan.lower()
    await redis.set(_user_key(user_id), json.dumps(data))
    logger.info("Plan updated | user=%s | plan=%s", user_id, plan)

async def update_scene_stats(
    redis: aioredis.Redis,
    user_id: str,
    scene_count: int,
) -> None:
    """
    Update total_scenes_generated for a user after a successful render.
    Called by the render worker with the actual scene count.
    """
    raw = await redis.get(_user_key(user_id))
    if not raw:
        return
    data = json.loads(raw)
    data["total_scenes_generated"] = data.get("total_scenes_generated", 0) + scene_count
    await redis.set(_user_key(user_id), json.dumps(data))
    logger.info("Scene stats updated | user=%s | +%d scenes | total=%d",
                user_id, scene_count, data["total_scenes_generated"])
RESET_TOKEN_TTL = 3600  # 1 hour


def _reset_key(token: str) -> str:
    return f"reset:{token}"


def generate_reset_token() -> str:
    """Generate a secure URL-safe reset token."""
    import secrets
    return secrets.token_urlsafe(32)


async def store_reset_token(redis: aioredis.Redis, email: str, token: str) -> None:
    """Store reset token → email mapping with 1-hour TTL."""
    await redis.set(_reset_key(token), email.lower(), ex=RESET_TOKEN_TTL)


async def verify_reset_token(redis: aioredis.Redis, token: str) -> str | None:
    """Return email if token is valid, None otherwise."""
    email = await redis.get(_reset_key(token))
    return email if email else None


async def consume_reset_token(redis: aioredis.Redis, token: str) -> str | None:
    """Return email and delete token (single use)."""
    email = await redis.get(_reset_key(token))
    if email:
        await redis.delete(_reset_key(token))
    return email if email else None


async def reset_password(redis: aioredis.Redis, email: str, new_password: str) -> bool:
    """Reset a user's password by email. Returns True if user found."""
    uid = await redis.get(_email_index_key(email.lower()))
    if not uid:
        return False
    raw = await redis.get(_user_key(uid))
    if not raw:
        return False
    data = json.loads(raw)
    data["password_hash"] = _hash_password(new_password)
    await redis.set(_user_key(uid), json.dumps(data))
    logger.info("Password reset for %s", email)
    return True
