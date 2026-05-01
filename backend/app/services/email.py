from __future__ import annotations

import logging
import os
import httpx

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

BREVO_API_KEY = os.environ.get("BREVO_API_KEY", "")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")


async def _send(to: str, subject: str, html: str, text: str) -> None:
    from_email = settings.email_from or "hello.sceneforge@gmail.com"
    from_name = settings.email_from_name or "SceneForge"

    # Try Brevo first (supports Gmail sender, no domain needed)
    if BREVO_API_KEY:
        await _send_brevo(to, subject, html, text, from_email, from_name)
        return

    # Fallback to Resend (requires verified domain)
    if RESEND_API_KEY:
        await _send_resend(to, subject, html, text, from_email, from_name)
        return

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
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://api.brevo.com/v3/smtp/email",
                headers={
                    "api-key": BREVO_API_KEY,
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            if resp.status_code in (200, 201):
                logger.info("Email sent via Brevo to %s: %s", to, subject)
            else:
                logger.error("Brevo API error %d: %s", resp.status_code, resp.text)
                _log_otp_fallback(to, subject)
    except Exception as e:
        logger.error("Brevo send failed: %s", e)
        _log_otp_fallback(to, subject)


async def _send_resend(to, subject, html, text, from_email, from_name):
    payload = {
        "from": f"{from_name} <onboarding@resend.dev>",
        "to": [to],
        "subject": subject,
        "html": html,
        "text": text,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}",
                         "Content-Type": "application/json"},
                json=payload,
            )
            if resp.status_code in (200, 201):
                logger.info("Email sent via Resend to %s: %s", to, subject)
            else:
                logger.error("Resend API error %d: %s", resp.status_code, resp.text)
                _log_otp_fallback(to, subject)
    except Exception as e:
        logger.error("Resend send failed: %s", e)
        _log_otp_fallback(to, subject)


def _log_otp_fallback(to: str, subject: str) -> None:
    import re
    match = re.search(r'\b(\d{6})\b', subject)
    if match:
        logger.warning("=" * 50)
        logger.warning("EMAIL FAILED — OTP for %s is: %s", to, match.group(1))
        logger.warning("=" * 50)


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
