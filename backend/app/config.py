from __future__ import annotations

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # App
    app_name: str = "SceneForge"
    debug: bool = False
    renders_dir: str = "./renders"
    frontend_origin: str = "http://localhost:5173"

    # ── AI providers ──────────────────────────────────────────────────────
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-1.5-flash"
    grok_api_key: str = ""
    grok_model: str = "grok-3-mini"
    anthropic_api_key: str = ""
    claude_model: str = "claude-sonnet-4-20250514"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"  # model for pro/studio/agency plans

    # ── Voice ─────────────────────────────────────────────────────────────
    elevenlabs_api_key: str = ""
    tts_provider: str = "gtts"   # "gtts" or "edge"
    pexels_api_key: str = ""
    unsplash_api_key: str = ""       # Unsplash Access Key — register at unsplash.com/developers

    # ── Flutterwave payments ───────────────────────────────────────────────
    flutterwave_public_key: str = ""   # FLWPUBK_TEST-xxx or FLWPUBK-xxx
    flutterwave_secret_key: str = ""   # FLWSECK_TEST-xxx or FLWSECK-xxx
    flutterwave_secret_hash: str = ""  # webhook verification hash (set in FLW dashboard)

    # Token pricing — tokens awarded per NGN paid
    # e.g. 1000 NGN = 500 tokens, 2000 NGN = 1200 tokens, 5000 NGN = 3500 tokens
    token_plans: dict = {
        "starter": {"amount": 1000, "currency": "NGN", "tokens": 500,  "label": "Starter"},
        "pro":     {"amount": 2000, "currency": "NGN", "tokens": 1200, "label": "Pro"},
        "studio":  {"amount": 5000, "currency": "NGN", "tokens": 3500, "label": "Studio"},
    }

    # ── Email (SMTP) ───────────────────────────────────────────────────────
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""    # your Gmail address
    smtp_password: str = "" # Gmail app password (not your login password)
    email_from: str = ""   # defaults to smtp_user if empty
    email_from_name: str = "SceneForge"

    # ── Storage ───────────────────────────────────────────────────────────
    s3_bucket: str = ""
    s3_region: str = "us-east-1"
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""

    # ── Admin ─────────────────────────────────────────────────────────────
    admin_secret_key: str = ""   # Legacy key auth — still supported
    superadmin_email: str = ""   # Bootstrap superadmin email (set in .env)
    superadmin_password: str = "" # Bootstrap superadmin password (set in .env)

    # ── Redis ─────────────────────────────────────────────────────────────
    redis_url: str = "redis://localhost:6379"

    # ElevenLabs voice IDs
    voice_ids: dict = {
        "Marcus": "TxGEqnHWrfWFTfGW9XjX",
        "Sophie": "EXAVITQu4vr4xnSDxMaL",
        "Alex":   "ErXwobaYiN019PkySvjV",
        "Jordan": "VR6AewLTigWG4xSOukaG",
        "Luna":   "pNInz6obpgDQGcFmaJgB",
        "Kai":    "yoZ06aMxZJJ28mfd3POQ",
    }

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    return Settings()
