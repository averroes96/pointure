"""
Fly.io deployment settings.
Inherits production hardening but adapts for containerised free-tier hosting:
  - Email optional (console backend when SMTP vars are absent)
  - WhiteNoise serves static files (no nginx reverse proxy)
  - SSL handled at Fly edge, not inside Django
  - Stdout-only logging (Fly captures stdout)
  - Celery beat slowed to stay within Upstash free tier (10 k cmd/day)
"""
from decouple import config

from .production import *  # noqa: F401, F403

# ─────────────────────────────────────────────
# SSL — terminated at Fly edge, not in Django
# ─────────────────────────────────────────────
SECURE_SSL_REDIRECT = False
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# ─────────────────────────────────────────────
# Email — SMTP optional; fall back to console for demo
# ─────────────────────────────────────────────
EMAIL_HOST = config("EMAIL_HOST", default="localhost")
EMAIL_HOST_USER = config("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = config("EMAIL_HOST_PASSWORD", default="")

if not EMAIL_HOST_USER:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# ─────────────────────────────────────────────
# Static files — WhiteNoise (no nginx on Fly.io)
# ─────────────────────────────────────────────
_mw = list(MIDDLEWARE)  # noqa: F405
_mw.insert(1, "whitenoise.middleware.WhiteNoiseMiddleware")
MIDDLEWARE = _mw

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"
    },
}

# ─────────────────────────────────────────────
# Logging — stdout only (Fly captures all stdout logs)
# ─────────────────────────────────────────────
LOGGING["root"]["handlers"] = ["console"]  # noqa: F405
LOGGING["handlers"].pop("file", None)  # noqa: F405

# ─────────────────────────────────────────────
# Celery beat — poll every 5 min to stay within Upstash 10 k cmd/day free tier
# (passed via --max-interval in fly.toml process command)
# ─────────────────────────────────────────────
