from __future__ import annotations
"""
agency.py  →  backend/app/api/agency.py

Mount in main.py:
    from app.api.agency import router as agency_router
    app.include_router(agency_router, prefix="/api/agency", tags=["Agency"])
"""

import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field, EmailStr

from app.dependencies import get_redis
from app.services import auth as auth_service
from app.services import agency_service as svc

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Auth helper ───────────────────────────────────────────────────────────────

async def _get_user(authorization: Optional[str], redis):
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(401, "Missing token")
    user_id = auth_service.verify_token(token)
    if not user_id:
        raise HTTPException(401, "Invalid or expired token")
    user = await auth_service.get_user_by_id(redis, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return user


async def _require_workspace(user_id: str, redis) -> dict:
    ws = await svc.get_user_workspace(redis, user_id)
    if not ws:
        # Auto-create workspace if user has agency plan but no workspace yet
        # (handles users who upgraded before auto-create was deployed)
        try:
            import json as _json
            raw_user = await redis.get(f"user:{user_id}")
            if raw_user:
                user_data = _json.loads(raw_user)
                if user_data.get("plan") == "agency":
                    ws_name = f"{user_data.get('full_name', 'My')}'s Agency"
                    ws = await svc.create_workspace(
                        redis, user_id, ws_name,
                        initial_tokens=user_data.get("tokens_remaining", 50000)
                    )
                    logger.info("Auto-created missing workspace for agency user %s", user_id)
                    return ws
        except Exception as e:
            logger.error("Workspace auto-create failed: %s", e)
        raise HTTPException(403, "No agency workspace. Upgrade to Agency plan first.")
    return ws


async def _require_role(ws_id: str, user_id: str, redis,
                         allowed: tuple = ("owner", "admin", "editor")):
    role = await svc.get_member_role(redis, ws_id, user_id)
    if role not in allowed:
        raise HTTPException(403, "Insufficient permissions")
    # Block suspended members from all mutating actions
    suspended = await redis.get(f"workspace:suspended:{ws_id}:{user_id}")
    if suspended and role != "owner":
        raise HTTPException(403, "Your workspace access has been suspended. Contact the workspace owner.")
    return role


# ── Schemas ───────────────────────────────────────────────────────────────────

class CreateWorkspaceRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)

class InviteMemberRequest(BaseModel):
    email: EmailStr
    role: str = Field(default="editor")

class UpdateRoleRequest(BaseModel):
    role: str

class BrandKitRequest(BaseModel):
    client_name: str = Field(..., min_length=1, max_length=100)
    logo_url: Optional[str] = ""
    colors: list[str] = Field(default_factory=list)
    subtitle_style: Optional[str] = "viral"
    ai_tone: Optional[str] = ""
    default_cta: Optional[str] = ""
    font: Optional[str] = ""
    intro_url: Optional[str] = ""
    outro_url: Optional[str] = ""
    watermark_position: Optional[str] = ""
    brand_voice_notes: Optional[str] = ""

class CreateProjectRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    client_name: Optional[str] = ""
    brand_kit_id: Optional[str] = ""
    platform: Optional[str] = "TikTok"
    notes: Optional[str] = ""
    assigned_to: list[str] = Field(default_factory=list)

class UpdateProjectRequest(BaseModel):
    title: Optional[str] = None
    client_name: Optional[str] = None
    brand_kit_id: Optional[str] = None
    platform: Optional[str] = None
    notes: Optional[str] = None
    assigned_to: Optional[list[str]] = None
    render_job_ids: Optional[list[str]] = None

class UpdateStatusRequest(BaseModel):
    status: str

class AddCommentRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    scene_index: Optional[int] = None

class ReviewDecisionRequest(BaseModel):
    decision: str   # "approved" | "changes_requested"
    message: Optional[str] = ""

class RenameWorkspaceRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)

class SuspendMemberRequest(BaseModel):
    suspended: bool

class TransferProjectsRequest(BaseModel):
    to_user_id: str

class ClientCommentRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    scene_index: Optional[int] = None
    author_name: Optional[str] = "Client"


# ── Workspace endpoints ───────────────────────────────────────────────────────

@router.post("/workspace")
async def create_workspace(
    req: CreateWorkspaceRequest,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    if user.plan != "agency":
        raise HTTPException(403, "Agency plan required. Upgrade on the billing page.")
    existing = await svc.get_user_workspace(redis, user.id)
    if existing:
        raise HTTPException(400, "You already have a workspace")
    ws = await svc.create_workspace(redis, user.id, req.name)
    return {"workspace": ws}


@router.get("/workspace")
async def get_my_workspace(
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    return {"workspace": ws}


@router.get("/workspace/dashboard")
async def get_dashboard(
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    data = await svc.get_dashboard(redis, ws["id"])
    return data


# ── Member endpoints ──────────────────────────────────────────────────────────

@router.get("/workspace/members")
async def list_members(
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    members = await svc.get_workspace_members(redis, ws["id"])
    pending = await svc.list_pending_invites(redis, ws["id"])
    return {"members": members, "pending_invites": pending}


@router.post("/workspace/invite")
async def invite_member(
    req: InviteMemberRequest,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    await _require_role(ws["id"], user.id, redis, ("owner", "admin"))

    members = await svc.get_workspace_members(redis, ws["id"])
    if len(members) >= ws.get("seat_limit", 5):
        raise HTTPException(400, "Seat limit reached. Contact support to add more seats.")

    token = await svc.create_invite(redis, ws["id"], user.id, req.email, req.role)

    # Send invite email
    try:
        from app.services.email import _send
        invite_url = f"https://scenraforge.com/join?token={token}"
        html = f"""
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0a0a0f;color:#f0f0ff;padding:32px;border-radius:16px">
          <div style="font-size:22px;font-weight:800;margin-bottom:8px">Scene<span style="color:#c9a84c">Forge</span></div>
          <h2 style="font-size:18px;font-weight:700;margin:24px 0 8px">You've been invited</h2>
          <p style="color:rgba(255,255,255,0.6);font-size:14px;line-height:1.6;margin:0 0 24px">
            <strong style="color:#f0f0ff">{user.full_name}</strong> has invited you to join
            <strong style="color:#f0f0ff">{ws["name"]}</strong> on SceneForge as a <strong style="color:#c9a84c">{req.role}</strong>.
          </p>
          <a href="{invite_url}" style="display:inline-block;background:#c9a84c;color:#000;font-weight:700;font-size:14px;padding:12px 28px;border-radius:10px;text-decoration:none">Accept invite</a>
          <p style="color:rgba(255,255,255,0.3);font-size:12px;margin-top:24px">This link expires in 7 days.</p>
        </div>"""
        text = f"{user.full_name} invited you to join {ws['name']} on SceneForge. Accept here: {invite_url}"
        await _send(req.email, f"You're invited to {ws['name']} on SceneForge", html, text)
    except Exception as e:
        logger.warning("Invite email failed: %s", e)

    return {"message": f"Invite sent to {req.email}", "token": token}


@router.get("/workspace/invite/preview/{token}")
async def preview_invite(token: str, redis=Depends(get_redis)):
    """Public — lets the invitee see workspace name & role before logging in."""
    invite = await svc.get_invite(redis, token)
    if not invite:
        raise HTTPException(404, "Invite not found or expired")
    # Get workspace name
    ws = await svc.get_workspace(redis, invite["ws_id"])
    # Get inviter name
    inviter_name = "Your team"
    try:
        raw = await redis.get(f"user:{invite['inviter_id']}")
        if raw:
            import json as _j
            inviter_name = _j.loads(raw).get("full_name", "Your team")
    except Exception:
        pass
    return {
        "workspace_name": ws["name"] if ws else "Agency workspace",
        "inviter_name":   inviter_name,
        "role":           invite["role"],
        "email":          invite["email"],
    }


@router.post("/workspace/join/{token}")
async def accept_invite(
    token: str,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    try:
        invite = await svc.accept_invite(redis, token, user.id)
        return {"message": "Joined workspace", "workspace_id": invite["ws_id"]}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/workspace/members/{member_id}/role")
async def update_member_role(
    member_id: str,
    req: UpdateRoleRequest,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    await _require_role(ws["id"], user.id, redis, ("owner", "admin"))
    if member_id == ws["owner_id"] and req.role != "owner":
        raise HTTPException(400, "Cannot change owner role")
    await svc.update_member_role(redis, ws["id"], member_id, req.role)
    return {"message": "Role updated"}


@router.delete("/workspace/members/{member_id}")
async def remove_member(
    member_id: str,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    await _require_role(ws["id"], user.id, redis, ("owner", "admin"))
    if member_id == ws["owner_id"]:
        raise HTTPException(400, "Cannot remove workspace owner")
    await svc.remove_member(redis, ws["id"], member_id)
    return {"message": "Member removed"}


# ── Token pool ────────────────────────────────────────────────────────────────

@router.get("/workspace/tokens")
async def get_pool_balance(
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    balance = await svc.get_pool_balance(redis, ws["id"])
    return {"pool_tokens": balance, "ws_id": ws["id"]}


# ── Brand kit endpoints ───────────────────────────────────────────────────────

from fastapi import UploadFile, File as _File

@router.post("/scene-image")
async def upload_scene_image(
    file: UploadFile = _File(...),
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    """Upload a custom image for a scene. Max 10MB. Returns {image_url}."""
    from app.services.storage import upload_file, r2_enabled
    import tempfile, os, uuid as _uuid

    user = await _get_user(authorization, redis)

    allowed = {"image/png","image/jpeg","image/jpg","image/webp","image/gif"}
    ct = (file.content_type or "").lower()
    if ct not in allowed:
        raise HTTPException(400, "Use PNG, JPG, WebP or GIF")

    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(400, "Image must be under 10 MB")

    ext_map = {"image/jpeg":".jpg","image/jpg":".jpg","image/png":".png",
               "image/webp":".webp","image/gif":".gif"}
    ext = ext_map.get(ct, ".jpg")
    key = f"scene-images/{user.id}/{_uuid.uuid4().hex[:10]}{ext}"

    if r2_enabled():
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(raw); tmp_path = tmp.name
        try:
            url = await upload_file(tmp_path, key)
        finally:
            os.unlink(tmp_path)
    else:
        import base64
        url = f"data:{ct};base64,{base64.b64encode(raw).decode()}"

    return {"image_url": url}


@router.post("/brand-kits/logo")
async def upload_brand_logo(
    file: UploadFile = _File(...),
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    """Upload a brand logo — multipart/form-data, field: file. Max 5MB."""
    from app.services.storage import upload_file, r2_enabled
    import tempfile, os, uuid as _uuid, mimetypes

    user = await _get_user(authorization, redis)
    ws   = await _require_workspace(user.id, redis)
    await _require_role(ws["id"], user.id, redis, ("owner", "admin"))

    allowed = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/svg+xml"}
    ct = (file.content_type or "").lower()
    if ct not in allowed:
        raise HTTPException(400, "Unsupported type. Use PNG, JPG, WebP, GIF or SVG.")

    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(400, "Logo must be under 5 MB")

    ext_map = {"image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png",
               "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg"}
    ext = ext_map.get(ct, ".png")
    key = f"brand-assets/{ws['id']}/logos/{_uuid.uuid4().hex[:10]}{ext}"

    if r2_enabled():
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(raw); tmp_path = tmp.name
        try:
            logo_url = await upload_file(tmp_path, key)
        finally:
            os.unlink(tmp_path)
    else:
        import base64
        logo_url = f"data:{ct};base64,{base64.b64encode(raw).decode()}"
        logger.warning("R2 not enabled — logo stored as data URL for ws=%s", ws["id"])

    logger.info("Brand logo uploaded | ws=%s | url=%s", ws["id"], logo_url)
    return {"logo_url": logo_url}


@router.get("/brand-kits")
async def list_brand_kits(
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    kits = await svc.list_brand_kits(redis, ws["id"])
    return {"brand_kits": kits}


@router.post("/brand-kits")
async def create_brand_kit(
    req: BrandKitRequest,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    await _require_role(ws["id"], user.id, redis, ("owner", "admin", "editor"))
    kit = await svc.create_brand_kit(redis, ws["id"], user.id, req.model_dump())
    return {"brand_kit": kit}


@router.get("/brand-kits/{kit_id}")
async def get_brand_kit(
    kit_id: str,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    kit = await svc.get_brand_kit(redis, kit_id)
    if not kit or kit["ws_id"] != ws["id"]:
        raise HTTPException(404, "Brand kit not found")
    return {"brand_kit": kit}


@router.put("/brand-kits/{kit_id}")
async def update_brand_kit(
    kit_id: str,
    req: BrandKitRequest,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    kit = await svc.get_brand_kit(redis, kit_id)
    if not kit or kit["ws_id"] != ws["id"]:
        raise HTTPException(404, "Brand kit not found")
    updated = await svc.update_brand_kit(redis, kit_id, req.model_dump())
    return {"brand_kit": updated}


@router.delete("/brand-kits/{kit_id}")
async def delete_brand_kit(
    kit_id: str,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    await _require_role(ws["id"], user.id, redis, ("owner", "admin"))
    kit = await svc.get_brand_kit(redis, kit_id)
    if not kit or kit["ws_id"] != ws["id"]:
        raise HTTPException(404, "Brand kit not found")
    await svc.delete_brand_kit(redis, ws["id"], kit_id)
    return {"message": "Brand kit deleted"}


# ── Project endpoints ─────────────────────────────────────────────────────────

@router.get("/projects")
async def list_projects(
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    role = await svc.get_member_role(redis, ws["id"], user.id)
    projects = await svc.list_projects(redis, ws["id"])

    # Clients only see projects they are assigned to
    if role == "client":
        projects = [p for p in projects if user.id in p.get("assigned_to", [])]

    return {"projects": projects}


@router.post("/projects")
async def create_project(
    req: CreateProjectRequest,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    await _require_role(ws["id"], user.id, redis, ("owner", "admin", "editor"))
    data = req.model_dump()
    if not data["assigned_to"]:
        data["assigned_to"] = [user.id]
    project = await svc.create_project(redis, ws["id"], user.id, data)
    return {"project": project}


@router.get("/projects/{proj_id}")
async def get_project(
    proj_id: str,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    project = await svc.get_project(redis, proj_id)
    if not project or project["ws_id"] != ws["id"]:
        raise HTTPException(404, "Project not found")
    comments = await svc.list_comments(redis, proj_id)
    return {"project": project, "comments": comments}


@router.put("/projects/{proj_id}")
async def update_project(
    proj_id: str,
    req: UpdateProjectRequest,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    project = await svc.get_project(redis, proj_id)
    if not project or project["ws_id"] != ws["id"]:
        raise HTTPException(404, "Project not found")
    await _require_role(ws["id"], user.id, redis, ("owner", "admin", "editor"))
    data = {k: v for k, v in req.model_dump().items() if v is not None}
    updated = await svc.update_project(redis, proj_id, data)
    return {"project": updated}


@router.patch("/projects/{proj_id}/status")
async def update_project_status(
    proj_id: str,
    req: UpdateStatusRequest,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    project = await svc.get_project(redis, proj_id)
    if not project or project["ws_id"] != ws["id"]:
        raise HTTPException(404, "Project not found")
    await _require_role(ws["id"], user.id, redis, ("owner", "admin", "editor"))
    try:
        updated = await svc.update_project_status(
            redis, ws["id"], proj_id, user.id, req.status
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"project": updated}


@router.delete("/projects/{proj_id}")
async def delete_project(
    proj_id: str,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    await _require_role(ws["id"], user.id, redis, ("owner", "admin"))
    project = await svc.get_project(redis, proj_id)
    if not project or project["ws_id"] != ws["id"]:
        raise HTTPException(404, "Project not found")
    await svc.delete_project(redis, ws["id"], proj_id)
    return {"message": "Project deleted"}


# ── Comments ──────────────────────────────────────────────────────────────────

@router.post("/projects/{proj_id}/comments")
async def add_comment(
    proj_id: str,
    req: AddCommentRequest,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    project = await svc.get_project(redis, proj_id)
    if not project or project["ws_id"] != ws["id"]:
        raise HTTPException(404, "Project not found")
    role = await svc.get_member_role(redis, ws["id"], user.id)
    comment = await svc.add_comment(
        redis, proj_id, user.id, user.full_name,
        req.scene_index, req.text, is_client=(role == "client")
    )
    await svc._log_activity(redis, ws["id"], user.id, "comment_added", {
        "proj_id": proj_id, "scene": req.scene_index
    })
    return {"comment": comment}


@router.patch("/projects/{proj_id}/comments/{comment_id}/resolve")
async def resolve_comment(
    proj_id: str,
    comment_id: str,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    await _require_role(ws["id"], user.id, redis, ("owner", "admin", "editor"))
    ok = await svc.resolve_comment(redis, proj_id, comment_id)
    if not ok:
        raise HTTPException(404, "Comment not found")
    return {"message": "Comment resolved"}


class EditCommentRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)


@router.patch("/projects/{proj_id}/comments/{comment_id}")
async def edit_comment(
    proj_id: str,
    comment_id: str,
    req: EditCommentRequest,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    """Edit a comment — only the original author can edit."""
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    project = await svc.get_project(redis, proj_id)
    if not project or project["ws_id"] != ws["id"]:
        raise HTTPException(404, "Project not found")
    try:
        updated = await svc.edit_comment(redis, proj_id, comment_id, user.id, req.text)
        if not updated:
            raise HTTPException(404, "Comment not found")
        return {"comment": updated}
    except ValueError as e:
        raise HTTPException(403, str(e))


@router.delete("/projects/{proj_id}/comments/{comment_id}")
async def delete_comment(
    proj_id: str,
    comment_id: str,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    """Delete a comment — author or workspace owner can delete."""
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    project = await svc.get_project(redis, proj_id)
    if not project or project["ws_id"] != ws["id"]:
        raise HTTPException(404, "Project not found")
    is_owner = ws.get("owner_id") == user.id
    try:
        ok = await svc.delete_comment(redis, proj_id, comment_id, user.id, is_owner)
        if not ok:
            raise HTTPException(404, "Comment not found")
        return {"message": "Comment deleted"}
    except ValueError as e:
        raise HTTPException(403, str(e))


# ── Workspace rename ─────────────────────────────────────────────────────────

@router.patch("/workspace/rename")
async def rename_workspace(
    req: RenameWorkspaceRequest,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    await _require_role(ws["id"], user.id, redis, ("owner",))
    updated = await svc.rename_workspace(redis, ws["id"], user.id, req.name)
    return {"workspace": updated}


# ── Member suspend ────────────────────────────────────────────────────────────

@router.patch("/workspace/members/{member_id}/suspend")
async def suspend_member(
    member_id: str,
    req: SuspendMemberRequest,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    await _require_role(ws["id"], user.id, redis, ("owner", "admin"))
    if member_id == ws["owner_id"]:
        raise HTTPException(400, "Cannot suspend workspace owner")
    await svc.suspend_member(redis, ws["id"], member_id, req.suspended)
    action = "suspended" if req.suspended else "unsuspended"
    return {"message": f"Member {action}"}


# ── Transfer projects ────────────────────────────────────────────────────────

@router.post("/workspace/members/{member_id}/transfer-projects")
async def transfer_projects(
    member_id: str,
    req: TransferProjectsRequest,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    await _require_role(ws["id"], user.id, redis, ("owner", "admin"))
    count = await svc.transfer_projects(redis, ws["id"], member_id, req.to_user_id)
    return {"transferred": count, "message": f"{count} project(s) transferred"}


# ── Invite management ─────────────────────────────────────────────────────────

@router.get("/workspace/invites")
async def list_invites(
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    await _require_role(ws["id"], user.id, redis, ("owner", "admin"))
    invites = await svc.list_all_invites(redis, ws["id"])
    return {"invites": invites}


@router.delete("/workspace/invites/{token}")
async def revoke_invite(
    token: str,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    await _require_role(ws["id"], user.id, redis, ("owner", "admin"))
    ok = await svc.revoke_invite(redis, ws["id"], token)
    if not ok:
        raise HTTPException(404, "Invite not found")
    return {"message": "Invite revoked"}


# ── Client review links ───────────────────────────────────────────────────────

@router.post("/projects/{proj_id}/review-link")
async def create_review_link(
    proj_id: str,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    project = await svc.get_project(redis, proj_id)
    if not project or project["ws_id"] != ws["id"]:
        raise HTTPException(404, "Project not found")
    await _require_role(ws["id"], user.id, redis, ("owner", "admin", "editor"))

    review = await svc.create_review_link(redis, ws["id"], proj_id, user.id)
    review_url = f"https://scenraforge.com/review/{review['token']}"

    # bump project to client_review status
    await svc.update_project_status(redis, ws["id"], proj_id, user.id, "client_review")

    return {
        "review_url": review_url,
        "token":      review["token"],
        "expires_at": review["expires_at"],
    }


@router.get("/review/{token}")
async def get_review_public(token: str, redis=Depends(get_redis)):
    """Public endpoint — no auth required. Used by the client review page."""
    review = await svc.get_review_link(redis, token)
    if not review:
        raise HTTPException(404, "Review link not found or expired")
    project = await svc.get_project(redis, review["proj_id"])
    if not project:
        raise HTTPException(404, "Project not found")
    comments = await svc.list_comments(redis, review["proj_id"])
    client_comments = [c for c in comments if c.get("is_client")]
    # Try to resolve the video URL from the latest completed render job
    video_url = ""
    job_ids = project.get("render_job_ids", [])
    for job_id in reversed(job_ids):
        try:
            raw_job = await redis.get(f"job:{job_id}:progress")
            if raw_job:
                import json as _jj
                job_data = _jj.loads(raw_job)
                if job_data.get("status") == "complete":
                    video_url = (
                        job_data.get("video_url") or
                        job_data.get("r2_urls", {}).get("final_video_music.mp4") or
                        job_data.get("r2_urls", {}).get("final_video.mp4") or ""
                    )
                    if video_url:
                        break
        except Exception:
            pass

    return {
        "review":   review,
        "project":  {
            "id":             project["id"],
            "title":          project["title"],
            "client_name":    project["client_name"],
            "platform":       project["platform"],
            "render_job_ids": job_ids,
            "video_url":      video_url,
        },
        "comments": client_comments,
    }


@router.post("/review/{token}/comment")
async def add_client_comment(
    token: str,
    req: ClientCommentRequest,
    redis=Depends(get_redis),
):
    """Public endpoint — client leaves a comment without logging in."""
    review = await svc.get_review_link(redis, token)
    if not review:
        raise HTTPException(404, "Review link not found or expired")
    comment = await svc.add_comment(
        redis, review["proj_id"],
        "client", req.author_name or "Client",
        req.scene_index, req.text, is_client=True
    )
    return {"comment": comment}


@router.post("/review/{token}/decide")
async def submit_review_decision(
    token: str,
    req: ReviewDecisionRequest,
    redis=Depends(get_redis),
):
    """Public endpoint — client approves or requests changes."""
    try:
        review = await svc.submit_review_decision(
            redis, token, req.decision, req.message or ""
        )
        return {"review": review, "message": f"Decision recorded: {req.decision}"}
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── Activity ──────────────────────────────────────────────────────────────────

@router.delete("/workspace/invite/{token}")
async def cancel_invite(
    token: str,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    """Cancel (revoke) a pending invite — owner/admin only."""
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    await _require_role(ws["id"], user.id, redis, ("owner", "admin"))
    ok = await svc.revoke_invite(redis, ws["id"], token)
    if not ok:
        raise HTTPException(404, "Invite not found or already used")
    return {"message": "Invite cancelled"}


@router.get("/workspace/activity")
async def get_activity(
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user = await _get_user(authorization, redis)
    ws = await _require_workspace(user.id, redis)
    activity = await svc.get_activity(redis, ws["id"], 50)
    return {"activity": activity}
