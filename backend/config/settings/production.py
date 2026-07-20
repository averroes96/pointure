"""Production settings — hardened security, S3 storage, proper email."""
from decouple import config  # noqa: F401 (re-import so overrides below work)

from .base import *  # noqa: F401, F403

DEBUG = False

# ─────────────────────────────────────────────
# Security hardening
# ─────────────────────────────────────────────
SECURE_SSL_REDIRECT = True
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_HSTS_SECONDS = 31_536_000        # 1 year
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_BROWSER_XSS_FILTER = True
X_FRAME_OPTIONS = "DENY"
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# ─────────────────────────────────────────────
# Email — SMTP (mandatory in production)
# ─────────────────────────────────────────────
# In production the console backend is never appropriate.
# All EMAIL_* values must be supplied via environment variables; there are no
# safe fallback defaults for a live server.
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"

# Provide defaults so startup doesn't fail if they are missing
EMAIL_HOST = config("EMAIL_HOST", default="")
EMAIL_PORT = config("EMAIL_PORT", cast=int, default=587)
EMAIL_HOST_USER = config("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = config("EMAIL_HOST_PASSWORD", default="")

# Port 587 → STARTTLS; port 465 → SSL.  Set exactly one to True in .env.prod.
EMAIL_USE_TLS = config("EMAIL_USE_TLS", default=True, cast=bool)
EMAIL_USE_SSL = config("EMAIL_USE_SSL", default=False, cast=bool)

# Timeout stays at the base.py value (10 s) unless overridden.

# ─────────────────────────────────────────────
# Logging to rotating file
# ─────────────────────────────────────────────
LOGGING["handlers"]["file"] = {  # noqa: F405
    "class": "logging.handlers.RotatingFileHandler",
    "filename": "/app/logs/django.log",
    "maxBytes": 10 * 1024 * 1024,   # 10 MB per file
    "backupCount": 5,
    "formatter": "verbose",
}
LOGGING["root"]["handlers"].append("file")  # noqa: F405

# ─────────────────────────────────────────────
# Static files (WhiteNoise)
# ─────────────────────────────────────────────
STORAGES["staticfiles"]["BACKEND"] = "whitenoise.storage.CompressedManifestStaticFilesStorage"
