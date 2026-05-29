"""
email_campaigns.py — Automated lifecycle email campaigns for SceneForge.

Campaigns:
  1. Welcome email   — sent on signup, delayed 2 min so OTP lands first
  2. Zero-render     — sent 24h after signup if user hasn't rendered anything
  3. Inactive 5-day  — sent when last_render_at > 5 days ago
  4. Inactive 14-day — deeper re-engagement if still inactive
  5. Inactive 30-day — final "we miss you" with bonus token offer

All campaigns are idempotent — a Redis flag prevents sending the same
campaign twice per user.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from app.config import get_settings
from app.services.email_service import _send

settings = get_settings()
logger = logging.getLogger(__name__)

APP_URL = getattr(settings, "frontend_origin", "https://sceneraforge.com")

# ─── Email helpers ────────────────────────────────────────────────────────────

def _header(title: str, subtitle: str = "") -> str:
    return f"""
    <tr><td style="background:linear-gradient(135deg,#1a0d33,#0a1a2e);padding:32px 40px;text-align:center">
      <h1 style="margin:0;font-size:26px;font-weight:800;letter-spacing:-1px;color:#fff">
        Scene<span style="color:#A78BFA">Forge</span>
      </h1>
      {'<p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.45)">'+subtitle+'</p>' if subtitle else ''}
    </td></tr>"""

def _footer() -> str:
    return f"""
    <tr><td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center">
      <p style="margin:0 0 6px;font-size:12px;color:rgba(255,255,255,0.25)">
        SceneForge · AI Video Studio · <a href="{APP_URL}" style="color:rgba(167,139,250,0.6);text-decoration:none">sceneraforge.com</a>
      </p>
      <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.15)">
        You're receiving this because you created a SceneForge account.
      </p>
    </td></tr>"""

def _wrap(body: str) -> str:
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#080810;font-family:'DM Sans',Arial,sans-serif;color:#F0F0FF">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080810;padding:40px 16px">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0"
        style="background:#111118;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;max-width:580px;width:100%">
        {body}
      </table>
    </td></tr>
  </table>
</body></html>"""

def _cta(label: str, url: str) -> str:
    return f"""<div style="text-align:center;margin:28px 0 0">
      <a href="{url}" style="display:inline-block;background:linear-gradient(135deg,#7C3AED,#5b21b6);
        color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-size:15px;
        font-weight:700;letter-spacing:.02em">{label}</a>
    </div>"""

def _feature_row(emoji: str, title: str, desc: str) -> str:
    return f"""<tr>
      <td style="padding:10px 0;vertical-align:top;width:36px;font-size:22px">{emoji}</td>
      <td style="padding:10px 0 10px 12px;vertical-align:top">
        <div style="font-size:13.5px;font-weight:700;color:#fff;margin-bottom:3px">{title}</div>
        <div style="font-size:12.5px;color:rgba(255,255,255,0.5);line-height:1.55">{desc}</div>
      </td>
    </tr>"""


# ─── 1. WELCOME EMAIL ─────────────────────────────────────────────────────────

async def send_welcome_email(to_email: str, full_name: str) -> None:
    """Full onboarding welcome — sent ~2 minutes after signup."""
    await asyncio.sleep(120)   # Let verification OTP land first

    first = full_name.split()[0] if full_name else "there"

    features = (
        _feature_row("🎬", "AI Script Generation",
            "Describe your topic and watch a full voiceover script appear in real time — tailored to your platform and audience.") +
        _feature_row("🖼️", "Auto Stock Footage",
            "Every scene is matched with relevant Pexels stock footage automatically. No searching, no downloading.") +
        _feature_row("🎙️", "Voice Synthesis + Custom Recording",
            "Choose from a library of AI voices or record your own. Your audio is processed and noise-reduced automatically.") +
        _feature_row("📱", "Every Platform, Perfect Dimensions",
            "TikTok, Instagram Reels, YouTube Shorts, LinkedIn, Pinterest — every video renders at the exact right size.") +
        _feature_row("🎥", "Ken Burns & Pan Motion Effects",
            "Cinematic zoom and pan effects make static images feel alive. No editing skills needed.") +
        _feature_row("🏢", "Agency Mode",
            "Manage multiple client projects, brand kits, and team members with shared token pools and client review links.")
    )

    html = _wrap(
        _header("Welcome to SceneForge", "Your AI video studio is ready") +
        f"""<tr><td style="padding:36px 40px">
          <p style="margin:0 0 6px;font-size:17px;color:#fff;font-weight:700">Hey {first} 👋</p>
          <p style="margin:0 0 20px;font-size:14px;color:rgba(255,255,255,0.55);line-height:1.7">
            Welcome to SceneForge — the fastest way to turn ideas into publish-ready short-form videos.
            Your account is live and you've got <strong style="color:#2DD4BF">1,000 free tokens</strong> to get started.
          </p>

          <!-- Token highlight -->
          <div style="background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.3);
            border-radius:12px;padding:18px 24px;margin-bottom:28px;text-align:center">
            <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#a78bfa;text-transform:uppercase;letter-spacing:.1em">Your starting balance</p>
            <p style="margin:0;font-size:40px;font-weight:800;color:#fff;letter-spacing:-1px">1,000 <span style="font-size:18px;color:rgba(255,255,255,0.4)">tokens</span></p>
            <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,0.35)">Each full video render = 100 tokens = 10 free videos</p>
          </div>

          <p style="margin:0 0 16px;font-size:13px;font-weight:700;color:rgba(255,255,255,0.6);
            text-transform:uppercase;letter-spacing:.08em">What you can do with SceneForge</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
            {features}
          </table>

          <!-- Quick start steps -->
          <div style="background:rgba(45,212,191,0.07);border:1px solid rgba(45,212,191,0.2);
            border-radius:12px;padding:20px 24px;margin-bottom:28px">
            <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#2DD4BF;text-transform:uppercase;letter-spacing:.08em">🚀 Make your first video in 5 steps</p>
            <ol style="margin:0;padding-left:18px;color:rgba(255,255,255,0.6);font-size:13px;line-height:1.8">
              <li>Choose your niche and target platform</li>
              <li>Pick an AI-generated video concept</li>
              <li>Generate (or write) your script</li>
              <li>Review your auto-generated scenes</li>
              <li>Pick a voice, hit Render — done in minutes</li>
            </ol>
          </div>

          {_cta("Create My First Video →", APP_URL)}

          <p style="margin:24px 0 0;font-size:12px;color:rgba(255,255,255,0.3);text-align:center;line-height:1.6">
            Questions? Reply to this email — we read every one.<br>
            <a href="{APP_URL}" style="color:rgba(167,139,250,0.5);text-decoration:none">sceneraforge.com</a>
          </p>
        </td></tr>""" +
        _footer()
    )

    text = f"""Hey {first},

Welcome to SceneForge! Your account is live and you have 1,000 free tokens to get started (each video = 100 tokens).

WHAT YOU CAN DO:
• AI Script Generation — describe your topic, get a full script in seconds
• Auto Stock Footage — every scene matched with Pexels clips automatically
• Voice Synthesis — AI voices + in-browser recording with noise reduction
• Every Platform — TikTok, Instagram, YouTube, LinkedIn, all perfect dimensions
• Motion Effects — Ken Burns zoom and pan for cinematic feel
• Agency Mode — manage clients, brand kits, and teams

QUICK START (5 steps):
1. Choose your niche and platform
2. Pick an AI video concept
3. Generate your script
4. Review your scenes
5. Pick a voice and render — done in minutes

Create your first video: {APP_URL}

— The SceneForge Team
"""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _send, to_email,
                               f"🎬 Welcome to SceneForge, {first}! Here's what you can do", html, text)
    logger.info("Welcome email sent to %s", to_email)


# ─── 2. ZERO-RENDER NUDGE (24h after signup) ─────────────────────────────────

async def send_zero_render_nudge(to_email: str, full_name: str, tokens: int) -> None:
    """Sent 24h after signup if the user hasn't rendered a single video."""
    first = full_name.split()[0] if full_name else "there"

    html = _wrap(
        _header("Your first video is waiting", "") +
        f"""<tr><td style="padding:36px 40px">
          <p style="margin:0 0 6px;font-size:17px;color:#fff;font-weight:700">Hey {first} 👋</p>
          <p style="margin:0 0 20px;font-size:14px;color:rgba(255,255,255,0.55);line-height:1.7">
            You signed up for SceneForge yesterday but haven't created your first video yet.
            Your <strong style="color:#2DD4BF">{tokens:,} tokens</strong> are still sitting there — let's put them to work.
          </p>

          <div style="background:rgba(124,58,237,0.1);border-left:3px solid #7C3AED;
            border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:24px">
            <p style="margin:0;font-size:13.5px;color:rgba(255,255,255,0.75);line-height:1.7">
              ⏱️ <strong style="color:#fff">It takes about 3 minutes</strong> from blank page to a ready-to-post video.
              SceneForge handles the script, footage, voiceover, and editing automatically.
            </p>
          </div>

          <div style="margin-bottom:24px">
            <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:.08em">Most popular first videos</p>
            {"".join([
              f'<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:rgba(255,255,255,0.03);border-radius:8px;margin-bottom:8px">'
              f'<span style="font-size:20px">{e}</span>'
              f'<span style="font-size:13px;color:rgba(255,255,255,0.65)">{t}</span>'
              f'</div>'
              for e, t in [
                ("🏋️", "5-minute home workout — for fitness creators"),
                ("💰", "How to save money fast — for finance creators"),
                ("📱", "3 apps I use every day — for tech creators"),
                ("🍳", "Quick 15-minute recipe — for food creators"),
              ]
            ])}
          </div>

          {_cta("Create My First Video →", APP_URL)}
        </td></tr>""" +
        _footer()
    )

    text = f"""Hey {first},

You signed up for SceneForge but haven't created your first video yet.
Your {tokens:,} tokens are ready to use — each video takes about 3 minutes.

SceneForge writes the script, finds footage, generates voiceover, and renders the video for you.

Create your first video: {APP_URL}

— The SceneForge Team
"""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _send, to_email,
                               f"⏳ {first}, your first SceneForge video is 3 minutes away", html, text)
    logger.info("Zero-render nudge sent to %s", to_email)


# ─── 3. INACTIVE 5-DAY ───────────────────────────────────────────────────────

async def send_inactive_5day(to_email: str, full_name: str, tokens: int, last_niche: str = "") -> None:
    """5 days since last render."""
    first = full_name.split()[0] if full_name else "there"
    niche_line = f"We noticed your last video was in the <strong style='color:#a78bfa'>{last_niche}</strong> space. " if last_niche else ""

    html = _wrap(
        _header("We miss you at SceneForge 👋", "") +
        f"""<tr><td style="padding:36px 40px">
          <p style="margin:0 0 6px;font-size:17px;color:#fff;font-weight:700">Hey {first},</p>
          <p style="margin:0 0 20px;font-size:14px;color:rgba(255,255,255,0.55);line-height:1.7">
            It's been 5 days since you last created a video. {niche_line}
            You still have <strong style="color:#2DD4BF">{tokens:,} tokens</strong> ready to use.
          </p>

          <div style="background:rgba(45,212,191,0.08);border:1px solid rgba(45,212,191,0.2);
            border-radius:12px;padding:20px 24px;margin-bottom:24px">
            <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#2DD4BF">💡 What creators are making this week</p>
            <ul style="margin:0;padding-left:16px;color:rgba(255,255,255,0.6);font-size:13px;line-height:1.9">
              <li>Quick tutorial videos that get 10x more saves than longer content</li>
              <li>"Did you know?" educational clips — easiest type to script with AI</li>
              <li>Behind-the-scenes content — authentic and fast to make</li>
              <li>Product demos with screen capture visuals</li>
            </ul>
          </div>

          <p style="margin:0 0 8px;font-size:13px;color:rgba(255,255,255,0.45);line-height:1.6">
            Consistency is the key to growing on short-form platforms. Even one video a week
            compounds into a strong content library over time.
          </p>

          {_cta("Jump Back In →", APP_URL)}
        </td></tr>""" +
        _footer()
    )

    text = f"""Hey {first},

It's been 5 days since your last SceneForge video. You have {tokens:,} tokens ready.

Creators who post consistently — even once a week — see the best results. One video takes 3 minutes.

Back to SceneForge: {APP_URL}

— The SceneForge Team
"""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _send, to_email,
                               f"🎬 {first}, it's been 5 days — ready to create again?", html, text)
    logger.info("5-day inactive email sent to %s", to_email)


# ─── 4. INACTIVE 14-DAY ──────────────────────────────────────────────────────

async def send_inactive_14day(to_email: str, full_name: str, tokens: int) -> None:
    """14 days without a render — deeper re-engagement."""
    first = full_name.split()[0] if full_name else "there"

    html = _wrap(
        _header("Still thinking about it?", "") +
        f"""<tr><td style="padding:36px 40px">
          <p style="margin:0 0 6px;font-size:17px;color:#fff;font-weight:700">Hey {first},</p>
          <p style="margin:0 0 20px;font-size:14px;color:rgba(255,255,255,0.55);line-height:1.7">
            Two weeks is a long time in the content game. We'd love to see you back on SceneForge.
            Your <strong style="color:#2DD4BF">{tokens:,} tokens</strong> are still here — they never expire.
          </p>

          <div style="background:rgba(255,255,255,0.04);border-radius:12px;padding:20px 24px;margin-bottom:24px">
            <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#fff">
              🤔 Is something holding you back?
            </p>
            <p style="margin:0 0 10px;font-size:13px;color:rgba(255,255,255,0.55);line-height:1.6">
              Common reasons people pause — and what actually helps:
            </p>
            {"".join([
              f'<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05)">'
              f'<span style="font-size:12px;color:#a78bfa;font-weight:700">{issue}</span>'
              f'<span style="font-size:12.5px;color:rgba(255,255,255,0.5);margin-left:8px">{fix}</span>'
              f'</div>'
              for issue, fix in [
                ('"I don\'t know what to make"', '→ SceneForge generates 6 ideas for you'),
                ('"I don\'t have time"', '→ A full video takes 3–5 minutes'),
                ('"I\'m not sure the quality is good enough"', '→ Try one scene preview — it\'s free'),
                ('"I\'m not a video person"', '→ You don\'t need to be — AI does the work'),
              ]
            ])}
          </div>

          {_cta("Come Back and Create →", APP_URL)}

          <p style="margin:20px 0 0;font-size:12px;color:rgba(255,255,255,0.25);text-align:center">
            Reply to this email if there's anything we can help with.
          </p>
        </td></tr>""" +
        _footer()
    )

    text = f"""Hey {first},

It's been 2 weeks since your last SceneForge video. Your {tokens:,} tokens never expire.

Common blockers — and fixes:
• "I don't know what to make" → SceneForge generates 6 ideas for you
• "I don't have time" → 3–5 minutes per video
• "Not sure about quality" → preview one scene free
• "I'm not a video person" → AI handles everything

Reply to this email if there's anything we can help with.

Back to SceneForge: {APP_URL}

— The SceneForge Team
"""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _send, to_email,
                               f"📹 {first}, still thinking about SceneForge?", html, text)
    logger.info("14-day inactive email sent to %s", to_email)


# ─── 5. INACTIVE 30-DAY (final) ──────────────────────────────────────────────

async def send_inactive_30day(to_email: str, full_name: str, tokens: int) -> None:
    """30 days inactive — final re-engagement with urgency."""
    first = full_name.split()[0] if full_name else "there"

    html = _wrap(
        _header("One last nudge from us", "") +
        f"""<tr><td style="padding:36px 40px">
          <p style="margin:0 0 6px;font-size:17px;color:#fff;font-weight:700">Hey {first},</p>
          <p style="margin:0 0 20px;font-size:14px;color:rgba(255,255,255,0.55);line-height:1.7">
            It's been a month since you've been on SceneForge. We're not going to spam you —
            this is our last nudge for a while. But we do want you to know your
            <strong style="color:#2DD4BF">{tokens:,} tokens</strong> are still waiting,
            and the platform has had some significant updates since you last logged in.
          </p>

          <div style="background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.25);
            border-radius:12px;padding:20px 24px;margin-bottom:24px">
            <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#a78bfa">✨ What's new since you left</p>
            <ul style="margin:0;padding-left:16px;color:rgba(255,255,255,0.6);font-size:13px;line-height:1.9">
              <li>Faster rendering — most videos now complete in under 2 minutes</li>
              <li>Custom voice recording — record directly in your browser</li>
              <li>Agency Mode — manage clients and teams</li>
              <li>More platforms — LinkedIn, Pinterest, Snapchat now supported</li>
            </ul>
          </div>

          {_cta("Take Another Look →", APP_URL)}

          <p style="margin:20px 0 0;font-size:12px;color:rgba(255,255,255,0.2);text-align:center">
            We won't send re-engagement emails after this. Your account and tokens remain active forever.
          </p>
        </td></tr>""" +
        _footer()
    )

    text = f"""Hey {first},

It's been a month. This is our last re-engagement email for a while.

Your {tokens:,} tokens are still here — they never expire. And there's been some improvements:
• Faster rendering — most videos under 2 minutes
• Custom voice recording in the browser
• Agency Mode for managing clients
• More platforms — LinkedIn, Pinterest, Snapchat

Take another look: {APP_URL}

Your account stays active indefinitely.

— The SceneForge Team
"""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _send, to_email,
                               f"🌟 {first}, one last note from SceneForge", html, text)
    logger.info("30-day inactive email sent to %s", to_email)


# ─── Campaign runner — called from admin endpoint ──────────────────────────────

async def run_engagement_campaign(redis) -> dict:
    """
    Scan all users and send the appropriate lifecycle email based on their status.
    Returns a summary of actions taken.
    Safe to run repeatedly — Redis flags prevent double-sending.
    """
    from app.services.auth_service import TOKENS_ON_SIGNUP
    now = datetime.now(timezone.utc)
    results = {
        "scanned": 0,
        "welcome_sent": 0,
        "zero_render_sent": 0,
        "inactive_5d_sent": 0,
        "inactive_14d_sent": 0,
        "inactive_30d_sent": 0,
        "skipped": 0,
        "errors": 0,
    }

    cursor = 0
    while True:
        cursor, keys = await redis.scan(cursor, match="user:*", count=200)
        for key in keys:
            if isinstance(key, bytes): key = key.decode()
            if key.count(":") != 1:
                continue
            raw = await redis.get(key)
            if not raw:
                continue
            try:
                ud = json.loads(raw)
                uid = ud.get("id", "")
                email = ud.get("email", "")
                name = ud.get("full_name", "")
                tokens = ud.get("tokens_remaining", TOKENS_ON_SIGNUP)
                videos = ud.get("videos_created", 0)
                created_str = ud.get("created_at", "")
                verified = ud.get("email_verified", False)

                if not email or not uid or not verified:
                    results["skipped"] += 1
                    continue

                results["scanned"] += 1

                # Parse created_at
                try:
                    created_at = datetime.fromisoformat(created_str.replace("Z","")).replace(tzinfo=timezone.utc)
                except Exception:
                    created_at = now - timedelta(days=1)

                age_days = (now - created_at).total_seconds() / 86400

                # Last render time
                last_render_raw = await redis.get(f"user:{uid}:last_render_at")
                last_render_str = last_render_raw.decode() if isinstance(last_render_raw, bytes) else (last_render_raw or "")
                try:
                    last_render = datetime.fromisoformat(last_render_str.replace("Z","")).replace(tzinfo=timezone.utc) if last_render_str else None
                except Exception:
                    last_render = None

                days_inactive = (now - last_render).total_seconds() / 86400 if last_render else age_days

                # Last niche for personalisation
                last_niche = ""
                try:
                    ln = await redis.get(f"user:{uid}:last_niche")
                    last_niche = (ln.decode() if isinstance(ln, bytes) else ln) or ""
                except Exception:
                    pass

                # ── Zero-render nudge — 24h+ since signup, never rendered ─────
                if videos == 0 and age_days >= 1.0:
                    flag = f"campaign:zero_render:{uid}"
                    if not await redis.exists(flag):
                        await send_zero_render_nudge(email, name, tokens)
                        await redis.set(flag, "1", ex=60*60*24*90)
                        results["zero_render_sent"] += 1
                        continue

                # ── Inactive 5-day ────────────────────────────────────────────
                if days_inactive >= 5 and days_inactive < 14:
                    flag = f"campaign:inactive_5d:{uid}"
                    if not await redis.exists(flag):
                        await send_inactive_5day(email, name, tokens, last_niche)
                        await redis.set(flag, "1", ex=60*60*24*30)
                        results["inactive_5d_sent"] += 1
                        continue

                # ── Inactive 14-day ───────────────────────────────────────────
                if days_inactive >= 14 and days_inactive < 30:
                    flag = f"campaign:inactive_14d:{uid}"
                    if not await redis.exists(flag):
                        await send_inactive_14day(email, name, tokens)
                        await redis.set(flag, "1", ex=60*60*24*30)
                        results["inactive_14d_sent"] += 1
                        continue

                # ── Inactive 30-day ───────────────────────────────────────────
                if days_inactive >= 30:
                    flag = f"campaign:inactive_30d:{uid}"
                    if not await redis.exists(flag):
                        await send_inactive_30day(email, name, tokens)
                        await redis.set(flag, "1", ex=60*60*24*60)
                        results["inactive_30d_sent"] += 1
                        continue

                results["skipped"] += 1

            except Exception as e:
                logger.error("Campaign error for key %s: %s", key, e)
                results["errors"] += 1

        if cursor == 0:
            break

    total_sent = sum(v for k, v in results.items() if k.endswith("_sent"))
    logger.info("Engagement campaign complete — %d scanned, %d emails sent", results["scanned"], total_sent)
    return results
