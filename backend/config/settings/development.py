"""Development settings — DEBUG mode, relaxed security, SQLite optional."""
from .base import *  # noqa: F401, F403

DEBUG = True

INSTALLED_APPS += ["debug_toolbar"]  # noqa: F405

MIDDLEWARE = [
    "debug_toolbar.middleware.DebugToolbarMiddleware",
] + MIDDLEWARE  # noqa: F405

INTERNAL_IPS = ["127.0.0.1", "::1"]

# In development, allow all origins for convenience
CORS_ALLOW_ALL_ORIGINS = True

# Show emails in console
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# Relaxed password validation in dev
AUTH_PASSWORD_VALIDATORS = []  # noqa: F405

# Static/media served locally
MEDIA_URL = "/media/"

# Disable HTTPS redirect
SECURE_SSL_REDIRECT = False
