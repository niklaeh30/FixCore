"""
Central configuration for the FixCore redeem bot + webhook server.

Everything is loaded from environment variables (see .env.example).
Nothing here should ever contain a real secret — copy .env.example to
.env and fill it in locally, .env is never committed.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


def _require_env(name: str) -> str:
    """Fetch a required env var, or raise a clear error if it's missing/empty."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"Missing required environment variable '{name}'. "
            f"Check your .env file against .env.example."
        )
    return value


def _get_env(name: str, default: str) -> str:
    """Fetch an optional env var, falling back to a (non-None) default."""
    value = os.getenv(name)
    return value if value else default


def _load_product_role_map() -> dict[str, int]:
    """
    Maps a Stripe Price ID -> Discord role ID to grant on redemption.

    Set in .env as JSON, e.g.:
    PRODUCT_ROLE_MAP={"price_1AbCdEfGh": 123456789012345678}

    If a Stripe session's price ID isn't in this map, DEFAULT_ROLE_ID is used.
    """
    raw = os.getenv("PRODUCT_ROLE_MAP", "{}")
    try:
        parsed = json.loads(raw)
        return {str(k): int(v) for k, v in parsed.items()}
    except (json.JSONDecodeError, ValueError) as exc:
        raise RuntimeError(
            f"PRODUCT_ROLE_MAP in .env is not valid JSON: {exc}"
        ) from exc


@dataclass(frozen=True)
class Settings:
    # --- Discord ---
    discord_bot_token: str = field(default_factory=lambda: _require_env("DISCORD_BOT_TOKEN"))
    discord_guild_id: int = field(default_factory=lambda: int(_require_env("DISCORD_GUILD_ID")))
    default_role_id: int = field(default_factory=lambda: int(_require_env("DEFAULT_ROLE_ID")))
    redeem_channel_id: int = field(default_factory=lambda: int(_get_env("REDEEM_CHANNEL_ID", "0") or 0))
    # Channel where a message is posted every time someone redeems a key —
    # who redeemed it, when it was purchased, and which product/role.
    # Set to "0" in .env to disable this entirely.
    redeem_log_channel_id: int = field(default_factory=lambda: int(_get_env("REDEEM_LOG_CHANNEL_ID", "1545436608856326165") or 0))
    # Always granted on top of whatever role a key itself resolves to (via
    # DEFAULT_ROLE_ID or PRODUCT_ROLE_MAP) — e.g. a general "Customer"
    # role every buyer should have regardless of which product they bought.
    # Set to "0" in .env to disable this entirely.
    extra_role_id: int = field(default_factory=lambda: int(_get_env("EXTRA_ROLE_ID", "1538255411298304010")))

    # --- Stripe ---
    stripe_secret_key: str = field(default_factory=lambda: _require_env("STRIPE_SECRET_KEY"))
    stripe_webhook_secret: str = field(default_factory=lambda: _require_env("STRIPE_WEBHOOK_SECRET"))

    # --- Product -> role mapping ---
    product_role_map: dict[str, int] = field(default_factory=_load_product_role_map)

    # --- Misc ---
    database_path: str = field(default_factory=lambda: _get_env("DATABASE_PATH", "redeem.db"))
    success_page_base_url: str = field(default_factory=lambda: _get_env("SUCCESS_PAGE_BASE_URL", "http://localhost:5000"))
    webhook_host: str = field(default_factory=lambda: _get_env("WEBHOOK_HOST", "0.0.0.0"))
    webhook_port: int = field(default_factory=lambda: int(_get_env("WEBHOOK_PORT", "5000")))
    brand_name: str = field(default_factory=lambda: _get_env("BRAND_NAME", "FixCore"))
    products_url: str = field(default_factory=lambda: _get_env("PRODUCTS_URL", "https://fixcorepc.com/products"))
    discord_invite_url: str = field(default_factory=lambda: _get_env("DISCORD_INVITE_URL", "https://discord.gg/xCGN2hXY8J"))

    # --- FixCore Free Tweaks (free key -> role -> download) ---
    # Role given when a free key is redeemed. 0 = free keys are switched off.
    free_tweaks_role_id: int = field(default_factory=lambda: int(_get_env("FREE_TWEAKS_ROLE_ID", "0") or 0))
    # Where the installer lives. Only handed out after the key is redeemed.
    free_tweaks_download_url: str = field(default_factory=lambda: _get_env(
        "FREE_TWEAKS_DOWNLOAD_URL", "https://fixcorepc.com/FixCore_Free_Tweaks_Setup.exe"))
    # Optional shared secret so another backend (e.g. fixcore-accounts) can ask
    # for a free key on behalf of a logged-in user. Leave empty to disable.
    free_key_api_secret: str = field(default_factory=lambda: _get_env("FREE_KEY_API_SECRET", ""))
    # FixCore account backend (email login). Used to check who a website
    # login token belongs to and which Discord account is linked to it.
    accounts_api_base: str = field(default_factory=lambda: _get_env(
        "ACCOUNTS_API_BASE", "https://web-production-fae792.up.railway.app").rstrip("/"))
    # Websites allowed to call the /api/ endpoints from the browser.
    allowed_origins: tuple[str, ...] = field(default_factory=lambda: tuple(
        o.strip() for o in _get_env(
            "ALLOWED_ORIGINS", "https://fixcorepc.com,https://www.fixcorepc.com").split(",")
        if o.strip()))


settings = Settings()
