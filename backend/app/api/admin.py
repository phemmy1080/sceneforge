from __future__ import annotations

"""
Admin API — protected by ADMIN_SECRET_KEY header.
"""

import csv
import io
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.config import get_settings
from app.dependencies import get_redis
from app.services import auth as auth_service
from app.services import pricing as pricing_service
from app.services import admin_auth as admin_auth_service
from app.services import coupons as coupon_service
from app.services import analytics as analytics_service
from app.services.email import send_token_confirmation

settings = get_settings()
router = APIRouter()
logger = logging.getLogger(__name__)

COUPON_PREFIX = "coupon:"
BROADCAST_KEY = "admin:broadcasts"


# ─── Auth guard ───────────────────────────────────────────────────────────────

async def _require_admin(
    authorization: Optional[str] = Header(None),
    x_admin_key: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    """
    Accept either:
    1. New method: Authorization: Bearer admin:<token>  (from role-based login)
    2. Legacy method: x-admin-key: <secret>  (from .env ADMIN_SECRET_KEY)
    """
    # Method 1 — Bearer token with admin: prefix
    token = (authorization or "").removeprefix("Bearer ").strip()
    if token.startswith("admin:"):
        from app.services.auth import verify_token as _vt
        uid = _vt(token[6:])
        if uid:
            admin = await admin_auth_service.get_admin_user(redis, uid)
            if admin and admin.get("active", True):
                return admin  # ✓ authenticated via role-based login
        raise HTTPException(status_code=403, detail="Invalid or expired admin token")

    # Method 2 — Legacy secret key (still supported)
    if x_admin_key:
        if settings.admin_secret_key and x_admin_key == settings.admin_secret_key:
            return {"role": "superadmin", "email": "legacy-key"}
        raise HTTPException(status_code=403, detail="Invalid admin key")

    raise HTTPException(status_code=403, detail="Admin authentication required")


# ─── Models ───────────────────────────────────────────────────────────────────

class SetTokensRequest(BaseModel):
    user_id: str
    tokens: int
    reason: str = "Admin adjustment"

class SetPlanRequest(BaseModel):
    user_id: str
    plan: str

class UpdatePlanPricingRequest(BaseModel):
    plan_key: str
    amount: int
    tokens: int
    label: str
    currency: str = "NGN"

class AddPlanRequest(BaseModel):
    plan_key: str
    amount: int
    tokens: int
    label: str
    currency: str = "NGN"

class SuspendUserRequest(BaseModel):
    user_id: str
    suspended: bool
    reason: str = ""

class BroadcastRequest(BaseModel):
    subject: str
    message: str

class CouponRequest(BaseModel):
    code: str
    tokens: int
    max_uses: int = 0          # 0 = unlimited
    expires_days: int = 0      # 0 = never expires


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _all_users(redis) -> list[dict]:
    users = []
    cursor = 0
    while True:
        cursor, keys = await redis.scan(cursor, match="user:*", count=200)
        for key in keys:
            if key.count(":") == 1:
                raw = await redis.get(key)
                if raw:
                    try:
                        data = json.loads(raw)
                        data.pop("password_hash", None)
                        users.append(data)
                    except Exception:
                        pass
        if cursor == 0:
            break
    return users


async def _log_action(redis, action: str, **kwargs):
    log_key = f"admin:log:{datetime.now(timezone.utc).isoformat()}:{uuid.uuid4().hex[:4]}"
    await redis.set(log_key, json.dumps({
        "action": action,
        "ts": datetime.now(timezone.utc).isoformat(),
        **kwargs,
    }), ex=60 * 60 * 24 * 90)


# ─── Stats ────────────────────────────────────────────────────────────────────

@router.get("/stats")
async def get_stats(redis=Depends(get_redis), _=Depends(_require_admin)):
    users = await _all_users(redis)
    plans = {}
    niches: dict[str, int] = {}
    total_scenes = 0
    total_videos = sum(u.get("videos_created", 0) for u in users)

    for u in users:
        p = u.get("plan", "free")
        plans[p] = plans.get(p, 0) + 1
        for niche, count in (u.get("niche_usage") or {}).items():
            niches[niche] = niches.get(niche, 0) + count
        total_scenes += u.get("total_scenes_generated", 0)

    # Also scan render job payloads for niche data (captures historical usage)
    cursor2 = 0
    while True:
        cursor2, jkeys = await redis.scan(cursor2, match="job:*:progress", count=200)
        for jkey in jkeys:
            job_id = jkey.split(":")[1]
            raw_job = await redis.get(f"job:{job_id}:niche")
            if raw_job:
                n = raw_job if isinstance(raw_job, str) else raw_job.decode()
                niches[n] = niches.get(n, 0) + 1
        if cursor2 == 0:
            break

    tx_count = 0
    cursor = 0
    while True:
        cursor, keys = await redis.scan(cursor, match="payment:processed:*", count=200)
        tx_count += len(keys)
        if cursor == 0:
            break

    avg_scenes = round(total_scenes / total_videos, 1) if total_videos > 0 else 0

    return {
        "total_users": len(users),
        "total_tokens_in_circulation": sum(u.get("tokens_remaining", 0) for u in users),
        "total_videos_created": total_videos,
        "total_transactions": tx_count,
        "users_by_plan": plans,
        "top_niches": dict(sorted(niches.items(), key=lambda x: x[1], reverse=True)[:8]),
        "avg_scenes_per_video": avg_scenes,
        "total_scenes_generated": total_scenes,
    }


# ─── Users ────────────────────────────────────────────────────────────────────

@router.get("/users")
async def list_users(redis=Depends(get_redis), _=Depends(_require_admin)):
    users = await _all_users(redis)
    users.sort(key=lambda u: u.get("created_at", ""), reverse=True)
    return {"users": users, "total": len(users)}


@router.get("/users/{user_id}")
async def get_user(user_id: str, redis=Depends(get_redis), _=Depends(_require_admin)):
    raw = await redis.get(f"user:{user_id}")
    if not raw:
        raise HTTPException(status_code=404, detail="User not found")
    data = json.loads(raw)
    data.pop("password_hash", None)
    data["charged_jobs_count"] = await redis.scard(f"user:{user_id}:charged_jobs")
    return data


@router.post("/users/top-up")
async def admin_top_up(req: SetTokensRequest, redis=Depends(get_redis), _=Depends(_require_admin)):
    try:
        updated = await auth_service.add_tokens(redis, req.user_id, req.tokens)
        await _log_action(redis, "top_up", user_id=req.user_id, tokens=req.tokens, reason=req.reason)
        return {"success": True, "tokens_remaining": updated.tokens_remaining, "user": updated.email}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/users/set-tokens")
async def admin_set_tokens(req: SetTokensRequest, redis=Depends(get_redis), _=Depends(_require_admin)):
    raw = await redis.get(f"user:{req.user_id}")
    if not raw:
        raise HTTPException(status_code=404, detail="User not found")
    data = json.loads(raw)
    old = data.get("tokens_remaining", 0)
    data["tokens_remaining"] = req.tokens
    await redis.set(f"user:{req.user_id}", json.dumps(data))
    await _log_action(redis, "set_tokens", user_id=req.user_id, tokens=req.tokens, old=old, reason=req.reason)
    return {"success": True, "old_balance": old, "new_balance": req.tokens}


@router.post("/users/set-plan")
async def admin_set_plan(req: SetPlanRequest, redis=Depends(get_redis), _=Depends(_require_admin)):
    await auth_service.update_plan(redis, req.user_id, req.plan)
    await _log_action(redis, "set_plan", user_id=req.user_id, plan=req.plan)
    return {"success": True, "plan": req.plan}


@router.post("/users/suspend")
async def suspend_user(req: SuspendUserRequest, redis=Depends(get_redis), _=Depends(_require_admin)):
    raw = await redis.get(f"user:{req.user_id}")
    if not raw:
        raise HTTPException(status_code=404, detail="User not found")
    data = json.loads(raw)
    data["suspended"] = req.suspended
    data["suspend_reason"] = req.reason
    await redis.set(f"user:{req.user_id}", json.dumps(data))
    await _log_action(redis, "suspend" if req.suspended else "unsuspend", user_id=req.user_id, reason=req.reason)
    return {"success": True, "suspended": req.suspended}


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, redis=Depends(get_redis), _=Depends(_require_admin)):
    raw = await redis.get(f"user:{user_id}")
    if not raw:
        raise HTTPException(status_code=404, detail="User not found")
    data = json.loads(raw)
    await redis.delete(f"email_index:{data.get('email', '')}")
    await redis.delete(f"user:{user_id}")
    await redis.delete(f"user:{user_id}:charged_jobs")
    await _log_action(redis, "delete_user", user_id=user_id, email=data.get("email"))
    return {"success": True, "deleted": user_id}


# ─── Users CSV export ─────────────────────────────────────────────────────────

@router.get("/users/export/csv")
async def export_users_csv(redis=Depends(get_redis), _=Depends(_require_admin)):
    users = await _all_users(redis)
    users.sort(key=lambda u: u.get("created_at", ""), reverse=True)

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=[
        "id", "full_name", "email", "plan", "tokens_remaining", "tokens_total",
        "videos_created", "suspended", "created_at",
    ])
    writer.writeheader()
    for u in users:
        writer.writerow({
            "id":               u.get("id", ""),
            "full_name":        u.get("full_name", ""),
            "email":            u.get("email", ""),
            "plan":             u.get("plan", "free"),
            "tokens_remaining": u.get("tokens_remaining", 0),
            "tokens_total":     u.get("tokens_total", 0),
            "videos_created":   u.get("videos_created", 0),
            "suspended":        u.get("suspended", False),
            "created_at":       u.get("created_at", ""),
        })

    output.seek(0)
    filename = f"sceneforge_users_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ─── Pricing ──────────────────────────────────────────────────────────────────

@router.get("/pricing")
async def get_pricing(redis=Depends(get_redis), _=Depends(_require_admin)):
    plans = await pricing_service.get_plans(redis)
    return {"plans": plans}


@router.put("/pricing/{plan_key}")
async def update_pricing(plan_key: str, req: UpdatePlanPricingRequest, redis=Depends(get_redis), _=Depends(_require_admin)):
    try:
        plans = await pricing_service.update_plan_pricing(redis, plan_key, req.amount, req.tokens, req.label, req.currency)
        await _log_action(redis, "pricing_update", plan_key=plan_key, amount=req.amount, tokens=req.tokens, reason=f"Updated {plan_key}")
        return {"success": True, "plans": plans}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/pricing")
async def add_pricing_plan(req: AddPlanRequest, redis=Depends(get_redis), _=Depends(_require_admin)):
    plans = await pricing_service.add_plan(redis, req.plan_key, req.amount, req.tokens, req.label, req.currency)
    await _log_action(redis, "plan_added", plan_key=req.plan_key, amount=req.amount, tokens=req.tokens, reason="New plan")
    return {"success": True, "plans": plans}


@router.delete("/pricing/{plan_key}")
async def delete_pricing_plan(plan_key: str, redis=Depends(get_redis), _=Depends(_require_admin)):
    try:
        plans = await pricing_service.delete_plan(redis, plan_key)
        return {"success": True, "plans": plans}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ─── Transactions & revenue chart ─────────────────────────────────────────────

@router.get("/transactions")
async def list_transactions(redis=Depends(get_redis), _=Depends(_require_admin)):
    txns = []
    cursor = 0
    while True:
        cursor, keys = await redis.scan(cursor, match="payment:processed:*", count=200)
        for key in keys:
            tx_id = key.replace("payment:processed:", "")
            # Try to get richer data from payment record
            raw = await redis.get(f"payment:record:{tx_id}")
            if raw:
                try:
                    rec = json.loads(raw)
                    txns.append(rec)
                    continue
                except Exception:
                    pass
            txns.append({"transaction_id": tx_id, "status": "completed"})
        if cursor == 0:
            break
    txns.sort(key=lambda t: t.get("ts", ""), reverse=True)
    return {"transactions": txns, "total": len(txns)}


@router.get("/revenue/chart")
async def revenue_chart(redis=Depends(get_redis), _=Depends(_require_admin)):
    """Return NGN earned per day over the last 30 days."""
    txns = []
    cursor = 0
    while True:
        cursor, keys = await redis.scan(cursor, match="payment:record:*", count=200)
        for key in keys:
            raw = await redis.get(key)
            if raw:
                try:
                    txns.append(json.loads(raw))
                except Exception:
                    pass
        if cursor == 0:
            break

    # Aggregate by day
    daily: dict[str, float] = {}
    total = 0.0
    for tx in txns:
        ts = tx.get("ts", "")
        amount = float(tx.get("amount", 0))
        if ts:
            day = ts[:10]  # YYYY-MM-DD
            daily[day] = daily.get(day, 0) + amount
            total += amount

    # Fill last 30 days with 0 if missing
    from datetime import timedelta
    today = datetime.now(timezone.utc).date()
    chart = []
    for i in range(29, -1, -1):
        day = str(today - timedelta(days=i))
        chart.append({"date": day, "amount": daily.get(day, 0)})

    return {"chart": chart, "total_revenue": total, "total_transactions": len(txns)}


# ─── Email broadcast ──────────────────────────────────────────────────────────

@router.post("/broadcast")
async def broadcast_email(req: BroadcastRequest, redis=Depends(get_redis), _=Depends(_require_admin)):
    """Send an email to all registered users."""
    from app.services.email import send_token_confirmation
    import asyncio

    users = await _all_users(redis)
    emails = [u["email"] for u in users if u.get("email") and not u.get("suspended")]

    if not emails:
        raise HTTPException(status_code=404, detail="No active users found")

    # Store broadcast record
    rec = {
        "id": uuid.uuid4().hex[:8],
        "subject": req.subject,
        "message": req.message,
        "recipients": len(emails),
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    await redis.lpush(BROADCAST_KEY, json.dumps(rec))
    await redis.ltrim(BROADCAST_KEY, 0, 49)  # keep last 50

    # Send emails asynchronously (fire and forget with basic batching)
    from app.services.email import _send
    import asyncio

    sent = 0
    errors = 0
    loop = asyncio.get_event_loop()

    html = f"""
<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#111118;color:#F0F0FF;border-radius:12px">
  <div style="font-size:20px;font-weight:800;margin-bottom:4px">Scene<span style="color:#A78BFA">Forge</span></div>
  <div style="height:1px;background:rgba(255,255,255,0.1);margin:12px 0"></div>
  <h2 style="font-size:18px;color:#fff;margin:0 0 12px">{req.subject}</h2>
  <div style="font-size:14px;color:rgba(255,255,255,0.7);line-height:1.7;white-space:pre-wrap">{req.message}</div>
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.08);font-size:12px;color:rgba(255,255,255,0.3)">
    SceneForge · AI Video Studio
  </div>
</div>"""

    for email in emails:
        try:
            await loop.run_in_executor(None, _send, email, req.subject, html, req.message)
            sent += 1
        except Exception:
            errors += 1

    await _log_action(redis, "broadcast", subject=req.subject, sent=sent, errors=errors, reason="Admin broadcast")
    return {"success": True, "sent": sent, "errors": errors, "total": len(emails)}


@router.get("/broadcasts")
async def list_broadcasts(redis=Depends(get_redis), _=Depends(_require_admin)):
    raw_list = await redis.lrange(BROADCAST_KEY, 0, 49)
    broadcasts = [json.loads(r) for r in raw_list]
    return {"broadcasts": broadcasts}


# ─── Coupon / promo codes ─────────────────────────────────────────────────────

@router.get("/coupons")
async def list_coupons(redis=Depends(get_redis), _=Depends(_require_admin)):
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
    coupons.sort(key=lambda c: c.get("created_at", ""), reverse=True)
    return {"coupons": coupons}


@router.post("/coupons")
async def create_coupon(req: CouponRequest, redis=Depends(get_redis), _=Depends(_require_admin)):
    code = req.code.upper().strip()
    existing = await redis.get(f"{COUPON_PREFIX}{code}")
    if existing:
        raise HTTPException(status_code=400, detail=f"Coupon code '{code}' already exists")

    coupon = {
        "code":       code,
        "tokens":     req.tokens,
        "max_uses":   req.max_uses,
        "uses":       0,
        "active":     True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    ttl = req.expires_days * 86400 if req.expires_days > 0 else None
    if ttl:
        await redis.set(f"{COUPON_PREFIX}{code}", json.dumps(coupon), ex=ttl)
    else:
        await redis.set(f"{COUPON_PREFIX}{code}", json.dumps(coupon))

    await _log_action(redis, "coupon_created", code=code, tokens=req.tokens, max_uses=req.max_uses, reason="Admin created coupon")
    return {"success": True, "coupon": coupon}


@router.delete("/coupons/{code}")
async def delete_coupon(code: str, redis=Depends(get_redis), _=Depends(_require_admin)):
    deleted = await redis.delete(f"{COUPON_PREFIX}{code.upper()}")
    if not deleted:
        raise HTTPException(status_code=404, detail="Coupon not found")
    return {"success": True}


# ─── Render queue monitor ─────────────────────────────────────────────────────

@router.get("/queue")
async def render_queue(redis=Depends(get_redis), _=Depends(_require_admin)):
    """List all active/recent render jobs from Redis."""
    jobs = []
    cursor = 0
    while True:
        cursor, keys = await redis.scan(cursor, match="job:*:progress", count=200)
        for key in keys:
            raw = await redis.get(key)
            if raw:
                try:
                    job_id = key.split(":")[1]
                    data = json.loads(raw)
                    user_id = await redis.get(f"job:{job_id}:user_id")
                    jobs.append({
                        "job_id":  job_id,
                        "status":  data.get("status", "unknown"),
                        "stage":   data.get("stage", ""),
                        "pct":     data.get("pct", 0),
                        "user_id": user_id or "unknown",
                        "error":   data.get("error", ""),
                    })
                except Exception:
                    pass
        if cursor == 0:
            break

    # Sort: processing first, then queued, then complete, then failed
    order = {"processing": 0, "queued": 1, "complete": 2, "failed": 3}
    jobs.sort(key=lambda j: order.get(j["status"], 9))
    return {"jobs": jobs, "total": len(jobs)}



@router.post("/transactions/backfill")
async def backfill_transactions(redis=Depends(get_redis), _=Depends(_require_admin)):
    """
    Enrich old transaction records by verifying them with Flutterwave API.
    Call this once to fill in missing plan/amount/token data for old payments.
    """
    import httpx

    filled = 0
    skipped = 0
    cursor = 0
    tx_ids = []

    while True:
        cursor, keys = await redis.scan(cursor, match="payment:processed:*", count=200)
        for key in keys:
            tx_id = key.replace("payment:processed:", "")
            # Skip if rich record already exists
            existing = await redis.get(f"payment:record:{tx_id}")
            if not existing:
                tx_ids.append(tx_id)
            else:
                skipped += 1
        if cursor == 0:
            break

    FLW_BASE = "https://api.flutterwave.com/v3"
    async with httpx.AsyncClient() as client:
        for tx_id in tx_ids:
            try:
                resp = await client.get(
                    f"{FLW_BASE}/transactions/{tx_id}/verify",
                    headers={"Authorization": f"Bearer {settings.flutterwave_secret_key}"},
                    timeout=10,
                )
                if resp.status_code != 200:
                    continue
                data = resp.json().get("data", {})
                if data.get("status") != "successful":
                    continue

                meta = data.get("meta", {}) or {}
                record = {
                    "transaction_id": tx_id,
                    "tx_ref":   data.get("tx_ref", ""),
                    "user_id":  meta.get("user_id", ""),
                    "email":    data.get("customer", {}).get("email", ""),
                    "plan":     meta.get("plan_key", "unknown"),
                    "tokens":   int(meta.get("tokens", 0)),
                    "amount":   float(data.get("amount", 0)),
                    "currency": data.get("currency", "NGN"),
                    "status":   "completed",
                    "ts":       data.get("created_at", ""),
                }
                await redis.set(
                    f"payment:record:{tx_id}",
                    json.dumps(record),
                    ex=60 * 60 * 24 * 90,
                )
                filled += 1
            except Exception as e:
                logger.warning("Backfill failed for tx %s: %s", tx_id, e)

    return {"filled": filled, "skipped_already_rich": skipped, "total": len(tx_ids) + skipped}


@router.post("/analytics/backfill-scenes")
async def backfill_scene_stats(redis=Depends(get_redis), _=Depends(_require_admin)):
    """
    Backfill total_scenes_generated for existing users by scanning
    completed render job results in Redis.
    """
    filled = 0
    cursor = 0
    user_scene_counts: dict[str, int] = {}

    # Scan all completed job progress records
    while True:
        cursor, keys = await redis.scan(cursor, match="job:*:progress", count=200)
        for key in keys:
            job_id = key.split(":")[1]
            raw = await redis.get(key)
            if not raw:
                continue
            try:
                data = json.loads(raw)
                if data.get("status") != "complete":
                    continue
                scene_count = data.get("scene_count", 0)
                if not scene_count:
                    continue
                # Get user_id for this job
                uid_raw = await redis.get(f"job:{job_id}:user_id")
                uid = uid_raw.decode() if isinstance(uid_raw, bytes) else uid_raw
                if uid:
                    user_scene_counts[uid] = user_scene_counts.get(uid, 0) + scene_count
            except Exception:
                pass
        if cursor == 0:
            break

    # Update each user's total_scenes_generated
    for uid, total in user_scene_counts.items():
        raw_user = await redis.get(f"user:{uid}")
        if raw_user:
            try:
                data = json.loads(raw_user)
                if data.get("total_scenes_generated", 0) == 0:
                    data["total_scenes_generated"] = total
                    await redis.set(f"user:{uid}", json.dumps(data))
                    filled += 1
            except Exception:
                pass

    return {"filled_users": filled, "user_scene_counts": user_scene_counts}

# ─── Activity logs ────────────────────────────────────────────────────────────

@router.get("/logs")
async def get_admin_logs(redis=Depends(get_redis), _=Depends(_require_admin)):
    logs = []
    cursor = 0
    while True:
        cursor, keys = await redis.scan(cursor, match="admin:log:*", count=200)
        for key in keys:
            raw = await redis.get(key)
            if raw:
                try:
                    logs.append(json.loads(raw))
                except Exception:
                    pass
        if cursor == 0:
            break
    logs.sort(key=lambda l: l.get("ts", ""), reverse=True)
    return {"logs": logs[:50]}

# ─── Render queue monitor ─────────────────────────────────────────────────────

@router.get("/queue")
async def get_render_queue(
    redis=Depends(get_redis),
    _=Depends(_require_admin),
):
    """Get all active, queued, and recent completed render jobs."""
    jobs = []
    cursor = 0
    while True:
        cursor, keys = await redis.scan(cursor, match="job:*:progress", count=500)
        for key in keys:
            raw = await redis.get(key)
            if raw:
                try:
                    data = json.loads(raw)
                    job_id = key.replace("job:", "").replace(":progress", "")
                    user_id_raw = await redis.get(f"job:{job_id}:user_id")
                    user_id = user_id_raw.decode() if isinstance(user_id_raw, bytes) else (user_id_raw or "")
                    jobs.append({
                        "job_id":  job_id,
                        "status":  data.get("status", "unknown"),
                        "stage":   data.get("stage", ""),
                        "pct":     data.get("pct", 0),
                        "user_id": user_id[:8] + "…" if user_id else "—",
                        "error":   data.get("error", ""),
                    })
                except Exception:
                    pass
        if cursor == 0:
            break
    # Sort: processing first, then queued, then complete, then failed
    order = {"processing": 0, "queued": 1, "complete": 2, "failed": 3}
    jobs.sort(key=lambda j: order.get(j["status"], 9))
    return {"jobs": jobs, "total": len(jobs)}


# ─── User CSV export ──────────────────────────────────────────────────────────

@router.get("/users/export/csv")
async def export_users_csv(
    redis=Depends(get_redis),
    _=Depends(_require_admin),
):
    """Download all users as a CSV file."""
    from fastapi.responses import StreamingResponse
    import csv, io

    users = await _all_users(redis)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "full_name", "email", "plan", "tokens_remaining",
                     "tokens_total", "videos_created", "suspended", "created_at"])
    for u in users:
        writer.writerow([
            u.get("id", ""), u.get("full_name", ""), u.get("email", ""),
            u.get("plan", "free"), u.get("tokens_remaining", 0),
            u.get("tokens_total", 1000), u.get("videos_created", 0),
            u.get("suspended", False), u.get("created_at", ""),
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=sceneforge_users.csv"},
    )


# ─── Email broadcast ──────────────────────────────────────────────────────────

class BroadcastRequest(BaseModel):
    subject: str
    message: str


@router.post("/broadcast")
async def broadcast_email(
    req: BroadcastRequest,
    redis=Depends(get_redis),
    _=Depends(_require_admin),
):
    """Send an email to all users. Runs synchronously — use for small user bases."""
    import asyncio
    from app.config import get_settings as _gs
    _settings = _gs()

    users = await _all_users(redis)
    sent = 0
    failed = 0

    for user in users:
        email = user.get("email")
        name  = user.get("full_name", "Creator")
        if not email:
            continue
        try:
            html = f"""<div style="font-family:sans-serif;max-width:580px;margin:0 auto;background:#111118;color:#F0F0FF;padding:32px;border-radius:12px">
              <h1 style="font-size:22px;font-weight:800;margin:0 0 6px">Scene<span style="color:#A78BFA">Forge</span></h1>
              <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:0 0 24px">News from the team</p>
              <p style="font-size:14px;margin-bottom:16px">Hi {name},</p>
              <div style="font-size:14px;line-height:1.7;color:rgba(255,255,255,0.8)">{req.message.replace(chr(10), '<br>')}</div>
              <p style="margin-top:28px;font-size:12px;color:rgba(255,255,255,0.3)">— The SceneForge Team</p>
            </div>"""
            import smtplib
            from email.mime.multipart import MIMEMultipart
            from email.mime.text import MIMEText
            msg = MIMEMultipart("alternative")
            msg["Subject"] = req.subject
            msg["From"] = f"SceneForge <{_settings.smtp_user}>"
            msg["To"] = email
            msg.attach(MIMEText(req.message, "plain"))
            msg.attach(MIMEText(html, "html"))
            def _send():
                with smtplib.SMTP(_settings.smtp_host, _settings.smtp_port) as s:
                    s.ehlo(); s.starttls()
                    s.login(_settings.smtp_user, _settings.smtp_password)
                    s.sendmail(_settings.smtp_user, email, msg.as_string())
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, _send)
            sent += 1
        except Exception as e:
            logger.error("Broadcast failed for %s: %s", email, e)
            failed += 1

    return {"sent": sent, "failed": failed, "total": len(users)}


# ─── Coupons ──────────────────────────────────────────────────────────────────

class CreateCouponRequest(BaseModel):
    code: str
    tokens: int
    max_uses: int = 1
    expires_at: Optional[str] = None
    description: str = ""


@router.get("/coupons")
async def list_coupons(redis=Depends(get_redis), _=Depends(_require_admin)):
    coupons = await coupon_service.list_coupons(redis)
    return {"coupons": coupons}


@router.post("/coupons")
async def create_coupon(
    req: CreateCouponRequest,
    redis=Depends(get_redis),
    _=Depends(_require_admin),
):
    try:
        coupon = await coupon_service.create_coupon(
            redis, req.code, req.tokens, req.max_uses, req.expires_at, req.description
        )
        return {"success": True, "coupon": coupon}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/coupons/{code}")
async def delete_coupon(code: str, redis=Depends(get_redis), _=Depends(_require_admin)):
    await coupon_service.delete_coupon(redis, code)
    return {"success": True}


@router.post("/coupons/{code}/deactivate")
async def deactivate_coupon(code: str, redis=Depends(get_redis), _=Depends(_require_admin)):
    try:
        coupon = await coupon_service.deactivate_coupon(redis, code)
        return {"success": True, "coupon": coupon}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ─── Analytics ────────────────────────────────────────────────────────────────

@router.get("/analytics/revenue")
async def revenue_chart(
    days: int = 30,
    redis=Depends(get_redis),
    _=Depends(_require_admin),
):
    data = await analytics_service.get_revenue_chart(redis, days)
    return {"data": data, "days": days}


@router.get("/analytics/usage")
async def usage_stats(redis=Depends(get_redis), _=Depends(_require_admin)):
    stats = await analytics_service.get_usage_stats(redis)
    return stats