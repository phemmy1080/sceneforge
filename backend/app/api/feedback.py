from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel

from app.dependencies import get_redis
from app.services.auth import verify_token

router = APIRouter()
logger = logging.getLogger(__name__)


class FeedbackRequest(BaseModel):
    rating:  int
    tags:    list[str] = []
    comment: str = ""
    trigger: str = ""   # video_complete | time_on_screen
    page:    str = ""


@router.post("")
async def submit_feedback(
    req: FeedbackRequest,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    token   = (authorization or "").removeprefix("Bearer ").strip()
    user_id = verify_token(token) if token else "anonymous"

    record = {
        "user_id": user_id,
        "rating":  req.rating,
        "tags":    req.tags,
        "comment": req.comment,
        "trigger": req.trigger,
        "page":    req.page,
        "ts":      datetime.now(timezone.utc).isoformat(),
    }

    await redis.lpush("sceneforge:feedback", json.dumps(record))
    await redis.ltrim("sceneforge:feedback", 0, 499)

    logger.info("Feedback | user=%s | rating=%d | trigger=%s", user_id, req.rating, req.trigger)
    return {"success": True}
