"""
Backup restore engine and validation for ShoeDZ Desktop.

Handles:
1. Validation of local or uploaded backup files (.sqlite3 or .shodzbak).
2. Decryption using passphrase or stored derived key.
3. Integrity checks (PRAGMA integrity_check, schema, and migration version ceiling).
4. Safe marker-file creation (pending_restore.json) and atomic swap before Django setup.
5. Graceful restart trigger using exit code 100 so Electron can relaunch the process.
"""
import json
import logging
import os
import shutil
import sqlite3
import tempfile
import threading
import time
from pathlib import Path
from typing import Optional

from django.conf import settings
from django.utils.translation import gettext_lazy as _

from .backup import load_desktop_config
from .crypto import (
    MAGIC_HEADER,
    decrypt_backup,
    InvalidPassphraseError,
    CorruptedBackupError,
)

logger = logging.getLogger(__name__)

MARKER_FILENAME = "pending_restore.json"
EXIT_CODE_RESTART = 100


def get_desktop_data_dir() -> Path:
    """Resolve the active data directory."""
    data_dir = getattr(settings, "DATA_DIR", None)
    if not data_dir:
        base_dir = getattr(settings, "BASE_DIR", Path("."))
        data_dir = base_dir / "data"
    p = Path(data_dir)
    p.mkdir(parents=True, exist_ok=True)
    return p


def validate_backup_for_restore(
    source_path: Path,
    passphrase: Optional[str] = None,
    data_dir: Optional[Path] = None,
) -> Path:
    """
    Validate a backup file before permitting a restore.
    
    Checks:
    1. Decrypts .shodzbak if encrypted using passphrase or stored key.
    2. Ensures the SQLite header is valid.
    3. Runs PRAGMA integrity_check == 'ok'.
    4. Ensures 'django_migrations' table exists.
    5. Checks migration version ceiling: refuses backups containing migrations
       newer than what the current application code knows about.
       
    Returns the path to the validated temporary SQLite file.
    Raises ValueError on validation or decryption failure.
    """
    if not source_path.exists() or not source_path.is_file():
        raise ValueError(_("Le fichier de sauvegarde spécifié est introuvable."))

    target_dir = data_dir or get_desktop_data_dir()
    temp_dir = target_dir / "temp"
    temp_dir.mkdir(parents=True, exist_ok=True)

    raw_bytes = source_path.read_bytes()
    if len(raw_bytes) < 16:
        raise ValueError(_("Fichier de sauvegarde vide ou corrompu."))

    # Check if encrypted (.shodzbak)
    is_encrypted = raw_bytes.startswith(MAGIC_HEADER)
    sqlite_bytes: bytes

    if is_encrypted:
        derived_key = None
        if not passphrase:
            config = load_desktop_config()
            key_hex = config.get("backup_derived_key")
            if key_hex:
                try:
                    derived_key = bytes.fromhex(key_hex)
                except Exception:
                    derived_key = None

        if not passphrase and not derived_key:
            raise ValueError(
                _("Cette sauvegarde est chiffrée. Une phrase de passe est requise pour la déchiffrer.")
            )

        try:
            sqlite_bytes = decrypt_backup(
                raw_bytes, passphrase=passphrase, derived_key=derived_key
            )
        except InvalidPassphraseError:
            raise ValueError(_("Phrase de passe incorrecte pour cette sauvegarde chiffrée."))
        except CorruptedBackupError:
            raise ValueError(_("Le fichier de sauvegarde chiffrée est corrompu ou illisible."))
        except Exception as e:
            raise ValueError(_("Erreur de déchiffrement : %(error)s") % {"error": str(e)})
    else:
        sqlite_bytes = raw_bytes

    # Check SQLite header
    if not sqlite_bytes.startswith(b"SQLite format 3\x00"):
        raise ValueError(
            _("Le fichier n'est pas une base de données SQLite valide (en-tête invalide).")
        )

    # Write to a temporary SQLite file for inspection
    temp_file = temp_dir / f"restore_validate_{int(time.time())}_{os.getpid()}.sqlite3"
    try:
        temp_file.write_bytes(sqlite_bytes)

        # 1. SQLite PRAGMA integrity_check
        conn = sqlite3.connect(f"file:{temp_file}?mode=ro", uri=True)
        try:
            cur = conn.cursor()
            try:
                cur.execute("PRAGMA integrity_check;")
                res = cur.fetchone()
                if not res or res[0] != "ok":
                    msg = res[0] if res else "Erreur intégrité inconnue"
                    raise ValueError(
                        _("Échec du contrôle d'intégrité de la base de données : %(msg)s") % {"msg": msg}
                    )
            except (sqlite3.DatabaseError, sqlite3.OperationalError) as db_err:
                raise ValueError(
                    _("Échec du contrôle d'intégrité de la base de données : %(msg)s") % {"msg": str(db_err)}
                )

            # 2. Check django_migrations table exists
            cur.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='django_migrations';"
            )
            if not cur.fetchone():
                raise ValueError(
                    _("Base de données invalide : la table des migrations 'django_migrations' est introuvable.")
                )

            # 3. Check migration version ceiling
            cur.execute("SELECT app, name FROM django_migrations;")
            backup_migrations = set(cur.fetchall())
        finally:
            conn.close()

        # Compare against migrations known to current code on disk
        from django.db import connection
        from django.db.migrations.loader import MigrationLoader

        loader = MigrationLoader(connection)
        known_migrations = set(loader.disk_migrations.keys())
        newer_migrations = backup_migrations - known_migrations

        if newer_migrations:
            sample_names = ", ".join(
                f"{app}.{name}" for app, name in list(newer_migrations)[:3]
            )
            raise ValueError(
                _(
                    "Cette sauvegarde a été créée avec une version plus récente de ShoeDZ "
                    "(%(count)d migration(s) inconnue(s) dont : %(samples)s). "
                    "Veuillez mettre à jour l'application avant de restaurer cette sauvegarde."
                )
                % {"count": len(newer_migrations), "samples": sample_names}
            )

        return temp_file

    except Exception:
        # Clean up temp file on validation failure
        if temp_file.exists():
            temp_file.unlink(missing_ok=True)
        raise


def create_pending_restore_marker(
    validated_temp_path: Path,
    source_name: str,
    data_dir: Optional[Path] = None,
) -> Path:
    """
    Create the marker file DATA_DIR/pending_restore.json pointing to the validated temp database.
    """
    target_dir = data_dir or get_desktop_data_dir()
    marker_path = target_dir / MARKER_FILENAME

    marker_data = {
        "temp_path": str(validated_temp_path.resolve()),
        "source_name": source_name,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    tmp_marker = marker_path.with_suffix(".tmp")
    tmp_marker.write_text(json.dumps(marker_data, indent=2), encoding="utf-8")
    tmp_marker.replace(marker_path)

    logger.info("Created pending restore marker for source '%s'", source_name)
    return marker_path


def apply_pending_restore_if_needed(
    data_dir: Path, target_db_path: Optional[Path] = None
) -> bool:
    """
    Invoked at backend startup before django.setup().
    If pending_restore.json exists:
    1. Backs up current db.sqlite3 to backups/pre_restore_<timestamp>.sqlite3.
    2. Cleans up existing -wal and -shm files.
    3. Moves the validated temp database into place as db.sqlite3.
    4. Deletes pending_restore.json.
    
    Returns True if a restore was applied, False otherwise.
    """
    marker_path = data_dir / MARKER_FILENAME
    if not marker_path.exists():
        return False

    try:
        data = json.loads(marker_path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.error("Failed to parse pending restore marker: %s", e)
        marker_path.unlink(missing_ok=True)
        return False

    temp_path = Path(data.get("temp_path", ""))
    if not temp_path.exists() or not temp_path.is_file():
        logger.error(
            "Pending restore file '%s' does not exist. Aborting restore.", temp_path
        )
        marker_path.unlink(missing_ok=True)
        return False

    target_db = target_db_path or (data_dir / "db.sqlite3")
    backups_dir = data_dir / "backups"
    backups_dir.mkdir(parents=True, exist_ok=True)

    timestamp = time.strftime("%Y%m%d_%H%M%S")
    pre_restore_backup = backups_dir / f"pre_restore_{timestamp}.sqlite3"

    try:
        # 1. Preserve current database if it exists
        if target_db.exists():
            logger.info(
                "Preserving current database to pre-restore backup: %s",
                pre_restore_backup,
            )
            shutil.copy2(target_db, pre_restore_backup)

            # Remove SQLite WAL & SHM files so they don't corrupt the newly swapped database
            wal = target_db.with_name(target_db.name + "-wal")
            if wal.exists():
                wal.unlink(missing_ok=True)
            shm = target_db.with_name(target_db.name + "-shm")
            if shm.exists():
                shm.unlink(missing_ok=True)

        # 2. Swap in the restored database
        logger.info("Applying restored database from: %s -> %s", temp_path, target_db)
        shutil.move(temp_path, target_db)

        # 3. Remove marker
        marker_path.unlink(missing_ok=True)
        logger.info(
            "Database restore completed successfully from '%s'.",
            data.get("source_name", "unknown"),
        )
        return True

    except Exception as err:
        logger.critical(
            "Failed during restore database swap: %s", err, exc_info=True
        )
        marker_path.unlink(missing_ok=True)
        return False


def trigger_backend_restart(exit_code: int = EXIT_CODE_RESTART, delay_seconds: float = 0.5) -> None:
    """
    Terminate the backend process with the specified exit code after a short delay
    to permit the HTTP response to finish delivering to the client.
    Electron listens for this exit code to relaunch the backend cleanly.
    """
    def _do_exit():
        time.sleep(delay_seconds)
        logger.info("Shutting down backend process for restore restart (exit code %d)", exit_code)
        os._exit(exit_code)

    thread = threading.Thread(target=_do_exit, name="restore-restart-thread", daemon=True)
    thread.start()
