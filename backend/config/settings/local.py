"""
Self-hosted (on-premise) Django settings.

Extends production settings but disables features that require external
services (S3, SSL redirect) so the app can run on a local machine or LAN
server without a publicly routable domain.
"""
from .production import *  # noqa: F401, F403

# ── Override SSL-only enforcements (no TLS on local install) ─────────────────
SECURE_SSL_REDIRECT = False
SECURE_HSTS_SECONDS = 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = False
SECURE_HSTS_PRELOAD = False
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

# ── Allow HTTP origins for local network ─────────────────────────────────────
CORS_ALLOWED_ORIGINS = [
    "http://localhost",
    "http://127.0.0.1",
]

# ── Email: fall back to console if not configured ────────────────────────────
from decouple import config as _config

_email_host = _config("EMAIL_HOST", default="")
if not _email_host:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# ── Media files: local filesystem (no S3) ───────────────────────────────────
DEFAULT_FILE_STORAGE = "django.core.files.storage.FileSystemStorage"
STATICFILES_STORAGE = "django.contrib.staticfiles.storage.StaticFilesStorage"
