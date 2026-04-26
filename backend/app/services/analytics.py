from __future__ import annotations

"""Analytics service — scans Redis for usage data."""

import json
import logging
from collections import defaultdict
from datetime import datetime, timezone, timedelta

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

RENDER_LOG_PREFIX = "analytics:render:"
NICHE_LOG_PREFIX  = "analytics:niche:"


async def log_render(
    redis: aioredis.Redis,
    user_id: str,
    scene_count: int,
    duration_seconds: int,
    niche: str = "",
    platform: str = "",
):
    """Log a completed render for analytics. Call from render_worker after success."""
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    key = f"{RENDER_LOG_PREFIX}{day}"
    entry = {
        "user_id":   user_id,
        "scenes":    scene_count,
        "duration":  duration_seconds,
        "niche":     niche,
        "platform":  platform,
        "ts":        datetime.now(timezone.utc).isoformat(),
    }
    await redis.rpush(key, json.dumps(entry))
    await redis.expire(key, 60 * 60 * 24 * 90)  # keep 90 days

    if niche:
        await redis.hincrby("analytics:niches", niche, 1)
    if platform:
        await redis.hincrby("analytics:platforms", platform, 1)


async def log_payment(redis: aioredis.Redis, amount: int, currency: str, plan_key: str, tx_id: str):
    """Log a payment for revenue tracking."""
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    key = f"analytics:revenue:{day}"
    entry = {"amount": amount, "currency": currency, "plan": plan_key, "tx_id": tx_id,
             "ts": datetime.now(timezone.utc).isoformat()}
    await redis.rpush(key, json.dumps(entry))
    await redis.expire(key, 60 * 60 * 24 * 365)


async def get_revenue_chart(redis: aioredis.Redis, days: int = 30) -> list[dict]:
    """Return daily revenue totals for the last N days."""
    result = []
    for i in range(days - 1, -1, -1):
        day = (datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y-%m-%d")
        key = f"analytics:revenue:{day}"
        entries = await redis.lrange(key, 0, -1)
        total = sum(json.loads(e).get("amount", 0) for e in entries) if entries else 0
        tx_count = len(entries)
        result.append({"date": day, "revenue": total, "transactions": tx_count})
    return result


async def get_usage_stats(redis: aioredis.Redis) -> dict:
    """Return aggregated usage statistics."""
    # Niche popularity
    niches_raw = await redis.hgetall("analytics:niches")
    niches = {k: int(v) for k, v in (niches_raw or {}).items()}
    niches_sorted = sorted(niches.items(), key=lambda x: x[1], reverse=True)

    # Platform popularity
    platforms_raw = await redis.hgetall("analytics:platforms")
    platforms = {k: int(v) for k, v in (platforms_raw or {}).items()}
    platforms_sorted = sorted(platforms.items(), key=lambda x: x[1], reverse=True)

    # Scan last 30 days of renders for avg scenes
    total_renders = 0
    total_scenes  = 0
    total_duration = 0

    for i in range(30):
        day = (datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y-%m-%d")
        entries = await redis.lrange(f"{RENDER_LOG_PREFIX}{day}", 0, -1)
        for raw in (entries or []):
            try:
                e = json.loads(raw)
                total_renders  += 1
                total_scenes   += e.get("scenes", 0)
                total_duration += e.get("duration", 0)
            except Exception:
                pass

    avg_scenes   = round(total_scenes / total_renders, 1) if total_renders else 0
    avg_duration = round(total_duration / total_renders) if total_renders else 0

    return {
        "niches":         [{"niche": n, "count": c} for n, c in niches_sorted[:10]],
        "platforms":      [{"platform": p, "count": c} for p, c in platforms_sorted[:6]],
        "total_renders_30d": total_renders,
        "avg_scenes_per_video": avg_scenes,
        "avg_duration_seconds": avg_duration,
    }
