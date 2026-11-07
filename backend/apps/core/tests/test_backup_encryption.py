"""
Tests for Task 6.7: Desktop backup destination folder, encryption (.shodzbak), and recovery verifier.
"""
import json
import os
import shutil
import tempfile
from pathlib import Path
import pytest
from rest_framework.test import APIClient

from apps.core.desktop.backup import (
    copy_to_external_destination,
    get_desktop_config_path,
    load_desktop_config,
    perform_database_backup,
    rotate_external_backups,
    save_desktop_config,
)
from apps.core.desktop.crypto import (
    CorruptedBackupError,
    create_passphrase_verifier,
    decrypt_backup,
    derive_key,
    encrypt_backup,
    InvalidPassphraseError,
    verify_passphrase_against_verifier,
)
from apps.core.models import RoleChoices, Tenant, User


@pytest.fixture
def temp_dirs(monkeypatch):
    """Provide isolated temporary directories for data and external backups."""
    temp_root = tempfile.mkdtemp()
    data_dir = Path(temp_root) / "data"
    data_dir.mkdir(parents=True)
    external_dir = Path(temp_root) / "external_backup"
    external_dir.mkdir(parents=True)

    monkeypatch.setattr("django.conf.settings.DATA_DIR", data_dir)

    # Create dummy active db
    db_path = data_dir / "db.sqlite3"
    import sqlite3
    conn = sqlite3.connect(str(db_path))
    conn.execute("CREATE TABLE test (id INT, name TEXT)")
    conn.execute("INSERT INTO test VALUES (1, 'ShoeDZ test')")
    conn.commit()
    conn.close()

    yield data_dir, external_dir, db_path
    shutil.rmtree(temp_root, ignore_errors=True)


class TestBackupCrypto:
    """Unit tests for AES-256-GCM authenticated encryption and scrypt derivation."""

    def test_encrypt_and_decrypt_with_passphrase(self):
        sample_data = b"SQLite format 3\x00" + os.urandom(2048)
        passphrase = "correct horse battery staple"

        encrypted = encrypt_backup(sample_data, passphrase=passphrase)
        assert encrypted.startswith(b"SHODZBAK\x01")
        assert encrypted != sample_data

        decrypted = decrypt_backup(encrypted, passphrase=passphrase)
        assert decrypted == sample_data

    def test_decrypt_with_wrong_passphrase_fails(self):
        sample_data = b"Sensitive SQLite Database Bytes"
        passphrase = "mySecretPassword123"

        encrypted = encrypt_backup(sample_data, passphrase=passphrase)

        with pytest.raises(InvalidPassphraseError):
            decrypt_backup(encrypted, passphrase="wrongPassword")

    def test_decrypt_corrupted_payload_fails(self):
        sample_data = b"Sample Database Data"
        passphrase = "password123"
        encrypted = bytearray(encrypt_backup(sample_data, passphrase=passphrase))

        # Corrupt one byte in ciphertext
        encrypted[-1] ^= 0xFF

        with pytest.raises(InvalidPassphraseError):
            decrypt_backup(bytes(encrypted), passphrase=passphrase)

        # Truncated header
        with pytest.raises(CorruptedBackupError):
            decrypt_backup(b"SHORT", passphrase=passphrase)

        # Invalid magic
        with pytest.raises(CorruptedBackupError):
            decrypt_backup(b"BADMAGIC" + encrypted[8:], passphrase=passphrase)

    def test_encrypt_and_decrypt_with_derived_key(self):
        sample_data = b"Payload for derived key encryption"
        salt = os.urandom(16)
        key = derive_key("passphrase456", salt)

        encrypted = encrypt_backup(sample_data, derived_key=key)
        decrypted = decrypt_backup(encrypted, derived_key=key)
        assert decrypted == sample_data

    def test_passphrase_verifier(self):
        passphrase = "StoreOwnerStrongKey2026!"
        verifier = create_passphrase_verifier(passphrase)

        assert "salt_hex" in verifier
        assert "verifier_salt_hex" in verifier
        assert "verifier_hash_hex" in verifier
        assert "derived_key_hex" in verifier

        assert verify_passphrase_against_verifier(passphrase, verifier) is True
        assert verify_passphrase_against_verifier("wrong_attempt", verifier) is False


@pytest.mark.django_db
class TestExternalBackupExecution:
    """Test backup creation with optional external destination copy and encryption."""

    def test_backup_without_external_destination(self, temp_dirs):
        data_dir, external_dir, db_path = temp_dirs

        backup_file = perform_database_backup(db_path=db_path)
        assert backup_file is not None
        assert backup_file.exists()
        assert backup_file.name.endswith(".sqlite3")

        # External directory remains empty
        assert len(list(external_dir.glob("*"))) == 0

    def test_backup_with_unencrypted_external_destination(self, temp_dirs):
        data_dir, external_dir, db_path = temp_dirs

        save_desktop_config({
            "backup_destination_dir": str(external_dir),
            "backup_encrypt": False,
        })

        backup_file = perform_database_backup(db_path=db_path)
        assert backup_file is not None

        ext_files = list(external_dir.glob("db_backup_*.sqlite3"))
        assert len(ext_files) == 1
        assert ext_files[0].read_bytes() == backup_file.read_bytes()

        cfg = load_desktop_config()
        assert cfg.get("last_external_backup_at") is not None
        assert cfg.get("last_external_error") is None
        assert cfg.get("last_external_file") == backup_file.name

    def test_backup_with_encrypted_external_destination(self, temp_dirs):
        data_dir, external_dir, db_path = temp_dirs
        passphrase = "SecretStoreBackup2026"
        verifier = create_passphrase_verifier(passphrase)

        save_desktop_config({
            "backup_destination_dir": str(external_dir),
            "backup_encrypt": True,
            "backup_derived_key": verifier["derived_key_hex"],
        })

        backup_file = perform_database_backup(db_path=db_path)
        assert backup_file is not None

        shodzbak_files = list(external_dir.glob("db_backup_*.shodzbak"))
        assert len(shodzbak_files) == 1

        encrypted_bytes = shodzbak_files[0].read_bytes()
        decrypted = decrypt_backup(
            encrypted_bytes,
            derived_key=bytes.fromhex(verifier["derived_key_hex"]),
        )
        assert decrypted == backup_file.read_bytes()

        cfg = load_desktop_config()
        assert cfg.get("last_external_file") == shodzbak_files[0].name
        assert cfg.get("last_external_error") is None

    def test_missing_destination_does_not_break_local_backup(self, temp_dirs):
        data_dir, external_dir, db_path = temp_dirs
        missing_dir = external_dir / "unmounted_usb_drive_e"

        save_desktop_config({
            "backup_destination_dir": str(missing_dir),
            "backup_encrypt": False,
        })

        # Must not raise; local backup must still succeed
        backup_file = perform_database_backup(db_path=db_path)
        assert backup_file is not None
        assert backup_file.exists()

        cfg = load_desktop_config()
        assert cfg.get("last_external_error") is not None
        assert "inaccessible" in cfg.get("last_external_error").lower()

    def test_external_backup_rotation(self, temp_dirs):
        data_dir, external_dir, db_path = temp_dirs

        # Create 5 dummy files
        for i in range(5):
            p = external_dir / f"db_backup_2026010{i}_000000.shodzbak"
            p.write_bytes(b"dummy")

        rotate_external_backups(external_dir, keep=3)
        remaining = sorted(p.name for p in external_dir.glob("*.shodzbak"))
        assert len(remaining) == 3


@pytest.mark.django_db
class TestBackupConfigAPI:
    """Test API endpoints for external backup configuration and listing."""

    @pytest.fixture(autouse=True)
    def setup_users(self, db, temp_dirs):
        self.data_dir, self.external_dir, self.db_path = temp_dirs
        self.tenant = Tenant.objects.create(name="Backup Shop")
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

    def test_list_backups_includes_external_config(self):
        client = APIClient()
        client.force_authenticate(user=self.manager)

        save_desktop_config({
            "backup_destination_dir": str(self.external_dir),
            "backup_encrypt": True,
            "backup_keep_external": 25,
        })

        resp = client.get("/api/v1/desktop/backups/")
        assert resp.status_code == 200
        assert "external_config" in resp.data
        ext = resp.data["external_config"]
        assert ext["destination_dir"] == str(self.external_dir)
        assert ext["encrypt"] is True
        assert ext["keep_external"] == 25
        assert ext["is_destination_connected"] is True

    def test_update_config_restricted_to_owner(self):
        client = APIClient()
        client.force_authenticate(user=self.manager)

        resp = client.post("/api/v1/desktop/backups/config/", {"destination_dir": "/tmp"})
        assert resp.status_code == 403

        client.force_authenticate(user=self.cashier)
        resp = client.post("/api/v1/desktop/backups/config/", {"destination_dir": "/tmp"})
        assert resp.status_code == 403

    def test_owner_can_configure_destination_and_passphrase(self):
        client = APIClient()
        client.force_authenticate(user=self.owner)

        payload = {
            "destination_dir": str(self.external_dir),
            "encrypt": True,
            "keep_external": 40,
            "passphrase": "StrongStorePassphrase123",
            "passphrase_confirm": "StrongStorePassphrase123",
        }
        resp = client.post("/api/v1/desktop/backups/config/", payload, format="json")
        assert resp.status_code == 200
        assert resp.data["status"] == "ok"
        assert resp.data["external_config"]["has_passphrase"] is True
        assert resp.data["external_config"]["keep_external"] == 40

        cfg = load_desktop_config()
        assert cfg["backup_destination_dir"] == str(self.external_dir)
        assert cfg["backup_encrypt"] is True
        assert cfg["backup_keep_external"] == 40
        assert "backup_derived_key" in cfg

    def test_passphrase_mismatch_returns_400(self):
        client = APIClient()
        client.force_authenticate(user=self.owner)

        payload = {
            "passphrase": "Password123",
            "passphrase_confirm": "PasswordDifferent",
        }
        resp = client.post("/api/v1/desktop/backups/config/", payload, format="json")
        assert resp.status_code == 400
        assert "correspondent pas" in resp.data["detail"]

    def test_passphrase_too_short_returns_400(self):
        client = APIClient()
        client.force_authenticate(user=self.owner)

        payload = {
            "passphrase": "short",
            "passphrase_confirm": "short",
        }
        resp = client.post("/api/v1/desktop/backups/config/", payload, format="json")
        assert resp.status_code == 400
        assert "au moins 8" in resp.data["detail"]
