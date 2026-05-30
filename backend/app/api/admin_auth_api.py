from __future__ import annotations

"""
Admin authentication API — integrated with main app login.
POST /api/admin-auth/login  — returns admin JWT with role
POST /api/admin-auth/users  — create admin user (superadmin only)
GET  /api/admin-auth/users  — list admin users (superadmin only)
PUT  /api/admin-auth/users/{id} — update admin user
DELETE /api/admin-auth/users/{id} — delete admin user
"""

import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel

from app.dependencies import get_redis
from app.services import admin_auth as admin_auth_service
from app.services.auth import issue_token, verify_token

router = APIRouter()
logger = logging.getLogger(__name__)


# ─── Models ───────────────────────────────────────────────────────────────────

class AdminLoginRequest(BaseModel):
    email: str
    password: str

class AdminLoginResponse(BaseModel):
    access_token: str
    admin: dict

class CreateAdminRequest(BaseModel):
    email: str
    full_name: str
    password: str
    role: str   # superadmin | admin | analytics | support

class UpdateAdminRequest(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None
    password: Optional[str] = None


# ─── Auth helpers ─────────────────────────────────────────────────────────────

async def _get_admin_from_token(authorization: Optional[str], redis) -> dict:
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing admin token")

    # Tokens are prefixed with "admin:" to distinguish from user tokens
    if not token.startswith("admin:"):
        raise HTTPException(status_code=401, detail="Not an admin token")

    user_id = verify_token(token[6:])  # strip "admin:" prefix
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired admin token")

    admin = await admin_auth_service.get_admin_user(redis, user_id)
    if not admin:
        raise HTTPException(status_code=403, detail="Not an admin account")
    if not admin.get("active", True):
        raise HTTPException(status_code=403, detail="Admin account suspended")
    return admin


def _require_role(*roles: str):
    """FastAPI dependency that checks admin role."""
    async def _check(
        authorization: Optional[str] = Header(None),
        redis=Depends(get_redis),
    ) -> dict:
        admin = await _get_admin_from_token(authorization, redis)
        if admin["role"] not in roles and admin["role"] != "superadmin":
            raise HTTPException(
                status_code=403,
                detail=f"Requires role: {', '.join(roles)}. Your role: {admin['role']}"
            )
        return admin
    return _check


def _require_admin():
    async def _check(
        authorization: Optional[str] = Header(None),
        redis=Depends(get_redis),
    ) -> dict:
        return await _get_admin_from_token(authorization, redis)
    return _check


# ─── Login ────────────────────────────────────────────────────────────────────

@router.post("/login", response_model=AdminLoginResponse)
async def admin_login(req: AdminLoginRequest, redis=Depends(get_redis), request=None):
    """
    Authenticate as an admin user.
    Uses same email/password but checks the admin user store.
    Returns an admin token prefixed with 'admin:' to distinguish from user tokens.
    """
    # ── Brute-force protection — max 10 attempts per email per minute ─────────
    _rl_key = f"admin_login_rl:{req.email}"
    try:
        _attempts = await redis.incr(_rl_key)
        if _attempts == 1:
            await redis.expire(_rl_key, 60)   # 1-minute window
        if _attempts > 10:
            raise HTTPException(status_code=429, detail="Too many login attempts. Try again in a minute.")
    except HTTPException:
        raise
    except Exception:
        pass  # Redis failure — don't block login

    admin = await admin_auth_service.authenticate_admin(redis, req.email, req.password)
    if not admin:
        raise HTTPException(status_code=401, detail="Invalid credentials or not an admin account")

    # Issue admin token — prefixed so it can't be used as a regular user token
    raw_token = issue_token(admin["id"])
    admin_token = f"admin:{raw_token}"

    logger.info("Admin login | email=%s | role=%s", admin["email"], admin["role"])

    return AdminLoginResponse(access_token=admin_token, admin=admin)


@router.get("/me")
async def get_admin_me(
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    """Get current admin profile."""
    return await _get_admin_from_token(authorization, redis)


# ─── Admin user management (superadmin only) ──────────────────────────────────

@router.get("/users")
async def list_admins(
    admin=Depends(_require_role("superadmin")),
    redis=Depends(get_redis),
):
    """List all admin users."""
    return {"admins": await admin_auth_service.list_admin_users(redis)}


@router.post("/users")
async def create_admin(
    req: CreateAdminRequest,
    admin=Depends(_require_role("superadmin")),
    redis=Depends(get_redis),
):
    """Create a new admin user (superadmin only)."""
    try:
        new_admin = await admin_auth_service.create_admin_user(
            redis,
            email=req.email,
            full_name=req.full_name,
            password=req.password,
            role=req.role,
            created_by=admin["email"],
        )
        return {"success": True, "admin": new_admin}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/users/{admin_id}")
async def update_admin(
    admin_id: str,
    req: UpdateAdminRequest,
    admin=Depends(_require_role("superadmin")),
    redis=Depends(get_redis),
):
    """Update an admin user."""
    try:
        updated = await admin_auth_service.update_admin_user(
            redis, admin_id,
            full_name=req.full_name,
            role=req.role,
            active=req.active,
            password=req.password,
        )
        return {"success": True, "admin": updated}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/users/{admin_id}")
async def delete_admin(
    admin_id: str,
    admin=Depends(_require_role("superadmin")),
    redis=Depends(get_redis),
):
    """Delete an admin user (superadmin only)."""
    if admin_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    try:
        await admin_auth_service.delete_admin_user(redis, admin_id)
        return {"success": True}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/roles")
async def get_roles(_=Depends(_require_admin())):
    """Return available roles and their permissions."""
    return {
        "roles": [
            {"role": "superadmin", "label": "Super Admin",  "description": "Full access — can create and manage admin users", "permissions": ["*"]},
            {"role": "admin",      "label": "Admin",        "description": "Full dashboard access except managing other admins", "permissions": admin_auth_service.ROLE_PERMISSIONS["admin"]},
            {"role": "analytics",  "label": "Analytics",   "description": "Read-only access to stats, analytics and transactions", "permissions": admin_auth_service.ROLE_PERMISSIONS["analytics"]},
            {"role": "support",    "label": "Support",     "description": "View users, top-up tokens, view queue", "permissions": admin_auth_service.ROLE_PERMISSIONS["support"]},
        ]
    }

class ResetPasswordRequest(BaseModel):
    new_password: str
    confirm_password: str


@router.post("/reset-password")
async def reset_password(
    req: ResetPasswordRequest,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    """
    Reset admin password — required on first login when must_reset_password is True.
    Can also be used voluntarily to change password.
    """
    admin = await _get_admin_from_token(authorization, redis)

    if req.new_password != req.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    if len(req.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    updated = await admin_auth_service.reset_admin_password(redis, admin["id"], req.new_password)
    logger.info("Admin password reset | email=%s", admin["email"])
    return {"success": True, "must_reset_password": False, "admin": updated}
