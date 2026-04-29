from __future__ import annotations

import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import Response

from app.config import get_settings

settings = get_settings()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.renders_dir, exist_ok=True)
    if settings.groq_api_key:
        logger.info("Groq key loaded — model: %s", settings.groq_model)
    else:
        logger.error("No AI key found. Add GROQ_API_KEY to your environment.")
    if not settings.elevenlabs_api_key:
        logger.warning("ELEVENLABS_API_KEY not set — voice synthesis disabled")
    yield


app = FastAPI(
    title="SceneForge API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow Vercel frontend and localhost dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TEMP: open for debugging
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.options("/{rest_of_path:path}")
async def preflight_handler(rest_of_path: str):
    return Response(status_code=200)

# Rate limiting (optional — graceful if slowapi not installed)
try:
    from app.middleware.rate_limit import limiter, RATE_LIMITING_ENABLED
    app.state.limiter = limiter
    if RATE_LIMITING_ENABLED:
        from slowapi.errors import RateLimitExceeded
        from slowapi.middleware import SlowAPIMiddleware
        from fastapi.responses import JSONResponse

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
from app.api.auth import router as auth_router
from app.api.generate import router as generate_router
from app.api.render import router as render_router
from app.api.export import router as export_router
from app.api.payments import router as payments_router
from app.api.admin import router as admin_router
from app.api.admin_auth_api import router as admin_auth_router
from app.api.niches import router as niches_router
from app.api.projects import router as projects_router

app.include_router(auth_router,       prefix="/api/auth",       tags=["Auth"])
app.include_router(generate_router,   prefix="/api/generate",   tags=["Generate"])
app.include_router(render_router,     prefix="/api/render",     tags=["Render"])
app.include_router(export_router,     prefix="/api/export",     tags=["Export"])
app.include_router(payments_router,   prefix="/api/payments",   tags=["Payments"])
app.include_router(admin_router,      prefix="/api/admin",      tags=["Admin"])
app.include_router(admin_auth_router, prefix="/api/admin-auth", tags=["AdminAuth"])
app.include_router(niches_router,     prefix="/api/niches",     tags=["Niches"])
app.include_router(projects_router,   prefix="/api/projects",   tags=["Projects"])

if os.path.exists(settings.renders_dir):
    app.mount("/renders", StaticFiles(directory=settings.renders_dir), name="renders")


@app.get("/api/health")
async def health_check():
    import time
    start = time.time()
    status = {"status": "ok", "version": "1.0.0", "services": {}}
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
    return JSONResponse(status_code=200 if status["status"] == "ok" else 503, content=status)
