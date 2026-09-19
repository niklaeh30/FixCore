"""
Flask server that:
  1. Listens for Stripe 'checkout.session.completed' webhooks, generates a
     redemption key, and stores it against the Stripe session.
  2. Serves a small success page (the one Stripe redirects the customer to)
     that shows their redemption key so they can copy it into Discord.
  3. Answers a small check-promo lookup the website's checkout pages call
     while someone types a discount code, so they get a real "Applied"
     state instead of the site just accepting anything typed in.

Run standalone with:  python webhook_server.py
Or import `app` and run it under gunicorn/waitress in production.
"""

from __future__ import annotations

import logging

import stripe
from flask import Flask, abort, jsonify, render_template_string, request

import database
from config import settings
from keygen import generate_key

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("webhook_server")

stripe.api_key = settings.stripe_secret_key

app = Flask(__name__)

# Only the website is allowed to call the JSON API below (the Stripe
# webhook and success page don't need this — browsers don't enforce CORS
# on server-to-server calls or plain page navigations).
WEBSITE_ORIGIN = "https://fixcorepc.com"


@app.after_request
def _add_cors_headers(response):
    if request.path.startswith("/api/"):
        response.headers["Access-Control-Allow-Origin"] = WEBSITE_ORIGIN
        response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    return response


def _unique_key() -> str:
    """Generate a key, retrying on the astronomically unlikely collision."""
    for _ in range(10):
        candidate = generate_key()
        if database.get_key(candidate) is None:
            return candidate
    raise RuntimeError("Could not generate a unique key after 10 attempts")


def _resolve_role_id(price_id: str | None) -> int:
    if price_id and price_id in settings.product_role_map:
        return settings.product_role_map[price_id]
    return settings.default_role_id


@app.route("/webhook/stripe", methods=["POST"])
def stripe_webhook():
    payload = request.data
    sig_header = request.headers.get("Stripe-Signature", "")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, settings.stripe_webhook_secret)
    except ValueError:
        log.warning("Invalid Stripe webhook payload")
        abort(400)
    except stripe.SignatureVerificationError:
        log.warning("Invalid Stripe webhook signature")
        abort(400)

    if event["type"] != "checkout.session.completed":
        # We only care about completed checkouts; ack everything else.
        return "", 200

    # Newer stripe-python versions no longer make StripeObject support
    # dict-style .get() directly — convert to a plain dict up front so the
    # rest of this function can use normal dict access safely.
    session = event["data"]["object"].to_dict()
    session_id = session["id"]
    customer_email = (session.get("customer_details") or {}).get("email")

    # Idempotency: Stripe may retry the same webhook.
    existing = database.get_key_by_session(session_id)
    if existing:
        log.info("Session %s already has key %s, skipping", session_id, existing.key)
        return "", 200

    # Figure out which price was purchased so we can pick the right role.
    price_id = None
    try:
        line_items = stripe.checkout.Session.list_line_items(session_id, limit=1)
        if line_items.data:
            price_id = line_items.data[0]["price"]["id"]
    except stripe.StripeError as exc:
        log.error("Could not fetch line items for session %s: %s", session_id, exc)

    role_id = _resolve_role_id(price_id)
    key = _unique_key()

    database.create_key(
        key=key,
        role_id=role_id,
        stripe_session_id=session_id,
        customer_email=customer_email,
        price_id=price_id,
    )
    log.info("Generated key %s for session %s (%s)", key, session_id, customer_email)

    return "", 200


@app.route("/api/check-promo", methods=["GET", "OPTIONS"])
def check_promo():
    """
    Called from the website's checkout pages while someone types a
    discount code. Looks the code up against Stripe directly (using the
    secret key we already have here) so the site can show a real
    "Applied" state instead of just accepting anything typed in.
    """
    if request.method == "OPTIONS":
        return "", 204  # CORS preflight — headers added by _add_cors_headers

    code = (request.args.get("code") or "").strip()
    if not code:
        return jsonify({"valid": False})

    try:
        result = stripe.PromotionCode.list(code=code, active=True, limit=1)
    except stripe.StripeError as exc:
        log.error("Stripe promo lookup failed for %r: %s", code, exc)
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


_SUCCESS_PAGE = """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{{ brand }} — Purchase complete</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, Segoe UI, sans-serif; background:#0f0f14; color:#e6e6ea;
           display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
    .card { background:#1a1a22; border:1px solid #2a2a35; border-radius:12px; padding:32px 36px;
            max-width:420px; text-align:center; }
    h1 { font-size:1.3rem; margin-bottom:8px; }
    p { color:#a3a3ad; font-size:0.95rem; }
    .key { font-family: "SFMono-Regular", Consolas, monospace; font-size:1.15rem; letter-spacing:1px;
           background:#0f0f14; border:1px solid #3a3a46; border-radius:8px; padding:14px;
           margin:20px 0; user-select:all; }
    .steps { text-align:left; font-size:0.9rem; color:#c7c7cf; margin-top:20px; }
    .steps li { margin-bottom:6px; }
    .spinner { width:22px; height:22px; margin:18px auto 4px; border-radius:50%;
               border:3px solid #2a2a35; border-top-color:#5865F2; animation:spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .email-input { width:100%; box-sizing:border-box; background:#0f0f14; border:1px solid #3a3a46;
                   border-radius:8px; padding:12px 14px; color:#e6e6ea; font-size:0.95rem; margin:16px 0 10px; }
    button.buy { display:block; width:100%; background:#5865F2; color:#fff; border:none; font-weight:600;
                 font-size:0.95rem; padding:12px; border-radius:8px; cursor:pointer; font-family:inherit; }
    button.buy:hover { opacity:0.85; }
    .not-found { font-size:0.85rem; margin-top:12px; }
    a { color:#8ab4ff; }
  </style>
</head>
<body>
  <div class="card">
    <h1>✅ Purchase complete</h1>
    {% if key %}
      <p>Copy your redemption key and paste it into the redeem button in Discord.</p>
      <div class="key" id="key">{{ key }}</div>
      <ol class="steps">
        <li><a href="{{ discord_url }}" target="_blank" rel="noopener">Join the {{ brand }} Discord server</a></li>
        <li>Click <strong>Redeem</strong> in the #redeem channel</li>
        <li>Paste this key</li>
      </ol>
    {% elif checking %}
      <p>We're still generating your key — this usually takes a few seconds. This page will refresh automatically.</p>
      <div class="spinner" aria-hidden="true"></div>
      <script>
        setTimeout(function () {
          var url = new URL(window.location.href);
          url.searchParams.set("n", "{{ attempt + 1 }}");
          window.location.href = url.toString();
        }, 3000);
      </script>
    {% else %}
      <p>We couldn't automatically match your key. Enter the email you used at checkout and we'll look it up.</p>
      <form method="get" action="/success">
        <input class="email-input" type="email" name="email" placeholder="you@example.com" required value="{{ email or '' }}">
        <button class="buy" type="submit">Find my key</button>
      </form>
      {% if email %}<p class="not-found">No key found yet for that email — if you just paid, wait a few seconds and try again.</p>{% endif %}
      <p class="not-found">Still stuck? <a href="{{ discord_url }}" target="_blank" rel="noopener">Ask in the {{ brand }} Discord</a> and we'll sort it out.</p>
    {% endif %}
  </div>
</body>
</html>
"""

# How many 3-second auto-reloads to try before giving up and offering the
# email-lookup fallback. 20 * 3s = 1 minute, which is far longer than the
# webhook should ever realistically take.
_MAX_POLL_ATTEMPTS = 20


@app.route("/success")
def success():
    session_id = request.args.get("session_id", "")
    email = request.args.get("email", "").strip()
    attempt = request.args.get("n", 0, type=int)

    record = None
    checking = False

    if email:
        # Explicit fallback lookup — only reached once the customer has
        # typed their email into the last-resort form below.
        record = database.get_latest_key_by_email(email)
    elif session_id and session_id != "{CHECKOUT_SESSION_ID}":
        # Normal path: Stripe substituted the real session id.
        record = database.get_key_by_session(session_id)
        checking = record is None and attempt < _MAX_POLL_ATTEMPTS
    else:
        # No usable session id at all (e.g. redirect URL misconfigured) —
        # still poll for a bit in case it resolves, before falling back.
        checking = attempt < _MAX_POLL_ATTEMPTS

    return render_template_string(
        _SUCCESS_PAGE,
        key=record.key if record else None,
        brand=settings.brand_name,
        checking=checking,
        email=email,
        attempt=attempt,
        discord_url=settings.discord_invite_url,
    )


@app.route("/health")
def health():
    return {"status": "ok"}, 200


_TEST_SHOP_PAGE = """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{{ brand }} — Test Shop</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, Segoe UI, sans-serif; background:#0f0f14; color:#e6e6ea;
           display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
    .card { background:#1a1a22; border:1px solid #2a2a35; border-radius:12px; padding:36px 40px;
            max-width:420px; text-align:center; }
    h1 { font-size:1.4rem; margin-bottom:4px; }
    p.tag { color:#a3a3ad; font-size:0.9rem; margin-top:0; margin-bottom:24px; }
    .product { background:#0f0f14; border:1px solid #3a3a46; border-radius:10px; padding:18px;
               text-align:left; margin-bottom:22px; }
    .product .name { font-weight:600; }
    .product .price { color:#8b8b96; font-size:0.9rem; margin-top:2px; }
    a.buy { display:block; background:#5865F2; color:#fff; text-decoration:none; font-weight:600;
            padding:14px; border-radius:8px; transition:opacity 0.15s; }
    a.buy:hover { opacity:0.85; }
    .badge { display:inline-block; background:#2a2a35; color:#a3a3ad; font-size:0.75rem;
             padding:3px 10px; border-radius:20px; margin-top:18px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🧪 {{ brand }} Test Shop</h1>
    <p class="tag">Not a real store — for testing the redeem flow only.</p>
    <div class="product">
      <div class="name">FixCore Test Product</div>
      <div class="price">$1.00 · Stripe test mode</div>
    </div>
    <a class="buy" href="/test-checkout">Buy now (test card)</a>
    <div class="badge">Use card 4242 4242 4242 4242</div>
  </div>
</body>
</html>
"""


@app.route("/")
def test_shop():
    return render_template_string(_TEST_SHOP_PAGE, brand=settings.brand_name)


@app.route("/test-checkout")
def test_checkout():
    """
    DEV/TEST ONLY. Creates a real Stripe test-mode Checkout Session for a
    $1 fake product on the fly (no product needs to exist in your Stripe
    dashboard) and redirects you straight into it. Pay with card number
    4242 4242 4242 4242, any future date, any CVC — completing it fires
    the same webhook a real purchase would, so you can test the full flow
    end to end.
    """
    try:
        checkout_session = stripe.checkout.Session.create(
            mode="payment",
            line_items=[
                {
                    "price_data": {
                        "currency": "usd",
                        "product_data": {"name": "FixCore Test Product"},
                        "unit_amount": 100,  # $1.00
                    },
                    "quantity": 1,
                }
            ],
            success_url=f"{settings.success_page_base_url}/success?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{settings.success_page_base_url}/",
        )
    except stripe.StripeError as exc:
        log.error("Could not create test checkout session: %s", exc)
        return f"Stripe error: {exc}", 500

    return f'<a href="{checkout_session.url}">Click here if you are not redirected automatically…</a>' \
           f'<meta http-equiv="refresh" content="0; url={checkout_session.url}">'


if __name__ == "__main__":
    database.init_db()
    app.run(host=settings.webhook_host, port=settings.webhook_port)
