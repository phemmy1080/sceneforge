import uuid
import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Header, Request

from app.config import get_settings
from app.models.schemas import RenderRequest, RenderJobResponse, JobStatusResponse
from app.services import auth as auth_service
from app.middleware.rate_limit import limiter
from app.services.plans import get_limits, check_scene_limit
from app.services.security import (
    check_queue_capacity, check_user_concurrency, check_recursive_job,
    register_active_job, track_render_abuse, track_ip_request,
    check_ip_blocked, validate_job_id,
)
from app.services.agency_service import get_workspace_id_for_user

settings = get_settings()
router = APIRouter()
logger = logging.getLogger(__name__)


async def _get_redis():
    try:
        import redis.asyncio as aioredis
        return await aioredis.from_url(settings.redis_url, decode_responses=True)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Redis unavailable: {e}")


def _extract_user_id(authorization: Optional[str]) -> Optional[str]:
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token:
        return None
    return auth_service.verify_token(token)


@router.post("/start", response_model=RenderJobResponse)
@limiter.limit("5/minute")
async def start_render(
    request: Request,
    req: RenderRequest,
    authorization: Optional[str] = Header(None),
):
    """
    Enqueue a render job.
    Checks token balance first — deduction happens after successful render.
    Re-renders of the same job_id are always free.
    """
    try:
        import arq
        import arq.connections
    except ImportError:
        raise HTTPException(status_code=503, detail="arq not installed")

    redis = await _get_redis()
    user_id = _extract_user_id(authorization)

    # ── Security checks ───────────────────────────────────────────────────────
    from fastapi import Request as _Req
    client_ip = (
        request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (request.client.host if request.client else "unknown")
    )
    await check_ip_blocked(redis, client_ip)
    await track_ip_request(redis, client_ip, "render_start")
    await check_queue_capacity(redis)

    # ── Token check ──────────────────────────────────────────────────────────
    # Generate a new job_id — each render start gets a fresh one
    job_id = str(uuid.uuid4())

    # If the request carries a previous job_id (re-render), check if already charged
    prev_job_id = getattr(req, "prev_job_id", None)

    if user_id:
        check_id = prev_job_id or job_id
        check = await auth_service.check_can_render(redis, user_id, check_id)

        if not check["can_render"]:
            await redis.aclose()
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "insufficient_tokens",
                    "message": check["reason"],
                    "tokens_remaining": check["tokens_remaining"],
                    "cost_per_video": 100,
                }
            )

        # ── Plan feature limits ───────────────────────────────────────────────
        import json as _json
        raw_user = await redis.get(f"user:{user_id}")
        user_plan = "free"
        if raw_user:
            user_plan = _json.loads(raw_user).get("plan", "free")

        limits = get_limits(user_plan)

        # Scene count limit (skip for re-renders)
        # ── Queue isolation: concurrency + spam ────────────────────────────
        await check_user_concurrency(redis, user_id, user_plan)
        await check_recursive_job(redis, user_id, job_id, getattr(req, "prev_job_id", None))

        if not prev_job_id:
            scene_count = len(req.scenes)
            allowed, max_scenes = check_scene_limit(user_plan, scene_count)
            if not allowed:
                await redis.aclose()
                raise HTTPException(
                    status_code=403,
                    detail={
                        "error": "scene_limit_exceeded",
                        "message": f"Free plan is limited to {max_scenes} scenes. You have {scene_count}. Upgrade to create longer videos.",
                        "max_scenes": max_scenes,
                        "upgrade_required": True,
                    }
                )

            # Daily render limit
            max_daily = limits["max_renders_per_day"]
            if max_daily != -1:
                import datetime
                today = datetime.date.today().isoformat()
                daily_key = f"renders:daily:{user_id}:{today}"
                daily_count = await redis.get(daily_key)
                daily_count = int(daily_count) if daily_count else 0

                if daily_count >= max_daily:
                    await redis.aclose()
                    raise HTTPException(
                        status_code=403,
                        detail={
                            "error": "daily_limit_exceeded",
                            "message": f"{limits['label']} plan allows {max_daily} renders per day. You've used all {max_daily} today. Try again tomorrow.",
                            "daily_limit": max_daily,
                            "used_today": daily_count,
                            "upgrade_required": True,
                        }
                    )

                # Increment daily counter (expires after 25 hours for safety)
                await redis.incr(daily_key)
                await redis.expire(daily_key, 90000)

        logger.info(
            "Render %s | user %s | re_render=%s | tokens=%s",
            job_id, user_id, check.get("is_re_render"), check["tokens_remaining"],
        )

    # ── Queue job ────────────────────────────────────────────────────────────
    await redis.set(
        f"job:{job_id}:progress",
        json.dumps({"status": "queued", "stage": "Queued", "pct": 0}),
        ex=3600,
    )

    # Store user_id alongside the job so the worker can deduct after success
    if user_id:
        await redis.set(f"job:{job_id}:user_id", user_id, ex=86400)
        # Store workspace_id so worker can deduct from shared pool
        try:
            ws_id = await get_workspace_id_for_user(redis, user_id)
            if ws_id:
                # Block suspended members from rendering
                suspended = await redis.get(f"workspace:suspended:{ws_id}:{user_id}")
                if suspended:
                    raise HTTPException(
                        status_code=403,
                        detail="Your workspace access has been suspended. Contact the workspace owner."
                    )
                await redis.set(f"job:{job_id}:ws_id", ws_id, ex=86400)
        except HTTPException:
            raise
        except Exception:
            pass
    if prev_job_id:
        await redis.set(f"job:{job_id}:prev_job_id", prev_job_id, ex=86400)
    # Store niche for analytics
    niche = getattr(req, "niche", None) or ""
    if niche:
        await redis.set(f"job:{job_id}:niche", niche, ex=86400)

    pool = await arq.create_pool(
        arq.connections.RedisSettings.from_dsn(settings.redis_url)
    )
    # Store agency_proj_id so worker can load brand kit
    agency_proj_id = getattr(req, "agency_project_id", None)
    if agency_proj_id:
        await redis.set(f"job:{job_id}:agency_proj_id", agency_proj_id, ex=86400 * 7)

    # Store scenes so the SceneEditor can reload them if the session is lost
    await redis.set(
        f"job:{job_id}:scenes",
        json.dumps([s.model_dump() for s in req.scenes]),
        ex=86400 * 7  # 7 days — editors may come back days later
    )
    await pool.enqueue_job("render_video", job_id, req.model_dump(), _job_id=job_id)
    await pool.close()
    await redis.aclose()

    logger.info("Render job queued: %s", job_id)
    return RenderJobResponse(job_id=job_id, status="queued")


@router.get("/scenes/{job_id}")
async def get_job_scenes(job_id: str):
    """Return the scenes that were used in a render job."""
    redis = await _get_redis()
    try:
        raw = await redis.get(f"job:{job_id}:scenes")
        if not raw:
            raise HTTPException(404, "Scenes not found for this job")
        scenes = json.loads(raw)
        return {"scenes": scenes}
    finally:
        await redis.aclose()


@router.get("/status/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str):
    redis = await _get_redis()
    raw = await redis.get(f"job:{job_id}:progress")
    await redis.aclose()

    if raw is None:
        raise HTTPException(status_code=404, detail="Job not found")

    data = json.loads(raw)
    status = data.get("status", "processing")

    return JobStatusResponse(
        job_id=job_id,
        status=status,
        progress=data.get("pct", 0),
        stage=data.get("stage", ""),
        result=data if status == "complete" else None,
        error=data.get("error") if status == "failed" else None,
    )
