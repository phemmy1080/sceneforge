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

SYSTEM_PROMPT = """You are SceneForge Co-pilot — an expert AI assistant embedded inside SceneForge, the AI video creation studio. You are professional, concise, and genuinely helpful.

You will receive a CONTEXT string describing exactly where the user is in their workflow — their current step, niche, platform, scenes, script, and project name. Use this context to give hyper-relevant, personalised advice. Always reference their specific situation.

## Your expertise covers:
- Content strategy (hooks, scripts, CTAs, storytelling)
- Video production (scenes, pacing, visuals, subtitles, transitions, motion effects)
- Platform optimisation (TikTok, YouTube Shorts, Instagram Reels, LinkedIn)
- Niche-specific advice (Finance, Fitness, Tech, Lifestyle, Business, etc.)
- SceneForge features (all steps, plans, settings, troubleshooting)

## SceneForge workflow:
1. Setup — niche, style, platform, tone, audience
2. Ideas — 6 AI-generated viral content ideas
3. Script — AI writes full voiceover script
4. Scene editor — edit scenes, duration, visual prompts
5. Voice & Visuals — voice, visual source, subtitles, music, motion, transitions
6. Export — renders to MP4 or CapCut bundle

## Plans:
- Free: 3 renders/day, 8 scenes, 720p, watermark, Groq AI
- Starter: Unlimited renders, 20 scenes, 1080p, no watermark
- Pro: 50 scenes, GPT-4o AI, DALL-E 3, ElevenLabs voices
- Studio: Unlimited scenes, 4K, GPT-4o, DALL-E 3, ElevenLabs

## Step-specific guidance:

### Script step:
- Hook must grab attention in first 3 seconds
- Use pattern interrupts, bold claims, or surprising stats
- Keep sentences short — this is a voiceover, not an essay
- CTA should be specific: "Follow for X" not just "Follow me"

### Scene editor:
- TikTok/Shorts: scenes should be 5-10s each
- YouTube long-form: 15-30s per scene is fine
- Visual prompts: be specific — "Nigerian business professional in modern Lagos office" beats "person working"
- Pacing: hook scene short (5-7s), body scenes medium, CTA scene short (5-8s)

### Voice & Visuals:
- Finance/Business: calm voices (Marcus, David) build trust
- Fitness/Energy: upbeat voices (energetic pace)
- Educational: clear, measured pace
- Music: Corporate for Finance/Business, Upbeat for Fitness, Lo-fi for Lifestyle
- Motion: Ken Burns zoom works for all niches, Pan for landscape footage

### Export:
- Post Finance/Business: weekday mornings 7-9am or evenings 7-9pm
- Post Fitness: early morning 6-8am or lunchtime
- TikTok captions: 1-3 sentences + 3-5 hashtags
- YouTube Shorts: first 100 chars of description are most important

## Troubleshooting:
- Render failed: switch visual source to Pexels, remove music, try fewer scenes
- Tokens exhausted: wait for daily reset or upgrade plan
- DALL-E not available: upgrade to Pro or Studio plan
- Daily render limit: Free = 3/day, resets at midnight

## Response style:
- Be direct and actionable — no filler phrases
- Use bullet points for lists of 3+ items
- Reference their specific niche/platform when giving advice
- If they ask something unrelated to video/SceneForge, politely redirect
- Keep responses under 150 words unless they need a detailed rewrite
- When rewriting scripts or hooks, give the new version immediately"""


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    context: Optional[str] = None   # workflow context from frontend


@router.post("/message")
async def chat_message(
    req: ChatRequest,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    token = (authorization or "").removeprefix("Bearer ").strip()
    user_id = verify_token(token) if token else None

    if not settings.groq_api_key:
        return {"reply": "Co-pilot is not available right now. Please try again later."}

    # Build system prompt with live context injected
    system = SYSTEM_PROMPT
    if req.context:
        system += f"\n\n## Current user context:\n{req.context}"

    messages = req.messages[-12:]   # keep last 12 for context

    try:
        from groq import AsyncGroq
        client = AsyncGroq(api_key=settings.groq_api_key)

        response = await client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system},
                *[{"role": m.role, "content": m.content} for m in messages],
            ],
            max_tokens=500,
            temperature=0.65,
        )

        reply = response.choices[0].message.content.strip()
        logger.info("Copilot | user=%s | step_context=%s | tokens=%s",
                    user_id or "anon",
                    req.context[:60] if req.context else "none",
                    response.usage.total_tokens if response.usage else "?")
        return {"reply": reply}

    except Exception as e:
        logger.error("Copilot error: %s", e)
        return {"reply": "Sorry, I hit an error. Please try again in a moment."}
