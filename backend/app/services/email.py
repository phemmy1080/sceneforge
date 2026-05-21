from __future__ import annotations

import logging
import os
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import httpx

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

# Provider API keys (optional — falls back to SMTP if not set)
BREVO_API_KEY  = os.environ.get("BREVO_API_KEY", "")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")

# Gmail SMTP (always available as final fallback)
SMTP_HOST     = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT     = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER     = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")


async def _send(to: str, subject: str, html: str, text: str) -> None:
    from_email = getattr(settings, "email_from", None) or SMTP_USER or "hello.sceneforge@gmail.com"
    from_name  = getattr(settings, "email_from_name", None) or "SceneForge"

    # 1. Brevo (preferred — no domain verification needed)
    if BREVO_API_KEY:
        try:
            await _send_brevo(to, subject, html, text, from_email, from_name)
            return
        except Exception as e:
            logger.error("Brevo failed, trying next provider: %s", e)

    # 2. Resend
    if RESEND_API_KEY:
        try:
            await _send_resend(to, subject, html, text, from_email, from_name)
            return
        except Exception as e:
            logger.error("Resend failed, trying SMTP: %s", e)

    # 3. Gmail SMTP (uses your SMTP_USER + SMTP_PASSWORD env vars)
    if SMTP_USER and SMTP_PASSWORD:
        try:
            await _send_smtp(to, subject, html, text, from_email, from_name)
            return
        except Exception as e:
            logger.error("SMTP failed: %s", e)

    # All providers failed
    logger.warning("No email provider configured — email not sent to %s", to)
    _log_otp_fallback(to, subject)


async def _send_brevo(to, subject, html, text, from_email, from_name):
    payload = {
        "sender": {"name": from_name, "email": from_email},
        "to": [{"email": to}],
        "subject": subject,
        "htmlContent": html,
        "textContent": text,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={"api-key": BREVO_API_KEY, "Content-Type": "application/json"},
            json=payload,
        )
        if resp.status_code in (200, 201):
            logger.info("Email sent via Brevo → %s: %s", to, subject)
        else:
            logger.error("Brevo error %d: %s", resp.status_code, resp.text)
            _log_otp_fallback(to, subject)
            raise Exception(f"Brevo HTTP {resp.status_code}")


async def _send_resend(to, subject, html, text, from_email, from_name):
    payload = {
        "from": f"{from_name} <onboarding@resend.dev>",
        "to": [to],
        "subject": subject,
        "html": html,
        "text": text,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}",
                     "Content-Type": "application/json"},
            json=payload,
        )
        if resp.status_code in (200, 201):
            logger.info("Email sent via Resend → %s: %s", to, subject)
        else:
            logger.error("Resend error %d: %s", resp.status_code, resp.text)
            _log_otp_fallback(to, subject)
            raise Exception(f"Resend HTTP {resp.status_code}")


async def _send_smtp(to, subject, html, text, from_email, from_name):
    """Send via Gmail SMTP using SMTP_USER + SMTP_PASSWORD env vars."""
    import asyncio

    def _do_send():
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = f"{from_name} <{from_email}>"
        msg["To"]      = to
        msg.attach(MIMEText(text, "plain"))
        msg.attach(MIMEText(html,  "html"))

        context = ssl.create_default_context()
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.ehlo()
            server.starttls(context=context)
            server.ehlo()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(from_email, to, msg.as_string())

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _do_send)
    logger.info("Email sent via SMTP → %s: %s", to, subject)


def _log_otp_fallback(to: str, subject: str) -> None:
    import re
    match = re.search(r'\b(\d{6})\b', subject)
    if match:
        logger.warning("=" * 50)
        logger.warning("EMAIL FAILED — OTP for %s is: %s", to, match.group(1))
        logger.warning("=" * 50)


# ── Email templates ───────────────────────────────────────────────────────────

async def send_verification_otp(to_email: str, full_name: str, otp: str) -> None:
    subject = f"Your SceneForge verification code: {otp}"
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#080810;font-family:Arial,sans-serif;color:#F0F0FF">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080810;padding:40px 0">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#111118;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden">
        <tr><td style="background:linear-gradient(135deg,#1a0d33,#0a1a2e);padding:28px 40px;text-align:center">
          <h1 style="margin:0;font-size:24px;font-weight:800;color:#fff">Scene<span style="color:#A78BFA">Forge</span></h1>
          <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.45)">Verify your email address</p>
        </td></tr>
        <tr><td style="padding:36px 40px;text-align:center">
          <p style="margin:0 0 6px;font-size:15px;color:rgba(255,255,255,0.8)">Hi {full_name},</p>
          <p style="margin:0 0 28px;font-size:13px;color:rgba(255,255,255,0.45);line-height:1.6">Enter this code to verify your SceneForge account.</p>
          <div style="background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.3);border-radius:14px;padding:28px 40px;display:inline-block;margin-bottom:28px">
            <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#c9a84c;text-transform:uppercase;letter-spacing:.15em">Verification code</p>
            <p style="margin:0;font-size:48px;font-weight:800;letter-spacing:12px;color:#fff;font-family:monospace">{otp}</p>
          </div>
          <p style="margin:0 0 8px;font-size:13px;color:rgba(255,255,255,0.35)">Expires in <strong style="color:rgba(255,255,255,0.6)">15 minutes</strong>.</p>
          <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.25)">If you didn't create a SceneForge account, ignore this email.</p>
        </td></tr>
        <tr><td style="padding:16px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.2)">SceneForge · AI Video Studio</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""
    text = f"Hi {full_name},\n\nYour SceneForge verification code is: {otp}\n\nExpires in 15 minutes.\n\n— SceneForge"
    await _send(to_email, subject, html, text)


async def send_password_reset(to_email: str, full_name: str, reset_url: str) -> None:
    subject = "Reset your SceneForge password"
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#080810;font-family:Arial,sans-serif;color:#F0F0FF">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080810;padding:40px 0">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#111118;border-radius:16px;border:1px solid rgba(255,255,255,0.08)">
        <tr><td style="background:linear-gradient(135deg,#1a0d33,#0a1a2e);padding:28px 40px;text-align:center">
          <h1 style="margin:0;font-size:24px;font-weight:800;color:#fff">Scene<span style="color:#A78BFA">Forge</span></h1>
          <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.45)">Password reset request</p>
        </td></tr>
        <tr><td style="padding:36px 40px;text-align:center">
          <p style="margin:0 0 28px;font-size:15px;color:rgba(255,255,255,0.8)">Hi {full_name}, click below to reset your password.</p>
          <a href="{reset_url}" style="display:inline-block;background:#7C5CFF;color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-size:14px;font-weight:700;margin-bottom:24px">
            Reset my password →
          </a>
          <p style="margin:0 0 8px;font-size:13px;color:rgba(255,255,255,0.35)">Expires in <strong style="color:rgba(255,255,255,0.6)">1 hour</strong>.</p>
          <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.25)">Didn't request this? Ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""
    text = f"Hi {full_name},\n\nReset your password: {reset_url}\n\nExpires in 1 hour.\n\n— SceneForge"
    await _send(to_email, subject, html, text)


async def send_token_confirmation(
    to_email: str, full_name: str, tokens_added: int, tokens_total: int,
    amount: int, currency: str, plan_label: str, transaction_id: str,
) -> None:
    subject = f"✅ {tokens_added} tokens added to your SceneForge account"
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#080810;font-family:Arial,sans-serif;color:#F0F0FF">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080810;padding:40px 0">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#111118;border-radius:16px;border:1px solid rgba(255,255,255,0.08)">
        <tr><td style="background:linear-gradient(135deg,#1a0d33,#0a1a2e);padding:28px 40px;text-align:center">
          <h1 style="margin:0;font-size:24px;font-weight:800;color:#fff">Scene<span style="color:#A78BFA">Forge</span></h1>
        </td></tr>
        <tr><td style="padding:36px 40px;text-align:center">
          <p style="margin:0 0 24px;font-size:15px;color:rgba(255,255,255,0.8)">Hi {full_name}, your payment was successful!</p>
          <div style="background:rgba(45,212,191,0.1);border:1px solid rgba(45,212,191,0.25);border-radius:12px;padding:24px;margin-bottom:24px">
            <p style="margin:0 0 4px;font-size:13px;color:#2DD4BF;font-weight:600;text-transform:uppercase">Tokens added</p>
            <p style="margin:0;font-size:48px;font-weight:800;color:#fff">+{tokens_added:,}</p>
            <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,0.4)">New balance: <strong style="color:rgba(255,255,255,0.75)">{tokens_total:,} tokens</strong></p>
          </div>
          <p style="font-size:13px;color:rgba(255,255,255,0.4)">Plan: {plan_label} · {currency} {amount:,} · TX: {transaction_id}</p>
          <a href="{settings.frontend_origin}" style="display:inline-block;background:#7C5CFF;color:#fff;text-decoration:none;padding:13px 32px;border-radius:10px;font-size:14px;font-weight:600">
            Start creating →
          </a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""
    text = f"Hi {full_name},\n\n+{tokens_added:,} tokens added. Balance: {tokens_total:,}.\nPlan: {plan_label} · {currency} {amount:,}\nTX: {transaction_id}\n\n— SceneForge"
    await _send(to_email, subject, html, text)


async def send_render_complete(
    to_email: str,
    full_name: str,
    project_title: str,
    scene_count: int,
    duration: int,
    video_url: str,
    tokens_remaining: int,
) -> None:
    """Send render complete notification email."""
    app_url = settings.frontend_origin
    subject = f'🎬 Your video "{project_title}" is ready!'
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#080810;font-family:Arial,sans-serif;color:#F0F0FF">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080810;padding:40px 0">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0"
        style="background:#111118;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden">
        <tr><td style="background:linear-gradient(135deg,#1a0d33,#0a1a2e);padding:28px 40px;text-align:center">
          <h1 style="margin:0;font-size:24px;font-weight:800;color:#fff">
            Scene<span style="color:#A78BFA">Forge</span>
          </h1>
          <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.45)">Your video is ready</p>
        </td></tr>
        <tr><td style="padding:36px 40px;text-align:center">
          <div style="font-size:48px;margin-bottom:16px">🎬</div>
          <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#fff">{project_title}</h2>
          <p style="margin:0 0 28px;font-size:13px;color:rgba(255,255,255,0.45)">
            Hi {full_name}, your video has finished rendering and is ready to download.
          </p>
          <div style="background:rgba(45,212,191,0.08);border:1px solid rgba(45,212,191,0.2);
            border-radius:12px;padding:16px 24px;display:inline-block;margin-bottom:28px">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="text-align:center;padding:0 16px">
                <p style="margin:0;font-size:24px;font-weight:800;color:#fff">{scene_count}</p>
                <p style="margin:4px 0 0;font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:.08em">Scenes</p>
              </td>
              <td style="width:1px;background:rgba(255,255,255,0.08)"></td>
              <td style="text-align:center;padding:0 16px">
                <p style="margin:0;font-size:24px;font-weight:800;color:#fff">{duration}s</p>
                <p style="margin:4px 0 0;font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:.08em">Duration</p>
              </td>
              <td style="width:1px;background:rgba(255,255,255,0.08)"></td>
              <td style="text-align:center;padding:0 16px">
                <p style="margin:0;font-size:24px;font-weight:800;color:#2DD4BF">{tokens_remaining:,}</p>
                <p style="margin:4px 0 0;font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:.08em">Tokens left</p>
              </td>
            </tr></table>
          </div><br>
          <a href="{app_url}" style="display:inline-block;background:#7C5CFF;color:#fff;
            text-decoration:none;padding:14px 36px;border-radius:10px;
            font-size:14px;font-weight:700;margin-bottom:16px">
            Download your video →
          </a>
          <p style="margin:8px 0 0;font-size:12px;color:rgba(255,255,255,0.25)">
            Open SceneForge → Export step to download your video, scenes, or CapCut package.
          </p>
        </td></tr>
        <tr><td style="padding:16px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.2)">SceneForge · AI Video Studio</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""
    text = (
        f"Hi {full_name},\n\n"
        f'Your video "{project_title}" is ready!\n\n'
        f"{scene_count} scenes · {duration}s · {tokens_remaining:,} tokens remaining\n\n"
        f"Open SceneForge to download: {app_url}\n\n"
        f"— SceneForge"
    )
    await _send(to_email, subject, html, text)

async def send_client_approved(
    to_email: str,
    owner_name: str,
    client_name: str,
    project_title: str,
    project_url: str,
    client_message: str = "",
) -> None:
    """Notify the workspace owner that a client approved their video."""
    subject = f"✅ {client_name} approved “{project_title}”"
    msg_block = ""
    if client_message.strip():
        msg_block = f"""
          <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px 20px;margin:0 0 24px;text-align:left">
            <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:.1em">Client message</p>
            <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.75);line-height:1.6;font-style:italic">"{client_message}"</p>
          </div>"""

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#080810;font-family:Arial,sans-serif;color:#F0F0FF">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080810;padding:40px 0">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#111118;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden">
        <tr><td style="background:linear-gradient(135deg,#0a2010,#0a1a2e);padding:28px 40px;text-align:center">
          <h1 style="margin:0;font-size:24px;font-weight:800;color:#fff">Scene<span style="color:#A78BFA">Forge</span></h1>
          <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.45)">Agency workspace</p>
        </td></tr>
        <tr><td style="padding:36px 40px;text-align:center">
          <div style="font-size:48px;margin-bottom:16px">&#x2705;</div>
          <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#fff">Client approved!</h2>
          <p style="margin:0 0 24px;font-size:14px;color:rgba(255,255,255,0.5);line-height:1.6">
            Hi {owner_name}, <strong style="color:rgba(255,255,255,0.8)">{client_name}</strong> has approved
            <strong style="color:rgba(255,255,255,0.8)">{project_title}</strong>.<br>
            The project is ready to render and export.
          </p>
          {msg_block}
          <a href="{project_url}" style="display:inline-block;background:#4ade80;color:#052e16;font-size:14px;font-weight:700;padding:14px 32px;border-radius:12px;text-decoration:none;margin-bottom:24px">
            Open project &rarr;
          </a>
          <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.25)">
            Next step: render the final video and export the MP4.
          </p>
        </td></tr>
        <tr><td style="padding:16px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.2)">SceneForge Agency &middot; You are receiving this because you are the workspace owner</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""
    text = (
        f"Hi {owner_name},\n\n"
        f"{client_name} has approved \"{project_title}\". "
        f"The project is ready to render and export.\n\n"
        + (f"Client message: {client_message}\n\n" if client_message.strip() else "")
        + f"Open project: {project_url}\n\n\u2014 SceneForge"
    )
    await _send(to_email, subject, html, text)


async def send_client_changes_requested(
    to_email: str,
    owner_name: str,
    client_name: str,
    project_title: str,
    project_url: str,
    client_message: str = "",
) -> None:
    """Notify the workspace owner that a client requested changes."""
    subject = f"🔄 {client_name} requested changes on “{project_title}”"
    msg_block = ""
    if client_message.strip():
        msg_block = f"""
          <div style="background:rgba(255,190,11,0.06);border:1px solid rgba(255,190,11,0.2);border-radius:12px;padding:16px 20px;margin:0 0 24px;text-align:left">
            <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:rgba(255,190,11,0.6);text-transform:uppercase;letter-spacing:.1em">Client feedback</p>
            <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.75);line-height:1.6;font-style:italic">"{client_message}"</p>
          </div>"""

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#080810;font-family:Arial,sans-serif;color:#F0F0FF">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080810;padding:40px 0">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#111118;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden">
        <tr><td style="background:linear-gradient(135deg,#1a1000,#0a1a2e);padding:28px 40px;text-align:center">
          <h1 style="margin:0;font-size:24px;font-weight:800;color:#fff">Scene<span style="color:#A78BFA">Forge</span></h1>
          <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.45)">Agency workspace</p>
        </td></tr>
        <tr><td style="padding:36px 40px;text-align:center">
          <div style="font-size:48px;margin-bottom:16px">&#x1f504;</div>
          <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#fff">Changes requested</h2>
          <p style="margin:0 0 24px;font-size:14px;color:rgba(255,255,255,0.5);line-height:1.6">
            Hi {owner_name}, <strong style="color:rgba(255,255,255,0.8)">{client_name}</strong> has reviewed
            <strong style="color:rgba(255,255,255,0.8)">{project_title}</strong> and requested changes.
          </p>
          {msg_block}
          <a href="{project_url}" style="display:inline-block;background:#c9a84c;color:#1a0f00;font-size:14px;font-weight:700;padding:14px 32px;border-radius:12px;text-decoration:none;margin-bottom:24px">
            View feedback &rarr;
          </a>
          <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.25)">
            Read the client's scene notes, make edits, re-render, and send a new review link.
          </p>
        </td></tr>
        <tr><td style="padding:16px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.2)">SceneForge Agency &middot; You are receiving this because you are the workspace owner</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""
    text = (
        f"Hi {owner_name},\n\n"
        f"{client_name} has requested changes on \"{project_title}\".\n\n"
        + (f"Their feedback: {client_message}\n\n" if client_message.strip() else "")
        + f"Open project to review notes: {project_url}\n\n\u2014 SceneForge"
    )
    await _send(to_email, subject, html, text)
