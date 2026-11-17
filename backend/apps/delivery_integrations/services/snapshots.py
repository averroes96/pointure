"""
Reference data kept as a JSON snapshot in DATA_DIR (docs/plans/delivery-v1-plan.md P2.1).

Offline-first (AGENTS.md §3): readers get the saved snapshot at once; a missing or
stale snapshot is refreshed in ONE background thread; a failed or empty refresh
keeps the previous snapshot. The file is written atomically.
"""
import json
import logging
import os
import threading
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)


class SnapshotStore:
    """
    `fetch` returns the cleaned list of rows to save (raises or returns [] on failure).
    `clean_row` re-validates rows read back from disk (returns None to drop a row).
    """

    def __init__(self, filename, max_age, fetch, clean_row):
        self.filename = filename
        self.max_age = max_age
        self.fetch = fetch
        self.clean_row = clean_row
        self._lock = threading.Lock()
        self._running = False

    # ── file ──────────────────────────────────────────────────────────────────
    def path(self) -> Path:
        data_dir = getattr(settings, "DATA_DIR", None) or (Path(settings.BASE_DIR) / "data")
        return Path(data_dir) / self.filename

    def load(self):
        """{"fetched_at": datetime, "rows": [...]} or None when no usable snapshot exists."""
        try:
            data = json.loads(self.path().read_text(encoding="utf-8"))
            fetched_at = datetime.fromisoformat(data["fetched_at"])
            rows = [r for r in (self.clean_row(x) for x in data["rows"]) if r is not None]
        except FileNotFoundError:
            return None
        except (OSError, ValueError, KeyError, TypeError):
            logger.warning("Snapshot %s unreadable; it will be fetched again", self.filename, exc_info=True)
            return None
        return {"fetched_at": fetched_at, "rows": rows} if rows else None

    def _write(self, rows):
        path = self.path()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps({"fetched_at": timezone.now().isoformat(), "rows": rows}, ensure_ascii=False),
                       encoding="utf-8")
        os.replace(tmp, path)

    # ── refresh ───────────────────────────────────────────────────────────────
    def refresh(self) -> bool:
        """Fetch and replace the snapshot. Never raises; False keeps the old snapshot."""
        try:
            rows = self.fetch()
        except Exception:
            logger.warning("Snapshot %s refresh failed; keeping the previous one", self.filename, exc_info=True)
            return False
        if not rows:
            logger.warning("Snapshot %s refresh ignored: nothing usable", self.filename)
            return False
        try:
            self._write(rows)
        except OSError:
            logger.warning("Snapshot %s could not be written", self.filename, exc_info=True)
            return False
        logger.info("Snapshot %s refreshed: %d rows", self.filename, len(rows))
        return True

    def _run(self):
        try:
            self.refresh()
        finally:
            with self._lock:
                self._running = False

    def start_background_refresh(self) -> bool:
        with self._lock:
            if self._running:
                return False
            self._running = True
        try:
            threading.Thread(target=self._run, name=f"snapshot-{self.filename}", daemon=True).start()
        except Exception:
            with self._lock:
                self._running = False
            logger.exception("Could not start the %s refresh", self.filename)
            return False
        return True

    def is_refreshing(self) -> bool:
        with self._lock:
            return self._running

    def get(self, force_refresh=False):
        """Answer at once; refresh in the background when missing, stale or forced."""
        snapshot = self.load()
        stale = snapshot is None or (timezone.now() - snapshot["fetched_at"]) > self.max_age
        if force_refresh or stale:
            self.start_background_refresh()
        return {
            "rows": snapshot["rows"] if snapshot else [],
            "fetched_at": snapshot["fetched_at"].isoformat() if snapshot else None,
            "stale": stale,
            "refreshing": self.is_refreshing(),
        }
