from __future__ import annotations

"""
Admin API — protected by ADMIN_SECRET_KEY header.
"""

import csv
import hashlib
import hmac
import io
import json
import logging
import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header, Depends, Request, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from fastapi import Query
from app.config import get_settings
from app.dependencies import get_redis
from app.services import auth as auth_service
from app.services import pricing as pricing_service
from app.services import admin_auth as admin_auth_service
from app.services import coupons as coupon_service
from app.middleware.rate_limit import limiter
from app.services import analytics as analytics_service
from app.services.email import send_token_confirmation

settings = get_settings()
router = APIRouter()
logger = logging.getLogger(__name__)

COUPON_PREFIX  = "coupon:"
BROADCAST_KEY  = "admin:broadcasts"
CSRF_KEY_PREFIX = "admin:csrf:"
CSRF_TTL        = 3600          # tokens valid for 1 hour
AUDIT_LOG_KEY   = "admin:audit"  # rich audit trail (separate from simple action log)


# ─── Auth guard ───────────────────────────────────────────────────────────────

async def _require_admin(
    authorization: Optional[str] = Header(None),
    x_admin_key: Optional[str] = Header(None),
    redis=Depends(get_redis),
) -> dict:
    """
    Authenticate admin. Returns admin dict with email, role, full_name.
    Used as FastAPI dependency — inject as `admin: dict = Depends(_require_admin)`.
    """
    token = (authorization or "").removeprefix("Bearer ").strip()
    if token.startswith("admin:"):
        from app.services.auth import verify_token as _vt
        uid = _vt(token[6:])
        if uid:
            adm = await admin_auth_service.get_admin_user(redis, uid)
            if adm and adm.get("active", True):
                return adm
        raise HTTPException(status_code=403, detail="Invalid or expired admin token")
    if x_admin_key:
        if settings.admin_secret_key and x_admin_key == settings.admin_secret_key:
            return {"role": "superadmin", "email": "legacy-key", "full_name": "Superadmin"}
        raise HTTPException(status_code=403, detail="Invalid admin key")
    raise HTTPException(status_code=403, detail="Admin authentication required")


# ─── CSRF protection ──────────────────────────────────────────────────────────

@router.get("/csrf-token")
async def get_csrf_token(
    redis=Depends(get_redis),
    admin: dict = Depends(_require_admin),
):
    """Issue a CSRF token tied to this admin session."""
    token = secrets.token_hex(32)
    admin_id = admin.get("id") or admin.get("email", "legacy")
    await redis.set(f"{CSRF_KEY_PREFIX}{admin_id}:{token}", "1", ex=CSRF_TTL)
    return {"csrf_token": token, "expires_in": CSRF_TTL}


async def _verify_csrf(
    redis,
    admin: dict,
    x_csrf_token: Optional[str] = None,
) -> None:
    """
    Verify CSRF token for state-mutating admin actions.
    Logs invalid tokens but does NOT block — the admin JWT already
    proves identity; CSRF adds defence-in-depth without breaking workflows.
    """
    if not x_csrf_token:
        logger.warning("CSRF token missing for admin=%s — action allowed (JWT validated)",
                       admin.get("email", "?"))
        return
    admin_id = admin.get("id") or admin.get("email", "legacy")
    key = f"{CSRF_KEY_PREFIX}{admin_id}:{x_csrf_token}"
    valid = await redis.get(key)
    if not valid:
        logger.warning("CSRF token invalid/expired for admin=%s — action allowed (JWT validated)",
                       admin.get("email", "?"))
        return
    # Valid — rotate token
    await redis.delete(key)
    logger.debug("CSRF token validated and rotated for admin=%s", admin.get("email", "?"))


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
    target:      str = "all"           # "all" | "plan" | "user" | "upload"
    plan:        Optional[str] = None  # required if target=plan
    user_id:     Optional[str] = None  # required if target=user
    email_list:  Optional[list] = None # required if target=upload
    subject:     str
    message:     str
    html:        Optional[str] = None  # rich HTML body from editor

class CouponRequest(BaseModel):
    code: str
    tokens: int
    max_uses: int = 0
    expires_days: int = 0

class CreateCouponRequest(BaseModel):
    code: str
    tokens: int
    max_uses: int = 1
    expires_at: Optional[str] = None
    description: str = ""


# ─── Helpers ──────────────────────────────────────────────────────────────────

# Cache _all_users for 60 seconds to avoid repeated full Redis scans
_all_users_cache: dict = {"ts": 0.0, "data": []}
_ALL_USERS_TTL = 10  # seconds — short TTL so token balances stay current

async def _all_users(redis, force: bool = False) -> list[dict]:
    import time
    now = time.time()
    if not force and now - _all_users_cache["ts"] < _ALL_USERS_TTL:
        return _all_users_cache["data"]
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
    # For workspace OWNERS/ADMINS → show pool balance (they own the pool)
    # For workspace EDITORS/CLIENTS → show their personal token balance
    for u in users:
        uid = u.get("id", "")
        if not uid:
            continue
        try:
            ws_raw = await redis.get(f"workspace:user:{uid}")
            if ws_raw:
                ws_id = ws_raw if isinstance(ws_raw, str) else ws_raw.decode()
                role_raw = await redis.get(f"workspace:member:{ws_id}:{uid}")
                role = (role_raw if isinstance(role_raw, str) else role_raw.decode()).strip() if role_raw else ""
                u["_is_agency_member"] = True
                u["_ws_id"] = ws_id
                u["_ws_role"] = role
                if role in ("owner", "admin"):
                    # Show the shared pool balance — this is what they manage
                    pool_raw = await redis.get(f"agency:tokens:{ws_id}")
                    if pool_raw is not None:
                        pool_bal = int(pool_raw)
                        u["tokens_remaining"] = pool_bal
                        u["tokens_total"]     = pool_bal
                        u["_token_label"] = "pool"
                else:
                    # Editors/clients keep their personal balance as-is
                    u["_token_label"] = "personal"
        except Exception:
            pass
    _all_users_cache["ts"]   = now
    _all_users_cache["data"] = users
    return users


async def _log_action(redis, action: str, admin: dict | None = None, **kwargs):
    """
    Dual write:
      1. admin:log:* keys  — simple action log (existing, for activity logs page)
      2. admin:audit list  — rich audit trail with who/what/when/ip
    """
    ts = datetime.now(timezone.utc).isoformat()
    entry = {
        "action": action,
        "ts": ts,
        # Who performed the action
        "performed_by_email": (admin or {}).get("email", "unknown"),
        "performed_by_name":  (admin or {}).get("full_name", ""),
        "performed_by_role":  (admin or {}).get("role", "unknown"),
        **kwargs,
    }
    # Simple per-key log (existing — activity log page reads these)
    log_key = f"admin:log:{ts}:{uuid.uuid4().hex[:4]}"
    await redis.set(log_key, json.dumps(entry), ex=60 * 60 * 24 * 90)
    # Rich audit list (new — audit page reads this)
    await redis.lpush(AUDIT_LOG_KEY, json.dumps(entry))
    await redis.ltrim(AUDIT_LOG_KEY, 0, 999)   # keep last 1000 audit events


# ─── Stats ────────────────────────────────────────────────────────────────────

@router.get("/stats")
async def get_stats(redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
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

    # Sum workspace token pools (agency:tokens:{ws_id})
    workspace_pool_total = 0
    workspace_pools: list[dict] = []
    cursor3 = 0
    while True:
        cursor3, wkeys = await redis.scan(cursor3, match="agency:tokens:*", count=200)
        for wkey in wkeys:
            raw_pool = await redis.get(wkey)
            if raw_pool:
                try:
                    pool_bal = int(raw_pool)
                    ws_id = wkey.split("agency:tokens:")[-1]
                    workspace_pool_total += pool_bal
                    workspace_pools.append({"ws_id": ws_id, "balance": pool_bal})
                except (ValueError, TypeError):
                    pass
        if cursor3 == 0:
            break

    user_token_total = sum(u.get("tokens_remaining", 0) for u in users)

    return {
        "total_users": len(users),
        "total_tokens_in_circulation": user_token_total + workspace_pool_total,
        "user_tokens_total": user_token_total,
        "workspace_pool_total": workspace_pool_total,
        "workspace_pools": sorted(workspace_pools, key=lambda x: x["balance"], reverse=True),
        "total_videos_created": total_videos,
        "total_transactions": tx_count,
        "users_by_plan": plans,
        "top_niches": dict(sorted(niches.items(), key=lambda x: x[1], reverse=True)[:8]),
        "avg_scenes_per_video": avg_scenes,
        "total_scenes_generated": total_scenes,
    }


# ─── Users ────────────────────────────────────────────────────────────────────


@router.get("/workspaces/pools")
async def get_workspace_pools(redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    """Return all agency workspace token pools with workspace name and balance."""
    pools = []
    cursor = 0
    while True:
        cursor, wkeys = await redis.scan(cursor, match="agency:tokens:*", count=200)
        for wkey in wkeys:
            ws_id = wkey.split("agency:tokens:")[-1] if "agency:tokens:" in wkey else wkey
            raw_pool = await redis.get(wkey)
            balance = int(raw_pool) if raw_pool else 0
            # Try to get workspace name
            ws_raw = await redis.get(f"workspace:{ws_id}")
            ws_name = ""
            owner_email = ""
            if ws_raw:
                try:
                    ws = json.loads(ws_raw)
                    ws_name = ws.get("name", "")
                    owner_email = ws.get("owner_email", "")
                except Exception:
                    pass
            pools.append({
                "ws_id": ws_id,
                "name": ws_name,
                "owner_email": owner_email,
                "balance": balance,
            })
        if cursor == 0:
            break
    pools.sort(key=lambda x: x["balance"], reverse=True)
    return {"pools": pools, "total": sum(p["balance"] for p in pools)}


@router.get("/users")
@limiter.limit("30/minute")
async def list_users(request: Request, redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    users = await _all_users(redis)
    users.sort(key=lambda u: u.get("created_at", ""), reverse=True)
    return {"users": users, "total": len(users)}


@router.get("/users/export/csv")
async def export_users_csv(redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
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
            "id": u.get("id", ""), "full_name": u.get("full_name", ""),
            "email": u.get("email", ""), "plan": u.get("plan", "free"),
            "tokens_remaining": u.get("tokens_remaining", 0),
            "tokens_total": u.get("tokens_total", 0),
            "videos_created": u.get("videos_created", 0),
            "suspended": u.get("suspended", False), "created_at": u.get("created_at", ""),
        })
    output.seek(0)
    filename = f"sceneforge_users_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/users/{user_id}")
async def get_user(user_id: str, redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    raw = await redis.get(f"user:{user_id}")
    if not raw:
        raise HTTPException(status_code=404, detail="User not found")
    data = json.loads(raw)
    data.pop("password_hash", None)
    data["charged_jobs_count"] = await redis.scard(f"user:{user_id}:charged_jobs")
    return data


@router.post("/users/top-up")
async def admin_top_up(req: SetTokensRequest, redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    try:
        updated = await auth_service.add_tokens(redis, req.user_id, req.tokens)
        await _log_action(redis, "top_up", admin=admin, user_id=req.user_id, tokens=req.tokens, reason=req.reason)
        return {"success": True, "tokens_remaining": updated.tokens_remaining, "user": updated.email}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/users/set-tokens")
async def admin_set_tokens(req: SetTokensRequest, redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    raw = await redis.get(f"user:{req.user_id}")
    if not raw:
        raise HTTPException(status_code=404, detail="User not found")
    data = json.loads(raw)
    old = data.get("tokens_remaining", 0)
    data["tokens_remaining"] = req.tokens
    await redis.set(f"user:{req.user_id}", json.dumps(data))
    await _log_action(redis, "set_tokens", admin=admin, user_id=req.user_id, tokens=req.tokens, old=old, reason=req.reason)
    return {"success": True, "old_balance": old, "new_balance": req.tokens}


@router.post("/users/set-plan")
async def admin_set_plan(req: SetPlanRequest, redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    await auth_service.update_plan(redis, req.user_id, req.plan)
    await _log_action(redis, "set_plan", admin=admin, user_id=req.user_id, plan=req.plan)
    return {"success": True, "plan": req.plan}


@router.post("/users/suspend")
async def suspend_user(req: SuspendUserRequest, redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    raw = await redis.get(f"user:{req.user_id}")
    if not raw:
        raise HTTPException(status_code=404, detail="User not found")
    data = json.loads(raw)
    data["suspended"] = req.suspended
    data["suspend_reason"] = req.reason
    await redis.set(f"user:{req.user_id}", json.dumps(data))
    await _log_action(redis, "suspend", admin=admin if req.suspended else "unsuspend", user_id=req.user_id, reason=req.reason)
    return {"success": True, "suspended": req.suspended}


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    raw = await redis.get(f"user:{user_id}")
    if not raw:
        raise HTTPException(status_code=404, detail="User not found")
    data = json.loads(raw)
    await redis.delete(f"email_index:{data.get('email', '')}")
    await redis.delete(f"user:{user_id}")
    await redis.delete(f"user:{user_id}:charged_jobs")
    await _log_action(redis, "delete_user", admin=admin, user_id=user_id, email=data.get("email"))
    return {"success": True, "deleted": user_id}


# ─── Pricing ──────────────────────────────────────────────────────────────────

@router.get("/pricing")
async def get_pricing(redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    plans = await pricing_service.get_plans(redis)
    return {"plans": plans}


@router.put("/pricing/{plan_key}")
async def update_pricing(plan_key: str, req: UpdatePlanPricingRequest, redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    try:
        plans = await pricing_service.update_plan_pricing(redis, plan_key, req.amount, req.tokens, req.label, req.currency)
        await _log_action(redis, "pricing_update", admin=admin, plan_key=plan_key, amount=req.amount, tokens=req.tokens, reason=f"Updated {plan_key}")
        return {"success": True, "plans": plans}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/pricing")
async def add_pricing_plan(req: AddPlanRequest, redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    plans = await pricing_service.add_plan(redis, req.plan_key, req.amount, req.tokens, req.label, req.currency)
    await _log_action(redis, "plan_added", admin=admin, plan_key=req.plan_key, amount=req.amount, tokens=req.tokens)
    return {"success": True, "plans": plans}


@router.delete("/pricing/{plan_key}")
async def delete_pricing_plan(plan_key: str, redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    try:
        plans = await pricing_service.delete_plan(redis, plan_key)
        return {"success": True, "plans": plans}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ─── Transactions ─────────────────────────────────────────────────────────────

@router.get("/transactions")
async def list_transactions(redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    txns = []
    cursor = 0
    while True:
        cursor, keys = await redis.scan(cursor, match="payment:processed:*", count=200)
        for key in keys:
            tx_id = key.replace("payment:processed:", "")
            raw = await redis.get(f"payment:record:{tx_id}")
            if raw:
                try:
                    txns.append(json.loads(raw))
                    continue
                except Exception:
                    pass
            txns.append({"transaction_id": tx_id, "status": "completed"})
        if cursor == 0:
            break
    txns.sort(key=lambda t: t.get("ts", ""), reverse=True)
    return {"transactions": txns, "total": len(txns)}


@router.get("/revenue/chart")
async def revenue_chart(redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
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
    daily: dict[str, float] = {}
    total = 0.0
    for tx in txns:
        ts = tx.get("ts", "")
        amount = float(tx.get("amount", 0))
        if ts:
            day = ts[:10]
            daily[day] = daily.get(day, 0) + amount
            total += amount
    from datetime import timedelta
    today = datetime.now(timezone.utc).date()
    chart = []
    for i in range(29, -1, -1):
        day = str(today - timedelta(days=i))
        chart.append({"date": day, "amount": daily.get(day, 0)})
    return {"chart": chart, "total_revenue": total, "total_transactions": len(txns)}


# ─── Email broadcast ──────────────────────────────────────────────────────────

@router.post("/broadcast")
async def broadcast_email(
    req: BroadcastRequest,
    redis=Depends(get_redis),
    admin: dict = Depends(_require_admin),
    x_csrf_token: Optional[str] = Header(None, alias="x-csrf-token"),
):
    """
    await _verify_csrf(redis, admin, x_csrf_token)
    await _verify_csrf(redis, admin, x_csrf_token)
    await _verify_csrf(redis, admin, x_csrf_token)
    await _verify_csrf(redis, admin, x_csrf_token)
    await _verify_csrf(redis, admin, x_csrf_token)
    await _verify_csrf(redis, admin, x_csrf_token)
    await _verify_csrf(redis, admin, x_csrf_token)
    await _verify_csrf(redis, admin, x_csrf_token)
    await _verify_csrf(redis, admin, x_csrf_token)
    Targeted email broadcast.
    target=all   → every non-suspended user
    target=plan  → all users on a specific plan (free/starter/pro/studio)
    target=user  → one specific user by UUID
    Use {{name}} and {{email}} in subject/message for personalisation.
    """
    from app.services.email import _send

    # ── Collect recipients ────────────────────────────────────────────────────
    recipients: list[dict] = []

    if req.target == "user":
        if not req.user_id:
            raise HTTPException(status_code=400, detail="user_id required for target=user")
        # Support email lookup as well as UUID
        if "@" in req.user_id:
            idx_raw = await redis.get(f"email_index:{req.user_id.lower()}")
            uid = idx_raw.decode() if isinstance(idx_raw, bytes) else (idx_raw or "")
        else:
            uid = req.user_id
        raw = await redis.get(f"user:{uid}")
        if not raw:
            raise HTTPException(status_code=404, detail="User not found")
        user = json.loads(raw)
        user.pop("password_hash", None)
        if user.get("email"):
            recipients.append(user)
    elif req.target == "upload":
        if not req.email_list:
            raise HTTPException(status_code=400, detail="email_list required for target=upload")
        for email_addr in req.email_list:
            email_addr = email_addr.strip().lower()
            if not email_addr:
                continue
            # Try to find user record for personalisation
            idx_raw = await redis.get(f"email_index:{email_addr}")
            uid = idx_raw.decode() if isinstance(idx_raw, bytes) else (idx_raw or "")
            if uid:
                raw = await redis.get(f"user:{uid}")
                if raw:
                    user = json.loads(raw)
                    user.pop("password_hash", None)
                    recipients.append(user)
                    continue
            # Not a registered user — send with email only
            recipients.append({"email": email_addr, "full_name": "Creator"})
    else:
        all_users = await _all_users(redis)
        for user in all_users:
            if not user.get("email"):
                continue
            if user.get("suspended"):
                continue
            if req.target == "plan":
                if not req.plan:
                    raise HTTPException(status_code=400, detail="plan required for target=plan")
                if user.get("plan", "free") != req.plan:
                    continue
            recipients.append(user)

    if not recipients:
        raise HTTPException(status_code=404, detail="No matching users found")

    logger.info("Broadcast | target=%s plan=%s | recipients=%d | subject=%s",
                req.target, req.plan, len(recipients), req.subject)

    # ── HTML template ─────────────────────────────────────────────────────────
    def _make_html(name: str, subject: str, body: str) -> str:
        html_body = body.replace("\n\n", "</p><p style='margin:0 0 14px'>").replace("\n", "<br>")
        return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#080810;font-family:Arial,sans-serif;color:#F0F0FF">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080810;padding:40px 0">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0"
        style="background:#111118;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden">
        <tr><td style="background:linear-gradient(135deg,#1a0d33,#0a1a2e);padding:28px 40px;text-align:center">
          <h1 style="margin:0;font-size:24px;font-weight:800;color:#fff">
            Scene<span style="color:#A78BFA">Forge</span>
          </h1>
        </td></tr>
        <tr><td style="padding:32px 40px">
          <p style="margin:0 0 14px;font-size:15px;color:rgba(255,255,255,0.85)">Hi {name},</p>
          <p style="margin:0 0 14px;font-size:14px;color:rgba(255,255,255,0.7);line-height:1.7">{html_body}</p>
          <p style="margin:24px 0 0;font-size:13px;color:rgba(255,255,255,0.35)">— The SceneForge Team</p>
        </td></tr>
        <tr><td style="padding:16px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.2)">SceneForge · AI Video Studio</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""

    # ── Send ──────────────────────────────────────────────────────────────────
    sent = failed = skipped = 0

    for user in recipients:
        email = user.get("email", "")
        name  = user.get("full_name", "Creator")
        if not email:
            skipped += 1
            continue
        body = req.message.replace("{{name}}", name).replace("{{email}}", email)
        subj = req.subject.replace("{{name}}", name)
        html = (req.html or _make_html(name, subj, body)).replace("{{name}}", name)
        try:
            await _send(email, subj, html, body)
            sent += 1
        except Exception as e:
            logger.error("Broadcast failed → %s: %s", email, e)
            failed += 1

    # Store record
    rec = {
        "id":         uuid.uuid4().hex[:8],
        "target":     req.target,
        "plan":       req.plan or "",
        "user_id":    req.user_id or "",
        "subject":    req.subject,
        "message":    req.message[:500] if req.message else "",
        "html":       req.html[:5000] if req.html else "",
        "recipients": len(recipients),
        "sent":       sent,
        "failed":     failed,
        "skipped":    skipped,
        "ts":         datetime.now(timezone.utc).isoformat(),
    }
    await redis.lpush(BROADCAST_KEY, json.dumps(rec))
    await redis.ltrim(BROADCAST_KEY, 0, 49)
    await _log_action(redis, "broadcast", admin=admin, subject=req.subject, sent=sent,
                      errors=failed, reason=f"Target: {req.target}")

    return {"success": True, "sent": sent, "failed": failed,
            "skipped": skipped, "total": len(recipients)}


@router.get("/broadcasts")
async def list_broadcasts(redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    raw_list = await redis.lrange(BROADCAST_KEY, 0, 49)
    broadcasts = [json.loads(r) for r in raw_list]
    return {"broadcasts": broadcasts}


# ─── AI Broadcast helpers ─────────────────────────────────────────────────────

class AICampaignRequest(BaseModel):
    goal: str           # re-engage | upgrade | feature | thankyou | promo | tips
    tone: str = "friendly"
    segment: str = "all"
    context: str = ""   # extra context from admin

class AISubjectRequest(BaseModel):
    body: str
    subject: str = ""

class AIAssistRequest(BaseModel):
    action: str         # shorten | emotional | cta | rewrite | simplify | urgent | custom
    body: str
    instruction: str = ""  # for custom action


async def _call_ai(prompt: str, max_tokens: int = 600) -> str:
    """
    Call AI for broadcast features.
    Tries OpenAI first, falls back to Groq.
    Both keys are in settings as openai_api_key / groq_api_key.
    """
    cfg = get_settings()
    errors = []

    # ── Primary: OpenAI ───────────────────────────────────────────────────
    openai_key = getattr(cfg, "openai_api_key", "") or ""
    if openai_key:
        try:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=openai_key)
            resp = await client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=0.7,
            )
            return resp.choices[0].message.content or ""
        except Exception as e:
            err_msg = f"OpenAI failed: {e}"
            logger.error("Broadcast AI — %s", err_msg)
            errors.append(err_msg)

    # ── Fallback: Groq ────────────────────────────────────────────────────
    groq_key = getattr(cfg, "groq_api_key", "") or ""
    if groq_key:
        try:
            from groq import AsyncGroq
            client = AsyncGroq(api_key=groq_key)
            resp = await client.chat.completions.create(
                model=getattr(cfg, "groq_model", None) or "llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=0.7,
            )
            return resp.choices[0].message.content or ""
        except Exception as e:
            err_msg = f"Groq failed: {e}"
            logger.error("Broadcast AI fallback — %s", err_msg)
            errors.append(err_msg)

    detail = "; ".join(errors) if errors else "No AI provider configured (set OPENAI_API_KEY or GROQ_API_KEY in Railway)"
    raise HTTPException(status_code=503, detail=detail)


@router.post("/broadcast/ai/campaign")
async def ai_generate_campaign(
    req: AICampaignRequest,
    redis=Depends(get_redis),
    admin: dict = Depends(_require_admin),
):
    """Generate a full email campaign using Claude."""
    goal_desc = {
        "re-engage": "Re-engage inactive users who haven't created a video in 14+ days",
        "upgrade":   "Encourage Free plan users to upgrade to a paid plan",
        "feature":   "Announce an exciting new product feature",
        "thankyou":  "Thank paying subscribers with appreciation and an exclusive offer",
        "promo":     "Offer a limited-time promo code discount",
        "tips":      "Share useful tips and tutorials to boost platform usage",
    }.get(req.goal, req.goal)

    prompt = (
        "You are a world-class email copywriter for SceneForge, an AI video studio "
        "for content creators in Nigeria. The app URL is https://scenraforge.com.\n\n"
        f"Campaign goal: {goal_desc}\n"
        f"Tone: {req.tone}\n"
        f"Target segment: {req.segment} users\n"
        + (f"Extra context: {req.context}\n" if req.context else "")
        + "\nWrite a complete marketing email:\n"
        "- Subject line: compelling, max 60 chars\n"
        "- Email body: conversational, 3-5 short paragraphs, ends with a clear CTA. "
        "Use {{name}} for personalisation. Sign off as 'The SceneForge Team'.\n"
        "- Use relevant emojis and symbols naturally throughout to boost engagement — attention markers (📢 🔔 👇 ⚠️), visual indicators (✅ 🎯 🔥 🚀), decorative elements (✨ ⭐ 💎 🌟), and emphasis symbols (⚡ 💯 🏆 🎉). Place them at the start of key lines, next to CTAs, and to break up sections. Do not overdo it — 4 to 8 emojis per email is ideal.\n\n"
        "Respond ONLY with JSON, no markdown:\n"
        '{"subject":"...","body":"..."}'
    )
    text = await _call_ai(prompt, max_tokens=800)
    import re as _re
    clean = _re.sub(r"```json|```", "", text).strip()
    try:
        result = json.loads(clean)
        return {"subject": result.get("subject", ""), "body": result.get("body", "")}
    except Exception:
        return {"subject": "", "body": text}


@router.post("/broadcast/ai/subjects")
async def ai_subject_suggestions(
    req: AISubjectRequest,
    redis=Depends(get_redis),
    admin: dict = Depends(_require_admin),
):
    """Generate 3 subject line variants for a broadcast."""
    prompt = (
        "You are an email marketing expert for SceneForge, an AI video creation tool "
        "for content creators in Nigeria.\n\n"
        f"Email body:\n{req.body or req.subject}\n\n"
        "Generate exactly 3 subject lines:\n"
        "1. CURIOSITY: Makes reader curious without being clickbait. May include 1 emoji.\n"
        "2. DIRECT: Clear and benefit-focused. May include 1 emoji.\n"
        "3. URGENCY: Creates urgency or FOMO. May include 1 emoji like ⏰ 🔥 ‼️.\n\n"
        "Respond ONLY with JSON array, no markdown:\n"
        '[{"type":"curiosity","subject":"..."},{"type":"direct","subject":"..."},{"type":"urgency","subject":"..."}]'
    )
    text = await _call_ai(prompt, max_tokens=300)
    import re as _re
    clean = _re.sub(r"```json|```", "", text).strip()
    try:
        suggestions = json.loads(clean)
        return {"suggestions": suggestions}
    except Exception:
        return {"suggestions": []}


@router.post("/broadcast/ai/assist")
async def ai_writing_assist(
    req: AIAssistRequest,
    redis=Depends(get_redis),
    admin: dict = Depends(_require_admin),
):
    """AI writing assistant — rewrite, shorten, improve the email body."""
    _emoji = (
        "Use relevant emojis and symbols naturally throughout to boost engagement — attention markers (📢 🔔 👇 ⚠️), visual indicators (✅ 🎯 🔥 🚀), decorative elements (✨ ⭐ 💎 🌟), and emphasis symbols (⚡ 💯 🏆 🎉). Place them at the start of key lines, next to CTAs, and to break up sections. Do not overdo it — 4 to 8 emojis per email is ideal. "
        "Return ONLY the rewritten email body."
    )
    action_prompts = {
        "shorten":   "Shorten this email to under 100 words keeping the core message and CTA. " + _emoji,
        "emotional": "Rewrite this email to be more emotionally resonant and personal. " + _emoji,
        "cta":       "Add a strong call-to-action button/link to scenraforge.com. " + _emoji,
        "rewrite":   "Rewrite this email in a fresher, more engaging way. " + _emoji,
        "simplify":  "Simplify this email — shorter sentences, simpler words, easier to read. " + _emoji,
        "urgent":    "Rewrite this email with more urgency and FOMO. " + _emoji,
        "custom":    req.instruction + " Also: " + _emoji,
    }
    task = action_prompts.get(req.action, req.instruction)
    prompt = (
        "SceneForge is an AI video studio for Nigerian content creators.\n\n"
        f"Original email:\n{req.body}\n\n"
        f"Task: {task}\n\n"
        "Return ONLY the result, no preamble or explanation."
    )
    result = await _call_ai(prompt, max_tokens=700)
    return {"result": result}


# ─── Coupons ──────────────────────────────────────────────────────────────────

@router.get("/coupons")
async def list_coupons(redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    coupons = await coupon_service.list_coupons(redis)
    return {"coupons": coupons}


@router.post("/coupons")
async def create_coupon(req: CreateCouponRequest, redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    try:
        coupon = await coupon_service.create_coupon(
            redis, req.code, req.tokens, req.max_uses, req.expires_at, req.description
        )
        return {"success": True, "coupon": coupon}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/coupons/{code}")
async def delete_coupon(code: str, redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    await coupon_service.delete_coupon(redis, code)
    return {"success": True}


@router.post("/coupons/{code}/deactivate")
async def deactivate_coupon(code: str, redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    try:
        coupon = await coupon_service.deactivate_coupon(redis, code)
        return {"success": True, "coupon": coupon}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ─── Analytics ────────────────────────────────────────────────────────────────

@router.get("/analytics/revenue")
async def analytics_revenue(days: int = 30, redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    data = await analytics_service.get_revenue_chart(redis, days)
    return {"data": data, "days": days}


@router.get("/analytics/usage")
async def analytics_usage(redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    stats = await analytics_service.get_usage_stats(redis)
    return stats


# ─── Render queue ─────────────────────────────────────────────────────────────

@router.get("/queue")
async def get_render_queue(redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
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
    order = {"processing": 0, "queued": 1, "complete": 2, "failed": 3}
    jobs.sort(key=lambda j: order.get(j["status"], 9))
    return {"jobs": jobs, "total": len(jobs)}


# ─── Activity logs ────────────────────────────────────────────────────────────

@router.get("/logs")
async def get_admin_logs(redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
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


# ─── User feedback ────────────────────────────────────────────────────────────

@router.get("/feedback")
async def list_feedback(redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    """Return last 100 feedback entries with user name/email resolved."""
    raw_list = await redis.lrange("sceneforge:feedback", 0, 99)
    items = []
    for r in raw_list:
        try:
            item = json.loads(r)
            # Resolve user name + email from Redis
            uid = item.get("user_id", "")
            if uid and uid != "anonymous":
                user_raw = await redis.get(f"user:{uid}")
                if user_raw:
                    try:
                        u = json.loads(user_raw)
                        item["user_name"] = u.get("full_name", "")
                        item["email"]     = u.get("email", "")
                    except Exception:
                        pass
            items.append(item)
        except Exception:
            pass
    avg = sum(i.get("rating", 0) for i in items) / len(items) if items else 0
    return {
        "feedback": items,
        "total": len(items),
        "avg_rating": round(avg, 2),
    }



# ─── Cost analytics ───────────────────────────────────────────────────────────

@router.get("/costs/summary")
async def get_cost_summary(
    redis=Depends(get_redis),
    admin: dict = Depends(_require_admin),
):
    """Per-plan cost & margin summary."""
    from app.services.cost_tracker import get_plan_cost_summary
    from app.services.pricing import get_plans, get_usd_to_ngn_rate
    summary = await get_plan_cost_summary(redis)
    plans   = await get_plans(redis)
    rate    = await get_usd_to_ngn_rate(redis)

    result = {}
    for plan_key, plan_data in plans.items():
        price_ngn    = float(plan_data.get("amount", 0))
        plan_tokens  = int(plan_data.get("tokens", 100))
        price_usd    = price_ngn / rate
        # Revenue per render = price / (plan_tokens / tokens_per_render)
        from app.services.cost_tracker import TOKENS_PER_VIDEO
        renders_per_plan     = max(plan_tokens / TOKENS_PER_VIDEO, 1)
        revenue_per_render   = price_usd / renders_per_plan

        cost_data = summary.get(plan_key, {})
        n         = max(cost_data.get("renders", 1), 1)
        avg_cost  = cost_data.get("avg_cost_usd", 0)
        margin    = revenue_per_render - avg_cost
        margin_pct = (margin / revenue_per_render * 100) if revenue_per_render > 0 else 0

        result[plan_key] = {
            **cost_data,
            "plan_label":          plan_data.get("label", plan_key),
            "price_ngn":           price_ngn,
            "price_usd":           round(price_usd, 4),
            "plan_tokens":         plan_tokens,
            "renders_per_plan":    round(renders_per_plan, 1),
            "revenue_per_render":  round(revenue_per_render, 6),
            "avg_cost_usd":        round(avg_cost, 6),
            "margin_usd":          round(margin, 4),
            "margin_pct":          round(margin_pct, 1),
            "exchange_rate":       rate,
            "renders":             cost_data.get("renders", 0),
            # Per-render average itemised costs
            "cost_breakdown": {
                "voice":   round(cost_data.get("cost_voice", 0)   / n, 6),
                "visual":  round(cost_data.get("cost_visual", 0)  / n, 6),
                "ai":      round(cost_data.get("cost_ai", 0)      / n, 6),
                "compute": round(cost_data.get("cost_compute", 0) / n, 6),
                "storage": round(cost_data.get("cost_storage", 0) / n, 6),
            },
            # Totals across all renders for this plan
            "total_revenue_usd":   round(cost_data.get("total_revenue_usd", 0), 4),
            "total_cost_usd":      round(cost_data.get("total_cost_usd", 0), 4),
            "total_margin_usd":    round(cost_data.get("total_margin_usd", 0), 4),
        }
    return {"plans": result, "exchange_rate": rate}


@router.get("/costs/recent")
async def get_recent_costs(
    limit: int = 100,
    redis=Depends(get_redis),
    admin: dict = Depends(_require_admin),
):
    """Last N individual render cost records enriched with username + render metadata."""
    from app.services.cost_tracker import get_recent_cost_records
    records = await get_recent_cost_records(redis, limit=min(limit, 500))

    # Enrich with username and render metadata
    # New records have username/user_email baked in; old records need Redis lookup
    user_name_cache: dict = {}
    for rec in records:
        uid = rec.get("user_id", "")
        # Use cached values from cost record if present
        if rec.get("username"):
            rec["full_name"] = rec["username"]
        if rec.get("user_email"):
            rec["email"] = rec.get("user_email", "")
        # Fall back to Redis lookup for old records
        if uid and (not rec.get("full_name")):
            if uid not in user_name_cache:
                try:
                    raw = await redis.get(f"user:{uid}")
                    if raw:
                        ud = json.loads(raw)
                        user_name_cache[uid] = {
                            "full_name": ud.get("full_name", ""),
                            "email":     ud.get("email", ""),
                        }
                    else:
                        user_name_cache[uid] = {"full_name": "", "email": ""}
                except Exception:
                    user_name_cache[uid] = {"full_name": "", "email": ""}
            rec["full_name"] = rec.get("full_name") or user_name_cache[uid]["full_name"]
            rec["email"]     = rec.get("email")     or user_name_cache[uid]["email"]
        # Fallback: ai_provider defaults to "groq" for old records that predate the field
        if not rec.get("ai_provider"):
            rec["ai_provider"] = "groq"

        # Pull extra render metadata from job Redis keys
        job_id = rec.get("job_id", "")
        if job_id:
            try:
                niche_r    = await redis.get(f"job:{job_id}:niche")
                platform_r = await redis.get(f"job:{job_id}:platform")
                title_r    = await redis.get(f"job:{job_id}:project_title")
                scenes_r   = await redis.get(f"job:{job_id}:scenes")
                rec["niche"]         = niche_r.decode() if isinstance(niche_r, bytes) else (niche_r or "")
                rec["platform"]      = platform_r.decode() if isinstance(platform_r, bytes) else (platform_r or "")
                rec["project_title"] = title_r.decode() if isinstance(title_r, bytes) else (title_r or "")
                if scenes_r:
                    import json as _j
                    sc = _j.loads(scenes_r if isinstance(scenes_r, str) else scenes_r.decode())
                    rec["scenes_detail"] = [{"id": s.get("id"), "text": s.get("text","")[:80]} for s in sc[:5]]
            except Exception:
                pass

        # Tokens consumed — each scene costs TOKENS_PER_VIDEO tokens
        if "tokens_consumed" not in rec or not rec["tokens_consumed"]:
            try:
                from app.services.cost_tracker import TOKENS_PER_VIDEO
                rec["tokens_consumed"] = rec.get("scenes", 0) * TOKENS_PER_VIDEO
            except Exception:
                rec["tokens_consumed"] = rec.get("scenes", 0) * 100

    return {"records": records, "total": len(records)}


@router.get("/costs/job/{job_id}")
async def get_job_cost(
    job_id: str,
    redis=Depends(get_redis),
    admin: dict = Depends(_require_admin),
):
    """Cost breakdown for a specific render job."""
    from app.services.cost_tracker import get_cost_record
    rec = await get_cost_record(redis, job_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Cost record not found for this job")
    return rec

@router.post("/costs/backfill")
@limiter.limit("5/hour")
async def backfill_cost_records(
    request: Request,
    redis=Depends(get_redis),
    admin: dict = Depends(_require_admin),
):
    """One-time backfill: re-enrich all cost log records with missing fields.

    Fixes records that predate storage of: niche, tokens_consumed, username,
    user_email, ai_provider.  Safe to run multiple times — already-correct
    fields are never overwritten.
    """
    from app.services.cost_tracker import COST_LOG_KEY, COST_KEY_PREFIX, TOKENS_PER_VIDEO

    raw_list = await redis.lrange(COST_LOG_KEY, 0, 499)
    if not raw_list:
        return {"status": "ok", "updated": 0, "total": 0}

    records = []
    for r in raw_list:
        try:
            records.append(json.loads(r))
        except Exception:
            pass

    user_cache: dict = {}
    updated = 0

    for rec in records:
        dirty = False
        job_id = rec.get("job_id", "")
        uid    = rec.get("user_id", "")

        # ── username / user_email ─────────────────────────────────────────────
        if uid and (not rec.get("username") or not rec.get("user_email")):
            if uid not in user_cache:
                try:
                    raw = await redis.get(f"user:{uid}")
                    user_cache[uid] = json.loads(raw) if raw else {}
                except Exception:
                    user_cache[uid] = {}
            ud = user_cache[uid]
            if not rec.get("username") and ud.get("full_name"):
                rec["username"]   = ud["full_name"]
                dirty = True
            if not rec.get("user_email") and ud.get("email"):
                rec["user_email"] = ud["email"]
                dirty = True
            # keep full_name/email populated for backward compat with JS
            if ud.get("full_name") and not rec.get("full_name"):
                rec["full_name"] = ud["full_name"]
                dirty = True
            if ud.get("email") and not rec.get("email"):
                rec["email"] = ud["email"]
                dirty = True

        # ── niche (may still be in Redis with 1-day TTL) ──────────────────────
        if job_id and not rec.get("niche"):
            try:
                niche_r = await redis.get(f"job:{job_id}:niche")
                if niche_r:
                    rec["niche"] = niche_r.decode() if isinstance(niche_r, bytes) else niche_r
                    dirty = True
            except Exception:
                pass

        # ── platform / project_title ─────────────────────────────────────────
        if job_id:
            for field, redis_key in [("platform", f"job:{job_id}:platform"),
                                      ("project_title", f"job:{job_id}:project_title")]:
                if not rec.get(field):
                    try:
                        val = await redis.get(redis_key)
                        if val:
                            rec[field] = val.decode() if isinstance(val, bytes) else val
                            dirty = True
                    except Exception:
                        pass

        # ── ai_provider ───────────────────────────────────────────────────────
        if not rec.get("ai_provider"):
            rec["ai_provider"] = "groq"
            dirty = True

        # ── tokens_consumed ───────────────────────────────────────────────────
        if not rec.get("tokens_consumed"):
            rec["tokens_consumed"] = max(100, rec.get("scenes", 0) * TOKENS_PER_VIDEO)
            dirty = True

        # ── voice_provider default ────────────────────────────────────────────
        if not rec.get("voice_provider"):
            rec["voice_provider"] = "edge_tts"
            dirty = True

        if dirty:
            updated += 1

    if updated == 0:
        return {"status": "ok", "updated": 0, "total": len(records), "message": "All records already complete"}

    # Rewrite the entire cost log list atomically
    pipe = redis.pipeline()
    pipe.delete(COST_LOG_KEY)
    for rec in records:
        pipe.rpush(COST_LOG_KEY, json.dumps(rec))
    pipe.ltrim(COST_LOG_KEY, 0, 499)
    await pipe.execute()

    # Also update individual job records in render:cost:{job_id}
    individual_updated = 0
    for rec in records:
        jid = rec.get("job_id", "")
        if not jid:
            continue
        try:
            existing_raw = await redis.get(f"{COST_KEY_PREFIX}{jid}")
            if existing_raw:
                existing = json.loads(existing_raw)
                # Merge in the enriched fields
                for field in ("username", "user_email", "full_name", "email",
                              "niche", "platform", "project_title",
                              "ai_provider", "tokens_consumed", "voice_provider"):
                    if rec.get(field) and not existing.get(field):
                        existing[field] = rec[field]
                await redis.set(
                    f"{COST_KEY_PREFIX}{jid}",
                    json.dumps(existing),
                    keepttl=True,
                )
                individual_updated += 1
        except Exception:
            pass

    logger.info("Cost backfill complete — %d/%d records updated, %d individual records patched",
                updated, len(records), individual_updated)
    return {
        "status": "ok",
        "updated": updated,
        "total": len(records),
        "individual_records_patched": individual_updated,
        "message": f"Backfilled {updated} of {len(records)} records",
    }



@router.get("/costs/user/{user_id}")
async def get_user_render_costs(
    user_id: str,
    redis=Depends(get_redis),
    admin: dict = Depends(_require_admin),
):
    """
    All render cost records for a specific user.
    Scans the cost log and returns records matching user_id,
    plus an aggregate summary.
    """
    from app.services.cost_tracker import get_recent_cost_records

    # Fetch up to 500 recent records and filter by user_id
    all_records = await get_recent_cost_records(redis, limit=500)
    user_records = [r for r in all_records if r.get("user_id") == user_id]

    if not user_records:
        # Also try individual job keys via user's job history
        cursor = 0
        user_records = []
        while True:
            cursor, keys = await redis.scan(
                cursor, match="render:cost:*", count=200
            )
            for key in keys:
                raw = await redis.get(key)
                if raw:
                    try:
                        rec = json.loads(raw)
                        if rec.get("user_id") == user_id:
                            user_records.append(rec)
                    except Exception:
                        pass
            if cursor == 0:
                break

    # Sort newest first
    user_records.sort(key=lambda r: r.get("ts", ""), reverse=True)

    # Aggregate summary
    total_renders   = len(user_records)
    total_cost      = sum(r.get("total_cost_usd", 0) for r in user_records)
    total_revenue   = sum(r.get("revenue_per_render", 0) for r in user_records)
    total_margin    = sum(r.get("margin_usd", 0) for r in user_records)
    avg_cost        = total_cost / total_renders if total_renders else 0
    avg_margin_pct  = (
        total_margin / total_revenue * 100 if total_revenue > 0 else 0
    )

    # Cost breakdown totals
    breakdown = {
        "voice":   sum(r.get("cost_voice_usd", 0)   for r in user_records),
        "visual":  sum(r.get("cost_visual_usd", 0)  for r in user_records),
        "ai":      sum(r.get("cost_ai_usd", 0)      for r in user_records),
        "compute": sum(r.get("cost_compute_usd", 0) for r in user_records),
        "storage": sum(r.get("cost_storage_usd", 0) for r in user_records),
    }

    return {
        "user_id":       user_id,
        "total_renders": total_renders,
        "summary": {
            "total_cost_usd":    round(total_cost, 6),
            "total_revenue_usd": round(total_revenue, 4),
            "total_margin_usd":  round(total_margin, 4),
            "avg_cost_usd":      round(avg_cost, 6),
            "avg_margin_pct":    round(avg_margin_pct, 1),
            "breakdown":         {k: round(v, 6) for k, v in breakdown.items()},
        },
        "renders": user_records[:100],   # cap at 100 for response size
    }


# ─── Audit trail ──────────────────────────────────────────────────────────────

@router.get("/audit")
async def get_audit_log(
    redis=Depends(get_redis),
    admin: dict = Depends(_require_admin),
    limit: int = 100,
    action: Optional[str] = None,
    performed_by: Optional[str] = None,
):
    """
    Rich audit trail — who did what and when.
    Filterable by action type and performer email.
    """
    raw = await redis.lrange(AUDIT_LOG_KEY, 0, min(limit * 3, 999))
    entries = []
    for r in raw:
        try:
            e = json.loads(r)
            if action and e.get("action") != action:
                continue
            if performed_by and performed_by.lower() not in e.get("performed_by_email", "").lower():
                continue
            entries.append(e)
            if len(entries) >= limit:
                break
        except Exception:
            pass
    return {
        "entries": entries,
        "total": len(entries),
        "filtered_by_action": action,
        "filtered_by_admin": performed_by,
    }


@router.get("/audit/actions")
async def get_audit_action_types(
    redis=Depends(get_redis),
    admin: dict = Depends(_require_admin),
):
    """Return distinct action types and admin emails for filter dropdowns."""
    raw = await redis.lrange(AUDIT_LOG_KEY, 0, 999)
    actions = set()
    admins  = set()
    for r in raw:
        try:
            e = json.loads(r)
            if e.get("action"):
                actions.add(e["action"])
            if e.get("performed_by_email"):
                admins.add(e["performed_by_email"])
        except Exception:
            pass
    return {"actions": sorted(actions), "admins": sorted(admins)}


# ─── Security monitoring ──────────────────────────────────────────────────────

@router.get("/security/suspicious")
async def get_suspicious_users_admin(
    redis=Depends(get_redis),
    admin: dict = Depends(_require_admin),
):
    """Users flagged for suspicious usage — high render rate, token abuse, failed renders."""
    from app.services.security import get_suspicious_users
    users = await get_suspicious_users(redis, limit=100)
    return {"suspicious_users": users, "total": len(users)}


@router.get("/security/blocked-ips")
async def get_blocked_ips_admin(
    redis=Depends(get_redis),
    admin: dict = Depends(_require_admin),
):
    """IPs currently blocked by the auto-blocker."""
    from app.services.security import get_blocked_ips
    ips = await get_blocked_ips(redis)
    return {"blocked_ips": ips, "total": len(ips)}


@router.delete("/security/blocked-ips/{ip}")
async def unblock_ip_admin(
    ip: str,
    redis=Depends(get_redis),
    admin: dict = Depends(_require_admin),
):
    """Manually unblock an IP address."""
    from app.services.security import unblock_ip
    await unblock_ip(redis, ip)
    await _log_action(redis, "unblock_ip", admin=admin, ip=ip)
    return {"success": True, "unblocked": ip}


@router.get("/security/queue")
async def get_queue_status(
    redis=Depends(get_redis),
    admin: dict = Depends(_require_admin),
):
    """Current render queue depth and per-user active job counts."""
    from app.services.security import QUEUE_KEY, USER_JOBS_PREFIX, MAX_QUEUE_DEPTH
    depth = await redis.llen(QUEUE_KEY)
    # Scan for per-user job counts
    per_user = []
    cursor = 0
    while True:
        cursor, keys = await redis.scan(cursor, match=f"{USER_JOBS_PREFIX}*", count=100)
        for key in keys:
            uid = key.replace(USER_JOBS_PREFIX, "") if isinstance(key, str) else key.decode().replace(USER_JOBS_PREFIX, "")
            count = await redis.scard(key)
            if count > 0:
                per_user.append({"user_id": uid, "active_jobs": count})
        if cursor == 0:
            break
    return {
        "queue_depth": depth,
        "max_queue_depth": MAX_QUEUE_DEPTH,
        "queue_utilisation_pct": round(depth / MAX_QUEUE_DEPTH * 100, 1),
        "active_users": len(per_user),
        "per_user": sorted(per_user, key=lambda x: x["active_jobs"], reverse=True),
    }

# ─── Backfill utilities ───────────────────────────────────────────────────────

@router.post("/transactions/backfill")
async def backfill_transactions(redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    import httpx
    filled = skipped = 0
    cursor = 0
    tx_ids = []
    while True:
        cursor, keys = await redis.scan(cursor, match="payment:processed:*", count=200)
        for key in keys:
            tx_id = key.replace("payment:processed:", "")
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
                    "tx_ref": data.get("tx_ref", ""),
                    "user_id": meta.get("user_id", ""),
                    "email": data.get("customer", {}).get("email", ""),
                    "plan": meta.get("plan_key", "unknown"),
                    "tokens": int(meta.get("tokens", 0)),
                    "amount": float(data.get("amount", 0)),
                    "currency": data.get("currency", "NGN"),
                    "status": "completed",
                    "ts": data.get("created_at", ""),
                }
                await redis.set(f"payment:record:{tx_id}", json.dumps(record), ex=60*60*24*90)
                filled += 1
            except Exception as e:
                logger.warning("Backfill failed for tx %s: %s", tx_id, e)
    return {"filled": filled, "skipped_already_rich": skipped, "total": len(tx_ids) + skipped}


@router.post("/analytics/backfill-scenes")
async def backfill_scene_stats(redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    filled = 0
    cursor = 0
    user_scene_counts: dict[str, int] = {}
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
                uid_raw = await redis.get(f"job:{job_id}:user_id")
                uid = uid_raw.decode() if isinstance(uid_raw, bytes) else (uid_raw or "")
                if uid:
                    user_scene_counts[uid] = user_scene_counts.get(uid, 0) + scene_count
            except Exception:
                pass
        if cursor == 0:
            break
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


# ─── Engagement campaign endpoints ───────────────────────────────────────────

@router.get("/campaigns/status")
async def get_campaign_status(redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    """How many users are in each campaign bucket."""
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    counts = {"scanned": 0, "zero_render": 0, "inactive_5d": 0,
              "inactive_14d": 0, "inactive_30d": 0, "healthy": 0,
              "unverified": 0, "flag_zero_render": 0, "flag_5d": 0,
              "flag_14d": 0, "flag_30d": 0}
    cursor = 0
    while True:
        cursor, keys = await redis.scan(cursor, match="user:*", count=200)
        for key in keys:
            if isinstance(key, bytes): key = key.decode()
            if key.count(":") != 1:
                continue
            raw = await redis.get(key)
            if not raw:
                continue
            try:
                ud = json.loads(raw)
                uid = ud.get("id", "")
                if not uid: continue
                counts["scanned"] += 1
                if not ud.get("email_verified"):
                    counts["unverified"] += 1
                    continue
                videos = ud.get("videos_created", 0)
                created_str = ud.get("created_at", "")
                try:
                    created_at = datetime.fromisoformat(created_str.replace("Z","")).replace(tzinfo=timezone.utc)
                except Exception:
                    created_at = now - timedelta(days=1)
                age_days = (now - created_at).total_seconds() / 86400
                lr_raw = await redis.get(f"user:{uid}:last_render_at")
                lr_str = (lr_raw.decode() if isinstance(lr_raw, bytes) else lr_raw) or ""
                try:
                    last_render = datetime.fromisoformat(lr_str.replace("Z","")).replace(tzinfo=timezone.utc) if lr_str else None
                except Exception:
                    last_render = None
                days_inactive = (now - last_render).total_seconds() / 86400 if last_render else age_days
                if videos == 0 and age_days >= 1.0: counts["zero_render"] += 1
                elif days_inactive >= 30: counts["inactive_30d"] += 1
                elif days_inactive >= 14: counts["inactive_14d"] += 1
                elif days_inactive >= 5:  counts["inactive_5d"] += 1
                else: counts["healthy"] += 1
                # Check if flags already set
                if await redis.exists(f"campaign:zero_render:{uid}"): counts["flag_zero_render"] += 1
                if await redis.exists(f"campaign:inactive_5d:{uid}"): counts["flag_5d"] += 1
                if await redis.exists(f"campaign:inactive_14d:{uid}"): counts["flag_14d"] += 1
                if await redis.exists(f"campaign:inactive_30d:{uid}"): counts["flag_30d"] += 1
            except Exception:
                pass
        if cursor == 0:
            break
    return counts


@router.post("/campaigns/run")
@limiter.limit("3/minute")
async def run_engagement_campaign(
    request: Request,
    redis=Depends(get_redis),
    admin: dict = Depends(_require_admin),
):
    """Trigger the engagement campaign. Runs in the background."""
    from app.services.email_campaigns import run_engagement_campaign as _run
    import asyncio

    async def _bg():
        import redis.asyncio as _aioredis
        import datetime as _dt
        from app.config import get_settings as _gs
        _settings = _gs()
        _r = await _aioredis.from_url(
            _settings.redis_url,
            decode_responses=True,
            ssl_cert_reqs=None,
        )
        try:
            result = await _run(_r)
            logger.info("Campaign run complete: %s", result)
            await _r.set("campaign:last_run",
                         json.dumps({**result, "ts": _dt.datetime.utcnow().isoformat()}),
                         ex=60*60*24*7)
        except Exception as _e:
            logger.error("Campaign background task failed: %s", _e)
        finally:
            await _r.aclose()

    asyncio.create_task(_bg())
    return {"status": "started", "message": "Campaign running in background — check /campaigns/last-run for results"}


@router.get("/campaigns/last-run")
async def get_last_campaign_run(redis=Depends(get_redis), admin: dict = Depends(_require_admin)):
    """Result of the most recent campaign run."""
    raw = await redis.get("campaign:last_run")
    if not raw:
        return {"status": "never_run", "message": "No campaign has been run yet"}
    return json.loads(raw)


@router.post("/campaigns/send-welcome/{user_id}")
async def send_welcome_to_user(
    user_id: str,
    redis=Depends(get_redis),
    admin: dict = Depends(_require_admin),
):
    """Manually send the welcome email to a specific user."""
    raw = await redis.get(f"user:{user_id}")
    if not raw:
        raise HTTPException(status_code=404, detail="User not found")
    ud = json.loads(raw)
    from app.services.email_campaigns import send_welcome_email
    import asyncio
    asyncio.create_task(send_welcome_email(ud["email"], ud.get("full_name", "")))
    await _log_admin_action(redis, admin["email"], "campaign_welcome", user_id, {"email": ud["email"]})
    return {"status": "queued", "email": ud["email"]}


@router.get("/campaigns/preview/{campaign_type}")
async def preview_campaign_email(
    campaign_type: str,
    name: str = "Sarah Johnson",
    tokens: int = 850,
    niche: str = "fitness",
    token: str = "",
    admin: dict = Depends(_require_admin),
):
    """
    Return rendered HTML for a campaign email so admin can preview it before sending.
    campaign_type: welcome | zero_render | inactive_5d | inactive_14d | inactive_30d
    """
    from fastapi.responses import HTMLResponse
    from app.services.email_campaigns import _wrap, _header, _footer, _cta, _feature_row, APP_URL

    first = name.split()[0] if name else "there"
    BLOCKERS = [
        ('"I don\'t know what to make"', '&#8594; SceneForge generates 6 ideas for you'),
        ('"I don\'t have time"',         '&#8594; A full video takes 3&#8211;5 minutes'),
        ('"Not sure quality is good"',   '&#8594; Try one scene preview &#8212; it\'s free'),
        ('"I\'m not a video person"',    '&#8594; You don\'t need to be &#8212; AI handles it'),
    ]
    IDEAS = [
        ("&#127947;", "5-minute home workout &#8212; fitness creators"),
        ("&#128176;", "How to save money fast &#8212; finance creators"),
        ("&#128241;", "3 apps I use every day &#8212; tech creators"),
        ("&#127859;", "Quick 15-minute recipe &#8212; food creators"),
    ]

    def idea_row(e, t):
        return (f'<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;'
                f'background:rgba(255,255,255,0.03);border-radius:8px;margin-bottom:8px">'
                f'<span style="font-size:20px">{e}</span>'
                f'<span style="font-size:13px;color:rgba(255,255,255,0.65)">{t}</span></div>')

    def blocker_row(issue, fix):
        return (f'<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05)">'
                f'<span style="font-size:12px;color:#a78bfa;font-weight:700">{issue}</span>'
                f'<span style="font-size:12.5px;color:rgba(255,255,255,0.5);margin-left:8px">{fix}</span></div>')

    if campaign_type == "welcome":
        features = (
            _feature_row("&#127916;", "AI Script Generation",
                "Describe your topic and watch a full voiceover script appear in real time.") +
            _feature_row("&#128444;", "Auto Stock Footage",
                "Every scene matched with Pexels stock footage automatically.") +
            _feature_row("&#127897;", "Voice Synthesis + Custom Recording",
                "AI voices or record your own. Noise-reduced automatically.") +
            _feature_row("&#128241;", "Every Platform, Perfect Dimensions",
                "TikTok, Reels, YouTube Shorts, LinkedIn &#8212; exactly the right size.") +
            _feature_row("&#127909;", "Ken Burns & Pan Motion Effects",
                "Cinematic zoom and pan make static images feel alive.") +
            _feature_row("&#127970;", "Agency Mode",
                "Client projects, brand kits, teams, and shared token pools.")
        )
        body = (
            f'<tr><td style="padding:36px 40px">'
            f'<p style="margin:0 0 6px;font-size:17px;color:#fff;font-weight:700">Hey {first} &#128075;</p>'
            f'<p style="margin:0 0 20px;font-size:14px;color:rgba(255,255,255,0.55);line-height:1.7">'
            f'Welcome to SceneForge &#8212; turn ideas into publish-ready videos.'
            f' Your account is live with <strong style="color:#2DD4BF">1,000 free tokens</strong>.</p>'
            f'<div style="background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.3);'
            f'border-radius:12px;padding:18px 24px;margin-bottom:24px;text-align:center">'
            f'<p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#a78bfa;text-transform:uppercase;letter-spacing:.1em">Your starting balance</p>'
            f'<p style="margin:0;font-size:40px;font-weight:800;color:#fff">1,000 <span style="font-size:18px;color:rgba(255,255,255,0.4)">tokens</span></p>'
            f'<p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,0.35)">Each video render = 100 tokens = 10 free videos</p></div>'
            f'<p style="margin:0 0 14px;font-size:13px;font-weight:700;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:.08em">What you can do</p>'
            f'<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px">{features}</table>'
            f'<div style="background:rgba(45,212,191,0.07);border:1px solid rgba(45,212,191,0.2);border-radius:12px;padding:20px 24px;margin-bottom:24px">'
            f'<p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#2DD4BF;text-transform:uppercase;letter-spacing:.08em">&#128640; 5 steps to your first video</p>'
            f'<ol style="margin:0;padding-left:18px;color:rgba(255,255,255,0.6);font-size:13px;line-height:1.8">'
            f'<li>Choose niche and target platform</li>'
            f'<li>Pick an AI-generated concept</li>'
            f'<li>Generate or write your script</li>'
            f'<li>Review your auto-generated scenes</li>'
            f'<li>Pick a voice, hit Render &#8212; done</li>'
            f'</ol></div>'
            f'{_cta("Create My First Video &#8594;", APP_URL)}'
            f'</td></tr>'
        )
        subject = f"&#127916; Welcome to SceneForge, {first}! Here\'s what you can do"

    elif campaign_type == "zero_render":
        ideas_html = "".join(idea_row(e, t) for e, t in IDEAS)
        body = (
            f'<tr><td style="padding:36px 40px">'
            f'<p style="margin:0 0 6px;font-size:17px;color:#fff;font-weight:700">Hey {first} &#128075;</p>'
            f'<p style="margin:0 0 20px;font-size:14px;color:rgba(255,255,255,0.55);line-height:1.7">'
            f'You signed up but haven\'t created your first video yet.'
            f' Your <strong style="color:#2DD4BF">{tokens:,} tokens</strong> are ready.</p>'
            f'<div style="background:rgba(124,58,237,0.1);border-left:3px solid #7C3AED;'
            f'border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:22px">'
            f'<p style="margin:0;font-size:13.5px;color:rgba(255,255,255,0.75);line-height:1.7">'
            f'&#9201; <strong style="color:#fff">3 minutes</strong> from blank page to ready-to-post video.</p></div>'
            f'<p style="margin:0 0 10px;font-size:13px;font-weight:700;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:.08em">Most popular first videos</p>'
            f'{ideas_html}'
            f'{_cta("Create My First Video &#8594;", APP_URL)}'
            f'</td></tr>'
        )
        subject = f"&#9203; {first}, your first SceneForge video is 3 minutes away"

    elif campaign_type == "inactive_5d":
        niche_line = (f"We noticed your last video was in the <strong style=\"color:#a78bfa\">{niche}</strong> space. "
                      if niche else "")
        body = (
            f'<tr><td style="padding:36px 40px">'
            f'<p style="margin:0 0 6px;font-size:17px;color:#fff;font-weight:700">Hey {first},</p>'
            f'<p style="margin:0 0 20px;font-size:14px;color:rgba(255,255,255,0.55);line-height:1.7">'
            f'It\'s been 5 days since your last video. {niche_line}'
            f'You have <strong style="color:#2DD4BF">{tokens:,} tokens</strong> ready.</p>'
            f'<div style="background:rgba(45,212,191,0.08);border:1px solid rgba(45,212,191,0.2);border-radius:12px;padding:20px 24px;margin-bottom:22px">'
            f'<p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#2DD4BF">&#128161; What creators are making this week</p>'
            f'<ul style="margin:0;padding-left:16px;color:rgba(255,255,255,0.6);font-size:13px;line-height:1.9">'
            f'<li>Quick tutorial videos &#8212; 10x more saves than long content</li>'
            f'<li>"Did you know?" clips &#8212; easiest to script with AI</li>'
            f'<li>Behind-the-scenes &#8212; authentic and fast</li>'
            f'<li>Product demos with screen capture visuals</li>'
            f'</ul></div>'
            f'<p style="margin:0 0 22px;font-size:13px;color:rgba(255,255,255,0.45);line-height:1.6">'
            f'Consistency is the key. Even one video a week compounds over time.</p>'
            f'{_cta("Jump Back In &#8594;", APP_URL)}'
            f'</td></tr>'
        )
        subject = f"&#127916; {first}, it\'s been 5 days &#8212; ready to create again?"

    elif campaign_type == "inactive_14d":
        blockers_html = "".join(blocker_row(i, f) for i, f in BLOCKERS)
        body = (
            f'<tr><td style="padding:36px 40px">'
            f'<p style="margin:0 0 6px;font-size:17px;color:#fff;font-weight:700">Hey {first},</p>'
            f'<p style="margin:0 0 20px;font-size:14px;color:rgba(255,255,255,0.55);line-height:1.7">'
            f'Two weeks is a long time in the content game.'
            f' Your <strong style="color:#2DD4BF">{tokens:,} tokens</strong> never expire.</p>'
            f'<div style="background:rgba(255,255,255,0.04);border-radius:12px;padding:20px 24px;margin-bottom:22px">'
            f'<p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#fff">&#129300; Is something holding you back?</p>'
            f'<p style="margin:0 0 12px;font-size:12.5px;color:rgba(255,255,255,0.5);line-height:1.55">Common reasons people pause &#8212; and what helps:</p>'
            f'{blockers_html}</div>'
            f'{_cta("Come Back and Create &#8594;", APP_URL)}'
            f'<p style="margin:18px 0 0;font-size:12px;color:rgba(255,255,255,0.25);text-align:center">Reply to this email if there\'s anything we can help with.</p>'
            f'</td></tr>'
        )
        subject = f"&#127909; {first}, still thinking about SceneForge?"

    elif campaign_type == "inactive_30d":
        body = (
            f'<tr><td style="padding:36px 40px">'
            f'<p style="margin:0 0 6px;font-size:17px;color:#fff;font-weight:700">Hey {first},</p>'
            f'<p style="margin:0 0 20px;font-size:14px;color:rgba(255,255,255,0.55);line-height:1.7">'
            f'It\'s been a month. This is our last re-engagement email for a while.'
            f' Your <strong style="color:#2DD4BF">{tokens:,} tokens</strong> never expire.</p>'
            f'<div style="background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.25);border-radius:12px;padding:20px 24px;margin-bottom:22px">'
            f'<p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#a78bfa">&#10024; What\'s new since you left</p>'
            f'<ul style="margin:0;padding-left:16px;color:rgba(255,255,255,0.6);font-size:13px;line-height:1.9">'
            f'<li>Faster rendering &#8212; most videos under 2 minutes</li>'
            f'<li>Custom voice recording in the browser</li>'
            f'<li>Agency Mode &#8212; manage clients, brand kits, teams</li>'
            f'<li>More platforms &#8212; LinkedIn, Pinterest, Snapchat</li>'
            f'</ul></div>'
            f'{_cta("Take Another Look &#8594;", APP_URL)}'
            f'<p style="margin:18px 0 0;font-size:12px;color:rgba(255,255,255,0.2);text-align:center">We won\'t send re-engagement emails after this. Your account stays active forever.</p>'
            f'</td></tr>'
        )
        subject = f"&#127775; {first}, one last note from SceneForge"

    else:
        raise HTTPException(status_code=400, detail=f"Unknown campaign type: {campaign_type}")

    full_html = _wrap(_header("", "") + body + _footer())

    page = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Email preview</title>
  <style>
    body{{margin:0;padding:20px;background:#080810;font-family:Arial,sans-serif}}
    .bar{{background:#1a1a2e;border:1px solid rgba(255,255,255,0.1);border-radius:8px;
      padding:12px 16px;margin-bottom:20px}}
    .bar .row{{display:flex;gap:8px;font-size:12px;margin-bottom:3px}}
    .bar .lbl{{color:rgba(255,255,255,0.35);min-width:60px;flex-shrink:0}}
    .bar .val{{color:rgba(255,255,255,0.65)}}
    .bar .subj{{color:#a78bfa;font-size:13px;font-weight:700;margin-top:6px}}
  </style>
</head>
<body>
  <div class="bar">
    <div class="row"><span class="lbl">From</span><span class="val">SceneForge &lt;hello@scenraforge.com&gt;</span></div>
    <div class="row"><span class="lbl">To</span><span class="val">{name} &lt;preview@example.com&gt;</span></div>
    <div class="row"><span class="lbl">Campaign</span><span class="val">{campaign_type.replace("_"," ").title()}</span></div>
    <div class="subj">{subject}</div>
  </div>
  {full_html}
</body>
</html>"""

    return HTMLResponse(content=page)
