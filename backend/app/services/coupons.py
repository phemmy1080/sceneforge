from __future__ import annotations

"""Coupon / promo code service — stored in Redis."""

import json
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

COUPON_PREFIX = "coupon:"
USED_PREFIX   = "coupon_used:"


async def create_coupon(
    redis: aioredis.Redis,
    code: str,
    tokens: int,
    max_uses: int = 1,
    expires_at: Optional[str] = None,
    description: str = "",
) -> dict:
    key = f"{COUPON_PREFIX}{code.upper().strip()}"
    existing = await redis.get(key)
    if existing:
        raise ValueError(f"Coupon code '{code}' already exists")
    data = {
        "code":        code.upper().strip(),
        "tokens":      tokens,
        "max_uses":    max_uses,
        "uses":        0,
        "expires_at":  expires_at,
        "description": description,
        "active":      True,
        "created_at":  datetime.now(timezone.utc).isoformat(),
    }
    await redis.set(key, json.dumps(data))
    logger.info("Coupon created | code=%s | tokens=%d | max_uses=%d", code, tokens, max_uses)
    return data


async def get_coupon(redis: aioredis.Redis, code: str) -> Optional[dict]:
    raw = await redis.get(f"{COUPON_PREFIX}{code.upper().strip()}")
    return json.loads(raw) if raw else None


async def list_coupons(redis: aioredis.Redis) -> list[dict]:
    coupons = []
    cursor = 0
    while True:
        cursor, keys = await redis.scan(cursor, match=f"{COUPON_PREFIX}*", count=200)
        for key in keys:
            raw = await redis.get(key)
            if raw:
                try:
                    coupons.append(json.loads(raw))
                except Exception:
                    pass
        if cursor == 0:
            break
    return sorted(coupons, key=lambda c: c.get("created_at", ""), reverse=True)


async def redeem_coupon(
    redis: aioredis.Redis,
    code: str,
    user_id: str,
) -> dict:
    """
    Validate and redeem a coupon for a user.
    Returns the coupon dict on success, raises ValueError on failure.
    """
    coupon = await get_coupon(redis, code)
    if not coupon:
        raise ValueError("Invalid coupon code")
    if not coupon.get("active"):
        raise ValueError("This coupon has been deactivated")

    # Check expiry
    if coupon.get("expires_at"):
        exp = datetime.fromisoformat(coupon["expires_at"])
        if datetime.now(timezone.utc) > exp:
            raise ValueError("This coupon has expired")

    # Check max uses
    if coupon["uses"] >= coupon["max_uses"]:
        raise ValueError("This coupon has reached its maximum uses")

    # Check if user already used it
    used_key = f"{USED_PREFIX}{code.upper()}:{user_id}"
    if await redis.get(used_key):
        raise ValueError("You have already used this coupon")

    # Mark as used by this user
    await redis.set(used_key, "1", ex=60 * 60 * 24 * 365)

    # Increment use count
    coupon["uses"] += 1
    await redis.set(f"{COUPON_PREFIX}{code.upper()}", json.dumps(coupon))

    logger.info("Coupon redeemed | code=%s | user=%s | tokens=%d", code, user_id, coupon["tokens"])
    return coupon


async def deactivate_coupon(redis: aioredis.Redis, code: str) -> dict:
    coupon = await get_coupon(redis, code)
    if not coupon:
        raise ValueError(f"Coupon '{code}' not found")
    coupon["active"] = False
    await redis.set(f"{COUPON_PREFIX}{code.upper()}", json.dumps(coupon))
    return coupon


async def delete_coupon(redis: aioredis.Redis, code: str) -> None:
    await redis.delete(f"{COUPON_PREFIX}{code.upper()}")
