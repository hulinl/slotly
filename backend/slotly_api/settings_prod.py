"""
Production-only settings overrides for Phase-1 Azure deployment.

Activate with `DJANGO_SETTINGS_MODULE=slotly_api.settings_prod`. Inherits
everything from `settings.py` and only overrides what differs in production:

- DEBUG is forced off; allowed hosts come from env.
- Postgres comes from DATABASE_URL (Azure Database for PostgreSQL FS).
- Cache + rate-limit storage move from Redis to Django's DatabaseCache,
  per the Phase-1 cost plan. No Redis is provisioned.
- Email goes via Azure Communication Services SMTP (with env-driven
  credentials).
- Static + media files served behind the Azure Static Web Apps / Container
  Apps managed certs; HSTS enabled.
- Celery is disabled — `manage.py poll_calendars` runs from a Container
  Apps Job triggered every 5 minutes.

Tighten further once the app is actually running in Azure (CSP, allowed
hosts, secret rotation policy, etc.).
"""

from __future__ import annotations

from .settings import *  # noqa: F401,F403  — pull base settings
from .settings import env  # noqa: E402

# --- Core ---
DEBUG = False
ALLOWED_HOSTS = env(
    "DJANGO_ALLOWED_HOSTS",
    default=["slotly.team", ".azurecontainerapps.io", "localhost"],
)

# --- Cookies / TLS ---
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env.bool("DJANGO_SECURE_SSL_REDIRECT", default=True)
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30  # 30 days; widen after launch
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = False
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"

# --- CORS / CSRF for prod frontend on slotly.team ---
FRONTEND_BASE_URL = env("FRONTEND_BASE_URL", default="https://slotly.team")
CORS_ALLOWED_ORIGINS = env(
    "CORS_ALLOWED_ORIGINS",
    default=[FRONTEND_BASE_URL],
)
CSRF_TRUSTED_ORIGINS = env(
    "CSRF_TRUSTED_ORIGINS",
    default=[FRONTEND_BASE_URL],
)

# --- Cache + rate-limit storage: Postgres-backed, no Redis ---
# `python manage.py createcachetable django_cache` once after first migrate.
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.db.DatabaseCache",
        "LOCATION": "django_cache",
    },
}

# --- Allauth headless URLs use the production frontend host ---
HEADLESS_FRONTEND_URLS = {
    "account_confirm_email": f"{FRONTEND_BASE_URL}/auth/verify/{{key}}",
    "account_reset_password": f"{FRONTEND_BASE_URL}/auth/forgot",
    "account_reset_password_from_key": f"{FRONTEND_BASE_URL}/auth/reset/{{key}}",
    "account_signup": f"{FRONTEND_BASE_URL}/auth/register",
}

# --- Email: Azure Communication Services via SMTP ---
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = env("EMAIL_HOST", default="smtp.azurecomm.net")
EMAIL_PORT = env.int("EMAIL_PORT", default=587)
EMAIL_USE_TLS = True
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="no-reply@slotly.team")

# --- Logging: send to stdout for Container Apps log streaming ---
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "compact": {
            "format": "{levelname} {name} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "compact",
        },
    },
    "loggers": {
        "django": {"handlers": ["console"], "level": "INFO"},
        "apps": {"handlers": ["console"], "level": "INFO"},
        "celery": {"handlers": ["console"], "level": "WARNING"},
    },
    "root": {"handlers": ["console"], "level": "INFO"},
}
