"""
In-process background scheduler for ShoeDZ Desktop.

Replaces Celery Beat in desktop standalone mode. Runs a dedicated background
thread inside the Waitress process to execute periodic maintenance tasks.
"""
import logging
import threading
import time
from datetime import datetime, timedelta

from django.conf import settings

logger = logging.getLogger(__name__)

_scheduler_thread = None
_stop_event = threading.Event()


def _run_scheduler_loop():
    logger.info("ShoeDZ Desktop scheduler thread started.")
    
    # Allow the main application and initial requests to settle before running background tasks
    for _ in range(30):
        if _stop_event.is_set():
            logger.info("ShoeDZ Desktop scheduler thread stopped early.")
            return
        time.sleep(1)

    last_license_check = datetime.min
    last_daily_tasks = datetime.min

    while not _stop_event.is_set():
        now = datetime.now()

        # 1. License heartbeat — every 30 minutes
        if now - last_license_check > timedelta(minutes=30):
            last_license_check = now
            try:
                from apps.licensing.tasks import license_heartbeat
                logger.debug("Executing scheduled license heartbeat...")
                license_heartbeat()
            except Exception:
                logger.warning("Scheduled license heartbeat failed", exc_info=True)

        # 2. Daily tasks (cheques, overdue invoices, low stock alerts, DB backup)
        if now - last_daily_tasks > timedelta(hours=24):
            last_daily_tasks = now
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
