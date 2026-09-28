import hashlib
import hmac
import json
import os
import re
import time
import jwt
import bcrypt
import requests
from datetime import datetime, timedelta, timezone
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

import database

load_dotenv()

app = Flask(__name__)

ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
CORS(app, origins=ALLOWED_ORIGINS or "*")

JWT_SECRET = os.environ.get("JWT_SECRET")
if not JWT_SECRET:
    # Without this every login token is unusable — fail loudly at startup.
    raise RuntimeError("JWT_SECRET is not set. Add it as an environment variable (Railway -> Variables).")
JWT_ALGORITHM = "HS256"
TOKEN_LIFETIME_DAYS = 30

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# --- affiliate program ---
# Signing secret of the Stripe webhook endpoint that points at THIS service
# (/api/stripe-webhook). It's a different endpoint from the redeem bot's,
# so it has its own "whsec_..." secret in the Stripe dashboard.
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET")
AFFILIATE_PERCENT = int(os.environ.get("AFFILIATE_COMMISSION_PERCENT", "10"))
SITE_URL = os.environ.get("SITE_URL", "https://fixcorepc.com").rstrip("/")

# --- purchase lookup (which products does this account own?) ---
# The FixCore bot must be a member of the server. Set DISCORD_BOT_TOKEN on Railway.
DISCORD_BOT_TOKEN = os.environ.get("DISCORD_BOT_TOKEN")
DISCORD_GUILD_ID = os.environ.get("DISCORD_GUILD_ID", "1538214452191826122")
FIXCORE_2_1_ROLE_IDS = ["1540798693123559474", "1538255411298304010"]
NETTBOOST_ROLE_ID = "1545452018313732116"
FIXCORE_ULTIMATE_ROLE_ID = "1549807754690957432"

database.init_db()


# ---------- helpers ----------

def make_token(user):
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "exp": datetime.now(timezone.utc) + timedelta(days=TOKEN_LIFETIME_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def public_user(user):
    return {
        "id": user["id"],
        "email": user["email"],
        "username": user.get("discord_username") or user["username"],
        "avatarUrl": user.get("avatar_url"),
        "discordLinked": bool(user.get("discord_id")),
    }


def get_user_from_request():
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[len("Bearer "):]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
    return database.get_user_by_id(payload["sub"])


# ---------- routes ----------

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"ok": True})


@app.route("/api/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip()
    password = data.get("password") or ""
    username = (data.get("username") or "").strip() or email.split("@")[0]

    if not EMAIL_RE.match(email):
        return jsonify({"error": "Please enter a valid email address."}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters."}), 400
    if database.get_user_by_email(email):
        return jsonify({"error": "An account with this email already exists."}), 409

    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    user = database.create_user(email, username, password_hash)

    token = make_token(user)
    return jsonify({"token": token, "user": public_user(user)}), 201


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip()
    password = data.get("password") or ""

    user = database.get_user_by_email(email)
    if not user or not bcrypt.checkpw(password.encode("utf-8"), user["password_hash"].encode("utf-8")):
        return jsonify({"error": "Incorrect email or password."}), 401

    token = make_token(user)
    return jsonify({"token": token, "user": public_user(user)})


@app.route("/api/me", methods=["GET"])
def me():
    user = get_user_from_request()
    if not user:
        return jsonify({"error": "Not signed in."}), 401
    return jsonify({"user": public_user(user)})


@app.route("/api/me/products", methods=["GET"])
def me_products():
    """
    Which FixCore products the signed-in account owns, based on the Discord
    roles of the linked Discord account. Email logins have no live Discord
    token, so we ask Discord with the bot token instead.
    """
    user = get_user_from_request()
    if not user:
        return jsonify({"error": "Not signed in."}), 401
    if not user.get("discord_id"):
        return jsonify({"discordLinked": False})
    if not DISCORD_BOT_TOKEN:
        return jsonify({"error": "Purchase lookup is not configured (DISCORD_BOT_TOKEN missing)."}), 503

    try:
        response = requests.get(
            f"https://discord.com/api/v10/guilds/{DISCORD_GUILD_ID}/members/{user['discord_id']}",
            headers={"Authorization": f"Bot {DISCORD_BOT_TOKEN}"},
            timeout=10,
        )
    except requests.RequestException:
        return jsonify({"error": "Could not reach Discord."}), 502

    if response.status_code == 404:
        # Linked Discord account isn't in the FixCore server -> owns nothing.
        roles = []
    elif response.ok:
        roles = response.json().get("roles") or []
    else:
        print(f"[products] discord lookup failed: {response.status_code} {response.text[:200]}")
        return jsonify({"error": "Could not verify roles with Discord."}), 502

    return jsonify({
        "discordLinked": True,
        "fixCore21": any(r in roles for r in FIXCORE_2_1_ROLE_IDS),
        "nettBoost": NETTBOOST_ROLE_ID in roles,
        "fixCoreUltimate": FIXCORE_ULTIMATE_ROLE_ID in roles,
    })


@app.route("/api/link-discord", methods=["POST"])
def link_discord():
    """
    Called right after the person authorizes with Discord as part of the
    "create account, then link Discord" flow. Takes the Discord access
    token the frontend just received from Discord's OAuth redirect, looks
    up who that is, and attaches it to the currently signed-in (email)
    account so future logins show their Discord name/avatar.
    """
    user = get_user_from_request()
    if not user:
        return jsonify({"error": "Not signed in."}), 401

    data = request.get_json(silent=True) or {}
    discord_token = data.get("discordAccessToken")
    if not discord_token:
        return jsonify({"error": "Missing Discord access token."}), 400

    try:
        response = requests.get(
            "https://discord.com/api/users/@me",
            headers={"Authorization": f"Bearer {discord_token}"},
            timeout=10,
        )
    except requests.RequestException:
        return jsonify({"error": "Could not reach Discord. Please try again."}), 502

    if not response.ok:
        return jsonify({"error": "Discord authorization failed. Please try again."}), 502

    discord_user = response.json()
    discord_id = discord_user.get("id")
    discord_username = discord_user.get("global_name") or discord_user.get("username")
    # The unique @handle (not the display name) — the affiliate code is built from it.
    discord_handle = discord_user.get("username")
    avatar_hash = discord_user.get("avatar")
    avatar_url = (
        f"https://cdn.discordapp.com/avatars/{discord_id}/{avatar_hash}.png?size=64"
        if avatar_hash else None
    )

    existing = database.get_user_by_discord_id(discord_id)
    if existing and existing["id"] != user["id"]:
        return jsonify({"error": "That Discord account is already linked to a different FixCore account."}), 409

    updated = database.update_user_discord(
        user["id"], discord_id, discord_username, avatar_url, discord_handle
    )
    return jsonify({"user": public_user(updated)})


# ---------- affiliate program ----------

@app.route("/api/affiliate/me", methods=["GET"])
def affiliate_me():
    """
    The signed-in user's affiliate dashboard data. The referral code is
    their Discord name and is created automatically on first call — no
    signup step. Needs a linked Discord account (that's where the name
    comes from); otherwise tells the frontend to prompt for that.
    """
    user = get_user_from_request()
    if not user:
        return jsonify({"error": "Not signed in."}), 401
    if not user.get("discord_id"):
        return jsonify({"discordLinked": False})

    affiliate = database.get_or_create_affiliate(user)
    if not affiliate:
        return jsonify({"error": "Could not create your referral code. Please try again."}), 500

    return jsonify({
        "discordLinked": True,
        "code": affiliate["code"],
        "link": f"{SITE_URL}/?ref={affiliate['code']}",
        "percent": AFFILIATE_PERCENT,
        "clicks": affiliate["clicks"],
        "sales": affiliate["sales"],
        "earned": affiliate["earned_cents"] / 100,
        "balance": affiliate["balance_cents"] / 100,
    })


@app.route("/api/affiliate/click", methods=["POST"])
def affiliate_click():
    data = request.get_json(silent=True) or {}
    database.record_affiliate_click(data.get("code"))
    return "", 204


@app.route("/api/affiliate/check", methods=["GET"])
def affiliate_check():
    """Used by the checkout pages to confirm a typed referral code exists."""
    return jsonify({"valid": database.get_affiliate_by_code(request.args.get("code")) is not None})


def verify_stripe_signature(payload, header, secret, tolerance=300):
    """
    Checks Stripe's "Stripe-Signature" header (t=<unix>,v1=<hmac-sha256>)
    without needing the stripe package: HMAC-SHA256 of "<t>.<raw body>"
    with the endpoint's signing secret, plus a 5-minute freshness window
    so a captured request can't be replayed later.
    """
    if not header or not secret:
        return False
    items = [item.split("=", 1) for item in header.split(",") if "=" in item]
    try:
        timestamp = int(next(v for k, v in items if k == "t"))
    except (StopIteration, ValueError):
        return False
    if abs(time.time() - timestamp) > tolerance:
        return False
    expected = hmac.new(
        secret.encode("utf-8"), f"{timestamp}.".encode("utf-8") + payload, hashlib.sha256
    ).hexdigest()
    signatures = [v for k, v in items if k == "v1"]
    return any(hmac.compare_digest(expected, sig) for sig in signatures)


@app.route("/api/stripe-webhook", methods=["POST"])
def stripe_webhook():
    """
    Credits the affiliate when a checkout that carried a referral code is
    paid. The checkout pages pass the code to Stripe as client_reference_id.
    """
    if not STRIPE_WEBHOOK_SECRET:
        return jsonify({"error": "Webhook not configured."}), 503

    payload = request.get_data()
    if not verify_stripe_signature(payload, request.headers.get("Stripe-Signature", ""), STRIPE_WEBHOOK_SECRET):
        return jsonify({"error": "Invalid signature."}), 400

    try:
        event = json.loads(payload)
    except ValueError:
        return jsonify({"error": "Bad payload."}), 400

    if event.get("type") == "checkout.session.completed":
        session = (event.get("data") or {}).get("object") or {}
        code = session.get("client_reference_id")
        if code and session.get("payment_status") == "paid":
            buyer = (session.get("customer_details") or {}).get("email") or session.get("customer_email")
            result = database.credit_affiliate_sale(
                session.get("id"), code, session.get("amount_total"), buyer, AFFILIATE_PERCENT
            )
            print(f"[affiliate] session={session.get('id')} code={code} -> {result}")

    # Always 200 once the signature checks out, so Stripe doesn't keep retrying.
    return jsonify({"received": True})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
