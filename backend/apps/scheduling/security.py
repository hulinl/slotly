"""
Token encryption for GoogleAccount.

Mirrors apps.calendars.security but kept as its own module so we can rotate
the underlying key independently if the threat model ever requires it. For
now both share CALENDAR_URL_ENCRYPTION_KEY — splitting later is a matter of
adding GOOGLE_TOKEN_ENCRYPTION_KEY env + a one-time re-encryption pass.
"""

from __future__ import annotations

import base64
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings


def _normalize_key(key: str) -> bytes:
    if not key:
        raise RuntimeError("CALENDAR_URL_ENCRYPTION_KEY is not set")
    candidate = key.replace("+", "-").replace("/", "_").rstrip("=")
    candidate += "=" * (-len(candidate) % 4)
    try:
        raw = base64.urlsafe_b64decode(candidate.encode())
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"CALENDAR_URL_ENCRYPTION_KEY is not valid base64: {exc}") from exc
    if len(raw) != 32:
        raise RuntimeError(
            f"CALENDAR_URL_ENCRYPTION_KEY must decode to 32 bytes, got {len(raw)}",
        )
    return candidate.encode()


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    return Fernet(_normalize_key(settings.CALENDAR_URL_ENCRYPTION_KEY))


def encrypt(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise ValueError("Encrypted Google token is corrupt or key changed") from exc
