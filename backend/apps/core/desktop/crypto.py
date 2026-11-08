"""
Cryptographic helpers for ShoeDZ desktop backup encryption and restoration.
Uses scrypt for key derivation and AES-256-GCM for authenticated encryption.
"""
import hashlib
import os
import secrets
from typing import Optional
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag

MAGIC_HEADER = b"SHODZBAK"
CURRENT_VERSION = 1
SALT_LEN = 16
NONCE_LEN = 12
HEADER_LEN = len(MAGIC_HEADER) + 1 + SALT_LEN + NONCE_LEN  # 8 + 1 + 16 + 12 = 37 bytes
SCRYPT_N = 16384
SCRYPT_R = 8
SCRYPT_P = 1
KEY_LEN = 32


class BackupCryptoError(Exception):
    """Base error for backup cryptographic failures."""
    pass


class InvalidPassphraseError(BackupCryptoError):
    """Raised when decryption fails due to invalid passphrase or corrupted auth tag."""
    pass


class CorruptedBackupError(BackupCryptoError):
    """Raised when backup file format or header is invalid."""
    pass


def derive_key(passphrase: str, salt: bytes) -> bytes:
    """Derive a 256-bit encryption key from a passphrase using scrypt."""
    if not passphrase:
        raise ValueError("Passphrase cannot be empty.")
    return hashlib.scrypt(
        passphrase.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=KEY_LEN,
    )


def create_passphrase_verifier(passphrase: str) -> dict:
    """
    Generate salt, verifier hash, and derived key for config.json storage.
    Verifier allows checking passphrase without keeping plaintext passphrase.
    """
    salt = secrets.token_bytes(SALT_LEN)
    key = derive_key(passphrase, salt)
    v_salt = secrets.token_bytes(SALT_LEN)
    v_hash = hashlib.scrypt(key, salt=v_salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32)
    return {
        "salt_hex": salt.hex(),
        "verifier_salt_hex": v_salt.hex(),
        "verifier_hash_hex": v_hash.hex(),
        "derived_key_hex": key.hex(),
    }


def verify_passphrase_against_verifier(passphrase: str, verifier: dict) -> bool:
    """Check if a passphrase matches the stored verifier."""
    try:
        salt = bytes.fromhex(verifier["salt_hex"])
        v_salt = bytes.fromhex(verifier["verifier_salt_hex"])
        expected_hash = bytes.fromhex(verifier["verifier_hash_hex"])
        key = derive_key(passphrase, salt)
        computed_hash = hashlib.scrypt(key, salt=v_salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32)
        return secrets.compare_digest(computed_hash, expected_hash)
    except Exception:
        return False


def encrypt_backup(
    data_bytes: bytes,
    passphrase: Optional[str] = None,
    derived_key: Optional[bytes] = None,
    salt: Optional[bytes] = None,
) -> bytes:
    """
    Encrypt sqlite database bytes into .shodzbak format.
    Accepts either a passphrase or a pre-derived 32-byte key (with its matching 16-byte salt).
    Format: [MAGIC (8)][VERSION (1)][SALT (16)][NONCE (12)][CIPHERTEXT (with tag)]
    """
    if not passphrase and not derived_key:
        raise ValueError("Either passphrase or derived_key must be provided.")

    if derived_key and not passphrase:
        if salt is None or len(salt) != SALT_LEN:
            raise ValueError(
                "A 16-byte salt matching derived_key must be provided when encrypting with derived_key."
            )
        key = derived_key
    else:
        if salt is None:
            salt = secrets.token_bytes(SALT_LEN)
        elif len(salt) != SALT_LEN:
            raise ValueError(f"salt must be {SALT_LEN} bytes.")
        key = derive_key(passphrase, salt)

    nonce = os.urandom(NONCE_LEN)
    ad = MAGIC_HEADER + bytes([CURRENT_VERSION])
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, data_bytes, associated_data=ad)

    return ad + salt + nonce + ciphertext


def decrypt_backup(package_bytes: bytes, passphrase: Optional[str] = None, derived_key: Optional[bytes] = None) -> bytes:
    """
    Decrypt a .shodzbak package back to raw sqlite bytes.
    Raises CorruptedBackupError if header is invalid or InvalidPassphraseError if tag mismatch.
    """
    if len(package_bytes) < HEADER_LEN + 16:
        raise CorruptedBackupError("Backup file is too short to be a valid .shodzbak file.")

    magic = package_bytes[: len(MAGIC_HEADER)]
    if magic != MAGIC_HEADER:
        raise CorruptedBackupError("Invalid backup file magic header.")

    version = package_bytes[len(MAGIC_HEADER)]
    if version != CURRENT_VERSION:
        raise CorruptedBackupError(f"Unsupported backup version: {version}")

    offset = len(MAGIC_HEADER) + 1
    salt = package_bytes[offset : offset + SALT_LEN]
    offset += SALT_LEN
    nonce = package_bytes[offset : offset + NONCE_LEN]
    offset += NONCE_LEN
    ciphertext = package_bytes[offset:]

    ad = MAGIC_HEADER + bytes([version])

    if derived_key and not passphrase:
        key = derived_key
    elif passphrase:
        key = derive_key(passphrase, salt)
    else:
        raise ValueError("Either passphrase or derived_key must be provided.")

    aesgcm = AESGCM(key)
    try:
        decrypted = aesgcm.decrypt(nonce, ciphertext, associated_data=ad)
        return decrypted
    except InvalidTag:
        raise InvalidPassphraseError("Decryption failed. Passphrase may be incorrect or backup file is corrupted.")

