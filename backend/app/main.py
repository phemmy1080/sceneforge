from __future__ import annotations

import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

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
from app.middleware.rate_limit import limiter, RATE_LIMITING_ENABLED

settings = get_settings()

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.renders_dir, exist_ok=True)

    if settings.groq_api_key:
        logger.info("Groq key loaded — model: %s", settings.groq_model)
    elif settings.gemini_api_key:
        logger.info("Gemini key loaded — model: %s", settings.gemini_model)
    elif settings.grok_api_key:
        logger.info("Grok (xAI) key loaded — model: %s", settings.grok_model)
    elif settings.anthropic_api_key:
        logger.info("Anthropic key loaded — model: %s", settings.claude_model)
    else:
        logger.error(
            "No AI key found. Add GROQ_API_KEY=gsk_... to your .env "
            "(free at https://console.groq.com)"
        )

    if not settings.elevenlabs_api_key:
        logger.warning("ELEVENLABS_API_KEY not set — voice synthesis disabled")
    if not settings.pexels_api_key:
        logger.warning("PEXELS_API_KEY not set — visual search disabled")

    yield


app = FastAPI(
    title="SceneForge API",
    version="1.0.0",
    description="AI-powered video content creation pipeline",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://sceneforge-alpha.vercel.app",
        "http://localhost:5173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router,     prefix="/api/auth",     tags=["Auth"])
app.include_router(generate_router, prefix="/api/generate", tags=["Generate"])
app.include_router(render_router,   prefix="/api/render",   tags=["Render"])
app.include_router(export_router,   prefix="/api/export",   tags=["Export"])
app.include_router(payments_router, prefix="/api/payments", tags=["Payments"])
app.include_router(admin_router,      prefix="/api/admin",       tags=["Admin"])
app.include_router(admin_auth_router,  prefix="/api/admin-auth",  tags=["AdminAuth"])
app.include_router(niches_router,       prefix="/api/niches",       tags=["Niches"])
app.include_router(projects_router,     prefix="/api/projects",     tags=["Projects"])

if os.path.exists(settings.renders_dir):
    app.mount("/renders", StaticFiles(directory=settings.renders_dir), name="renders")


@app.get("/health")
async def health():
    if settings.groq_api_key:
        provider, model = "groq", settings.groq_model
    elif settings.gemini_api_key:
        provider, model = "gemini", settings.gemini_model
    elif settings.grok_api_key:
        provider, model = "grok", settings.grok_model
    elif settings.anthropic_api_key:
        provider, model = "anthropic", settings.claude_model
    else:
        provider, model = "none", "none"

    return {
        "status": "ok",
        "ai_provider": provider,
        "model": model,
        "keys": {
            "groq":       bool(settings.groq_api_key),
            "gemini":     bool(settings.gemini_api_key),
            "grok":       bool(settings.grok_api_key),
            "anthropic":  bool(settings.anthropic_api_key),
            "elevenlabs": bool(settings.elevenlabs_api_key),
            "pexels":     bool(settings.pexels_api_key),
        },
    }


@app.get("/debug/key")
async def debug_key():
    key = (
        settings.groq_api_key
        or settings.gemini_api_key
        or settings.grok_api_key
        or settings.anthropic_api_key
        or ""
    )
    if not key:
        return {"loaded": False, "provider": "none", "length": 0}

    if settings.groq_api_key:
        provider = "groq"
    elif settings.gemini_api_key:
        provider = "gemini"
    elif settings.grok_api_key:
        provider = "grok"
    else:
        provider = "anthropic"

    preview = key[:10] + "..." + key[-6:] if len(key) > 16 else "TOO_SHORT"
    return {
        "loaded": True,
        "provider": provider,
        "preview": preview,
        "length": len(key),
        "has_whitespace": key != key.strip(),
        "has_quotes": key.startswith('"') or key.startswith("'"),
    }


@app.get("/api/health")
async def health_check():
    """
    Health check endpoint for uptime monitoring.
    Returns 200 if API is up and Redis is reachable.
    Returns 503 if Redis is down.
    """
    import time
    start = time.time()

    status = {
        "status": "ok",
        "version": "1.0.0",
        "services": {}
    }

    # Check Redis
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

    from fastapi.responses import JSONResponse
    code = 200 if status["status"] == "ok" else 503
    return JSONResponse(status_code=code, content=status)
