"""
ShoeDZ — Algerian Phone Normalization and Validation Utilities.

Standardizes Algerian phone numbers (Ooredoo, Mobilis, Djezzy, and fixed lines)
into a canonical 10-digit local format: 0XXXXXXXXX (or 9 digits for legacy landlines).
"""
import re
from typing import Optional

# Algerian mobile regex: 10 digits starting with 05, 06, or 07
ALGERIAN_MOBILE_REGEX = re.compile(r"^0[567]\d{8}$")

# Algerian landline regex: 9 or 10 digits starting with 02, 03, 04
ALGERIAN_LANDLINE_REGEX = re.compile(r"^0[234]\d{7,8}$")

# Combined Algerian phone regex
ALGERIAN_PHONE_REGEX = re.compile(r"^0([567]\d{8}|[234]\d{7,8})$")


def clean_phone_input(raw_phone: Optional[str]) -> str:
    """Strip spaces, dashes, dots, parentheses, and invisible characters."""
    if not raw_phone:
        return ""
    # Remove all whitespace, dots, dashes, parentheses, slashes
    return re.sub(r"[\s\-\.\(\)\/\\]+", "", str(raw_phone).strip())


def normalize_algerian_phone(raw_phone: Optional[str]) -> str:
    """
    Normalizes any Algerian phone number representation into the canonical local format:
    e.g. 0555123456, 0661234567, 0770123456, 021234567.

    Supports:
      - Local format: "0555 12 34 56" -> "0555123456"
      - International: "+213 555 12 34 56" -> "0555123456"
      - International double-zero: "00213 555 12 34 56" -> "0555123456"
      - Prefix without plus: "213555123456" -> "0555123456"
      - Combined with zero: "+213 0555 12 34 56" -> "0555123456"
      - Missing leading zero: "555123456" -> "0555123456"
    """
    cleaned = clean_phone_input(raw_phone)
    if not cleaned:
        return ""

    # Remove + prefix if present
    if cleaned.startswith("+"):
        cleaned = cleaned[1:]

    # Remove 00213 prefix
    if cleaned.startswith("00213"):
        cleaned = cleaned[5:]
    # Remove 213 prefix if followed by a phone number
    elif cleaned.startswith("213") and len(cleaned) in (11, 12, 13):
        cleaned = cleaned[3:]

    # If it now starts with 0 (e.g. was +2130555... or 0555...)
    if cleaned.startswith("0"):
        return cleaned

    # If it's a 9-digit mobile number missing the leading 0 (starts with 5, 6, 7)
    if len(cleaned) == 9 and cleaned[0] in ("5", "6", "7"):
        return "0" + cleaned

    # If it's an 8 or 9 digit landline number missing the leading 0 (starts with 2, 3, 4)
    if len(cleaned) in (8, 9) and cleaned[0] in ("2", "3", "4"):
        return "0" + cleaned

    return cleaned


def is_valid_algerian_phone(phone: Optional[str], mobile_only: bool = False) -> bool:
    """
    Validates whether a phone number (raw or normalized) is a valid Algerian phone number.
    By default allows both mobile (05/06/07) and landline (02/03/04).
    If mobile_only=True, only 10-digit mobile numbers are accepted.
    """
    normalized = normalize_algerian_phone(phone)
    if not normalized:
        return False
    if mobile_only:
        return bool(ALGERIAN_MOBILE_REGEX.match(normalized))
    return bool(ALGERIAN_PHONE_REGEX.match(normalized))


def format_algerian_phone_display(phone: Optional[str]) -> str:
    """
    Formats a 10-digit Algerian phone number for user-friendly UI display:
    e.g. "0555123456" -> "0555 12 34 56"
    """
    normalized = normalize_algerian_phone(phone)
    if len(normalized) == 10:
        return f"{normalized[:4]} {normalized[4:6]} {normalized[6:8]} {normalized[8:]}"
    elif len(normalized) == 9:
        return f"{normalized[:3]} {normalized[3:5]} {normalized[5:7]} {normalized[7:]}"
    return phone or ""

