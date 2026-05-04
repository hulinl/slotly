"""
Application-layer encryption for ICS subscription URLs.

The URL is treated as a secret: anyone with it has read access to the user's
calendar. We never log it, and at rest in the DB it's stored as a Fernet
token (AES-128-CBC + HMAC-SHA256) keyed off CALENDAR_URL_ENCRYPTION_KEY,
which in production is fetched from Azure Key Vault.
"""

from __future__ import annotations

import base64
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings


def _normalize_key(key: str) -> bytes:
    """Accept a 32-byte key in either standard or url-safe base64."""
    if not key:
        raise RuntimeError("CALENDAR_URL_ENCRYPTION_KEY is not set")
    # Convert standard base64 (+/) to url-safe (-_) so Fernet can decode it.
    candidate = key.replace("+", "-").replace("/", "_").rstrip("=")
    candidate += "=" * (-len(candidate) % 4)
    try:
        raw = base64.urlsafe_b64decode(candidate.encode())
    except Exception as exc:  # noqa: BLE001 — surface as configuration error
        raise RuntimeError(f"CALENDAR_URL_ENCRYPTION_KEY is not valid base64: {exc}") from exc
    if len(raw) != 32:
        raise RuntimeError(
            f"CALENDAR_URL_ENCRYPTION_KEY must decode to 32 bytes, got {len(raw)}",
        )
    return candidate.encode()


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    return Fernet(_normalize_key(settings.CALENDAR_URL_ENCRYPTION_KEY))


def encrypt_url(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_url(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise ValueError("Encrypted calendar URL is corrupt or key changed") from exc
