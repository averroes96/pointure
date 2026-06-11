"""
Render.com deployment settings.
Inherits from base (not production) to avoid hard-required EMAIL_HOST.
Applies production security hardening manually, then adapts for Render:
  - SSL terminated at Render edge, not inside Django
  - WhiteNoise serves static files (no nginx)
  - Email optional (console fallback when SMTP vars are absent)
  - Stdout-only logging
  - Celery tasks run eagerly in-process (no background worker on free tier)
"""
from decouple import config

from .base import *  # noqa: F401, F403

# ─────────────────────────────────────────────
# Security hardening (mirrors production.py)
# ─────────────────────────────────────────────
DEBUG = False
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_BROWSER_XSS_FILTER = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# SSL terminated at Render edge proxy — don't redirect inside Django
SECURE_SSL_REDIRECT = False
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# ─────────────────────────────────────────────
# Email — optional; console backend when SMTP vars are absent
# ─────────────────────────────────────────────
EMAIL_HOST = config("EMAIL_HOST", default="localhost")
EMAIL_PORT = config("EMAIL_PORT", default=587, cast=int)
EMAIL_HOST_USER = config("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = config("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = config("EMAIL_USE_TLS", default=True, cast=bool)

if EMAIL_HOST_USER:
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
else:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# ─────────────────────────────────────────────
# Static files — WhiteNoise (no nginx on Render free tier)
# ─────────────────────────────────────────────
MIDDLEWARE.insert(1, "whitenoise.middleware.WhiteNoiseMiddleware")  # noqa: F405

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"
    },
}

# ─────────────────────────────────────────────
# Logging — stdout only
# ─────────────────────────────────────────────
LOGGING["root"]["handlers"] = ["console"]  # noqa: F405

# ─────────────────────────────────────────────
# Celery — run tasks eagerly in-process (no background worker on free tier)
# ─────────────────────────────────────────────
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
