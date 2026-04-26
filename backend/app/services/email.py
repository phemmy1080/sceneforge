from __future__ import annotations

import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


def _send(to: str, subject: str, html: str, text: str) -> None:
    """Send an email via SMTP. Runs synchronously — call from executor."""
    if not settings.smtp_user or not settings.smtp_password:
        logger.warning("SMTP not configured — email not sent to %s", to)
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"{settings.email_from_name} <{settings.email_from or settings.smtp_user}>"
    msg["To"]      = to

    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
            server.ehlo()
            server.starttls()
            server.login(settings.smtp_user, settings.smtp_password)
            server.sendmail(settings.smtp_user, to, msg.as_string())
        logger.info("Email sent to %s: %s", to, subject)
    except Exception as e:
        logger.error("Failed to send email to %s: %s", to, e)
        # Always print OTP to console as fallback so dev can test
        if "Verification code" in subject or "verification code" in subject:
            import re
            match = re.search(r'\b(\d{6})\b', subject)
            if match:
                logger.warning("=" * 50)
                logger.warning("EMAIL FAILED — OTP for %s is: %s", to, match.group(1))
                logger.warning("=" * 50)


async def send_token_confirmation(
    to_email: str,
    full_name: str,
    tokens_added: int,
    tokens_total: int,
    amount: int,
    currency: str,
    plan_label: str,
    transaction_id: str,
) -> None:
    """Send payment confirmation + token top-up email."""
    import asyncio
    loop = asyncio.get_event_loop()

    subject = f"✅ {tokens_added} tokens added to your SceneForge account"

    html = f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#080810;font-family:'DM Sans',Arial,sans-serif;color:#F0F0FF">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080810;padding:40px 0">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#111118;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#1a0d33,#0a1a2e);padding:32px 40px;text-align:center">
          <h1 style="margin:0;font-size:26px;font-weight:800;letter-spacing:-1px;color:#fff">
            Scene<span style="color:#A78BFA">Forge</span>
          </h1>
          <p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,0.5)">Payment confirmed</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:36px 40px">
          <p style="margin:0 0 8px;font-size:16px;color:rgba(255,255,255,0.8)">Hi {full_name},</p>
          <p style="margin:0 0 24px;font-size:14px;color:rgba(255,255,255,0.5);line-height:1.6">
            Your payment was successful. Here's your receipt and token summary.
          </p>

          <!-- Token highlight -->
          <div style="background:rgba(45,212,191,0.1);border:1px solid rgba(45,212,191,0.25);border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
            <p style="margin:0 0 4px;font-size:13px;color:#2DD4BF;font-weight:600;text-transform:uppercase;letter-spacing:.08em">Tokens added</p>
            <p style="margin:0;font-size:48px;font-weight:800;color:#fff;letter-spacing:-2px">+{tokens_added:,}</p>
            <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,0.4)">New balance: <strong style="color:rgba(255,255,255,0.75)">{tokens_total:,} tokens</strong></p>
          </div>

          <!-- Receipt -->
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid rgba(255,255,255,0.07);border-radius:10px;overflow:hidden;margin-bottom:24px">
            <tr style="background:rgba(255,255,255,0.03)">
              <td style="padding:12px 16px;font-size:12px;color:rgba(255,255,255,0.4);font-weight:600;text-transform:uppercase;letter-spacing:.08em">Plan</td>
              <td style="padding:12px 16px;font-size:13px;color:rgba(255,255,255,0.8);text-align:right">{plan_label}</td>
            </tr>
            <tr>
              <td style="padding:12px 16px;font-size:12px;color:rgba(255,255,255,0.4);font-weight:600;text-transform:uppercase;letter-spacing:.08em">Amount paid</td>
              <td style="padding:12px 16px;font-size:13px;color:rgba(255,255,255,0.8);text-align:right">{currency} {amount:,}</td>
            </tr>
            <tr style="background:rgba(255,255,255,0.03)">
              <td style="padding:12px 16px;font-size:12px;color:rgba(255,255,255,0.4);font-weight:600;text-transform:uppercase;letter-spacing:.08em">Transaction ID</td>
              <td style="padding:12px 16px;font-size:12px;color:rgba(255,255,255,0.5);text-align:right;font-family:monospace">{transaction_id}</td>
            </tr>
          </table>

          <p style="margin:0 0 24px;font-size:13px;color:rgba(255,255,255,0.4);line-height:1.6">
            Each video render costs <strong style="color:rgba(255,255,255,0.65)">100 tokens</strong>.
            Your new tokens are live immediately — go create your next video.
          </p>

          <div style="text-align:center">
            <a href="{settings.frontend_origin}" style="display:inline-block;background:#7C5CFF;color:#fff;text-decoration:none;padding:13px 32px;border-radius:10px;font-size:14px;font-weight:600;letter-spacing:.02em">
              Open SceneForge →
            </a>
          </div>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center">
          <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.25)">
            SceneForge · AI Video Studio · This is an automated receipt
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
"""

    text = f"""Hi {full_name},

Payment confirmed — {tokens_added:,} tokens added to your SceneForge account.

Plan: {plan_label}
Amount: {currency} {amount:,}
Tokens added: +{tokens_added:,}
New balance: {tokens_total:,} tokens
Transaction ID: {transaction_id}

Each video render costs 100 tokens. Your tokens are live immediately.

Open SceneForge: {settings.frontend_origin}

— The SceneForge Team
"""

    await loop.run_in_executor(None, _send, to_email, subject, html, text)


async def send_verification_otp(
    to_email: str,
    full_name: str,
    otp: str,
) -> None:
    """Send a 6-digit OTP verification email."""
    import asyncio
    loop = asyncio.get_event_loop()

    subject = f"Your SceneForge verification code: {otp}"

    html = f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
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
          <p style="margin:0 0 28px;font-size:13px;color:rgba(255,255,255,0.45);line-height:1.6">
            Enter this code to verify your SceneForge account.
          </p>
          <div style="background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.3);border-radius:14px;padding:28px 40px;display:inline-block;margin-bottom:28px">
            <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#c9a84c;text-transform:uppercase;letter-spacing:.15em">Verification code</p>
            <p style="margin:0;font-size:48px;font-weight:800;letter-spacing:12px;color:#fff;font-family:monospace">{otp}</p>
          </div>
          <p style="margin:0 0 8px;font-size:13px;color:rgba(255,255,255,0.35)">This code expires in <strong style="color:rgba(255,255,255,0.6)">15 minutes</strong>.</p>
          <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.25)">If you didn't create a SceneForge account, ignore this email.</p>
        </td></tr>
        <tr><td style="padding:16px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.2)">SceneForge · AI Video Studio</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""

    text = f"""Hi {full_name},

Your SceneForge verification code is: {otp}

This code expires in 15 minutes.

If you didn't create a SceneForge account, ignore this email.

— SceneForge
"""

    await loop.run_in_executor(None, _send, to_email, subject, html, text)


async def send_password_reset(
    to_email: str,
    full_name: str,
    reset_url: str,
) -> None:
    """Send password reset email with a link."""
    import asyncio
    loop = asyncio.get_event_loop()

    subject = "Reset your SceneForge password"

    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#080810;font-family:Arial,sans-serif;color:#F0F0FF">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080810;padding:40px 0">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#111118;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden">
        <tr><td style="background:linear-gradient(135deg,#1a0d33,#0a1a2e);padding:28px 40px;text-align:center">
          <h1 style="margin:0;font-size:24px;font-weight:800;color:#fff">Scene<span style="color:#A78BFA">Forge</span></h1>
          <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.45)">Password reset request</p>
        </td></tr>
        <tr><td style="padding:36px 40px;text-align:center">
          <p style="margin:0 0 6px;font-size:15px;color:rgba(255,255,255,0.8)">Hi {full_name},</p>
          <p style="margin:0 0 28px;font-size:13px;color:rgba(255,255,255,0.45);line-height:1.6">
            We received a request to reset your password. Click the button below to choose a new one.
          </p>
          <a href="{reset_url}" style="display:inline-block;background:#7C5CFF;color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-size:14px;font-weight:700;margin-bottom:24px">
            Reset my password →
          </a>
          <p style="margin:0 0 8px;font-size:13px;color:rgba(255,255,255,0.35)">This link expires in <strong style="color:rgba(255,255,255,0.6)">1 hour</strong>.</p>
          <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.25)">If you didn't request a password reset, ignore this email — your password won't change.</p>
        </td></tr>
        <tr><td style="padding:16px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.2)">SceneForge · AI Video Studio</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""

    text = f"""Hi {full_name},

We received a request to reset your SceneForge password.

Reset your password here: {reset_url}

This link expires in 1 hour.

If you didn't request this, ignore this email.

— SceneForge
"""

    await loop.run_in_executor(None, _send, to_email, subject, html, text)
