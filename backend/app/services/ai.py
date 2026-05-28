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

settings = get_settings()
logger = logging.getLogger(__name__)

# ── Cached clients ────────────────────────────────────────────────────────────
_groq_client:   Optional[AsyncOpenAI] = None
_openai_client: Optional[AsyncOpenAI] = None

PREMIUM_PLANS = {"pro", "studio", "agency"}


def _get_groq_client() -> AsyncOpenAI:
    global _groq_client
    if _groq_client is None:
        if not settings.groq_api_key:
            raise ValueError("GROQ_API_KEY not set")
        _groq_client = AsyncOpenAI(
            api_key=settings.groq_api_key,
            base_url="https://api.groq.com/openai/v1",
        )
        logger.info("Groq client initialised — model: %s", settings.groq_model)
    return _groq_client


def _get_openai_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        import os
        openai_key = os.environ.get("OPENAI_API_KEY", "")
        if not openai_key:
            raise ValueError("OPENAI_API_KEY not set")
        _openai_client = AsyncOpenAI(api_key=openai_key)
        logger.info("OpenAI client initialised — model: gpt-4o")
    return _openai_client


def _client_and_model(plan: str = "free") -> tuple[AsyncOpenAI, str]:
    """Return (client, model) based on user plan."""
    import os
    openai_key = os.environ.get("OPENAI_API_KEY", "")
    if plan.lower() in PREMIUM_PLANS and openai_key:
        logger.info("Using OpenAI (gpt-4o) for plan=%s", plan)
        return _get_openai_client(), "gpt-4o"
    logger.info("Using Groq (%s) for plan=%s", settings.groq_model, plan)
    return _get_groq_client(), settings.groq_model


def get_provider_info(plan: str = "free") -> dict:
    """Return provider info — used by generate.py for logging."""
    import os
    if plan.lower() in PREMIUM_PLANS and os.environ.get("OPENAI_API_KEY"):
        return {"provider": "openai", "model": "gpt-4o"}
    return {"provider": "groq", "model": settings.groq_model}


# ── Kept for backwards compatibility (used by existing code that calls get_client()) ──
def get_client() -> AsyncOpenAI:
    return _get_groq_client()

def _model() -> str:
    return settings.groq_model


# ── Brand context ─────────────────────────────────────────────────────────────

def _brand_context(req) -> str:
    """Build a brand context block from optional brand kit fields on a request."""
    lines = []
    if getattr(req, "brand_client_name", ""):
        lines.append(f"Client: {req.brand_client_name}")
    if getattr(req, "brand_ai_tone", ""):
        lines.append(f"Brand tone: {req.brand_ai_tone}")
    if getattr(req, "brand_voice_notes", ""):
        lines.append(f"Brand voice rules: {req.brand_voice_notes}")
    if getattr(req, "brand_default_cta", ""):
        lines.append(f"Default call-to-action: {req.brand_default_cta}")
    if not lines:
        return ""
    return "\n\nBRAND GUIDELINES (follow strictly):\n" + "\n".join(lines)


# ── JSON cleaning ─────────────────────────────────────────────────────────────

def _clean_json(raw: str) -> str:
    raw = re.sub(r"```(?:json)?", "", raw).strip()
    for start, end in [("[", "]"), ("{", "}")]:
        i = raw.find(start)
        if i != -1:
            j = raw.rfind(end)
            if j > i:
                return raw[i:j + 1]
    return raw


# ── Public API ────────────────────────────────────────────────────────────────

async def generate_ideas(req: GenerateIdeasRequest, plan: str = "free") -> list[IdeaItem]:
    client, model = _client_and_model(plan)

    # Build enriched context section
    extra_parts = []
    if req.idea_tags:
        extra_parts.append(
            "Prioritise ideas around these topics:\n" +
            "\n".join(f"- {t}" for t in req.idea_tags)
        )
    if req.objective:
        extra_parts.append(f"Campaign objective: {req.objective}")
    if getattr(req, "client_brief", "").strip():
        extra_parts.append(
            "Client brief (follow these instructions carefully):\n" +
            req.client_brief.strip()
        )
    elif getattr(req, "context", "").strip():
        extra_parts.append(f"Additional context: {req.context}")

    hints_section = ("\n\n" + "\n\n".join(extra_parts)) if extra_parts else ""
    brand_ctx = _brand_context(req)

    # Duration / scene guidance
    dur = getattr(req, "duration_hint", 60) or 60
    scenes = getattr(req, "scene_count_hint", 8) or 8
    duration_note = f"Target duration: {dur}s with ~{scenes} scenes. "

    prompt = f"""Generate exactly 6 content ideas for a {req.style} video in the {req.niche} industry/niche.

Platform: {req.platform}
Audience: {req.audience or "general audience"}
Tone: {req.tone}
{duration_note}{hints_section}{brand_ctx}

Return ONLY a valid JSON array of 6 objects — no explanation, no markdown:
[{{"title": "...", "hook": "...", "angle": "..."}}]

- title: compelling video title (max 60 chars)
- hook: opening line that grabs attention in the first 2 seconds (max 80 chars)
- angle: unique creative approach (max 60 chars)"""

    response = await client.chat.completions.create(
        model=model,
        max_tokens=1024,
        temperature=0.8,
        messages=[
            {"role": "system", "content": "You are a viral content strategist. Return only valid JSON arrays, no markdown, no explanation."},
            {"role": "user",   "content": prompt},
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


async def generate_script(req: GenerateScriptRequest, plan: str = "free") -> str:
    client, model = _client_and_model(plan)
    is_long  = "YouTube" in req.platform and "Shorts" not in req.platform
    duration = "3-5 minutes (450-700 words)" if is_long else "45-60 seconds (120-160 words)"
    brand_ctx = _brand_context(req)

    prompt = f"""Write a complete {req.style} video script for {req.platform}.

Title: "{req.idea.title}"
Hook: "{req.idea.hook}"
Niche: {req.niche} | Tone: {req.tone}
Audience: {req.audience or "general"}
Target length: {duration}

Format with section labels on their own lines: [HOOK] [INTRO] [MAIN] [CTA]
Add [PAUSE] for dramatic effect.
Add visual cues like [SHOW: chart] or [CUT TO: talking head].
Short punchy sentences for voiceover. No markdown.{brand_ctx}"""

    response = await client.chat.completions.create(
        model=model,
        max_tokens=2048,
        temperature=0.7,
        messages=[
            {"role": "system", "content": "You are an expert short-form video scriptwriter."},
            {"role": "user",   "content": prompt},
        ],
    )
    return response.choices[0].message.content or ""


async def stream_script(
    req: GenerateScriptRequest, plan: str = "free"
) -> AsyncGenerator[str, None]:
    client, model = _client_and_model(plan)
    is_long  = "YouTube" in req.platform and "Shorts" not in req.platform
    duration = "3-5 minutes" if is_long else "45-60 seconds"
    brand_ctx = _brand_context(req)

    prompt = f"""Write a complete {req.style} video script.
Title: "{req.idea.title}" | Hook: "{req.idea.hook}"
Platform: {req.platform} | Duration: {duration}
Tone: {req.tone} | Niche: {req.niche}
Use [HOOK] [INTRO] [MAIN] [CTA] section labels.
Add [SHOW: ...] visual cues. Short punchy sentences.{brand_ctx}"""

    stream = await client.chat.completions.create(
        model=model,
        max_tokens=2048,
        temperature=0.7,
        stream=True,
        messages=[
            {"role": "system", "content": "You are an expert short-form video scriptwriter."},
            {"role": "user",   "content": prompt},
        ],
    )

    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


async def generate_scenes(req: GenerateScenesRequest, plan: str = "free") -> list[Scene]:
    client, model = _client_and_model(plan)
    brand_ctx = _brand_context(req)

    prompt = f"""You are a professional video editor. Break this script into scenes.

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
- Each scene text = one complete thought or paragraph from the script{brand_ctx}"""

    response = await client.chat.completions.create(
        model=model,
        max_tokens=8192,
        temperature=0.1,
        messages=[
            {"role": "system", "content": "You are a video production assistant. Return only valid JSON arrays, no markdown."},
            {"role": "user",   "content": prompt},
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
    scenes = []
    for item in data:
        # Fix scene type
        t = str(item.get('type', 'main')).lower().strip()
        if t not in valid_types:
            if t.startswith('ct'):   item['type'] = 'cta'
            elif t.startswith('ho'): item['type'] = 'hook'
            elif t.startswith('in'): item['type'] = 'intro'
            else:                    item['type'] = 'main'

        # Skip scenes with empty or whitespace-only text — GPT-4o occasionally
        # returns an empty string for a scene, causing Pydantic validation to fail
        text = str(item.get('text', '')).strip()
        if not text:
            logger.warning("Skipping scene with empty text: %s", item)
            continue
        item['text'] = text

        # Also sanitise visual_prompt — allow empty (has default in schema)
        vp = str(item.get('visual_prompt', '')).strip()
        if vp:
            item['visual_prompt'] = vp

        try:
            scenes.append(Scene(**item))
        except Exception as exc:
            logger.warning("Skipping invalid scene %s: %s", item, exc)
            continue

    if not scenes:
        raise ValueError("AI returned no valid scenes — please try again")

    return scenes
