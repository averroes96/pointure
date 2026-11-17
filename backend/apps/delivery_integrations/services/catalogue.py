"""
Courier catalogue: the list of couriers dzship supports, with each courier's
platform, required credential names, capabilities and API address.

Source: GET {DzshipClient.BASE_URL}/couriers (docs/plans/delivery-v1-plan.md P1.3).

The catalogue is reference data shared by every store, so it is kept as one JSON
file in DATA_DIR rather than in the database: it needs no migration, it can be
fetched again at any time, and saving it never takes SQLite's single write lock.

Offline-first (AGENTS.md §3): requests are answered from the saved snapshot at once.
A missing or stale snapshot is refreshed in a background thread; a failed refresh
keeps the previous snapshot.
"""
import json
import logging
import os
import re
import threading
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

import requests
from django.conf import settings
from django.utils import timezone

from .dzship_client import DzshipClient

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 10
MAX_AGE = timedelta(hours=24)
SNAPSHOT_FILENAME = "courier_catalogue.json"

_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,49}$")
_CREDENTIAL_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,49}$")

_refresh_lock = threading.Lock()
_refresh_running = False


def snapshot_path() -> Path:
    data_dir = getattr(settings, "DATA_DIR", None) or (Path(settings.BASE_DIR) / "data")
    return Path(data_dir) / SNAPSHOT_FILENAME


# ─── Validation ────────────────────────────────────────────────────────────────

def _clean_https_url(value):
    if not isinstance(value, str) or len(value) > 255:
        return None
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname:
        return None
    return value.rstrip("/")


def clean_entry(raw):
    """Return a validated catalogue entry, or None when the entry is unusable."""
    if not isinstance(raw, dict):
        return None
    key = raw.get("key")
    name = raw.get("name")
    platform = raw.get("platform")
    credentials = raw.get("requiredCredentials")
    if not (isinstance(key, str) and _KEY_RE.match(key)):
        return None
    if not (isinstance(name, str) and 0 < len(name) <= 120):
        return None
    if not (isinstance(platform, str) and _KEY_RE.match(platform)):
        return None
    if not (
        isinstance(credentials, list)
        and 1 <= len(credentials) <= 8
        and all(isinstance(c, str) and _CREDENTIAL_RE.match(c) for c in credentials)
    ):
        return None

    capabilities = raw.get("capabilities") or {}
    if not isinstance(capabilities, dict):
        return None
    capabilities = {str(k): v for k, v in capabilities.items() if isinstance(v, bool)}

    entry = {
        "key": key,
        "name": name,
        "platform": platform,
        "required_credentials": list(credentials),
        "capabilities": capabilities,
        "endpoint": None,
        "requires_base_url": False,
        "base_url_suffixes": [],
    }
    if raw.get("requiresBaseUrl") is True:
        suffixes = raw.get("baseUrlSuffixes") or []
        if not (isinstance(suffixes, list) and suffixes and all(
            isinstance(s, str) and s.startswith(".") and len(s) <= 100 for s in suffixes
        )):
            return None
        entry["requires_base_url"] = True
        entry["base_url_suffixes"] = list(suffixes)
    else:
        endpoint = _clean_https_url(raw.get("endpoint"))
        if endpoint is None:
            return None
        entry["endpoint"] = endpoint
    return entry


# ─── Snapshot file ─────────────────────────────────────────────────────────────

def load_snapshot():
    """Return {"fetched_at": datetime, "couriers": [...]} or None when no usable snapshot exists."""
    path = snapshot_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        fetched_at = datetime.fromisoformat(data["fetched_at"])
        couriers = [e for e in (clean_entry_from_snapshot(c) for c in data["couriers"]) if e]
    except FileNotFoundError:
        return None
    except (OSError, ValueError, KeyError, TypeError):
        logger.warning("Courier catalogue snapshot unreadable; it will be fetched again", exc_info=True)
        return None
    if not couriers:
        return None
    return {"fetched_at": fetched_at, "couriers": couriers}


def clean_entry_from_snapshot(entry):
    """Snapshot entries are already in our shape; re-check the fields we rely on."""
    if not isinstance(entry, dict):
        return None
    raw = {
        "key": entry.get("key"),
        "name": entry.get("name"),
        "platform": entry.get("platform"),
        "requiredCredentials": entry.get("required_credentials"),
        "capabilities": entry.get("capabilities"),
        "endpoint": entry.get("endpoint"),
        "requiresBaseUrl": entry.get("requires_base_url"),
        "baseUrlSuffixes": entry.get("base_url_suffixes"),
    }
    return clean_entry(raw)


def _write_snapshot(couriers):
    path = snapshot_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"fetched_at": timezone.now().isoformat(), "couriers": couriers}
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)  # atomic: readers never see a half-written file


# ─── Refresh ───────────────────────────────────────────────────────────────────

def refresh_catalogue():
    """
    Fetch the catalogue from dzship and replace the snapshot.
    Returns True on success. Never raises: on any failure the old snapshot stays.
    """
    url = f"{DzshipClient.BASE_URL}/couriers"
    try:
        response = requests.get(url, headers={"Accept": "application/json"}, timeout=TIMEOUT_SECONDS)
        response.raise_for_status()
        raw = response.json()
    except (requests.RequestException, ValueError):
        logger.warning("Courier catalogue refresh failed; keeping the previous snapshot", exc_info=True)
        return False

    if not isinstance(raw, list):
        logger.warning("Courier catalogue refresh ignored: unexpected response shape")
        return False

    couriers, seen = [], set()
    for item in raw:
        entry = clean_entry(item)
        if entry and entry["key"] not in seen:
            seen.add(entry["key"])
            couriers.append(entry)
    dropped = len(raw) - len(couriers)
    if not couriers:
        logger.warning("Courier catalogue refresh ignored: no valid courier in %d entries", len(raw))
        return False
    if dropped:
        logger.info("Courier catalogue: %d entries dropped as invalid or duplicate", dropped)

    try:
        _write_snapshot(couriers)
    except OSError:
        logger.warning("Courier catalogue snapshot could not be written", exc_info=True)
        return False
    logger.info("Courier catalogue refreshed: %d couriers", len(couriers))
    return True


def _run_refresh():
    global _refresh_running
    try:
        refresh_catalogue()
    except Exception:  # never let a background thread die silently
        logger.exception("Unexpected error while refreshing the courier catalogue")
    finally:
        with _refresh_lock:
            _refresh_running = False


def start_background_refresh():
    """Start one refresh thread unless one is already running. Returns True if started."""
    global _refresh_running
    with _refresh_lock:
        if _refresh_running:
            return False
        _refresh_running = True
    try:
        threading.Thread(target=_run_refresh, name="courier-catalogue-refresh", daemon=True).start()
    except Exception:
        with _refresh_lock:
            _refresh_running = False
        logger.exception("Could not start the courier catalogue refresh")
        return False
    return True


def is_refreshing():
    with _refresh_lock:
        return _refresh_running


def get_catalogue(force_refresh=False):
    """
    Answer at once from the snapshot and refresh in the background when needed.

    Returns {"couriers", "fetched_at", "stale", "refreshing"}. `couriers` is empty
    only before the very first successful fetch.
    """
    snapshot = load_snapshot()
    stale = snapshot is None or (timezone.now() - snapshot["fetched_at"]) > MAX_AGE
    if force_refresh or stale:
        start_background_refresh()
    return {
        "couriers": snapshot["couriers"] if snapshot else [],
        "fetched_at": snapshot["fetched_at"].isoformat() if snapshot else None,
        "stale": stale,
        "refreshing": is_refreshing(),
    }


def get_courier(key):
    """Look one courier up in the current snapshot (no network). None when unknown."""
    snapshot = load_snapshot()
    if not snapshot:
        return None
    return next((c for c in snapshot["couriers"] if c["key"] == key), None)
