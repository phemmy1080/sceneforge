from __future__ import annotations

"""
Niches API — public read, admin write.
Niches are stored in Redis so they can be managed from the admin dashboard.
"""

import json
import logging

from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Optional

from app.dependencies import get_redis
from app.config import get_settings

settings = get_settings()
router = APIRouter()
logger = logging.getLogger(__name__)

NICHES_KEY = "sceneforge:niches"

DEFAULT_NICHES = [
    {"key": "Finance",  "label": "Finance",  "suggestions": ["Best investment tips", "Saving money fast", "Stock market basics", "Budget your salary", "Crypto explained"]},
    {"key": "Fitness",  "label": "Fitness",  "suggestions": ["5 fitness myths", "Home workout routine", "Best protein foods", "Weight loss tips", "Build muscle fast"]},
    {"key": "Tech",     "label": "Tech",     "suggestions": ["AI tools you need now", "Best free apps 2025", "Productivity hacks", "iPhone hidden features", "Build a side project"]},
    {"key": "Travel",   "label": "Travel",   "suggestions": ["Budget travel tips", "Hidden gems in Lagos", "Solo travel guide", "Travel hacks 2025", "Best places to visit"]},
    {"key": "Food",     "label": "Food",     "suggestions": ["Easy 10-min recipes", "Nigerian street food", "Meal prep ideas", "Healthy snacks", "Kitchen hacks"]},
    {"key": "Business", "label": "Business", "suggestions": ["Start a business with 0", "How I made my first 1M", "Business ideas 2025", "Marketing on a budget", "Side hustle ideas"]},
    {"key": "Science",  "label": "Science",  "suggestions": ["Mind-blowing facts", "How black holes work", "Space exploration 2025", "Human body secrets", "Climate change explained"]},
    {"key": "History",  "label": "History",  "suggestions": ["African empires untold", "History they never taught", "Rise and fall of Rome", "Nigeria's history", "WW2 untold stories"]},
    {"key": "Mindset",  "label": "Mindset",  "suggestions": ["How I changed my mindset", "Morning routine habits", "Stop procrastinating", "Discipline over motivation", "Atomic habits summary"]},
    {"key": "Gaming",   "label": "Gaming",   "suggestions": ["Best games 2025", "Gaming setup on a budget", "Top 10 mobile games", "How to go pro", "Game review"]},
    {"key": "Fashion",  "label": "Fashion",  "suggestions": ["Style on a budget", "Outfits for every occasion", "Fashion trends 2025", "How to dress smart", "Thrift shopping tips"]},
    {"key": "Health",   "label": "Health",   "suggestions": ["Sleep better tonight", "Gut health foods", "Mental health habits", "Vitamin D truth", "Posture fixes at home"]},
    {"key": "General",  "label": "General",  "suggestions": ["Life lessons I learned", "Things nobody tells you", "How I changed my mindset", "Mistakes to avoid", "Simple habits that work"]},
]


async def _get_niches(redis) -> list[dict]:
    raw = await redis.get(NICHES_KEY)
    if raw:
        return json.loads(raw)
    # Seed defaults on first call
    await redis.set(NICHES_KEY, json.dumps(DEFAULT_NICHES))
    return DEFAULT_NICHES


# ─── Public endpoints ─────────────────────────────────────────────────────────

@router.get("")
async def get_niches(redis=Depends(get_redis)):
    """Return all active niches — used by the frontend Setup and NewProject modal."""
    niches = await _get_niches(redis)
    return {"niches": niches}


# ─── Admin endpoints ──────────────────────────────────────────────────────────

class NicheRequest(BaseModel):
    key: str
    label: str
    suggestions: list[str] = []


async def _require_admin_token(authorization: Optional[str] = Header(None), redis=Depends(get_redis)):
    from app.services import admin_auth as aa
    from app.services.auth import verify_token
    token = (authorization or "").removeprefix("Bearer ").strip()
    if token.startswith("admin:"):
        uid = verify_token(token[6:])
        if uid:
            admin = await aa.get_admin_user(redis, uid)
            if admin and admin.get("active", True):
                return admin
    # Legacy key
    x_key = None
    if token and not token.startswith("admin:"):
        x_key = token
    if x_key and settings.admin_secret_key and x_key == settings.admin_secret_key:
        return {"role": "superadmin"}
    raise HTTPException(status_code=403, detail="Admin access required")


@router.post("/admin")
async def add_niche(
    req: NicheRequest,
    admin=Depends(_require_admin_token),
    redis=Depends(get_redis),
):
    niches = await _get_niches(redis)
    if any(n["key"] == req.key for n in niches):
        raise HTTPException(status_code=400, detail=f"Niche '{req.key}' already exists")
    niches.append({"key": req.key, "label": req.label, "suggestions": req.suggestions})
    await redis.set(NICHES_KEY, json.dumps(niches))
    logger.info("Niche added: %s", req.key)
    return {"success": True, "niches": niches}


@router.put("/admin/{key}")
async def update_niche(
    key: str,
    req: NicheRequest,
    admin=Depends(_require_admin_token),
    redis=Depends(get_redis),
):
    niches = await _get_niches(redis)
    idx = next((i for i, n in enumerate(niches) if n["key"] == key), None)
    if idx is None:
        raise HTTPException(status_code=404, detail=f"Niche '{key}' not found")
    niches[idx] = {"key": req.key, "label": req.label, "suggestions": req.suggestions}
    await redis.set(NICHES_KEY, json.dumps(niches))
    return {"success": True, "niches": niches}


@router.delete("/admin/{key}")
async def delete_niche(
    key: str,
    admin=Depends(_require_admin_token),
    redis=Depends(get_redis),
):
    niches = await _get_niches(redis)
    new_niches = [n for n in niches if n["key"] != key]
    if len(new_niches) == len(niches):
        raise HTTPException(status_code=404, detail=f"Niche '{key}' not found")
    await redis.set(NICHES_KEY, json.dumps(new_niches))
    return {"success": True, "niches": new_niches}


@router.put("/admin/reorder")
async def reorder_niches(
    keys: list[str],
    admin=Depends(_require_admin_token),
    redis=Depends(get_redis),
):
    niches = await _get_niches(redis)
    niche_map = {n["key"]: n for n in niches}
    reordered = [niche_map[k] for k in keys if k in niche_map]
    # append any not in the list
    for n in niches:
        if n["key"] not in keys:
            reordered.append(n)
    await redis.set(NICHES_KEY, json.dumps(reordered))
    return {"success": True, "niches": reordered}
