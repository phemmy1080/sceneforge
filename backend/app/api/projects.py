from __future__ import annotations

"""
Projects API — server-side project persistence.
All project data is stored in Redis under project:{user_id}:{project_id}
Projects list index: projects:{user_id} → sorted set (score = created_at timestamp)
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel

from app.dependencies import get_redis
from app.services.auth import verify_token

logger = logging.getLogger(__name__)
router = APIRouter()


# ─── Auth helper ──────────────────────────────────────────────────────────────

def _require_user(authorization: Optional[str] = Header(None)) -> str:
    token = (authorization or "").removeprefix("Bearer ").strip()
    user_id = verify_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user_id


# ─── Models ───────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    id: Optional[str] = None          # client can supply its own UUID
    name: str
    niche: str = ""
    style: str = "Educational"
    platform: str = "TikTok (9:16, 60s)"
    folder: str = ""

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    niche: Optional[str] = None
    style: Optional[str] = None
    platform: Optional[str] = None
    folder: Optional[str] = None
    status: Optional[str] = None      # draft | active | exported
    step: Optional[str] = None        # setup | ideas | script | scenes | voice | export
    scene_count: Optional[int] = None
    duration: Optional[int] = None
    # Rich content fields
    selected_idea: Optional[dict] = None
    script: Optional[str] = None
    scenes: Optional[list] = None
    voice_config: Optional[dict] = None
    job_id: Optional[str] = None
    video_url: Optional[str] = None


# ─── Redis helpers ─────────────────────────────────────────────────────────────

def _project_key(user_id: str, project_id: str) -> str:
    return f"project:{user_id}:{project_id}"

def _projects_index_key(user_id: str) -> str:
    return f"projects:{user_id}"

PROJECT_TTL = 60 * 60 * 24 * 365  # 1 year


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_project(
    body: ProjectCreate,
    user_id: str = Depends(_require_user),
    redis=Depends(get_redis),
):
    """Create a new project. Client can supply its own UUID for offline-first sync."""
    project_id = body.id or str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    project = {
        "id":           project_id,
        "user_id":      user_id,
        "name":         body.name,
        "niche":        body.niche,
        "style":        body.style,
        "platform":     body.platform,
        "folder":       body.folder or body.niche or "General",
        "status":       "draft",
        "step":         "setup",
        "scene_count":  0,
        "duration":     0,
        "created_at":   now,
        "updated_at":   now,
        # Rich content (populated as user progresses)
        "selected_idea":  None,
        "script":         None,
        "scenes":         [],
        "voice_config":   {},
        "job_id":         None,
        "video_url":      None,
    }

    # Store project data
    await redis.set(
        _project_key(user_id, project_id),
        json.dumps(project),
        ex=PROJECT_TTL,
    )

    # Add to user's project index (sorted by created_at as unix timestamp)
    import time
    score = time.time()
    await redis.zadd(_projects_index_key(user_id), {project_id: score})
    await redis.expire(_projects_index_key(user_id), PROJECT_TTL)

    logger.info("Project created | user=%s | project=%s | name=%s", user_id, project_id, body.name)
    return project


@router.get("")
async def list_projects(
    user_id: str = Depends(_require_user),
    redis=Depends(get_redis),
):
    """List all projects for the authenticated user, newest first."""
    # Get project IDs sorted by creation time (newest first = reverse)
    project_ids = await redis.zrevrange(_projects_index_key(user_id), 0, -1)

    projects = []
    for pid in project_ids:
        raw = await redis.get(_project_key(user_id, pid))
        if raw:
            try:
                p = json.loads(raw)
                # Don't send heavy fields in the list view
                p.pop("scenes", None)
                p.pop("script", None)
                projects.append(p)
            except Exception:
                pass
        else:
            # Clean up stale index entry
            await redis.zrem(_projects_index_key(user_id), pid)

    return {"projects": projects, "total": len(projects)}


@router.get("/{project_id}")
async def get_project(
    project_id: str,
    user_id: str = Depends(_require_user),
    redis=Depends(get_redis),
):
    """Get full project data including scenes and script."""
    raw = await redis.get(_project_key(user_id, project_id))
    if not raw:
        raise HTTPException(status_code=404, detail="Project not found")
    return json.loads(raw)


@router.put("/{project_id}")
async def update_project(
    project_id: str,
    body: ProjectUpdate,
    user_id: str = Depends(_require_user),
    redis=Depends(get_redis),
):
    """Update project fields. Only provided fields are updated (partial update)."""
    raw = await redis.get(_project_key(user_id, project_id))
    if not raw:
        raise HTTPException(status_code=404, detail="Project not found")

    project = json.loads(raw)

    # Apply only the fields that were provided
    update_data = body.model_dump(exclude_none=True)
    for field, value in update_data.items():
        project[field] = value

    project["updated_at"] = datetime.now(timezone.utc).isoformat()

    await redis.set(
        _project_key(user_id, project_id),
        json.dumps(project),
        ex=PROJECT_TTL,
    )

    return project


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: str,
    user_id: str = Depends(_require_user),
    redis=Depends(get_redis),
):
    """Delete a project and remove from index."""
    deleted = await redis.delete(_project_key(user_id, project_id))
    if not deleted:
        raise HTTPException(status_code=404, detail="Project not found")
    await redis.zrem(_projects_index_key(user_id), project_id)
    logger.info("Project deleted | user=%s | project=%s", user_id, project_id)
    return None


@router.post("/sync")
async def sync_projects(
    body: dict,
    user_id: str = Depends(_require_user),
    redis=Depends(get_redis),
):
    """
    Bulk sync — accepts a list of local projects and saves them all.
    Used on first login to migrate projects from localStorage to backend.
    Returns the server's full project list after sync.
    """
    local_projects = body.get("projects", [])
    import time

    synced = 0
    for p in local_projects:
        pid = p.get("id")
        if not pid:
            continue
        # Don't overwrite if server version is newer
        existing_raw = await redis.get(_project_key(user_id, pid))
        if existing_raw:
            continue  # already on server, skip

        # Ensure required fields
        p["user_id"] = user_id
        p.setdefault("created_at", datetime.now(timezone.utc).isoformat())
        p.setdefault("updated_at", datetime.now(timezone.utc).isoformat())
        p.setdefault("folder", p.get("niche") or "General")

        await redis.set(
            _project_key(user_id, pid),
            json.dumps(p),
            ex=PROJECT_TTL,
        )
        score = time.time()
        await redis.zadd(_projects_index_key(user_id), {pid: score})
        synced += 1

    await redis.expire(_projects_index_key(user_id), PROJECT_TTL)

    # Return updated server list
    result = await list_projects(user_id=user_id, redis=redis)
    return {"synced": synced, **result}
