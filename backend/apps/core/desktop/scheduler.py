"""
In-process background scheduler for ShoeDZ Desktop.

Replaces Celery Beat in desktop standalone mode. Runs a dedicated background
thread inside the Waitress process to execute periodic maintenance tasks.
"""
import json
import logging
import os
from pathlib import Path
import threading
import time
from datetime import datetime, timedelta
from typing import Optional

from django.conf import settings

logger = logging.getLogger(__name__)

_scheduler_thread = None
_stop_event = threading.Event()


def get_scheduler_state_path() -> Path:
    """Return the filesystem path for the scheduler state file in DATA_DIR."""
    data_dir = getattr(settings, "DATA_DIR", None)
    if not data_dir:
        base_dir = getattr(settings, "BASE_DIR", Path("."))
        data_dir = base_dir / "data"
    p = Path(data_dir)
    p.mkdir(parents=True, exist_ok=True)
    return p / "scheduler_state.json"


def load_scheduler_state(path: Optional[Path] = None) -> dict:
    """Load persistent scheduler state dictionary from disk."""
    state_file = path or get_scheduler_state_path()
    if not state_file.exists():
        return {}
    try:
        with open(state_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning("Failed to read scheduler state file %s: %s", state_file, e)
        return {}


def save_scheduler_state(state: dict, path: Optional[Path] = None) -> None:
    """Atomically save persistent scheduler state dictionary to disk."""
    state_file = path or get_scheduler_state_path()
    temp_file = state_file.with_name(f"{state_file.name}.tmp")
    try:
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_file, state_file)
    except Exception as e:
        logger.warning("Failed to write scheduler state file %s: %s", state_file, e)
        if temp_file.exists():
            try:
                temp_file.unlink()
            except Exception:
                pass


def should_run_daily_tasks(last_run: Optional[datetime], now: Optional[datetime] = None) -> bool:
    """
    Determine if daily desktop maintenance tasks should run.
    Runs if:
      - never run before (last_run is None)
      - more than 24 hours have passed since last_run
      - or the last run date differs from today (e.g. yesterday vs today)
    """
    if last_run is None:
        return True
    if now is None:
        now = datetime.now()
    if last_run > now:
        # Clock adjusted backwards; only rerun if last_run is in the future by > 1 day
        return (last_run - now) > timedelta(days=1)
    return (now - last_run) >= timedelta(hours=24) or (last_run.date() != now.date())


def _run_scheduler_loop():
    logger.info("ShoeDZ Desktop scheduler thread started.")
    
    # Allow the main application and initial requests to settle before running background tasks
    for _ in range(30):
        if _stop_event.is_set():
            logger.info("ShoeDZ Desktop scheduler thread stopped early.")
            return
        time.sleep(1)

    # In-process interval for license heartbeat (every 30 minutes) using monotonic time
    heartbeat_interval_sec = 30 * 60
    last_license_check_mono = time.monotonic() - heartbeat_interval_sec

    # Load persistent state for daily tasks
    state = load_scheduler_state()
    last_daily_str = state.get("last_daily_tasks")
    last_daily_tasks: Optional[datetime] = None
    if last_daily_str:
        try:
            last_daily_tasks = datetime.fromisoformat(last_daily_str)
        except Exception:
            last_daily_tasks = None

    while not _stop_event.is_set():
        now_mono = time.monotonic()
        now = datetime.now()

        # 1. License heartbeat — every 30 minutes (monotonic interval)
        if now_mono - last_license_check_mono >= heartbeat_interval_sec:
            last_license_check_mono = now_mono
            try:
                from apps.licensing.tasks import license_heartbeat
                logger.debug("Executing scheduled license heartbeat...")
                license_heartbeat()
            except Exception:
                logger.warning("Scheduled license heartbeat failed", exc_info=True)

        # 2. Daily tasks (cheques, overdue invoices, low stock alerts, DB backup)
        if should_run_daily_tasks(last_daily_tasks, now):
            last_daily_tasks = now
            state["last_daily_tasks"] = now.isoformat()
            save_scheduler_state(state)
            logger.info("Running daily desktop maintenance tasks...")
            
            try:
                from apps.notifications.tasks import check_cheque_due_dates
                check_cheque_due_dates()
            except Exception:
                logger.warning("Scheduled check_cheque_due_dates failed", exc_info=True)

            try:
                from apps.notifications.tasks import flag_overdue_invoices
                flag_overdue_invoices()
            except Exception:
                logger.warning("Scheduled flag_overdue_invoices failed", exc_info=True)

            try:
                from apps.notifications.tasks import check_low_stock
                check_low_stock()
            except Exception:
                logger.warning("Scheduled check_low_stock failed", exc_info=True)

            try:
                from apps.core.desktop.backup import perform_database_backup
                perform_database_backup()
            except Exception:
                logger.warning("Scheduled perform_database_backup failed", exc_info=True)

            try:
                from apps.closing.services.reminder import check_closing_reminders
                check_closing_reminders(now=now, state=state, save_state=True)
            except Exception:
                logger.warning("Scheduled check_closing_reminders failed", exc_info=True)

            try:
                from apps.sales.tasks import cleanup_held_sales
                cleanup_held_sales()
            except Exception:
                logger.warning("Scheduled cleanup_held_sales failed", exc_info=True)

        # Always close thread-local DB connections to prevent holding SQLite locks
        try:
            from django.db import connections
            connections.close_all()
        except Exception:
            pass

        # Sleep in small increments to allow rapid clean shutdown
        for _ in range(60):
            if _stop_event.is_set():
                break
            time.sleep(1)

    logger.info("ShoeDZ Desktop scheduler thread stopped.")


def start_scheduler():
    """Start the scheduler background thread if not already running."""
    global _scheduler_thread
    if _scheduler_thread and _scheduler_thread.is_alive():
        return

    _stop_event.clear()
    _scheduler_thread = threading.Thread(
        target=_run_scheduler_loop,
        name="shodz-desktop-scheduler",
        daemon=True,
    )
    _scheduler_thread.start()


def stop_scheduler():
    """Signal the scheduler background thread to stop."""
    _stop_event.set()
