"""
Local SQLite backup engine for ShoeDZ Desktop.

Uses Python's native sqlite3 online backup API to safely snapshot the database
even while active writes or transactions are taking place.
"""
import glob
import json
import logging
import os
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

from django.conf import settings

from .crypto import encrypt_backup, decrypt_backup, create_passphrase_verifier

logger = logging.getLogger(__name__)
MAX_BACKUP_COPIES = 14


def get_desktop_config_path() -> Path:
    """Return the path to config.json in the data directory."""
    data_dir = getattr(settings, "DATA_DIR", None)
    if not data_dir:
        base_dir = getattr(settings, "BASE_DIR", Path("."))
        data_dir = base_dir / "data"
    return Path(data_dir) / "config.json"


def load_desktop_config() -> dict:
    """Read desktop configuration from config.json."""
    config_path = get_desktop_config_path()
    if config_path.exists():
        try:
            return json.loads(config_path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_desktop_config(updates: dict) -> dict:
    """Update config.json atomically."""
    config_path = get_desktop_config_path()
    current = load_desktop_config()
    current.update(updates)
    config_path.parent.mkdir(parents=True, exist_ok=True)
    temp_file = config_path.with_suffix(".tmp")
    temp_file.write_text(json.dumps(current, indent=2), encoding="utf-8")
    temp_file.replace(config_path)
    return current


def copy_to_external_destination(local_backup_path: Path) -> dict:
    """
    Copy and optionally encrypt a local backup snapshot to the configured external destination folder.
    This operation is fault-tolerant: failure here never fails the primary local backup.
    """
    config = load_desktop_config()
    dest_dir_str = (config.get("backup_destination_dir") or "").strip()

    if not dest_dir_str:
        logger.debug("No external backup destination directory configured.")
        return {"status": "skipped", "reason": "no_destination"}

    dest_dir = Path(dest_dir_str)
    if not dest_dir.exists() or not dest_dir.is_dir():
        error_msg = f"Dossier de destination externe inaccessible : {dest_dir_str}"
        logger.warning(error_msg)
        save_desktop_config({"last_external_error": error_msg})
        return {"status": "error", "error": error_msg}

    try:
        encrypt = config.get("backup_encrypt", True)
        if encrypt:
            derived_key_hex = config.get("backup_derived_key")
            salt_hex = config.get("backup_salt")
            if not derived_key_hex or not salt_hex:
                error_msg = "Chiffrement activé mais aucune clé de chiffrement configurée."
                logger.warning(error_msg)
                save_desktop_config({"last_external_error": error_msg})
                return {"status": "error", "error": error_msg}

            derived_key = bytes.fromhex(derived_key_hex)
            salt = bytes.fromhex(salt_hex)
            raw_bytes = local_backup_path.read_bytes()
            encrypted_package = encrypt_backup(raw_bytes, derived_key=derived_key, salt=salt)

            target_filename = local_backup_path.stem + ".shodzbak"
            target_path = dest_dir / target_filename
            target_path.write_bytes(encrypted_package)
            logger.info("Encrypted external backup created: %s", target_path)
        else:
            target_filename = local_backup_path.name
            target_path = dest_dir / target_filename
            shutil.copy2(local_backup_path, target_path)
            logger.info("External backup copied: %s", target_path)

        # Rotate external copies
        keep_external = int(config.get("backup_keep_external", 30) or 30)
        rotate_external_backups(dest_dir, keep=keep_external)

        now_iso = datetime.now().isoformat()
        save_desktop_config({
            "last_external_backup_at": now_iso,
            "last_external_error": None,
            "last_external_file": target_filename,
        })
        return {"status": "success", "file": target_filename}

    except Exception as exc:
        error_msg = f"Erreur lors de la copie externe : {str(exc)}"
        logger.exception(error_msg)
        save_desktop_config({"last_external_error": error_msg})
        return {"status": "error", "error": error_msg}


def rotate_external_backups(dest_dir: Path, keep: int = 30) -> None:
    """Keep only the most recent `keep` external backups in the destination folder."""
    try:
        files = []
        for p in dest_dir.iterdir():
            if p.is_file() and p.name.startswith("db_backup_") and (p.name.endswith(".shodzbak") or p.name.endswith(".sqlite3")):
                files.append(p)
        files.sort(key=lambda p: p.stat().st_mtime, reverse=True)

        if len(files) > keep:
            for old_file in files[keep:]:
                try:
                    old_file.unlink()
                    logger.debug("Pruned old external backup: %s", old_file)
                except OSError:
                    pass
    except Exception:
        logger.warning("Error rotating external backup files", exc_info=True)


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
        [
            p
            for p in backups_dir.glob("*.sqlite3")
            if p.name.startswith("db_backup_") or p.name.startswith("pre_restore_")
        ],
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


def perform_database_backup(prefix: str = "db_backup", db_path: Path = None) -> Path:
    """
    Perform an online snapshot of db.sqlite3 and rotate old copies.
    Returns the path to the newly created backup file.
    """
    if db_path is None:
        db_path = settings.DATABASES["default"]["NAME"]
    if not os.path.exists(str(db_path)):
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

        # External destination copy (Task 6.7)
        try:
            copy_to_external_destination(backup_file)
        except Exception:
            logger.warning("External backup copy failed unexpectedly", exc_info=True)

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
