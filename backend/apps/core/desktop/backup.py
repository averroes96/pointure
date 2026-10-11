"""
Local SQLite backup engine for ShoeDZ Desktop.

Uses Python's native sqlite3 online backup API to safely snapshot the database
even while active writes or transactions are taking place.
"""
import glob
import logging
import os
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

from django.conf import settings

logger = logging.getLogger(__name__)
MAX_BACKUP_COPIES = 14


def get_backups_dir() -> Path:
    """Return the directory path for storing desktop backups."""
    data_dir = getattr(settings, "DATA_DIR", Path("."))
    backups_dir = data_dir / "backups"
    backups_dir.mkdir(parents=True, exist_ok=True)
    return backups_dir


def perform_database_backup() -> Path:
    """
    Perform an online snapshot of db.sqlite3 and rotate old copies.
    Returns the path to the newly created backup file.
    """
    db_path = settings.DATABASES["default"]["NAME"]
    if not os.path.exists(db_path):
        logger.warning("Database file %s does not exist; backup skipped.", db_path)
        return None

    backups_dir = get_backups_dir()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = backups_dir / f"db_backup_{timestamp}.sqlite3"

    logger.info("Starting online backup of %s to %s", db_path, backup_file)

    try:
        source_conn = sqlite3.connect(str(db_path))
        dest_conn = sqlite3.connect(str(backup_file))

        with dest_conn:
            source_conn.backup(dest_conn, pages=100, sleep=0.01)

        dest_conn.close()
        source_conn.close()

        logger.info("Database backup created successfully: %s", backup_file)
        rotate_backups(backups_dir)
        return backup_file
    except Exception:
        logger.exception("Failed to create database backup")
        return None


def rotate_backups(backups_dir: Path, keep: int = MAX_BACKUP_COPIES) -> None:
    """Keep only the most recent `keep` backup files, pruning older ones."""
    try:
        files = sorted(
            backups_dir.glob("db_backup_*.sqlite3"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if len(files) > keep:
            for old_file in files[keep:]:
                try:
                    old_file.unlink()
                    logger.debug("Pruned old backup: %s", old_file)
                except OSError:
                    pass
    except Exception:
        logger.warning("Error rotating backup files", exc_info=True)
