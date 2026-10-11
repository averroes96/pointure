"""
ShoeDZ — Desktop Distribution Django Settings.

Standalone desktop profile:
- Embedded SQLite with Write-Ahead Logging (WAL)
- Multi-threaded Waitress WSGI
- In-memory caching and synchronous Celery execution
- Local filesystem storage
- Chromium printToPDF bridge for PDF output
"""
import os
from datetime import timedelta
from pathlib import Path

from decouple import config

# ─────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Persistent shared application data directory.
# Windows: %ProgramData%\ShoeDZ (shared by all users on machine)
# Fallback: %APPDATA%\ShoeDZ or BASE_DIR/data (development/testing)
_custom_data = os.environ.get("SHODZ_DATA_DIR", "")
_programdata = os.environ.get("PROGRAMDATA", "")
_appdata = os.environ.get("APPDATA", "")

if _custom_data:
    DATA_DIR = Path(_custom_data)
elif _programdata:
    DATA_DIR = Path(_programdata) / "ShoeDZ"
elif _appdata:
    DATA_DIR = Path(_appdata) / "ShoeDZ"
else:
    DATA_DIR = BASE_DIR / "data"

DATA_DIR.mkdir(parents=True, exist_ok=True)

# ─────────────────────────────────────────────
# Desktop mode flags
# ─────────────────────────────────────────────
DESKTOP_MODE = True
DEPLOYMENT_MODE = "local"

# ─────────────────────────────────────────────
# Security
# ─────────────────────────────────────────────
SECRET_KEY = config("SECRET_KEY", default="shodz-desktop-local-production-secret-key-change-me")
DEBUG = config("DEBUG", default=False, cast=bool)

# Strictly local loopback only (Single-PC v1)
ALLOWED_HOSTS = ["localhost", "127.0.0.1"]

# ─────────────────────────────────────────────
# Application Definition
# ─────────────────────────────────────────────
DJANGO_APPS = [
    "unfold",
    "colorfield",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    "django_extensions",
]

LOCAL_APPS = [
    "apps.core",
    "apps.inventory",
    "apps.sales",
    "apps.invoicing",
    "apps.clients",
    "apps.suppliers",
    "apps.reports",
    "apps.notifications",
    "apps.licensing",
    "apps.mobile",
    "apps.loyalty",
    "apps.promotions",
    "apps.events",
    "apps.webhooks",
    "apps.delivery_integrations",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

# ─────────────────────────────────────────────
# Licensing
# ─────────────────────────────────────────────
LICENSE_KEY = config("LICENSE_KEY", default="")
LICENSE_SERVER_URL = config("LICENSE_SERVER_URL", default="https://licenses.shodz.app")
LICENSE_GRACE_DAYS = 7
APP_VERSION = config("APP_VERSION", default="1.0.0")

# ─────────────────────────────────────────────
# Middleware
# ─────────────────────────────────────────────
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "apps.core.middleware.TenantMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

# ─────────────────────────────────────────────
# Templates
# ─────────────────────────────────────────────
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# ─────────────────────────────────────────────
# Database — SQLite (WAL mode)
# ─────────────────────────────────────────────
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": DATA_DIR / "db.sqlite3",
        "OPTIONS": {
            "timeout": 30,
        },
    }
}

# Configure SQLite PRAGMA journal_mode=WAL on connection
from django.db.backends.signals import connection_created  # noqa: E402


def _configure_sqlite_wal(sender, connection, **kwargs):
    if connection.vendor == "sqlite":
        with connection.cursor() as cursor:
            cursor.execute("PRAGMA journal_mode = WAL;")
            cursor.execute("PRAGMA synchronous = NORMAL;")
            cursor.execute("PRAGMA busy_timeout = 30000;")


connection_created.connect(_configure_sqlite_wal)

# ─────────────────────────────────────────────
# Custom Auth
# ─────────────────────────────────────────────
AUTH_USER_MODEL = "core.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ─────────────────────────────────────────────
# Internationalisation
# ─────────────────────────────────────────────
LANGUAGE_CODE = "fr-dz"
TIME_ZONE = "Africa/Algiers"
USE_I18N = True
USE_L10N = True
USE_TZ = True

LANGUAGES = [
    ("ar", "العربية"),
    ("fr", "Français"),
    ("en", "English"),
]

LOCALE_PATHS = [BASE_DIR / "locale"]

# ─────────────────────────────────────────────
# Static & Media files
# ─────────────────────────────────────────────
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]

# Add built SPA directory if bundled
SPA_DIR = BASE_DIR / "static" / "spa"
if SPA_DIR.exists():
    STATICFILES_DIRS.append(SPA_DIR)

MEDIA_URL = "/media/"
MEDIA_ROOT = DATA_DIR / "media"
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ─────────────────────────────────────────────
# Django REST Framework
# ─────────────────────────────────────────────
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardResultsPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "EXCEPTION_HANDLER": "apps.core.exceptions.custom_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "1000/hour",
        "user": "5000/hour",
        "login": "20/minute",
        "password_reset": "10/hour",
    },
}

# ─────────────────────────────────────────────
# JWT Settings
# ─────────────────────────────────────────────
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=12),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=60),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}

# ─────────────────────────────────────────────
# OpenAPI / drf-spectacular
# ─────────────────────────────────────────────
SPECTACULAR_SETTINGS = {
    "TITLE": "ShoeDZ API",
    "DESCRIPTION": "Shoe Retail & Wholesale Management Platform — Desktop Edition",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "SCHEMA_PATH_PREFIX": "/api/v1",
}

# ─────────────────────────────────────────────
# Cache — In-memory (no Redis required)
# ─────────────────────────────────────────────
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "shodz-desktop-cache",
    }
}

# ─────────────────────────────────────────────
# Celery — In-process eager execution (no worker required)
# ─────────────────────────────────────────────
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
CELERY_BROKER_URL = "memory://"
CELERY_RESULT_BACKEND = "cache"

# ─────────────────────────────────────────────
# Email — Console output default (offline safe)
# ─────────────────────────────────────────────
EMAIL_BACKEND = config(
    "EMAIL_BACKEND",
    default="django.core.mail.backends.console.EmailBackend",
)
EMAIL_HOST = config("EMAIL_HOST", default="localhost")
EMAIL_PORT = config("EMAIL_PORT", default=587, cast=int)
EMAIL_USE_TLS = config("EMAIL_USE_TLS", default=True, cast=bool)
EMAIL_USE_SSL = config("EMAIL_USE_SSL", default=False, cast=bool)
EMAIL_HOST_USER = config("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = config("EMAIL_HOST_PASSWORD", default="")
EMAIL_TIMEOUT = config("EMAIL_TIMEOUT", default=10, cast=int)
DEFAULT_FROM_EMAIL = config("DEFAULT_FROM_EMAIL", default="noreply@shodz.dz")
SERVER_EMAIL = config("SERVER_EMAIL", default="errors@shodz.dz")
EMAIL_SUBJECT_PREFIX = config("EMAIL_SUBJECT_PREFIX", default="[ShoeDZ] ")

ADMINS = []
MANAGERS = []

# ─────────────────────────────────────────────
# CORS — Loopback origins
# ─────────────────────────────────────────────
CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOW_CREDENTIALS = True

# ─────────────────────────────────────────────
# Storage — Local filesystem only
# ─────────────────────────────────────────────
STORAGE_PROVIDER = "local"
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedStaticFilesStorage",
    },
}

# ─────────────────────────────────────────────
# Security — Local loopback (no SSL redirect)
# ─────────────────────────────────────────────
SECURE_SSL_REDIRECT = False
SECURE_HSTS_SECONDS = 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = False
SECURE_HSTS_PRELOAD = False
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

# ─────────────────────────────────────────────
# Electron Chromium PDF Bridge
# ─────────────────────────────────────────────
PDF_BRIDGE_URL = config("PDF_BRIDGE_URL", default="http://127.0.0.1:8746/render-pdf")
PDF_BRIDGE_TOKEN = config("PDF_BRIDGE_TOKEN", default="")

# ─────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────
LOG_DIR = DATA_DIR / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "[{asctime}] {levelname} {name} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
        "file": {
            "class": "logging.FileHandler",
            "filename": str(LOG_DIR / "shodz.log"),
            "formatter": "verbose",
            "encoding": "utf-8",
        },
    },
    "root": {"handlers": ["console", "file"], "level": "INFO"},
    "loggers": {
        "django": {"handlers": ["console", "file"], "level": "WARNING", "propagate": False},
        "apps": {"handlers": ["console", "file"], "level": "INFO", "propagate": False},
    },
}

# ─────────────────────────────────────────────
# Admin Interface
# ─────────────────────────────────────────────
X_FRAME_OPTIONS = "SAMEORIGIN"
SILENCED_SYSTEM_CHECKS = ["security.W019"]

UNFOLD = {
    "SITE_TITLE": "ShoeDZ Admin",
    "SITE_HEADER": "ShoeDZ Admin",
    "SITE_URL": "/",
}
