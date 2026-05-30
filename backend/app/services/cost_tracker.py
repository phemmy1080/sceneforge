"""
cost_tracker.py — Per-render cost accounting for SceneForge.

Cost model (all in USD):
  Voice synthesis   — Microsoft Edge TTS (edge-tts) is free for all plans
                      ElevenLabs $0.30/1k chars — Studio plan only, when ELEVENLABS_API_KEY set
  Visuals           — Pexels free; DALL-E 3 $0.04/image (1024×1024)
  AI generation     — Groq free tier; OpenAI gpt-4o-mini ~$0.00015/1k input + $0.0006/1k output
  FFmpeg/compute    — Railway CPU cost: ~$0.000015/second of processing
  Storage (R2)      — $0.015/GB-month → amortised per video ≈ $0.0003/render (50 MB avg)
  Video serving     — R2 egress free for first 10 GB/month, ~$0.0 for now

Margin = Revenue per render - Cost per render
Revenue per render = plan_price_ngn / exchange_rate / tokens_per_plan * TOKENS_PER_VIDEO
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# ─── Cost constants (USD) ─────────────────────────────────────────────────────

# Voice
EDGE_TTS_COST_PER_CHAR   = 0.0          # Microsoft Edge TTS — free (uses browser/edge runtime)
ELEVENLABS_COST_PER_CHAR = 0.30 / 1000  # $0.30 per 1k chars (pro voices only)

# Visuals
PEXELS_COST_PER_IMAGE   = 0.0           # free
DALLE3_COST_PER_IMAGE   = 0.040         # $0.04 per 1024×1024 image

# AI text generation (gpt-4o-mini pricing)
OPENAI_INPUT_PER_1K     = 0.00015       # $0.15 per 1M input tokens
OPENAI_OUTPUT_PER_1K    = 0.00060       # $0.60 per 1M output tokens
GROQ_COST_PER_1K        = 0.0           # free tier

# Compute (Railway) — $0.000463/vCPU-minute → ~$0.000008/sec on shared 0.5 vCPU
COMPUTE_COST_PER_SEC    = 0.000008

# Storage — R2 $0.015/GB-month; avg video 50MB → $0.00075/month → $0.000025/render (30-day)
STORAGE_COST_PER_RENDER = 0.000025

# Tokens consumed per video render (from your deduct_tokens logic)
TOKENS_PER_VIDEO        = 100

# Redis key patterns
COST_KEY_PREFIX         = "render:cost:"    # render:cost:{job_id}
PLAN_COST_KEY           = "plan:costs"      # hash: plan_key → JSON cost summary
COST_LOG_KEY            = "admin:cost:log"  # list of recent cost records


# ─── Cost record builder ──────────────────────────────────────────────────────

def build_cost_record(
    job_id: str,
    user_id: str,
    plan: str,
    scenes: int,
    visual_source: str,
    voice_provider: str,
    total_chars: int,
    ai_provider: str,
    ai_input_tokens: int,
    ai_output_tokens: int,
    render_seconds: float,
    dalle_images: int = 0,
    plan_price_ngn: float = 0.0,
    plan_tokens: int = 100,
    exchange_rate: float = 1600.0,
    niche: str = "",
    tokens_consumed: int = 0,    # actual SceneForge tokens deducted from user balance
    username: str = "",          # cached full_name for fast display
    user_email: str = "",        # cached email for fast display
) -> dict:
    """Compute itemised cost breakdown for one render job."""

    # Voice cost
    # Microsoft Edge TTS is free; ElevenLabs is $0.30/1k chars
    if voice_provider == "elevenlabs":
        voice_cost = total_chars * ELEVENLABS_COST_PER_CHAR
    else:
        # edge_tts / gtts — free
        voice_cost = total_chars * EDGE_TTS_COST_PER_CHAR  # = 0.0

    # Visual cost
    if visual_source == "dalle" or dalle_images > 0:
        visual_cost = (scenes if dalle_images == 0 else dalle_images) * DALLE3_COST_PER_IMAGE
    else:
        visual_cost = PEXELS_COST_PER_IMAGE

    # AI generation cost
    if ai_provider == "openai":
        ai_cost = (ai_input_tokens / 1000) * OPENAI_INPUT_PER_1K + \
                  (ai_output_tokens / 1000) * OPENAI_OUTPUT_PER_1K
    else:
        ai_cost = GROQ_COST_PER_1K

    # Compute cost
    compute_cost = render_seconds * COMPUTE_COST_PER_SEC

    # Storage
    storage_cost = STORAGE_COST_PER_RENDER

    total_cost_usd = voice_cost + visual_cost + ai_cost + compute_cost + storage_cost

    # Revenue per render
    # plan_price covers `plan_tokens` tokens; each render costs TOKENS_PER_VIDEO tokens
    # so revenue per render = (plan_price / plan_tokens) * TOKENS_PER_VIDEO
    plan_price_usd = plan_price_ngn / exchange_rate
    renders_per_plan = max(plan_tokens / TOKENS_PER_VIDEO, 1)
    revenue_per_render_usd = plan_price_usd / renders_per_plan
    margin_usd = revenue_per_render_usd - total_cost_usd
    margin_pct  = (margin_usd / revenue_per_render_usd * 100) if revenue_per_render_usd > 0 else 0

    return {
        "job_id":              job_id,
        "user_id":             user_id,
        "username":            username,
        "user_email":          user_email,
        "plan":                plan,
        "ts":                  datetime.now(timezone.utc).isoformat(),
        "scenes":              scenes,
        "niche":               niche,
        "visual_source":       visual_source,
        "voice_provider":      voice_provider,
        "tokens_consumed":     tokens_consumed or max(100, scenes * TOKENS_PER_VIDEO),
        # Itemised costs (USD)
        "cost_voice_usd":      round(voice_cost, 6),
        "cost_visual_usd":     round(visual_cost, 6),
        "cost_ai_usd":         round(ai_cost, 6),
        "cost_compute_usd":    round(compute_cost, 6),
        "cost_storage_usd":    round(storage_cost, 6),
        "total_cost_usd":      round(total_cost_usd, 6),
        # Revenue & margin
        "plan_price_ngn":      plan_price_ngn,
        "plan_price_usd":      round(plan_price_usd, 4),
        "plan_tokens":         plan_tokens,
        "renders_per_plan":    round(renders_per_plan, 1),
        "revenue_per_render":  round(revenue_per_render_usd, 6),
        "margin_usd":          round(margin_usd, 4),
        "margin_pct":          round(margin_pct, 1),
        # Raw inputs
        "total_chars":         total_chars,
        "ai_input_tokens":     ai_input_tokens,
        "ai_output_tokens":    ai_output_tokens,
        "render_seconds":      round(render_seconds, 2),
        "dalle_images":        dalle_images,
        "exchange_rate":       exchange_rate,
    }


# ─── Redis persistence ────────────────────────────────────────────────────────

async def store_cost_record(redis, record: dict) -> None:
    """Store individual job cost + update per-plan aggregates."""
    job_id = record["job_id"]

    # 1. Store individual record (TTL 90 days)
    await redis.set(
        f"{COST_KEY_PREFIX}{job_id}",
        json.dumps(record),
        ex=60 * 60 * 24 * 90,
    )

    # 2. Push to recent cost log (capped at 500)
    await redis.lpush(COST_LOG_KEY, json.dumps(record))
    await redis.ltrim(COST_LOG_KEY, 0, 499)

    # 3. Update per-plan aggregate in a Redis hash
    plan = record["plan"]
    raw = await redis.hget(PLAN_COST_KEY, plan)
    if raw:
        agg = json.loads(raw)
    else:
        agg = {
            "plan": plan, "renders": 0,
            "total_cost_usd": 0.0, "total_revenue_usd": 0.0,
            "total_margin_usd": 0.0,
            "avg_cost_usd": 0.0, "avg_margin_usd": 0.0, "avg_margin_pct": 0.0,
            "cost_voice": 0.0, "cost_visual": 0.0,
            "cost_ai": 0.0, "cost_compute": 0.0, "cost_storage": 0.0,
        }

    agg["renders"]           += 1
    agg["total_cost_usd"]    += record["total_cost_usd"]
    agg["total_revenue_usd"] += record["revenue_per_render"]
    agg["total_margin_usd"]  += record["margin_usd"]
    agg["cost_voice"]        += record["cost_voice_usd"]
    agg["cost_visual"]       += record["cost_visual_usd"]
    agg["cost_ai"]           += record["cost_ai_usd"]
    agg["cost_compute"]      += record["cost_compute_usd"]
    agg["cost_storage"]      += record["cost_storage_usd"]

    n = agg["renders"]
    agg["avg_cost_usd"]    = round(agg["total_cost_usd"]    / n, 6)
    agg["avg_margin_usd"]  = round(agg["total_margin_usd"]  / n, 4)
    agg["avg_margin_pct"]  = round(
        agg["total_margin_usd"] / agg["total_revenue_usd"] * 100
        if agg["total_revenue_usd"] > 0 else 0, 1
    )

    # Round all fields for clean storage
    for k in ["total_cost_usd","total_revenue_usd","total_margin_usd",
              "cost_voice","cost_visual","cost_ai","cost_compute","cost_storage"]:
        agg[k] = round(agg[k], 6)

    await redis.hset(PLAN_COST_KEY, plan, json.dumps(agg))
    logger.info("Cost stored — job=%s plan=%s cost=$%.4f margin=$%.4f (%.1f%%)",
                job_id, plan, record["total_cost_usd"],
                record["margin_usd"], record["margin_pct"])


async def get_plan_cost_summary(redis) -> dict:
    """Return per-plan cost aggregates."""
    raw = await redis.hgetall(PLAN_COST_KEY)
    result = {}
    for k, v in raw.items():
        plan = k.decode() if isinstance(k, bytes) else k
        result[plan] = json.loads(v)
    return result


async def get_recent_cost_records(redis, limit: int = 50) -> list[dict]:
    """Return most recent cost records."""
    raw = await redis.lrange(COST_LOG_KEY, 0, limit - 1)
    return [json.loads(r) for r in raw]


async def get_cost_record(redis, job_id: str) -> dict | None:
    raw = await redis.get(f"{COST_KEY_PREFIX}{job_id}")
    return json.loads(raw) if raw else None
