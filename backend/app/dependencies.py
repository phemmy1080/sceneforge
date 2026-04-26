from __future__ import annotations

from app.config import get_settings

settings = get_settings()


async def get_redis():
    """Yield a Redis connection — used as a FastAPI dependency."""
    try:
        import redis.asyncio as aioredis
    except ImportError:
        raise RuntimeError(
            "redis package not installed. Run: pip install redis"
        )
    client = await aioredis.from_url(settings.redis_url, decode_responses=True)
    try:
        yield client
    finally:
        await client.aclose()