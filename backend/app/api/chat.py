from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel
from typing import Optional

from app.dependencies import get_redis
from app.services.auth import verify_token
from app.config import get_settings

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()

SYSTEM_PROMPT = """You are SceneForge Assistant — a friendly, concise helper built into the SceneForge AI video studio.

You ONLY answer questions about SceneForge and video creation. If asked anything unrelated, politely redirect.

## About SceneForge
SceneForge is an AI-powered video studio that creates short-form videos for TikTok, YouTube Shorts, Instagram Reels, and LinkedIn. The workflow has 6 steps:
1. Setup — choose niche, style, platform, tone, audience
2. Ideas — AI generates 6 viral content ideas
3. Script — AI writes the full voiceover script (streamed live)
4. Scene Editor — script split into scenes, edit text/duration/visuals
5. Voice & Visuals — pick neural voice, visual source, subtitles, background music
6. Export — video renders and downloads as MP4 or CapCut bundle

## Plans
- Free: 3 renders/day, 8 scenes max, 720p, watermark, Groq AI, Pexels visuals
- Starter: Unlimited renders, 20 scenes, 1080p, no watermark, Pexels visuals
- Pro: 50 scenes, 1080p, GPT-4o AI, DALL-E 3 images, ElevenLabs voices
- Studio: Unlimited scenes, 4K, GPT-4o AI, DALL-E 3, ElevenLabs voices

## Features
- 24+ neural voices with adjustable speed and stability
- Visual sources: stock video, stock photos, mixed (Pexels + AI), AI images (Pro/Studio only)
- Subtitle styles: viral, minimal, karaoke, none
- Background music: upbeat, cinematic, lofi, corporate, energetic, inspiring
- CapCut export with draft_content.json for direct import
- Token system: tokens are deducted per render based on plan
- Projects saved automatically with folder organisation
- Upload your own script or voiceover to skip AI generation

## Common Issues & Solutions
- "Render failed": Go back to Voice & Visuals, try stock video instead of AI images, or remove background music
- "Tokens exhausted": Upgrade plan or wait for daily reset
- "Daily limit reached": Free plan allows 3 renders/day, resets at midnight
- "DALL-E not available": Upgrade to Pro or Studio plan
- Video too long: Reduce scene count or shorten individual scene durations

## Tips
- Add topic hints in Setup to guide the AI toward specific angles
- Use "Viral / Hook-first" style for TikTok, "Educational" for YouTube
- Keep scenes 5-8 seconds for best engagement on short-form platforms
- CapCut export lets you add your own edits after rendering

Keep answers short, friendly, and actionable. Use bullet points for steps. Never mention competitors."""


class ChatMessage(BaseModel):
    role: str   # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


@router.post("/message")
async def chat_message(
    req: ChatRequest,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    token = (authorization or "").removeprefix("Bearer ").strip()
    user_id = verify_token(token) if token else None

    if not settings.groq_api_key:
        return {"reply": "I'm not available right now. Please try again later."}

    # Keep last 10 messages for context
    messages = req.messages[-10:]

    try:
        from groq import AsyncGroq
        client = AsyncGroq(api_key=settings.groq_api_key)

        response = await client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                *[{"role": m.role, "content": m.content} for m in messages],
            ],
            max_tokens=400,
            temperature=0.6,
        )

        reply = response.choices[0].message.content.strip()
        logger.info("Chat | user=%s | tokens=%s", user_id or "anon",
                    response.usage.total_tokens if response.usage else "?")
        return {"reply": reply}

    except Exception as e:
        logger.error("Chat error: %s", e)
        return {"reply": "Sorry, I hit an error. Please try again in a moment."}
