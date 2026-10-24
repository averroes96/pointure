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
    data_dir = getattr(settings, "DATA_DIR", None)
    if not data_dir:
        base_dir = getattr(settings, "BASE_DIR", Path("."))
        data_dir = base_dir / "data"
    backups_dir = Path(data_dir) / "backups"
    backups_dir.mkdir(parents=True, exist_ok=True)
    return backups_dir


def _format_size(size_bytes: int) -> str:
    """Format bytes into readable string."""
    if size_bytes < 1024:
        return f"{size_bytes} o"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} Ko"
    else:
        return f"{size_bytes / (1024 * 1024):.2f} Mo"


def list_backup_files() -> list:
    """Return a sorted list of metadata for all available database backups."""
    backups_dir = get_backups_dir()
    files = sorted(
        backups_dir.glob("db_backup_*.sqlite3"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    result = []
    for p in files:
        try:
            stat = p.stat()
            result.append({
                "filename": p.name,
                "size_bytes": stat.st_size,
                "size_human": _format_size(stat.st_size),
                "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
        except OSError:
            pass
    return result


def delete_backup_file(filename: str) -> bool:
    """Delete a backup file safely, guarding against path traversal."""
    safe_name = os.path.basename(filename)
    if not safe_name.endswith(".sqlite3") or safe_name != filename:
        return False
    backups_dir = get_backups_dir()
    target = backups_dir / safe_name
    if target.exists() and target.is_file():
        try:
            target.unlink()
            logger.info("Deleted backup file: %s", target)
            return True
        except OSError:
            logger.warning("Could not delete backup file: %s", target, exc_info=True)
            return False
    return False


def perform_database_backup(prefix: str = "db_backup") -> Path:
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
    backup_file = backups_dir / f"{prefix}_{timestamp}.sqlite3"

    logger.info("Starting online backup of %s to %s", db_path, backup_file)

    source_conn = None
    dest_conn = None
    try:
        source_conn = sqlite3.connect(str(db_path), timeout=60)
        dest_conn = sqlite3.connect(str(backup_file), timeout=60)

        with dest_conn:
            source_conn.backup(dest_conn, pages=100, sleep=0.01)

        logger.info("Database backup created successfully: %s", backup_file)
        rotate_backups(backups_dir)
        return backup_file
    except Exception:
        logger.exception("Failed to create database backup")
        return None
    finally:
        if dest_conn:
            try:
                dest_conn.close()
            except Exception:
                pass
        if source_conn:
            try:
                source_conn.close()
            except Exception:
                pass


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
