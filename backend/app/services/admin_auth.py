from __future__ import annotations

"""
Admin / role-based access control service.

Roles:
  superadmin  — full access, can create/manage admin users
  admin       — full dashboard access except creating other admins
  analytics   — read-only: stats, analytics, users (no edit)
  support     — can view users, top-up tokens, cannot delete or change pricing

SUPERADMIN is bootstrapped from .env SUPERADMIN_EMAIL + SUPERADMIN_PASSWORD.
"""

import json
import logging
from typing import Optional

import redis.asyncio as aioredis

from app.config import get_settings
from app.services.auth import (
    _hash_password, _verify_password, _user_key, _email_index_key,
    _make_initials, _user_out, TOKENS_ON_SIGNUP
)

settings = get_settings()
logger = logging.getLogger(__name__)

ROLES = ["superadmin", "admin", "analytics", "support"]

ROLE_PERMISSIONS: dict[str, list[str]] = {
    "superadmin": ["*"],                               # all permissions
    "admin":      ["users.*", "pricing.*", "coupons.*", "broadcast.*",
                   "analytics.*", "transactions.*", "queue.*", "logs.*"],
    "analytics":  ["analytics.read", "stats.read", "users.read", "transactions.read"],
    "support":    ["users.read", "users.topup", "users.plan", "queue.read", "logs.read"],
}


def _has_permission(role: str, permission: str) -> bool:
    perms = ROLE_PERMISSIONS.get(role, [])
    if "*" in perms:
        return True
    if permission in perms:
        return True
    # Wildcard match e.g. "users.*" covers "users.read", "users.topup" etc.
    ns = permission.split(".")[0]
    return f"{ns}.*" in perms


async def get_admin_user(redis: aioredis.Redis, user_id: str) -> Optional[dict]:
    """Return admin profile if user has any admin role, else None."""
    raw = await redis.get(f"admin:user:{user_id}")
    if not raw:
        return None
    return json.loads(raw)


async def get_admin_by_email(redis: aioredis.Redis, email: str) -> Optional[dict]:
    uid = await redis.get(_email_index_key(email))
    if not uid:
        return None
    return await get_admin_user(redis, uid)


async def list_admin_users(redis: aioredis.Redis) -> list[dict]:
    admins = []
    cursor = 0
    while True:
        cursor, keys = await redis.scan(cursor, match="admin:user:*", count=200)
        for key in keys:
            raw = await redis.get(key)
            if raw:
                try:
                    a = json.loads(raw)
                    a.pop("password_hash", None)
                    admins.append(a)
                except Exception:
                    pass
        if cursor == 0:
            break
    admins.sort(key=lambda a: a.get("created_at", ""), reverse=True)
    return admins


async def create_admin_user(
    redis: aioredis.Redis,
    email: str,
    full_name: str,
    password: str,
    role: str,
    created_by: str = "system",
) -> dict:
    """Create an admin user (separate from regular user accounts)."""
    if role not in ROLES:
        raise ValueError(f"Invalid role '{role}'. Must be one of: {', '.join(ROLES)}")

    email = email.lower().strip()

    # Check if email already has an admin account
    existing = await redis.get(f"admin:email:{email}")
    if existing:
        raise ValueError(f"Admin account already exists for {email}")

    from datetime import datetime, timezone
    import uuid
    admin_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    admin_data = {
        "id":                admin_id,
        "email":             email,
        "full_name":         full_name,
        "password_hash":     _hash_password(password),
        "role":              role,
        "permissions":       ROLE_PERMISSIONS.get(role, []),
        "created_by":        created_by,
        "created_at":        now,
        "active":            True,
        "must_reset_password": created_by != "bootstrap",  # force reset on first login for all non-bootstrap admins
    }

    await redis.set(f"admin:user:{admin_id}", json.dumps(admin_data))
    await redis.set(f"admin:email:{email}", admin_id)

    logger.info("Admin user created | id=%s | email=%s | role=%s | by=%s",
                admin_id, email, role, created_by)

    safe = {k: v for k, v in admin_data.items() if k != "password_hash"}
    return safe


async def authenticate_admin(
    redis: aioredis.Redis, email: str, password: str
) -> Optional[dict]:
    """Authenticate an admin user. Returns admin profile or None."""
    email = email.lower().strip()

    # Check superadmin bootstrap credentials from .env
    if (settings.superadmin_email and
            email == settings.superadmin_email.lower() and
            settings.superadmin_password and
            password == settings.superadmin_password):

        # Auto-create superadmin record if not yet in Redis
        existing_id = await redis.get(f"admin:email:{email}")
        if not existing_id:
            await create_admin_user(
                redis, email,
                full_name="Super Admin",
                password=password,
                role="superadmin",
                created_by="bootstrap",
            )

        admin_id = await redis.get(f"admin:email:{email}")
        if admin_id:
            raw = await redis.get(f"admin:user:{admin_id}")
            if raw:
                data = json.loads(raw)
                if not data.get("active", True):
                    return None
                data.pop("password_hash", None)
                return data

    # Check regular admin accounts
    admin_id = await redis.get(f"admin:email:{email}")
    if not admin_id:
        return None

    raw = await redis.get(f"admin:user:{admin_id}")
    if not raw:
        return None

    data = json.loads(raw)
    if not data.get("active", True):
        return None
    if not _verify_password(password, data.get("password_hash", "")):
        return None

    data.pop("password_hash", None)
    return data


async def reset_admin_password(
    redis: aioredis.Redis,
    admin_id: str,
    new_password: str,
) -> dict:
    """Reset admin password and clear the must_reset_password flag."""
    raw = await redis.get(f"admin:user:{admin_id}")
    if not raw:
        raise ValueError("Admin user not found")
    data = json.loads(raw)
    data["password_hash"] = _hash_password(new_password)
    data["must_reset_password"] = False
    await redis.set(f"admin:user:{admin_id}", json.dumps(data))
    logger.info("Admin password reset | id=%s", admin_id)
    safe = {k: v for k, v in data.items() if k != "password_hash"}
    return safe


async def update_admin_user(
    redis: aioredis.Redis,
    admin_id: str,
    full_name: Optional[str] = None,
    role: Optional[str] = None,
    active: Optional[bool] = None,
    password: Optional[str] = None,
) -> dict:
    raw = await redis.get(f"admin:user:{admin_id}")
    if not raw:
        raise ValueError("Admin user not found")
    data = json.loads(raw)
    if full_name:
        data["full_name"] = full_name
    if role:
        if role not in ROLES:
            raise ValueError(f"Invalid role: {role}")
        data["role"] = role
        data["permissions"] = ROLE_PERMISSIONS.get(role, [])
    if active is not None:
        data["active"] = active
    if password:
        data["password_hash"] = _hash_password(password)
    await redis.set(f"admin:user:{admin_id}", json.dumps(data))
    safe = {k: v for k, v in data.items() if k != "password_hash"}
    return safe


async def delete_admin_user(redis: aioredis.Redis, admin_id: str) -> None:
    raw = await redis.get(f"admin:user:{admin_id}")
    if not raw:
        raise ValueError("Admin user not found")
    data = json.loads(raw)
    await redis.delete(f"admin:user:{admin_id}")
    await redis.delete(f"admin:email:{data.get('email', '')}")
    logger.info("Admin user deleted | id=%s | email=%s", admin_id, data.get("email"))
