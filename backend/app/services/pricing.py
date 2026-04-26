from __future__ import annotations

"""
Pricing service — stores plan config in Redis so it can be updated
live from the admin dashboard without restarting the server.
Falls back to config.py defaults on first run.
"""

import json
import logging
from typing import Optional

import redis.asyncio as aioredis

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

PRICING_KEY = "sceneforge:pricing:plans"

DEFAULT_PLANS = {
    "starter": {"amount": 1000, "currency": "NGN", "tokens": 500,  "label": "Starter", "videos": 5},
    "pro":     {"amount": 2000, "currency": "NGN", "tokens": 1200, "label": "Pro",     "videos": 12},
    "studio":  {"amount": 5000, "currency": "NGN", "tokens": 3500, "label": "Studio",  "videos": 35},
}


async def get_plans(redis: aioredis.Redis) -> dict:
    """Return current plans from Redis, seeding defaults if not set."""
    raw = await redis.get(PRICING_KEY)
    if raw:
        return json.loads(raw)
    # First run — seed from config defaults
    plans = dict(settings.token_plans) if settings.token_plans else DEFAULT_PLANS
    # Ensure videos field exists
    for key, plan in plans.items():
        if "videos" not in plan:
            plan["videos"] = plan["tokens"] // 100
    await redis.set(PRICING_KEY, json.dumps(plans))
    return plans


async def get_plan(redis: aioredis.Redis, plan_key: str) -> Optional[dict]:
    plans = await get_plans(redis)
    return plans.get(plan_key)


async def update_plan_pricing(
    redis: aioredis.Redis,
    plan_key: str,
    amount: int,
    tokens: int,
    label: str,
    currency: str = "NGN",
) -> dict:
    """Update a single plan's pricing. Returns the full updated plans dict."""
    plans = await get_plans(redis)
    if plan_key not in plans:
        raise ValueError(f"Unknown plan key: {plan_key}")
    plans[plan_key].update({
        "amount":   amount,
        "tokens":   tokens,
        "label":    label,
        "currency": currency,
        "videos":   tokens // 100,
    })
    await redis.set(PRICING_KEY, json.dumps(plans))
    logger.info("Pricing updated | plan=%s | amount=%d | tokens=%d", plan_key, amount, tokens)
    return plans


async def add_plan(
    redis: aioredis.Redis,
    plan_key: str,
    amount: int,
    tokens: int,
    label: str,
    currency: str = "NGN",
) -> dict:
    """Add a new plan."""
    plans = await get_plans(redis)
    plans[plan_key] = {
        "amount":   amount,
        "tokens":   tokens,
        "label":    label,
        "currency": currency,
        "videos":   tokens // 100,
    }
    await redis.set(PRICING_KEY, json.dumps(plans))
    logger.info("Plan added | key=%s | amount=%d | tokens=%d", plan_key, amount, tokens)
    return plans


async def delete_plan(redis: aioredis.Redis, plan_key: str) -> dict:
    """Remove a plan."""
    plans = await get_plans(redis)
    if plan_key not in plans:
        raise ValueError(f"Plan not found: {plan_key}")
    del plans[plan_key]
    await redis.set(PRICING_KEY, json.dumps(plans))
    logger.info("Plan deleted | key=%s", plan_key)
    return plans
