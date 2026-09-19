"""
Minimal standalone server for testing the discount-code check locally —
just the one /api/check-promo endpoint, without needing the full
redeem-bot setup (Discord token, guild ID, etc.) filled in.

Once you're ready to go live, this logic already lives in the real
webhook_server.py too — deploy that to Railway as usual and this local
script becomes unnecessary (just point PROMO_CHECK_BASE back at the
Railway URL in the website files).

Run:
    pip install flask flask-cors stripe python-dotenv
    python check_promo_local.py

Needs one thing in a .env file next to this script (or just set it as
an environment variable before running):
    STRIPE_SECRET_KEY=sk_test_... (or sk_live_...)
"""

import os

import stripe
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

stripe.api_key = os.environ.get("STRIPE_SECRET_KEY")

app = Flask(__name__)
CORS(app)  # wide open — this is a local-only dev helper, never deploy this file as-is


@app.route("/api/check-promo", methods=["GET"])
def check_promo():
    if not stripe.api_key:
        return jsonify({"valid": False, "error": "STRIPE_SECRET_KEY not set in .env"}), 500

    code = (request.args.get("code") or "").strip()
    if not code:
        return jsonify({"valid": False})

    try:
        result = stripe.PromotionCode.list(code=code, active=True, limit=1)
    except stripe.StripeError as exc:
        print("Stripe promo lookup failed:", exc)
        return jsonify({"valid": False})

    if not result.data:
        return jsonify({"valid": False})

    # Newer stripe-python versions need an explicit .to_dict() before plain
    # attribute/key access on nested fields works reliably.
    promo = result.data[0].to_dict()
    coupon = promo.get("coupon") or {}
    return jsonify({
        "valid": True,
        "percent_off": coupon.get("percent_off"),
        "amount_off": coupon.get("amount_off"),
        "currency": coupon.get("currency"),
    })


if __name__ == "__main__":
    print("Running on http://127.0.0.1:5050 — checking real Stripe promotion codes.")
    app.run(port=5050, debug=True)
