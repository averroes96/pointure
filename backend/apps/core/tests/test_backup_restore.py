"""
Tests for Task 6.8: Desktop backup restore engine, validation, and marker swap.
"""
import json
import os
import shutil
import sqlite3
import tempfile
from pathlib import Path
import pytest
from rest_framework.test import APIClient

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.db.migrations.loader import MigrationLoader

from apps.core.desktop.backup import (
    get_backups_dir,
    load_desktop_config,
    save_desktop_config,
)
from apps.core.desktop.crypto import encrypt_backup
from apps.core.desktop.restore import (
    MARKER_FILENAME,
    apply_pending_restore_if_needed,
    create_pending_restore_marker,
    validate_backup_for_restore,
)
from apps.core.models import RoleChoices, Tenant, User


def create_sample_sqlite_db(
    path: Path,
    include_migrations: bool = True,
    future_migration: bool = False,
    extra_data: str = "original",
) -> Path:
    """Create a test SQLite database with valid structure and migrations."""
    if path.exists():
        path.unlink()

    conn = sqlite3.connect(str(path))
    cur = conn.cursor()

    if include_migrations:
        cur.execute(
            """
            CREATE TABLE django_migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                applied DATETIME NOT NULL
            );
            """
        )
        loader = MigrationLoader(connection)
        known = list(loader.disk_migrations.keys())
        for app, name in known[:5]:
            cur.execute(
                "INSERT INTO django_migrations (app, name, applied) VALUES (?, ?, '2026-01-01 00:00:00')",
                (app, name),
            )

        if future_migration:
            cur.execute(
                "INSERT INTO django_migrations (app, name, applied) VALUES ('core', '9999_unseen_future', '2026-01-01 00:00:00')"
            )

    cur.execute("CREATE TABLE test_data (id INT PRIMARY KEY, content TEXT);")
    cur.execute("INSERT INTO test_data VALUES (1, ?);", (extra_data,))
    conn.commit()
    conn.close()
    return path


@pytest.fixture
def temp_restore_env(db, monkeypatch):
    """Provide isolated directory structure for testing restore operations."""
    temp_root = tempfile.mkdtemp()
    data_dir = Path(temp_root) / "data"
    data_dir.mkdir(parents=True)
    backups_dir = data_dir / "backups"
    backups_dir.mkdir(parents=True)

    monkeypatch.setattr("django.conf.settings.DATA_DIR", data_dir)

    # Active DB
    active_db = data_dir / "db.sqlite3"
    create_sample_sqlite_db(active_db, extra_data="active_live_db")

    yield data_dir, backups_dir, active_db
    shutil.rmtree(temp_root, ignore_errors=True)


class TestRestoreValidation:
    """Test validation and integrity checking for backup files."""

    def test_valid_backup_file_passes_validation(self, temp_restore_env):
        data_dir, backups_dir, active_db = temp_restore_env
        valid_backup = backups_dir / "valid_backup.sqlite3"
        create_sample_sqlite_db(valid_backup, extra_data="valid_content")

        validated_path = validate_backup_for_restore(valid_backup, data_dir=data_dir)
        try:
            assert validated_path.exists()
            assert validated_path.name.startswith("restore_validate_")
            # Verify data
            conn = sqlite3.connect(str(validated_path))
            cur = conn.cursor()
            cur.execute("SELECT content FROM test_data WHERE id=1;")
            assert cur.fetchone()[0] == "valid_content"
            conn.close()
        finally:
            if validated_path.exists():
                validated_path.unlink()

    def test_corrupt_file_fails_validation(self, temp_restore_env):
        data_dir, backups_dir, _ = temp_restore_env
        corrupt_file = backups_dir / "corrupt.sqlite3"
        corrupt_file.write_bytes(b"SQLite format 3\x00" + b"\xff" * 512)

        with pytest.raises(ValueError, match="contrôle d'intégrité"):
            validate_backup_for_restore(corrupt_file, data_dir=data_dir)

    def test_non_sqlite_file_fails_validation(self, temp_restore_env):
        data_dir, backups_dir, _ = temp_restore_env
        fake_file = backups_dir / "fake.sqlite3"
        fake_file.write_bytes(b"THIS IS NOT SQLITE FILE DATA AT ALL")

        with pytest.raises(ValueError, match="pas une base de données SQLite valide"):
            validate_backup_for_restore(fake_file, data_dir=data_dir)

    def test_missing_migrations_table_fails_validation(self, temp_restore_env):
        data_dir, backups_dir, _ = temp_restore_env
        no_migrations_file = backups_dir / "no_migrations.sqlite3"
        create_sample_sqlite_db(no_migrations_file, include_migrations=False)

        with pytest.raises(ValueError, match="django_migrations"):
            validate_backup_for_restore(no_migrations_file, data_dir=data_dir)

    def test_newer_migrations_fails_version_ceiling_check(self, temp_restore_env):
        data_dir, backups_dir, _ = temp_restore_env
        future_file = backups_dir / "future.sqlite3"
        create_sample_sqlite_db(future_file, future_migration=True)

        with pytest.raises(ValueError, match="version plus récente"):
            validate_backup_for_restore(future_file, data_dir=data_dir)

    def test_encrypted_backup_with_valid_passphrase(self, temp_restore_env):
        data_dir, backups_dir, _ = temp_restore_env
        raw_db = backups_dir / "plain.sqlite3"
        create_sample_sqlite_db(raw_db, extra_data="encrypted_payload")

        raw_bytes = raw_db.read_bytes()
        encrypted_bytes = encrypt_backup(raw_bytes, passphrase="SecretPassphrase123!")
        raw_db.unlink()

        enc_file = backups_dir / "test.shodzbak"
        enc_file.write_bytes(encrypted_bytes)

        validated_path = validate_backup_for_restore(
            enc_file, passphrase="SecretPassphrase123!", data_dir=data_dir
        )
        try:
            assert validated_path.exists()
            conn = sqlite3.connect(str(validated_path))
            cur = conn.cursor()
            cur.execute("SELECT content FROM test_data WHERE id=1;")
            assert cur.fetchone()[0] == "encrypted_payload"
            conn.close()
        finally:
            if validated_path.exists():
                validated_path.unlink()

    def test_encrypted_backup_with_invalid_passphrase(self, temp_restore_env):
        data_dir, backups_dir, _ = temp_restore_env
        raw_db = backups_dir / "plain.sqlite3"
        create_sample_sqlite_db(raw_db)

        encrypted_bytes = encrypt_backup(raw_db.read_bytes(), passphrase="RightPassphrase123!")
        raw_db.unlink()

        enc_file = backups_dir / "test.shodzbak"
        enc_file.write_bytes(encrypted_bytes)

        with pytest.raises(ValueError, match="Phrase de passe incorrecte"):
            validate_backup_for_restore(
                enc_file, passphrase="WrongPassphrase999!", data_dir=data_dir
            )


class TestApplyPendingRestore:
    """Test marker file creation and pre-boot database swap."""

    def test_apply_pending_restore_without_marker_returns_false(self, temp_restore_env):
        data_dir, _, _ = temp_restore_env
        assert apply_pending_restore_if_needed(data_dir) is False

    def test_apply_pending_restore_performs_swap_and_preserves_pre_restore_backup(
        self, temp_restore_env
    ):
        data_dir, backups_dir, active_db = temp_restore_env

        # Create active db with content 'before_restore'
        create_sample_sqlite_db(active_db, extra_data="before_restore")

        # Fake WAL and SHM
        wal_file = data_dir / "db.sqlite3-wal"
        shm_file = data_dir / "db.sqlite3-shm"
        wal_file.write_bytes(b"wal data")
        shm_file.write_bytes(b"shm data")

        # Prepare new database to restore
        temp_dir = data_dir / "temp"
        temp_dir.mkdir(parents=True, exist_ok=True)
        restored_db_temp = temp_dir / "restored.sqlite3"
        create_sample_sqlite_db(restored_db_temp, extra_data="after_restore")

        # Create marker
        marker_path = create_pending_restore_marker(
            validated_temp_path=restored_db_temp,
            source_name="db_backup_test.sqlite3",
            data_dir=data_dir,
        )
        assert marker_path.exists()

        # Apply pending restore
        res = apply_pending_restore_if_needed(data_dir, target_db_path=active_db)
        assert res is True

        # Marker should be removed
        assert not marker_path.exists()

        # WAL and SHM should be deleted
        assert not wal_file.exists()
        assert not shm_file.exists()

        # Active DB should now contain 'after_restore'
        conn = sqlite3.connect(str(active_db))
        cur = conn.cursor()
        cur.execute("SELECT content FROM test_data WHERE id=1;")
        assert cur.fetchone()[0] == "after_restore"
        conn.close()

        # Pre-restore backup must have been created in backups/
        pre_restores = list(backups_dir.glob("pre_restore_*.sqlite3"))
        assert len(pre_restores) == 1
        conn_pre = sqlite3.connect(str(pre_restores[0]))
        cur_pre = conn_pre.cursor()
        cur_pre.execute("SELECT content FROM test_data WHERE id=1;")
        assert cur_pre.fetchone()[0] == "before_restore"
        conn_pre.close()

    def test_apply_pending_restore_merges_uncheckpointed_wal_and_lists_in_backups(
        self, temp_restore_env
    ):
        from apps.core.desktop.backup import list_backup_files

        data_dir, backups_dir, active_db = temp_restore_env
        create_sample_sqlite_db(active_db, extra_data="initial_checkpointed")

        # Open a WAL connection and write a row without closing/checkpointing
        wal_conn = sqlite3.connect(str(active_db))
        wal_conn.execute("PRAGMA journal_mode=WAL;")
        wal_conn.execute("PRAGMA wal_autocheckpoint=0;")
        wal_conn.execute("UPDATE test_data SET content='uncheckpointed_wal_write' WHERE id=1;")
        wal_conn.commit()
        try:
            wal_file = data_dir / "db.sqlite3-wal"
            assert wal_file.exists() and wal_file.stat().st_size > 0

            # Prepare new database to restore
            temp_dir = data_dir / "temp"
            temp_dir.mkdir(parents=True, exist_ok=True)
            restored_db_temp = temp_dir / "restored.sqlite3"
            create_sample_sqlite_db(restored_db_temp, extra_data="restored_state")

            create_pending_restore_marker(
                validated_temp_path=restored_db_temp,
                source_name="db_backup_test.sqlite3",
                data_dir=data_dir,
            )

            res = apply_pending_restore_if_needed(data_dir, target_db_path=active_db)
            assert res is True
        finally:
            wal_conn.close()

        # Pre-restore backup must contain the uncheckpointed WAL write
        pre_restores = list(backups_dir.glob("pre_restore_*.sqlite3"))
        assert len(pre_restores) == 1
        conn_pre = sqlite3.connect(str(pre_restores[0]))
        cur_pre = conn_pre.cursor()
        cur_pre.execute("SELECT content FROM test_data WHERE id=1;")
        assert cur_pre.fetchone()[0] == "uncheckpointed_wal_write"
        conn_pre.close()

        # Pre-restore backup must appear in list_backup_files() for UI recovery
        listed_names = [b["filename"] for b in list_backup_files()]
        assert pre_restores[0].name in listed_names


@pytest.mark.django_db
class TestRestoreAPI:
    """Test API endpoint POST /api/v1/desktop/backups/restore/."""

    @pytest.fixture(autouse=True)
    def setup_users(self, db, temp_restore_env, monkeypatch):
        self.data_dir, self.backups_dir, self.active_db = temp_restore_env
        self.tenant = Tenant.objects.create(name="Restore Shop")
        self.owner = User.objects.create_user(
            email="owner@test.com",
            password="testpassword",
            tenant=self.tenant,
            role=RoleChoices.OWNER,
        )
        self.manager = User.objects.create_user(
            email="manager@test.com",
            password="testpassword",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cashier@test.com",
            password="testpassword",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )

        # Mock trigger_backend_restart so test execution does not exit
        self.restart_triggered = []
        monkeypatch.setattr(
            "apps.core.desktop.restore.trigger_backend_restart",
            lambda delay_seconds=0.5: self.restart_triggered.append(True),
        )

    def test_restore_requires_owner(self):
        client = APIClient()
        client.force_authenticate(user=self.manager)
        resp = client.post("/api/v1/desktop/backups/restore/", {"filename": "test.sqlite3"})
        assert resp.status_code == 403

        client.force_authenticate(user=self.cashier)
        resp = client.post("/api/v1/desktop/backups/restore/", {"filename": "test.sqlite3"})
        assert resp.status_code == 403

    def test_restore_missing_payload_returns_400(self):
        client = APIClient()
        client.force_authenticate(user=self.owner)
        resp = client.post("/api/v1/desktop/backups/restore/", {})
        assert resp.status_code == 400

    def test_restore_nonexistent_local_file_returns_404(self):
        client = APIClient()
        client.force_authenticate(user=self.owner)
        resp = client.post(
            "/api/v1/desktop/backups/restore/",
            {"filename": "does_not_exist.sqlite3"},
        )
        assert resp.status_code == 404

    def test_restore_valid_local_file_success(self):
        client = APIClient()
        client.force_authenticate(user=self.owner)

        # Create a valid backup file in backups dir
        local_backup = self.backups_dir / "db_backup_20261101_000000.sqlite3"
        create_sample_sqlite_db(local_backup, extra_data="local_restore_payload")

        resp = client.post(
            "/api/v1/desktop/backups/restore/",
            {"filename": "db_backup_20261101_000000.sqlite3"},
        )
        assert resp.status_code == 200
        assert resp.data["status"] == "ok"
        assert len(self.restart_triggered) == 1

        # Marker file must exist
        marker = self.data_dir / MARKER_FILENAME
        assert marker.exists()
        marker_data = json.loads(marker.read_text())
        assert marker_data["source_name"] == "db_backup_20261101_000000.sqlite3"

    def test_restore_uploaded_file_success(self):
        client = APIClient()
        client.force_authenticate(user=self.owner)

        # Build in-memory SQLite database
        temp_db_path = self.data_dir / "temp_db_to_upload.sqlite3"
        create_sample_sqlite_db(temp_db_path, extra_data="uploaded_content")
        file_bytes = temp_db_path.read_bytes()
        temp_db_path.unlink()

        uploaded = SimpleUploadedFile(
            "uploaded_backup.sqlite3",
            file_bytes,
            content_type="application/x-sqlite3",
        )

        resp = client.post(
            "/api/v1/desktop/backups/restore/",
            {"file": uploaded},
            format="multipart",
        )
        assert resp.status_code == 200
        assert resp.data["status"] == "ok"
        assert len(self.restart_triggered) == 1

        marker = self.data_dir / MARKER_FILENAME
        assert marker.exists()
