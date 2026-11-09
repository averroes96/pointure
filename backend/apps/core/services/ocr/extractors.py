"""
Standard reusable field extractors for the ShoeDZ Agnostic OCR Engine.
Used by ExtractionProfile column definitions, header metadata rules, and footer total rules.
"""
import datetime
import re
import unicodedata
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

from apps.core.utils.phone import is_valid_algerian_phone, normalize_algerian_phone


def normalize_ocr_label(val: Any) -> str:
    """
    Normalize text for keyword/synonym matching:
    lowercased, accents stripped, punctuation collapsed.
    """
    if val is None:
        return ""
    s = str(val).strip().lower()
    nfkd_form = unicodedata.normalize("NFKD", s)
    s = "".join([c for c in nfkd_form if not unicodedata.combining(c)])
    s = re.sub(r"[أإآٱ]", "ا", s)
    s = re.sub(r"ة\b", "ه", s)
    s = re.sub(r"ى\b", "ي", s)
    s = re.sub(r"[\s_\-\.:;,/\\'\"]+", " ", s).strip()
    return s


def parse_currency(val: Any) -> Optional[Decimal]:
    """
    Cleans DZD, DA, Dinars, spaces, comma/dot decimals and returns a quantized Decimal(0.01).
    Examples:
      - "2.450,00 DA" -> Decimal("2450.00")
      - "1 250,50 DZD" -> Decimal("1250.50")
      - "3,500.00" -> Decimal("3500.00")
      - "1800" -> Decimal("1800.00")
    """
    if val is None:
        return None
    if isinstance(val, Decimal):
        return val.quantize(Decimal("0.01"))
    if isinstance(val, (int, float)):
        return Decimal(str(val)).quantize(Decimal("0.01"))

    s = str(val).strip()
    if not s:
        return None

    # Remove currency labels & symbols
    s = re.sub(r"(?i)\b(da|dzd|eur|usd|dinar|dinars|ht|ttc|net)\b", "", s)
    s = re.sub(r"[دج\$€£]", "", s)

    # Extract first plausible numeric token (supporting spaces/dots/commas as thousand/decimal separators)
    match = re.search(r"[-+]?\d[\d\s\xa0\.,]*\d|\d+", s)
    if not match:
        return None

    num_str = re.sub(r"[\s\xa0]", "", match.group(0))
    if not num_str:
        return None

    if "." in num_str and "," in num_str:
        if num_str.rfind(",") > num_str.rfind("."):
            # French/Algerian format: 2.450,00 -> 2450.00
            num_str = num_str.replace(".", "").replace(",", ".")
        else:
            # English format: 2,450.00 -> 2450.00
            num_str = num_str.replace(",", "")
    elif "," in num_str:
        # Check if comma is thousand separator (e.g. 2,450 with 3 digits after) or decimal (2450,00)
        parts = num_str.split(",")
        if len(parts) == 2 and len(parts[1]) in (1, 2):
            num_str = num_str.replace(",", ".")
        elif len(parts) > 2:
            num_str = "".join(parts[:-1]) + "." + parts[-1]
        else:
            num_str = num_str.replace(",", ".")
    elif num_str.count(".") > 1:
        # Multiple dots e.g. 1.250.000 -> thousand separators
        parts = num_str.split(".")
        if len(parts[-1]) in (1, 2):
            num_str = "".join(parts[:-1]) + "." + parts[-1]
        else:
            num_str = "".join(parts)

    try:
        return Decimal(num_str).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return None


def parse_date(val: Any) -> Optional[datetime.date]:
    """
    Parses Algerian/French and ISO dates from OCR text:
      - DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
      - DD/MM/YY, DD-MM-YY
      - YYYY-MM-DD, YYYY/MM/DD
    """
    if val is None:
        return None
    if isinstance(val, datetime.datetime):
        return val.date()
    if isinstance(val, datetime.date):
        return val

    s = str(val).strip()
    if not s:
        return None

    # 1. DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (4-digit year)
    m = re.search(r"\b(0?[1-9]|[12]\d|3[01])[/\-\.](0?[1-9]|1[0-2])[/\-\.](20\d{2}|19\d{2})\b", s)
    if m:
        day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return datetime.date(year, month, day)
        except ValueError:
            pass

    # 2. YYYY-MM-DD or YYYY/MM/DD
    m = re.search(r"\b(20\d{2}|19\d{2})[/\-\.](0?[1-9]|1[0-2])[/\-\.](0?[1-9]|[12]\d|3[01])\b", s)
    if m:
        year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return datetime.date(year, month, day)
        except ValueError:
            pass

    # 3. DD/MM/YY or DD-MM-YY (2-digit year)
    m = re.search(r"\b(0?[1-9]|[12]\d|3[01])[/\-\.](0?[1-9]|1[0-2])[/\-\.](\d{2})\b", s)
    if m:
        day, month, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
        year = 2000 + yy if yy < 70 else 1900 + yy
        try:
            return datetime.date(year, month, day)
        except ValueError:
            pass

    return None


def parse_phone(val: Any) -> Optional[str]:
    """
    Extracts and normalizes an Algerian mobile or landline phone number from OCR text.
    Supports formats like '0555 12 34 56', '+213 661 23 45 67', '0770-12-34-56', '021 23 45 67'.
    Returns normalized 10-digit (or 9-digit landline) string, or None.
    """
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None

    # Check direct normalization first
    direct = normalize_algerian_phone(s)
    if is_valid_algerian_phone(direct):
        return direct

    # Search for phone-like sequences inside larger strings
    candidates = re.findall(
        r"(?:\+213|00213|0)[\s\-\.]?[2-7](?:[\s\-\.]?\d){7,8}\b",
        s,
    )
    for cand in candidates:
        norm = normalize_algerian_phone(cand)
        if is_valid_algerian_phone(norm):
            return norm

    return None


def parse_integer(val: Any) -> Optional[int]:
    """
    Extracts an integer value from a cell or token string.
    Example: '120 paires' -> 120, '15' -> 15.
    """
    if val is None:
        return None
    if isinstance(val, bool):
        return None
    if isinstance(val, int):
        return val
    if isinstance(val, float):
        return int(round(val))

    s = str(val).strip()
    if not s:
        return None

    m = re.search(r"[-+]?\d+", s.replace(" ", ""))
    if m:
        try:
            return int(m.group(0))
        except ValueError:
            return None
    return None


def parse_alphanumeric_code(val: Any) -> str:
    """
    Cleans an article reference, SKU, or document code.
    Trims surrounding punctuation/whitespace while preserving internal hyphens, slashes, and dots.
    """
    if val is None:
        return ""
    s = str(val).strip()
    if not s:
        return ""
    # Strip leading/trailing colons, semicolons, quotes, pipes, brackets
    s = re.sub(r"^[\s:;,\|\"'\(\)\[\]]+|[\s:;,\|\"'\(\)\[\]]+$", "", s)
    # Collapse multiple spaces
    s = re.sub(r"\s+", " ", s)
    return s

