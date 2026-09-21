"""
Tiny SQLite wrapper for the accounts service.

Kept deliberately simple (stdlib sqlite3, no ORM) to match the style of
FixCore's other small Python services (database.py in the redeem bot).

Note: on Railway, the filesystem is ephemeral unless you attach a Volume.
For a handful of users SQLite is fine to start with, but if you expect
real growth, swap this out for Railway's Postgres add-on later — the
functions below are the only place that would need to change.
"""

import re
import sqlite3
import os
from datetime import datetime, timezone

# If a Railway Volume is mounted at /data, use it automatically so accounts
# survive redeploys even when DATABASE_PATH was forgotten. (A wiped database
# is what makes old login tokens suddenly return "session expired".)
_default_db = "/data/fixcore_accounts.db" if os.path.isdir("/data") else "fixcore_accounts.db"
DATABASE_PATH = os.environ.get("DATABASE_PATH", _default_db)
print(f"[database] using {DATABASE_PATH}")


def get_connection():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_connection()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            discord_id TEXT UNIQUE,
            discord_username TEXT,
            avatar_url TEXT,
            created_at TEXT NOT NULL
        )
        """
    )

    # Migration: Discord's unique @handle (e.g. "nicklas"), separate from the
    # display name. The affiliate code is built from this. Safe to run on an
    # existing database — only adds the column if it isn't there yet.
    user_cols = [row["name"] for row in conn.execute("PRAGMA table_info(users)")]
    if "discord_handle" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN discord_handle TEXT")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS affiliates (
            user_id INTEGER PRIMARY KEY REFERENCES users(id),
            code TEXT UNIQUE NOT NULL,
            clicks INTEGER NOT NULL DEFAULT 0,
            sales INTEGER NOT NULL DEFAULT 0,
            earned_cents INTEGER NOT NULL DEFAULT 0,
            balance_cents INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )
        """
    )
    # One row per credited Stripe checkout. The session id is the primary key
    # on purpose: Stripe retries webhooks, and this makes double-crediting
    # the same purchase impossible.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS affiliate_sales (
            stripe_session_id TEXT PRIMARY KEY,
            code TEXT NOT NULL,
            amount_cents INTEGER NOT NULL,
            commission_cents INTEGER NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


def create_user(email, username, password_hash):
    conn = get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO users (email, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (email.lower().strip(), username, password_hash, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
        user_id = cur.lastrowid
        return get_user_by_id(user_id)
    finally:
        conn.close()


def get_user_by_email(email):
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM users WHERE email = ?", (email.lower().strip(),)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_user_by_id(user_id):
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_user_by_discord_id(discord_id):
    if not discord_id:
        return None
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM users WHERE discord_id = ?", (discord_id,)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def update_user_discord(user_id, discord_id, discord_username, avatar_url, discord_handle=None):
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE users SET discord_id = ?, discord_username = ?, avatar_url = ?, discord_handle = ? WHERE id = ?",
            (discord_id, discord_username, avatar_url, discord_handle, user_id),
        )
        conn.commit()
        return get_user_by_id(user_id)
    finally:
        conn.close()


# ---------- affiliate program ----------

def clean_code(value):
    """
    Turns a Discord name into a safe referral code: lowercase letters,
    digits, "_" and "-" only. Discord handles may contain "." — that's
    swapped for "_" because Stripe's client_reference_id (which carries
    the code through checkout) doesn't allow dots.
    """
    value = (value or "").strip().lower().replace(".", "_")
    return re.sub(r"[^a-z0-9_-]", "", value)[:32]


def get_affiliate_by_code(code):
    code = clean_code(code)
    if not code:
        return None
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM affiliates WHERE code = ?", (code,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_or_create_affiliate(user):
    """
    Every user with a linked Discord account gets a referral code equal to
    their Discord name, created automatically the first time it's needed.
    The code never changes afterwards, even if they rename themselves on
    Discord, so links they've already shared keep working.
    """
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM affiliates WHERE user_id = ?", (user["id"],)).fetchone()
        if row:
            return dict(row)

        base = clean_code(user.get("discord_handle")) \
            or clean_code(user.get("discord_username")) \
            or clean_code(user.get("username"))
        if not base:
            base = "user"
        # First choice is the plain Discord name; if somebody already has
        # it, fall back to name + user id (ids are unique, so this can't clash).
        candidates = [base[:32], f"{base[:24]}{user['id']}"]

        for code in candidates:
            try:
                conn.execute(
                    "INSERT INTO affiliates (user_id, code, created_at) VALUES (?, ?, ?)",
                    (user["id"], code, datetime.now(timezone.utc).isoformat()),
                )
                conn.commit()
                break
            except sqlite3.IntegrityError:
                conn.rollback()
                # Either the code is taken (try the next candidate) or a
                # parallel request already created this user's row.
                existing = conn.execute(
                    "SELECT * FROM affiliates WHERE user_id = ?", (user["id"],)
                ).fetchone()
                if existing:
                    return dict(existing)

        row = conn.execute("SELECT * FROM affiliates WHERE user_id = ?", (user["id"],)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def record_affiliate_click(code):
    code = clean_code(code)
    if not code:
        return False
    conn = get_connection()
    try:
        cur = conn.execute("UPDATE affiliates SET clicks = clicks + 1 WHERE code = ?", (code,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def credit_affiliate_sale(stripe_session_id, code, amount_cents, buyer_email, percent):
    """
    Adds a commission for one paid Stripe checkout. Returns a short status
    string (handy for logs): credited / duplicate / unknown_code /
    self_referral / no_amount.
    """
    code = clean_code(code)
    if not code or not stripe_session_id:
        return "unknown_code"
    if not amount_cents or amount_cents <= 0:
        return "no_amount"

    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT a.user_id, u.email FROM affiliates a JOIN users u ON u.id = a.user_id WHERE a.code = ?",
            (code,),
        ).fetchone()
        if not row:
            return "unknown_code"

        # Can't earn commission by buying through your own link.
        if buyer_email and buyer_email.strip().lower() == (row["email"] or "").strip().lower():
            return "self_referral"

        commission = amount_cents * int(percent) // 100
        try:
            conn.execute(
                "INSERT INTO affiliate_sales (stripe_session_id, code, amount_cents, commission_cents, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (stripe_session_id, code, amount_cents, commission, datetime.now(timezone.utc).isoformat()),
            )
        except sqlite3.IntegrityError:
            return "duplicate"

        conn.execute(
            "UPDATE affiliates SET sales = sales + 1, earned_cents = earned_cents + ?, "
            "balance_cents = balance_cents + ? WHERE user_id = ?",
            (commission, commission, row["user_id"]),
        )
        conn.commit()
        return "credited"
    finally:
        conn.close()
