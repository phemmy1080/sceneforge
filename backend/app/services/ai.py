from __future__ import annotations

import json
import re
import logging
from typing import AsyncGenerator, Optional

from openai import AsyncOpenAI

from app.config import get_settings
from app.models.schemas import (
    GenerateIdeasRequest, IdeaItem,
    GenerateScriptRequest,
    GenerateScenesRequest, Scene,
)


def _brand_context(req) -> str:
    """Build a brand context block from optional brand kit fields on a request."""
    lines = []
    if getattr(req, 'brand_client_name', ''):
        lines.append(f"Client: {req.brand_client_name}")
    if getattr(req, 'brand_ai_tone', ''):
        lines.append(f"Brand tone: {req.brand_ai_tone}")
    if getattr(req, 'brand_voice_notes', ''):
        lines.append(f"Brand voice rules: {req.brand_voice_notes}")
    if getattr(req, 'brand_default_cta', ''):
        lines.append(f"Default call-to-action: {req.brand_default_cta}")
    if not lines:
        return ""
    return "\n\nBRAND GUIDELINES (follow strictly):\n" + "\n".join(lines)

settings = get_settings()
logger = logging.getLogger(__name__)

_client: Optional[AsyncOpenAI] = None


def get_client() -> AsyncOpenAI:
    global _client
    if _client is not None:
        return _client

    if settings.groq_api_key:
        _client = AsyncOpenAI(
            api_key=settings.groq_api_key,
            base_url="https://api.groq.com/openai/v1",
        )
        logger.info("Using Groq — model: %s", settings.groq_model)

    elif settings.gemini_api_key:
        # Gemini via OpenAI-compatible endpoint
        _client = AsyncOpenAI(
            api_key=settings.gemini_api_key,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        )
        logger.info("Using Gemini — model: %s", settings.gemini_model)

    elif settings.grok_api_key:
        _client = AsyncOpenAI(
            api_key=settings.grok_api_key,
            base_url="https://api.x.ai/v1",
        )
        logger.info("Using Grok (xAI) — model: %s", settings.grok_model)

    elif settings.anthropic_api_key:
        _client = AsyncOpenAI(
            api_key=settings.anthropic_api_key,
            base_url="https://api.anthropic.com/v1",
        )
        logger.info("Using Anthropic compat — model: %s", settings.claude_model)

    else:
        raise ValueError(
            "No AI API key found. Set GROQ_API_KEY in your .env file. "
            "Get a free key at https://console.groq.com"
        )

    return _client


def _model() -> str:
    if settings.groq_api_key:
        return settings.groq_model
    if settings.gemini_api_key:
        return settings.gemini_model
    if settings.grok_api_key:
        return settings.grok_model
    return settings.claude_model


def _clean_json(raw: str) -> str:
    raw = re.sub(r"```(?:json)?", "", raw).strip()
    for start, end in [("[", "]"), ("{", "}")]:
        i = raw.find(start)
        if i != -1:
            j = raw.rfind(end)
            if j > i:
                return raw[i:j + 1]
    return raw


async def generate_ideas(req: GenerateIdeasRequest) -> list[IdeaItem]:
    client = get_client()

    # Build hints section from user-supplied topic tags
    hints_section = ""
    if req.idea_tags:
        hints_section = f"""
User has requested ideas around these specific topics (prioritise these):
{chr(10).join(f"- {t}" for t in req.idea_tags)}
Generate ideas that directly address these topics. Fill remaining slots with related ideas.
"""
    elif req.context:
        hints_section = f"\nFocus area: {req.context}"

    brand_ctx = _brand_context(req)
    prompt = f"""Generate exactly 6 viral content ideas for a {req.style} {req.niche} video.

Platform: {req.platform}
Audience: {req.audience or "general"}
Tone: {req.tone}{hints_section}{brand_ctx}

Return ONLY a valid JSON array of 6 objects — no explanation, no markdown:
[{{"title": "...", "hook": "...", "angle": "..."}}]

- title: compelling video title (max 60 chars)
- hook: opening line that grabs attention (max 80 chars)
- angle: unique approach or angle (max 60 chars)"""

    response = await client.chat.completions.create(
        model=_model(),
        max_tokens=1024,
        temperature=0.8,
        messages=[
            {"role": "system", "content": "You are a viral content strategist. Return only valid JSON arrays, no markdown, no explanation."},
            {"role": "user", "content": prompt},
        ],
    )

    raw = response.choices[0].message.content or ""
    logger.debug("Ideas raw: %s", raw[:300])

    try:
        data = json.loads(_clean_json(raw))
    except json.JSONDecodeError as exc:
        logger.error("Failed to parse ideas JSON. Raw: %s", raw)
        raise ValueError(f"Model returned invalid JSON: {exc}") from exc

    return [IdeaItem(**item) for item in data]


async def generate_script(req: GenerateScriptRequest) -> str:
    client = get_client()
    is_long = "YouTube" in req.platform and "Shorts" not in req.platform
    duration = "3-5 minutes (450-700 words)" if is_long else "45-60 seconds (120-160 words)"

    brand_ctx = _brand_context(req)
    prompt = f"""Write a complete {req.style} video script for {req.platform}.

Title: "{req.idea.title}"
Hook: "{req.idea.hook}"
Niche: {req.niche} | Tone: {req.tone}
Audience: {req.audience or "general"}
Target length: {duration}{brand_ctx}

Format with section labels on their own lines: [HOOK] [INTRO] [MAIN] [CTA]
Add [PAUSE] for dramatic effect.
Add visual cues like [SHOW: chart] or [CUT TO: talking head].
Short punchy sentences for voiceover. No markdown."""

    response = await client.chat.completions.create(
        model=_model(),
        max_tokens=2048,
        temperature=0.7,
        messages=[
            {"role": "system", "content": "You are an expert short-form video scriptwriter."},
            {"role": "user", "content": prompt},
        ],
    )

    return response.choices[0].message.content or ""


async def stream_script(req: GenerateScriptRequest) -> AsyncGenerator[str, None]:
    client = get_client()
    is_long = "YouTube" in req.platform and "Shorts" not in req.platform
    duration = "3-5 minutes" if is_long else "45-60 seconds"

    brand_ctx = _brand_context(req)
    prompt = f"""Write a complete {req.style} video script.
Title: "{req.idea.title}" | Hook: "{req.idea.hook}"
Platform: {req.platform} | Duration: {duration}
Tone: {req.tone} | Niche: {req.niche}{brand_ctx}
Use [HOOK] [INTRO] [MAIN] [CTA] section labels.
Add [SHOW: ...] visual cues. Short punchy sentences."""

    stream = await client.chat.completions.create(
        model=_model(),
        max_tokens=2048,
        temperature=0.7,
        stream=True,
        messages=[
            {"role": "system", "content": "You are an expert short-form video scriptwriter."},
            {"role": "user", "content": prompt},
        ],
    )

    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


async def generate_scenes(req: GenerateScenesRequest) -> list[Scene]:
    client = get_client()

    brand_ctx = _brand_context(req)
    cta_note = f"\n- End the final scene with this call-to-action: {req.brand_default_cta}" if getattr(req, 'brand_default_cta', '') else ""
    prompt = f"""You are a professional video editor. Break this script into scenes.{brand_ctx}

CRITICAL RULES FOR THE "text" FIELD:
- Copy the EXACT spoken words from the script into each scene's "text" field
- Do NOT summarise, shorten, paraphrase or truncate any text
- Do NOT cut words mid-sentence
- The "text" field must contain the COMPLETE voiceover for that scene, word for word
- Every single word in the script must appear in exactly one scene's text
- If a scene has many words, that is fine — preserve them all

Script:
{req.script}

Return ONLY a valid JSON array — no markdown, no explanation:
[{{
  "id": 1,
  "text": "COMPLETE verbatim voiceover text for this scene — no truncation",
  "visual": "cinematic description of what appears on screen",
  "duration": 6,
  "type": "hook",
  "visual_keyword": "2-4 word pexels search term",
  "emotion": "energetic",
  "b_roll_note": "overlay or B-roll suggestion"
}}]

Rules:
- type: hook, intro, main, or cta
- duration: calculate from word count — approximately 2.5 words per second. A 20-word scene = 8s, 30-word scene = 12s, 40-word scene = 16s
- Do NOT cap duration at 8 seconds — use however many seconds the words require
- Create enough scenes to cover every word — 6 to 20 scenes depending on script length
- Each scene text = one complete thought or paragraph from the script{cta_note}"""

    response = await client.chat.completions.create(
        model=_model(),
        max_tokens=8192,
        temperature=0.1,
        messages=[
            {"role": "system", "content": "You are a video production assistant. Return only valid JSON arrays, no markdown."},
            {"role": "user", "content": prompt},
        ],
    )

    raw = response.choices[0].message.content or ""
    logger.debug("Scenes raw: %s", raw[:300])

    try:
        data = json.loads(_clean_json(raw))
    except json.JSONDecodeError as exc:
        logger.error("Failed to parse scenes JSON. Raw: %s", raw)
        raise ValueError(f"Model returned invalid JSON: {exc}") from exc

    valid_types = {'hook', 'intro', 'main', 'cta'}
    for item in data:
        t = str(item.get('type', 'main')).lower().strip()
        if t not in valid_types:
            if t.startswith('ct'): item['type'] = 'cta'
            elif t.startswith('ho'): item['type'] = 'hook'
            elif t.startswith('in'): item['type'] = 'intro'
            else: item['type'] = 'main'
    return [Scene(**item) for item in data]
