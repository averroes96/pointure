"""
ShoeDZ — Base Django Settings
Shared across all environments. Never use directly — import from development.py or production.py.
"""
import os
from datetime import timedelta
from pathlib import Path

from celery.schedules import crontab
from decouple import config, Csv

# ─────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# ─────────────────────────────────────────────
# Security
# ─────────────────────────────────────────────
SECRET_KEY = config("SECRET_KEY")
DEBUG = config("DEBUG", default=False, cast=bool)
ALLOWED_HOSTS = config("ALLOWED_HOSTS", default="localhost", cast=Csv())

# ─────────────────────────────────────────────
# Application Definition
# ─────────────────────────────────────────────
DJANGO_APPS = [
    "admin_interface",
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
    "django_celery_beat",
    "django_celery_results",
    "django_extensions",
    "storages",
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
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

# ─────────────────────────────────────────────
# Deployment mode & licensing
# ─────────────────────────────────────────────
# "cloud"  — SaaS multi-tenant mode; license checking is disabled.
# "local"  — Self-hosted single-tenant; license enforcement is active.
DEPLOYMENT_MODE = config("DEPLOYMENT_MODE", default="cloud")

LICENSE_KEY = config("LICENSE_KEY", default="")
LICENSE_SERVER_URL = config("LICENSE_SERVER_URL", default="https://licenses.shodz.app")
LICENSE_GRACE_DAYS = 7   # Days the app can run without reaching the license server
APP_VERSION = config("APP_VERSION", default="1.0.0")

# ─────────────────────────────────────────────
# Mobile / Push notifications (cloud mode only)
# ─────────────────────────────────────────────
# Provide ONE of the two. Base64 is preferred for container environments.
# FIREBASE_CREDENTIALS_BASE64: base64-encoded service account JSON
# FIREBASE_CREDENTIALS_JSON:   path to service account JSON file
FIREBASE_CREDENTIALS_BASE64 = config("FIREBASE_CREDENTIALS_BASE64", default="")
FIREBASE_CREDENTIALS_JSON = config("FIREBASE_CREDENTIALS_JSON", default="")

# ─────────────────────────────────────────────
# Middleware
# ─────────────────────────────────────────────
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
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
# Database
# ─────────────────────────────────────────────
import dj_database_url  # noqa: E402 – imported here to avoid circular issues

DATABASE_URL = config("DATABASE_URL", default="postgres://shodz:shodz_dev@localhost:5432/shodz")
DATABASES = {
    "default": dj_database_url.parse(DATABASE_URL, conn_max_age=600),
}

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
# Static & Media
# ─────────────────────────────────────────────
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

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
        "anon": "200/day",
        "user": "2000/hour",
        "login": "5/minute",
        "password_reset": "3/hour",
        "mobile": "500/hour",
    },
}

# ─────────────────────────────────────────────
# JWT Settings
# ─────────────────────────────────────────────
from datetime import timedelta  # noqa: E402

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=8),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
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
    "DESCRIPTION": "Shoe Retail & Wholesale Management Platform — Algeria",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "SCHEMA_PATH_PREFIX": "/api/v1",
}

# ─────────────────────────────────────────────
# Celery
# ─────────────────────────────────────────────
REDIS_URL = config("REDIS_URL", default="redis://localhost:6379/0")

CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = "django-db"
CELERY_CACHE_BACKEND = "django-cache"
CELERY_TIMEZONE = "Africa/Algiers"
CELERY_TASK_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_RESULT_SERIALIZER = "json"
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_TIME_LIMIT = 300  # 5 minutes
CELERY_TASK_SOFT_TIME_LIMIT = 240
CELERY_BEAT_SCHEDULER = "django_celery_beat.schedulers:DatabaseScheduler"
CELERY_TASK_ROUTES = {
    "apps.invoicing.tasks.*": {"queue": "pdf"},
    "apps.notifications.tasks.*": {"queue": "notifications"},
}

# Periodic tasks — all times interpreted in CELERY_TIMEZONE (Africa/Algiers).
# With DatabaseScheduler these are seeded into the DB on first startup and can
# be overridden later via Django admin without a redeploy.
CELERY_BEAT_SCHEDULE = {
    # Flag invoices past their due date as "overdue" — must run before business opens.
    "flag-overdue-invoices": {
        "task": "apps.notifications.tasks.flag_overdue_invoices",
        "schedule": crontab(hour=7, minute=0),          # 07:00 daily
        "options": {"queue": "notifications"},
    },
    # Notify owners of cheques maturing within 3 days.
    "check-cheque-due-dates": {
        "task": "apps.notifications.tasks.check_cheque_due_dates",
        "schedule": crontab(hour=8, minute=0),          # 08:00 daily
        "options": {"queue": "notifications"},
    },
    # Low-stock sweep — runs four times a day; task deduplicates within 24 h.
    "check-low-stock": {
        "task": "apps.notifications.tasks.check_low_stock",
        "schedule": timedelta(hours=6),                  # every 6 hours
        "options": {"queue": "notifications"},
    },
    # License heartbeat — self-hosted mode only; no-op in cloud mode.
    "license-heartbeat": {
        "task": "licensing.heartbeat",
        "schedule": timedelta(minutes=30),               # every 30 minutes
        "options": {"queue": "default"},
    },
    # Database backup — only runs when BACKUP_ENABLED=true.
    "database-backup": {
        "task": "apps.core.tasks.backup_database",
        "schedule": crontab(hour=2, minute=0),           # 02:00 daily
        "options": {"queue": "default"},
    },
}

# ─────────────────────────────────────────────
# Cache
# ─────────────────────────────────────────────
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
    }
}

# ─────────────────────────────────────────────
# Email
# ─────────────────────────────────────────────
# Development default: print to console so no SMTP server is needed locally.
# Override EMAIL_BACKEND to smtp.EmailBackend (or any other) via .env / env vars.
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
EMAIL_TIMEOUT = config("EMAIL_TIMEOUT", default=10, cast=int)   # seconds; avoids hanging
DEFAULT_FROM_EMAIL = config("DEFAULT_FROM_EMAIL", default="noreply@shodz.dz")
# Address that appears in the "From" header of server error emails sent to ADMINS.
SERVER_EMAIL = config("SERVER_EMAIL", default="errors@shodz.dz")
EMAIL_SUBJECT_PREFIX = config("EMAIL_SUBJECT_PREFIX", default="[ShoeDZ] ")

# Comma-separated "Name <email>" pairs read from the environment, e.g.:
#   DJANGO_ADMINS=Alice <alice@example.com>,Bob <bob@example.com>
_raw_admins = config("DJANGO_ADMINS", default="")
ADMINS = [
    (part.split("<")[0].strip(), part.split("<")[1].rstrip(">").strip())
    for part in _raw_admins.split(",")
    if "<" in part
]
MANAGERS = ADMINS

# ─────────────────────────────────────────────
# CORS
# ─────────────────────────────────────────────
CORS_ALLOWED_ORIGINS = config("CORS_ALLOWED_ORIGINS", default="http://localhost:5173", cast=Csv())
CORS_ALLOW_CREDENTIALS = True

# ─────────────────────────────────────────────
# Frontend
# ─────────────────────────────────────────────
FRONTEND_URL = config("FRONTEND_URL", default="http://localhost")

# ─────────────────────────────────────────────
# ─────────────────────────────────────────────
# Cloud Storage
# ─────────────────────────────────────────────
# STORAGE_PROVIDER selects the backend for uploaded media files.
#
# Provider          | Value          | Required env vars
# ------------------|----------------|--------------------------------------------------
# No cloud (dev)    | "local"        | — (uses filesystem)
# Amazon S3         | "aws"          | STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY, STORAGE_BUCKET, STORAGE_REGION
# Cloudflare R2     | "cloudflare"   | same as aws + STORAGE_ENDPOINT_URL
# Backblaze B2      | "backblaze"    | same as aws + STORAGE_ENDPOINT_URL
# Google Cloud      | "gcs"          | STORAGE_BUCKET, GCS_CREDENTIALS_BASE64 (or GOOGLE_APPLICATION_CREDENTIALS)
# Azure Blob        | "azure"        | AZURE_ACCOUNT_NAME, AZURE_ACCOUNT_KEY, STORAGE_BUCKET
#
# Optional for all: STORAGE_CDN_DOMAIN — custom CDN domain in front of the bucket

STORAGE_PROVIDER = config("STORAGE_PROVIDER", default="local")

_S3_COMPATIBLE = {"aws", "cloudflare", "backblaze", "minio"}

if STORAGE_PROVIDER in _S3_COMPATIBLE:
    AWS_ACCESS_KEY_ID       = config("STORAGE_ACCESS_KEY")
    AWS_SECRET_ACCESS_KEY   = config("STORAGE_SECRET_KEY")
    AWS_STORAGE_BUCKET_NAME = config("STORAGE_BUCKET")
    AWS_S3_REGION_NAME      = config("STORAGE_REGION", default="auto")
    _ep = config("STORAGE_ENDPOINT_URL", default="")
    AWS_S3_ENDPOINT_URL     = _ep or None          # None → native AWS endpoint
    AWS_DEFAULT_ACL         = "private"
    AWS_S3_FILE_OVERWRITE   = False
    AWS_QUERYSTRING_AUTH    = True
    AWS_QUERYSTRING_EXPIRE  = 900                  # 15-min signed URLs
    AWS_S3_OBJECT_PARAMETERS = {"CacheControl": "max-age=86400"}
    _cdn = config("STORAGE_CDN_DOMAIN", default="")
    if _cdn:
        AWS_S3_CUSTOM_DOMAIN = _cdn
        AWS_QUERYSTRING_AUTH = False               # CDN serves files publicly
    STORAGES = {
        "default":    {"BACKEND": "storages.backends.s3boto3.S3Boto3Storage"},
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }

elif STORAGE_PROVIDER == "gcs":
    import base64 as _b64, json as _json, os as _os, tempfile as _tmp
    GS_BUCKET_NAME   = config("STORAGE_BUCKET")
    GS_DEFAULT_ACL   = None                        # uniform bucket-level access
    GS_FILE_OVERWRITE = False
    GS_EXPIRATION    = 900
    _creds_b64 = config("GCS_CREDENTIALS_BASE64", default="")
    if _creds_b64:
        _tf = _tmp.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
        _json.dump(_json.loads(_b64.b64decode(_creds_b64)), _tf)
        _tf.close()
        _os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = _tf.name
    _cdn = config("STORAGE_CDN_DOMAIN", default="")
    if _cdn:
        GS_CUSTOM_ENDPOINT = f"https://{_cdn}"
    STORAGES = {
        "default":    {"BACKEND": "storages.backends.gcloud.GoogleCloudStorage"},
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }

elif STORAGE_PROVIDER == "azure":
    AZURE_ACCOUNT_NAME   = config("AZURE_ACCOUNT_NAME")
    AZURE_ACCOUNT_KEY    = config("AZURE_ACCOUNT_KEY")
    AZURE_CONTAINER      = config("STORAGE_BUCKET")
    AZURE_OVERWRITE_FILES = False
    AZURE_URL_EXPIRATION_SECS = 900
    _cdn = config("STORAGE_CDN_DOMAIN", default="")
    if _cdn:
        AZURE_CUSTOM_DOMAIN = _cdn
    STORAGES = {
        "default":    {"BACKEND": "storages.backends.azure_storage.AzureStorage"},
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }

# ─────────────────────────────────────────────
# Database Backup
# ─────────────────────────────────────────────
# Independent of STORAGE_PROVIDER — backups can go to a different bucket / provider.
# Uses S3-compatible API (all four major providers support this):
#   AWS S3         → leave BACKUP_ENDPOINT_URL empty
#   Cloudflare R2  → BACKUP_ENDPOINT_URL=https://{account_id}.r2.cloudflarestorage.com
#   Backblaze B2   → BACKUP_ENDPOINT_URL=https://s3.{region}.backblazeb2.com
#   GCS (interop)  → BACKUP_ENDPOINT_URL=https://storage.googleapis.com
#   Azure (Azurite)→ BACKUP_ENDPOINT_URL=http://127.0.0.1:10000/{account}

BACKUP_ENABLED        = config("BACKUP_ENABLED", default=False, cast=bool)
BACKUP_ACCESS_KEY     = config("BACKUP_ACCESS_KEY", default="")
BACKUP_SECRET_KEY     = config("BACKUP_SECRET_KEY", default="")
BACKUP_BUCKET         = config("BACKUP_BUCKET", default="")
BACKUP_REGION         = config("BACKUP_REGION", default="auto")
_bep = config("BACKUP_ENDPOINT_URL", default="")
BACKUP_ENDPOINT_URL   = _bep or None
BACKUP_RETENTION_DAYS = config("BACKUP_RETENTION_DAYS", default=30, cast=int)

# ─────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────
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
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "django": {"handlers": ["console"], "level": "WARNING", "propagate": False},
        "apps": {"handlers": ["console"], "level": "DEBUG", "propagate": False},
        "celery": {"handlers": ["console"], "level": "INFO", "propagate": False},
    },
}

# ─────────────────────────────────────────────
# Sentry — error monitoring & performance tracing
# ─────────────────────────────────────────────
SENTRY_DSN = config("SENTRY_DSN", default="")


def _sentry_before_send(event, hint):
    """Filter out events that add noise without actionable signal."""
    if "exc_info" in hint:
        exc_type, _, _ = hint["exc_info"]
        noisy = (
            "NotFound",
            "PermissionDenied",
            "AuthenticationFailed",
            "NotAuthenticated",
            "Throttled",
        )
        if exc_type and exc_type.__name__ in noisy:
            return None
    request = event.get("request", {})
    if request.get("url", "").endswith("/healthz"):
        return None
    return event


if SENTRY_DSN:
    import logging

    import sentry_sdk
    from sentry_sdk.integrations.celery import CeleryIntegration
    from sentry_sdk.integrations.django import DjangoIntegration
    from sentry_sdk.integrations.logging import LoggingIntegration

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[
            DjangoIntegration(
                transaction_style="url",
                middleware_spans=False,
                signals_spans=False,
            ),
            CeleryIntegration(monitor_beat_tasks=True),
            LoggingIntegration(
                level=logging.WARNING,
                event_level=logging.ERROR,
            ),
        ],
        traces_sample_rate=0.1,
        profiles_sample_rate=0.1,
        release=config("APP_VERSION", default="dev"),
        environment=config("DEPLOYMENT_MODE", default="cloud"),
        send_default_pii=False,
        ignore_errors=[
            KeyboardInterrupt,
            "django.exceptions.DisallowedHost",
        ],
        before_send=_sentry_before_send,
    )


# ─────────────────────────────────────────────
# Admin Interface
# ─────────────────────────────────────────────
X_FRAME_OPTIONS = "SAMEORIGIN"
SILENCED_SYSTEM_CHECKS = ["security.W019"]
