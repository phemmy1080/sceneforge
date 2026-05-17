from __future__ import annotations

import asyncio
import os
import logging
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import Response, JSONResponse

from app.config import get_settings

from app.api.auth import router as auth_router
from app.api.generate import router as generate_router
from app.api.render import router as render_router
from app.api.export import router as export_router
from app.api.payments import router as payments_router
from app.api.admin import router as admin_router
from app.api.admin_auth_api import router as admin_auth_router
from app.api.niches import router as niches_router
from app.api.projects import router as projects_router
from app.api.voice_router import router as voice_sample_router
from app.api.chat import router as chat_router
from app.api.agency import router as agency_router

settings = get_settings()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)

# ── Health check cache (avoids Redis ping on every UptimeRobot call) ──────────
_health_cache: dict = {"ts": 0.0, "status": "ok", "content": {}}
_HEALTH_CACHE_TTL = 30  # seconds


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.renders_dir, exist_ok=True)

    if settings.groq_api_key:
        logger.info("Groq key loaded — model: %s", settings.groq_model)
    else:
        logger.error("No AI key found. Add GROQ_API_KEY to your environment.")

    if not getattr(settings, 'elevenlabs_api_key', None):
        logger.warning("ELEVENLABS_API_KEY not set — ElevenLabs voices disabled")

    # Warm voice sample cache in background — only runs once (flag stored in Redis)
    async def _warm_voices():
        redis = None
        try:
            import redis.asyncio as aioredis
            from app.services.voice_samples import warm_sample_cache
            redis = await aioredis.from_url(settings.redis_url, decode_responses=True)
            await warm_sample_cache(redis)
        except Exception as e:
            logger.warning("Voice sample cache warm failed: %s", e)
        finally:
            if redis:
                await redis.aclose()

    asyncio.create_task(_warm_voices())

    yield


app = FastAPI(
    title="SceneForge API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
# Read allowed origins from settings — never use * in production
_allowed_origins = [o.strip() for o in getattr(settings, "frontend_origin", "").split(",") if o.strip()]
if not _allowed_origins:
    _allowed_origins = ["http://localhost:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.options("/{rest_of_path:path}")
async def preflight_handler(rest_of_path: str):
    return Response(status_code=200)


@app.options("/{path:path}")
async def options_handler(path: str):
    return Response(status_code=200)


# Rate limiting
try:
    from app.middleware.rate_limit import limiter, RATE_LIMITING_ENABLED
    app.state.limiter = limiter
    if RATE_LIMITING_ENABLED:
        from slowapi.errors import RateLimitExceeded
        from slowapi.middleware import SlowAPIMiddleware

        @app.exception_handler(RateLimitExceeded)
        async def rate_limit_handler(request, exc):
            return JSONResponse(
                status_code=429,
                content={"error": "rate_limit_exceeded", "message": "Too many requests."}
            )
        app.add_middleware(SlowAPIMiddleware)
except Exception as e:
    logger.warning("Rate limiting not available: %s", e)


# Routers
app.include_router(auth_router,         prefix="/api/auth",       tags=["Auth"])
app.include_router(generate_router,     prefix="/api/generate",   tags=["Generate"])
app.include_router(render_router,       prefix="/api/render",     tags=["Render"])
app.include_router(export_router,       prefix="/api/export",     tags=["Export"])
app.include_router(payments_router,     prefix="/api/payments",   tags=["Payments"])
app.include_router(admin_router,        prefix="/api/admin",      tags=["Admin"])
app.include_router(admin_auth_router,   prefix="/api/admin-auth", tags=["AdminAuth"])
app.include_router(niches_router,       prefix="/api/niches",     tags=["Niches"])
app.include_router(projects_router,     prefix="/api/projects",   tags=["Projects"])
app.include_router(voice_sample_router, prefix="/api/voice",      tags=["Voice"])
app.include_router(chat_router,         prefix="/api/chat",       tags=["Chat"])
app.include_router(agency_router,       prefix="/api/agency",     tags=["Agency"])

if os.path.exists(settings.renders_dir):
    app.mount("/renders", StaticFiles(directory=settings.renders_dir), name="renders")


# ── Health check — cached 30s to avoid Redis ping on every monitor call ───────
@app.get("/api/health")
async def health_check():
    now = time.time()

    # Serve cached response if fresh
    if now - _health_cache["ts"] < _HEALTH_CACHE_TTL and _health_cache["content"]:
        return JSONResponse(
            status_code=200 if _health_cache["status"] == "ok" else 503,
            content=_health_cache["content"]
        )

    # Fresh check
    start = now
    status: dict = {"status": "ok", "version": "1.0.0", "services": {}}
    try:
        import redis.asyncio as aioredis
        r = await aioredis.from_url(settings.redis_url, decode_responses=True)
        await r.ping()
        await r.aclose()
        status["services"]["redis"] = "ok"
    except Exception as e:
        status["services"]["redis"] = f"error: {str(e)[:50]}"
        status["status"] = "degraded"

    status["response_ms"] = round((time.time() - start) * 1000)

    # Cache the result
    _health_cache["ts"]      = now
    _health_cache["status"]  = status["status"]
    _health_cache["content"] = status

    return JSONResponse(
        status_code=200 if status["status"] == "ok" else 503,
        content=status
    )
