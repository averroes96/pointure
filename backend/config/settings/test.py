"""
ShoeDZ — Test Settings (SQLite / Desktop-based, no Docker or Postgres required).
"""
import os
import tempfile
from pathlib import Path

_TEMP_TEST_DIR = Path(tempfile.mkdtemp(prefix="shodz_test_"))
os.environ.setdefault("SHODZ_DATA_DIR", str(_TEMP_TEST_DIR))

from .desktop import *  # noqa: E402, F401, F403

DATA_DIR = Path(os.environ["SHODZ_DATA_DIR"])
MEDIA_ROOT = DATA_DIR / "media"
STATIC_ROOT = DATA_DIR / "staticfiles"
LOG_DIR = DATA_DIR / "logs"

for _dir in (DATA_DIR, MEDIA_ROOT, STATIC_ROOT, LOG_DIR):
    _dir.mkdir(parents=True, exist_ok=True)

DATABASES["default"]["NAME"] = DATA_DIR / "db.sqlite3"
LOGGING["handlers"]["file"]["filename"] = str(LOG_DIR / "shodz.log")

PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.MD5PasswordHasher",
]

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "shodz-test-cache",
    }
}

