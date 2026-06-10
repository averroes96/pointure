"""
Render.com deployment settings.
Inherits production hardening and adapts for Render's free-tier web service:
  - SSL terminated at Render edge, not inside Django
  - WhiteNoise serves static files (no nginx)
  - Email optional (console fallback when SMTP vars are absent)
  - Stdout-only logging (Render captures stdout)
  - Celery tasks run eagerly in-process (no background worker on free tier)
"""
from decouple import config

from .production import *  # noqa: F401, F403

# ─────────────────────────────────────────────
# SSL — terminated at Render edge proxy
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
# Static files — WhiteNoise (no nginx on Render free tier)
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
# Logging — stdout only (Render captures all stdout logs)
# ─────────────────────────────────────────────
LOGGING["root"]["handlers"] = ["console"]  # noqa: F405
LOGGING["handlers"].pop("file", None)  # noqa: F405

# ─────────────────────────────────────────────
# Celery — run tasks eagerly in the web process.
# Render's free tier has no background worker support.
# PDF generation and notifications still work; they just run synchronously.
# ─────────────────────────────────────────────
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
