"""
ShoeDZ Agnostic Vision & Spatial OCR Engine (`apps.core.services.ocr`).
Reusable across Purchase Orders, Supplier Invoices, Stocktake Sheets,
Expense Receipts, and Cheques.
"""
from apps.core.services.ocr.engine import (
    DocumentScanEngine,
    get_cv2,
    get_numpy,
    get_pil_image,
    get_rapid_ocr,
)
from apps.core.services.ocr.extractors import (
    normalize_ocr_label,
    parse_alphanumeric_code,
    parse_currency,
    parse_date,
    parse_integer,
    parse_phone,
)
from apps.core.services.ocr.parser import ProfileDocumentParser
from apps.core.services.ocr.schema import (
    ColumnDefinition,
    ExtractionProfile,
    FieldExtractionRule,
    OCRToken,
)

__all__ = [
    "DocumentScanEngine",
    "get_cv2",
    "get_numpy",
    "get_pil_image",
    "get_rapid_ocr",
    "ProfileDocumentParser",
    "OCRToken",
    "ColumnDefinition",
    "FieldExtractionRule",
    "ExtractionProfile",
    "normalize_ocr_label",
    "parse_currency",
    "parse_date",
    "parse_phone",
    "parse_integer",
    "parse_alphanumeric_code",
]

