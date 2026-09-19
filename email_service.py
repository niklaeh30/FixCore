"""
Sends transactional email via Resend (https://resend.com).

Free tier: 3,000 emails/month, 100/day — plenty for account signups.
Until fixcorepc.com is verified as a sending domain in Resend, you can
only send TO the email address you signed up to Resend with. See the
README for the verification steps (it's just adding a couple of DNS
records at your domain registrar/GitHub Pages DNS).
"""

import os
import requests

RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
FROM_EMAIL = os.environ.get("FROM_EMAIL", "FixCore <onboarding@resend.dev>")

RESEND_URL = "https://api.resend.com/emails"


def send_welcome_email(to_email, username):
    """
    Best-effort: returns True/False, never raises. A failed email should
    never block account creation — the account is already saved by the
    time this is called.
    """
    if not RESEND_API_KEY:
        print("RESEND_API_KEY not set — skipping welcome email")
        return False

    html = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#1a1a1f;">Welcome to FixCore, {username}!</h2>
      <p style="color:#444; line-height:1.6;">
        Thanks for creating an account on FixCore. You can now sign in
        anytime to manage your subscriptions and purchases.
      </p>
      <p style="color:#444; line-height:1.6;">
        If you didn't create this account, you can safely ignore this email.
      </p>
      <p style="color:#888; font-size:13px; margin-top:32px;">— The FixCore team</p>
    </div>
    """

    try:
        response = requests.post(
            RESEND_URL,
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "from": FROM_EMAIL,
                "to": [to_email],
                "subject": "Thanks for creating an account on FixCore",
                "html": html,
            },
            timeout=10,
        )
        if response.status_code >= 300:
            print("Resend error:", response.status_code, response.text)
            return False
        return True
    except requests.RequestException as e:
        print("Resend request failed:", e)
        return False
