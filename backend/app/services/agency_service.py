from __future__ import annotations
"""
agency_service.py  →  backend/app/services/agency_service.py

All Redis keys:
  workspace:{ws_id}                  — workspace metadata
  workspace:member:{ws_id}:{user_id} — member role
  workspace:members:{ws_id}          — set of user_ids
  workspace:owner:{user_id}          — workspace_id this user owns
  workspace:user:{user_id}           — workspace_id this user belongs to (any role)
  workspace:invite:{token}           — pending invite (7d TTL)
  workspace:invites:{ws_id}          — set of invite tokens
  agency:brandkit:{kit_id}           — brand kit JSON
  agency:brandkits:{ws_id}           — set of kit_ids
  agency:project:{proj_id}           — project JSON
  agency:projects:{ws_id}            — set of proj_ids
  agency:review:{token}              — client review link (TTL 7d)
  agency:comments:{proj_id}          — list of comment JSON
  agency:activity:{ws_id}            — list of activity events (capped 200)
  agency:tokens:{ws_id}              — shared token pool
"""

import json
import uuid
import secrets
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

INVITE_TTL   = 60 * 60 * 24 * 7   # 7 days
REVIEW_TTL   = 60 * 60 * 24 * 7   # 7 days
ACTIVITY_CAP = 200

# ── Key helpers ───────────────────────────────────────────────────────────────

def _ws_key(ws_id: str)              -> str: return f"workspace:{ws_id}"
def _member_key(ws_id, uid)          -> str: return f"workspace:member:{ws_id}:{uid}"
def _members_key(ws_id)              -> str: return f"workspace:members:{ws_id}"
def _owner_key(uid)                  -> str: return f"workspace:owner:{uid}"
def _user_ws_key(uid)                -> str: return f"workspace:user:{uid}"
def _invite_key(token)               -> str: return f"workspace:invite:{token}"
def _invites_key(ws_id)              -> str: return f"workspace:invites:{ws_id}"
def _kit_key(kit_id)                 -> str: return f"agency:brandkit:{kit_id}"
def _kits_key(ws_id)                 -> str: return f"agency:brandkits:{ws_id}"
def _proj_key(proj_id)               -> str: return f"agency:project:{proj_id}"
def _projs_key(ws_id)                -> str: return f"agency:projects:{ws_id}"
def _review_key(token)               -> str: return f"agency:review:{token}"
def _comments_key(proj_id)           -> str: return f"agency:comments:{proj_id}"
def _activity_key(ws_id)             -> str: return f"agency:activity:{ws_id}"
def _pool_key(ws_id)                 -> str: return f"agency:tokens:{ws_id}"

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Workspace ─────────────────────────────────────────────────────────────────

async def create_workspace(redis: aioredis.Redis, owner_id: str, name: str,
                           initial_tokens: int = 50_000) -> dict:
    ws_id = str(uuid.uuid4())
    ws = {
        "id":         ws_id,
        "name":       name,
        "owner_id":   owner_id,
        "plan":       "agency",
        "seat_limit": 5,
        "created_at": _now(),
    }
    pipe = redis.pipeline()
    pipe.set(_ws_key(ws_id), json.dumps(ws))
    pipe.set(_owner_key(owner_id), ws_id)
    pipe.set(_user_ws_key(owner_id), ws_id)
    pipe.set(_member_key(ws_id, owner_id), "owner")
    pipe.sadd(_members_key(ws_id), owner_id)
    pipe.set(_pool_key(ws_id), initial_tokens)
    await pipe.execute()
    await _log_activity(redis, ws_id, owner_id, "workspace_created", {"name": name})
    logger.info("Workspace created | ws=%s | owner=%s", ws_id, owner_id)
    return ws


async def get_workspace(redis: aioredis.Redis, ws_id: str) -> Optional[dict]:
    raw = await redis.get(_ws_key(ws_id))
    return json.loads(raw) if raw else None


async def get_user_workspace(redis: aioredis.Redis, user_id: str) -> Optional[dict]:
    ws_id = await redis.get(_user_ws_key(user_id))
    if not ws_id:
        return None
    ws_id = ws_id if isinstance(ws_id, str) else ws_id.decode()
    return await get_workspace(redis, ws_id)


async def get_workspace_id_for_user(redis: aioredis.Redis, user_id: str) -> Optional[str]:
    ws_id = await redis.get(_user_ws_key(user_id))
    if not ws_id:
        return None
    return ws_id if isinstance(ws_id, str) else ws_id.decode()


# ── Members ───────────────────────────────────────────────────────────────────

VALID_ROLES = {"owner", "admin", "editor", "client"}


async def get_member_role(redis: aioredis.Redis, ws_id: str, user_id: str) -> Optional[str]:
    role = await redis.get(_member_key(ws_id, user_id))
    if not role:
        return None
    return role if isinstance(role, str) else role.decode()


async def get_workspace_members(redis: aioredis.Redis, ws_id: str) -> list[dict]:
    member_ids = await redis.smembers(_members_key(ws_id))
    members = []
    for uid in member_ids:
        uid = uid if isinstance(uid, str) else uid.decode()
        role = await get_member_role(redis, ws_id, uid)
        raw_user = await redis.get(f"user:{uid}")
        if raw_user:
            u = json.loads(raw_user)
            members.append({
                "user_id":  uid,
                "role":     role or "editor",
                "name":     u.get("full_name", ""),
                "email":    u.get("email", ""),
                "initials": u.get("avatar_initials", "?"),
            })
    return sorted(members, key=lambda m: 0 if m["role"] == "owner" else 1)


async def update_member_role(redis: aioredis.Redis, ws_id: str, user_id: str, role: str):
    if role not in VALID_ROLES:
        raise ValueError(f"Invalid role: {role}")
    await redis.set(_member_key(ws_id, user_id), role)


async def remove_member(redis: aioredis.Redis, ws_id: str, user_id: str):
    pipe = redis.pipeline()
    pipe.srem(_members_key(ws_id), user_id)
    pipe.delete(_member_key(ws_id, user_id))
    pipe.delete(_user_ws_key(user_id))
    await pipe.execute()


# ── Invites ───────────────────────────────────────────────────────────────────

async def create_invite(redis: aioredis.Redis, ws_id: str, inviter_id: str,
                        email: str, role: str) -> str:
    if role not in VALID_ROLES or role == "owner":
        raise ValueError("Invalid invite role")
    token = secrets.token_urlsafe(32)
    invite = {
        "token":      token,
        "ws_id":      ws_id,
        "inviter_id": inviter_id,
        "email":      email.lower().strip(),
        "role":       role,
        "created_at": _now(),
    }
    pipe = redis.pipeline()
    pipe.set(_invite_key(token), json.dumps(invite), ex=INVITE_TTL)
    pipe.sadd(_invites_key(ws_id), token)
    await pipe.execute()
    return token


async def get_invite(redis: aioredis.Redis, token: str) -> Optional[dict]:
    raw = await redis.get(_invite_key(token))
    return json.loads(raw) if raw else None


async def accept_invite(redis: aioredis.Redis, token: str, user_id: str) -> dict:
    invite = await get_invite(redis, token)
    if not invite:
        raise ValueError("Invite not found or expired")
    ws_id = invite["ws_id"]

    existing = await redis.get(_user_ws_key(user_id))
    if existing:
        raise ValueError("You already belong to a workspace")

    pipe = redis.pipeline()
    pipe.set(_user_ws_key(user_id), ws_id)
    pipe.set(_member_key(ws_id, user_id), invite["role"])
    pipe.sadd(_members_key(ws_id), user_id)
    pipe.delete(_invite_key(token))
    pipe.srem(_invites_key(ws_id), token)
    await pipe.execute()

    await _log_activity(redis, ws_id, user_id, "member_joined",
                        {"role": invite["role"], "email": invite["email"]})
    return invite


async def list_pending_invites(redis: aioredis.Redis, ws_id: str) -> list[dict]:
    tokens = await redis.smembers(_invites_key(ws_id))
    invites = []
    for t in tokens:
        t = t if isinstance(t, str) else t.decode()
        inv = await get_invite(redis, t)
        if inv:
            invites.append(inv)
    return invites


# ── Shared token pool ─────────────────────────────────────────────────────────

async def get_pool_balance(redis: aioredis.Redis, ws_id: str) -> int:
    val = await redis.get(_pool_key(ws_id))
    return int(val) if val else 0


async def deduct_pool_tokens(redis: aioredis.Redis, ws_id: str, amount: int) -> int:
    balance = await get_pool_balance(redis, ws_id)
    if balance < amount:
        raise ValueError("Insufficient workspace tokens")
    new_balance = await redis.decrby(_pool_key(ws_id), amount)
    return int(new_balance)


async def add_pool_tokens(redis: aioredis.Redis, ws_id: str, amount: int) -> int:
    new_balance = await redis.incrby(_pool_key(ws_id), amount)
    return int(new_balance)


# ── Brand kits ────────────────────────────────────────────────────────────────

async def create_brand_kit(redis: aioredis.Redis, ws_id: str, owner_id: str,
                           data: dict) -> dict:
    kit_id = str(uuid.uuid4())
    kit = {
        "id":           kit_id,
        "ws_id":        ws_id,
        "client_name":  data.get("client_name", "Unnamed client"),
        "logo_url":     data.get("logo_url", ""),
        "colors":       data.get("colors", []),
        "subtitle_style": data.get("subtitle_style", "viral"),
        "ai_tone":      data.get("ai_tone", ""),
        "default_cta":  data.get("default_cta", ""),
        "font":         data.get("font", ""),
        "created_by":   owner_id,
        "created_at":   _now(),
        "updated_at":   _now(),
    }
    pipe = redis.pipeline()
    pipe.set(_kit_key(kit_id), json.dumps(kit))
    pipe.sadd(_kits_key(ws_id), kit_id)
    await pipe.execute()
    await _log_activity(redis, ws_id, owner_id, "brand_kit_created",
                        {"kit_id": kit_id, "client": kit["client_name"]})
    return kit


async def get_brand_kit(redis: aioredis.Redis, kit_id: str) -> Optional[dict]:
    raw = await redis.get(_kit_key(kit_id))
    return json.loads(raw) if raw else None


async def list_brand_kits(redis: aioredis.Redis, ws_id: str) -> list[dict]:
    kit_ids = await redis.smembers(_kits_key(ws_id))
    kits = []
    for kid in kit_ids:
        kid = kid if isinstance(kid, str) else kid.decode()
        kit = await get_brand_kit(redis, kid)
        if kit:
            kits.append(kit)
    return sorted(kits, key=lambda k: k.get("created_at", ""))


async def update_brand_kit(redis: aioredis.Redis, kit_id: str, data: dict) -> dict:
    kit = await get_brand_kit(redis, kit_id)
    if not kit:
        raise ValueError("Brand kit not found")
    allowed = {"client_name","logo_url","colors","subtitle_style","ai_tone","default_cta","font"}
    for k, v in data.items():
        if k in allowed:
            kit[k] = v
    kit["updated_at"] = _now()
    await redis.set(_kit_key(kit_id), json.dumps(kit))
    return kit


async def delete_brand_kit(redis: aioredis.Redis, ws_id: str, kit_id: str):
    pipe = redis.pipeline()
    pipe.delete(_kit_key(kit_id))
    pipe.srem(_kits_key(ws_id), kit_id)
    await pipe.execute()


# ── Projects ──────────────────────────────────────────────────────────────────

PROJECT_STATUSES = [
    "draft", "in_review", "client_review", "approved", "rendering", "exported"
]


async def create_project(redis: aioredis.Redis, ws_id: str, creator_id: str,
                         data: dict) -> dict:
    proj_id = str(uuid.uuid4())
    project = {
        "id":           proj_id,
        "ws_id":        ws_id,
        "title":        data.get("title", "Untitled project"),
        "client_name":  data.get("client_name", ""),
        "brand_kit_id": data.get("brand_kit_id", ""),
        "platform":     data.get("platform", "TikTok"),
        "status":       "draft",
        "assigned_to":  data.get("assigned_to", [creator_id]),
        "render_job_ids": [],
        "notes":        data.get("notes", ""),
        "created_by":   creator_id,
        "created_at":   _now(),
        "updated_at":   _now(),
    }
    pipe = redis.pipeline()
    pipe.set(_proj_key(proj_id), json.dumps(project))
    pipe.sadd(_projs_key(ws_id), proj_id)
    await pipe.execute()
    await _log_activity(redis, ws_id, creator_id, "project_created",
                        {"proj_id": proj_id, "title": project["title"]})
    return project


async def get_project(redis: aioredis.Redis, proj_id: str) -> Optional[dict]:
    raw = await redis.get(_proj_key(proj_id))
    return json.loads(raw) if raw else None


async def list_projects(redis: aioredis.Redis, ws_id: str) -> list[dict]:
    proj_ids = await redis.smembers(_projs_key(ws_id))
    projects = []
    for pid in proj_ids:
        pid = pid if isinstance(pid, str) else pid.decode()
        proj = await get_project(redis, pid)
        if proj:
            projects.append(proj)
    return sorted(projects, key=lambda p: p.get("updated_at", ""), reverse=True)


async def update_project_status(redis: aioredis.Redis, ws_id: str, proj_id: str,
                                 user_id: str, new_status: str) -> dict:
    if new_status not in PROJECT_STATUSES:
        raise ValueError(f"Invalid status: {new_status}")
    project = await get_project(redis, proj_id)
    if not project or project["ws_id"] != ws_id:
        raise ValueError("Project not found")
    old_status = project["status"]
    project["status"] = new_status
    project["updated_at"] = _now()
    await redis.set(_proj_key(proj_id), json.dumps(project))
    await _log_activity(redis, ws_id, user_id, "project_status_changed", {
        "proj_id": proj_id,
        "title":   project["title"],
        "from":    old_status,
        "to":      new_status,
    })
    return project


async def update_project(redis: aioredis.Redis, proj_id: str, data: dict) -> dict:
    project = await get_project(redis, proj_id)
    if not project:
        raise ValueError("Project not found")
    allowed = {"title","client_name","brand_kit_id","platform","notes","assigned_to","render_job_ids"}
    for k, v in data.items():
        if k in allowed:
            project[k] = v
    project["updated_at"] = _now()
    await redis.set(_proj_key(proj_id), json.dumps(project))
    return project


async def delete_project(redis: aioredis.Redis, ws_id: str, proj_id: str):
    pipe = redis.pipeline()
    pipe.delete(_proj_key(proj_id))
    pipe.srem(_projs_key(ws_id), proj_id)
    pipe.delete(_comments_key(proj_id))
    await pipe.execute()


# ── Client review links ───────────────────────────────────────────────────────

async def create_review_link(redis: aioredis.Redis, ws_id: str, proj_id: str,
                              created_by: str) -> dict:
    token = secrets.token_urlsafe(20)
    review = {
        "token":      token,
        "ws_id":      ws_id,
        "proj_id":    proj_id,
        "created_by": created_by,
        "created_at": _now(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "status":     "pending",   # pending | approved | changes_requested
    }
    await redis.set(_review_key(token), json.dumps(review), ex=REVIEW_TTL)
    await _log_activity(redis, ws_id, created_by, "review_link_created",
                        {"proj_id": proj_id, "token": token})
    return review


async def get_review_link(redis: aioredis.Redis, token: str) -> Optional[dict]:
    raw = await redis.get(_review_key(token))
    return json.loads(raw) if raw else None


async def submit_review_decision(redis: aioredis.Redis, token: str,
                                  decision: str, message: str = "") -> dict:
    review = await get_review_link(redis, token)
    if not review:
        raise ValueError("Review link not found or expired")
    if decision not in ("approved", "changes_requested"):
        raise ValueError("Invalid decision")

    review["status"]    = decision
    review["message"]   = message
    review["decided_at"] = _now()

    await redis.set(_review_key(token), json.dumps(review), ex=REVIEW_TTL)

    if decision == "approved":
        project = await get_project(redis, review["proj_id"])
        if project:
            await update_project_status(
                redis, review["ws_id"], review["proj_id"],
                "client_reviewer", "approved"
            )
    return review


# ── Comments ──────────────────────────────────────────────────────────────────

async def add_comment(redis: aioredis.Redis, proj_id: str, author_id: str,
                      author_name: str, scene_index: Optional[int],
                      text: str, is_client: bool = False) -> dict:
    comment = {
        "id":           str(uuid.uuid4()),
        "proj_id":      proj_id,
        "author_id":    author_id,
        "author_name":  author_name,
        "scene_index":  scene_index,
        "text":         text,
        "is_client":    is_client,
        "resolved":     False,
        "created_at":   _now(),
    }
    await redis.lpush(_comments_key(proj_id), json.dumps(comment))
    await redis.ltrim(_comments_key(proj_id), 0, 499)
    return comment


async def list_comments(redis: aioredis.Redis, proj_id: str) -> list[dict]:
    raws = await redis.lrange(_comments_key(proj_id), 0, -1)
    comments = [json.loads(r) for r in raws]
    return sorted(comments, key=lambda c: c.get("created_at", ""))


async def resolve_comment(redis: aioredis.Redis, proj_id: str, comment_id: str) -> bool:
    raws = await redis.lrange(_comments_key(proj_id), 0, -1)
    updated = False
    new_list = []
    for r in raws:
        c = json.loads(r)
        if c["id"] == comment_id:
            c["resolved"] = True
            updated = True
        new_list.append(json.dumps(c))
    if updated:
        pipe = redis.pipeline()
        pipe.delete(_comments_key(proj_id))
        for item in new_list:
            pipe.rpush(_comments_key(proj_id), item)
        await pipe.execute()
    return updated


# ── Activity log ──────────────────────────────────────────────────────────────

async def _log_activity(redis: aioredis.Redis, ws_id: str, user_id: str,
                         action: str, detail: dict):
    event = {
        "id":       str(uuid.uuid4()),
        "ws_id":    ws_id,
        "user_id":  user_id,
        "action":   action,
        "detail":   detail,
        "ts":       _now(),
    }
    key = _activity_key(ws_id)
    await redis.lpush(key, json.dumps(event))
    await redis.ltrim(key, 0, ACTIVITY_CAP - 1)


async def get_activity(redis: aioredis.Redis, ws_id: str, limit: int = 50) -> list[dict]:
    raws = await redis.lrange(_activity_key(ws_id), 0, limit - 1)
    return [json.loads(r) for r in raws]


# ── Dashboard summary ─────────────────────────────────────────────────────────

async def get_dashboard(redis: aioredis.Redis, ws_id: str) -> dict:
    projects = await list_projects(redis, ws_id)
    members  = await get_workspace_members(redis, ws_id)
    activity = await get_activity(redis, ws_id, 20)
    pool     = await get_pool_balance(redis, ws_id)

    active       = [p for p in projects if p["status"] not in ("exported",)]
    pending_appr = [p for p in projects if p["status"] == "client_review"]

    return {
        "active_projects":   len(active),
        "pending_approvals": len(pending_appr),
        "team_members":      len(members),
        "pool_tokens":       pool,
        "recent_projects":   projects[:5],
        "recent_activity":   activity[:10],
        "members":           members,
    }
