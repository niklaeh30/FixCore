"""
SQLite storage for redemption keys.

Keeps things deliberately simple: a single 'keys' table, one connection
opened per call (fine at this volume, and avoids cross-thread sqlite
issues between the Flask webhook thread and the discord.py bot thread).
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone

from config import settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS keys (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    key             TEXT NOT NULL UNIQUE,
    stripe_session_id TEXT UNIQUE,
    customer_email  TEXT,
    price_id        TEXT,
    role_id         INTEGER NOT NULL,
    redeemed        INTEGER NOT NULL DEFAULT 0,
    redeemed_by_id  TEXT,
    redeemed_by_name TEXT,
    created_at      TEXT NOT NULL,
    redeemed_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_keys_key ON keys(key);
CREATE INDEX IF NOT EXISTS idx_keys_session ON keys(stripe_session_id);
"""


@dataclass
class KeyRecord:
    id: int
    key: str
    stripe_session_id: str | None
    customer_email: str | None
    price_id: str | None
    role_id: int
    redeemed: bool
    redeemed_by_id: str | None
    redeemed_by_name: str | None
    created_at: str
    redeemed_at: str | None


@contextmanager
def _connect():
    conn = sqlite3.connect(settings.database_path, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(_SCHEMA)


def _row_to_record(row: sqlite3.Row) -> KeyRecord:
    return KeyRecord(
        id=row["id"],
        key=row["key"],
        stripe_session_id=row["stripe_session_id"],
        customer_email=row["customer_email"],
        price_id=row["price_id"],
        role_id=row["role_id"],
        redeemed=bool(row["redeemed"]),
        redeemed_by_id=row["redeemed_by_id"],
        redeemed_by_name=row["redeemed_by_name"],
        created_at=row["created_at"],
        redeemed_at=row["redeemed_at"],
    )


def create_key(
    key: str,
    role_id: int,
    stripe_session_id: str | None = None,
    customer_email: str | None = None,
    price_id: str | None = None,
) -> KeyRecord:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO keys (key, stripe_session_id, customer_email, price_id, role_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (key, stripe_session_id, customer_email, price_id, role_id, now),
        )
        row = conn.execute("SELECT * FROM keys WHERE id = ?", (cur.lastrowid,)).fetchone()
        return _row_to_record(row)


def get_key(key: str) -> KeyRecord | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM keys WHERE key = ?", (key.strip().upper(),)
        ).fetchone()
        return _row_to_record(row) if row else None


def get_key_by_session(stripe_session_id: str) -> KeyRecord | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM keys WHERE stripe_session_id = ?", (stripe_session_id,)
        ).fetchone()
        return _row_to_record(row) if row else None


def mark_redeemed(key: str, redeemed_by_id: str, redeemed_by_name: str) -> bool:
    """
    Atomically mark a key as redeemed. Returns True only if this call is the
    one that flipped it (protects against a double-submit / race condition).
    """
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        cur = conn.execute(
            """
            UPDATE keys
            SET redeemed = 1, redeemed_by_id = ?, redeemed_by_name = ?, redeemed_at = ?
            WHERE key = ? AND redeemed = 0
            """,
            (redeemed_by_id, redeemed_by_name, now, key.strip().upper()),
        )
        return cur.rowcount == 1


def get_latest_key_for_user(discord_id: str) -> KeyRecord | None:
    """
    Most recent redeemed key for a given Discord user ID — used by the
    website dashboard to show someone their own license key without
    them having to dig it out of Discord DMs again.
    """
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM keys
            WHERE redeemed_by_id = ? AND redeemed = 1
            ORDER BY redeemed_at DESC
            LIMIT 1
            """,
            (str(discord_id),),
        ).fetchone()
        return _row_to_record(row) if row else None
