"""
Smart Purchase-Order Import Engine for ShoeDZ.
Supports Multi-Language CSV & Excel (French, Arabic, English),
multi-encoding detection, delimiter and decimal auto-detection,
trilingual column synonym matching, size mode expansion (single, range, matrix),
catalog product/variant reconciliation, and template saving/re-application.
"""
import csv
import io
import re
import unicodedata
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Set, Tuple

import charset_normalizer
import openpyxl

from django.db import transaction
from django.utils.translation import gettext_lazy as _

from apps.core.services.legacy_dbf import distribute_quantity, parse_pointure_range
from apps.inventory.models import Product, Variant
from apps.suppliers.models import (
    ImportSizeModeChoices,
    POLine,
    POStatusChoices,
    PurchaseOrder,
    Supplier,
    SupplierImportTemplate,
)


# ─────────────────────────────────────────────────────────────────────────────
# Trilingual Column Synonym Dictionaries (Case, Accent & Symbol Insensitive)
# ─────────────────────────────────────────────────────────────────────────────

PO_SYNONYMS: Dict[str, List[str]] = {
    "reference": [
        "ref", "reference", "référence", "code", "article", "sku", "item",
        "code_article", "model", "modele", "modèle", "code_modele", "ref_fournisseur",
        "المرجع", "رمز الموديل", "رمز المادة", "كود المنتج", "الرمز", "الكود", "رقم الموديل"
    ],
    "description": [
        "designation", "désignation", "libelle", "libellé", "description", "nom",
        "name", "product_name", "nom_produit", "article_name", "modele", "modèle",
        "التعيين", "الموديل", "الوصف", "اسم المنتج", "اسم الموديل", "البيان", "اسم الحذاء"
    ],
    "size": [
        "pointure", "taille", "p", "p.", "pointures", "size", "sizes", "shoe_size",
        "eu_size", "size_eu", "pointure_eu", "t", "t.",
        "المقاس", "القياس", "الحجم", "النمرة", "مقاس الحذاء"
    ],
    "quantity": [
        "qte", "qté", "quantite", "quantité", "paires", "total_paires", "total paires",
        "qty", "quantity", "pairs", "total pairs", "paires_total", "total_qty", "nb_paires",
        "الكمية", "عدد الأزواج", "مجموع الأزواج", "الأزواج"
    ],
    "cartons": [
        "colis", "cartons", "carton", "ctn", "serie", "série", "nb_ctn", "nb ctn",
        "boxes", "box", "nb_cartons", "nb cartons", "nbr_cartons", "colisage",
        "الطرد", "الكرتون", "العلب", "عدد الكراتين", "كرتون"
    ],
    "unit_price": [
        "pu", "p.u", "pu_ht", "pu ht", "prix", "prix_achat", "prix achat",
        "prix_unitaire", "prix unitaire", "unit_price", "unit price", "cost",
        "buying_price", "pa", "pamp", "cout", "coût",
        "سعر الشراء", "السعر الوحدوي", "ثمن الشراء", "سعر الوحدة", "التكلفة"
    ],
    "colour": [
        "couleur", "coloris", "teinte", "colour", "color", "couleurs", "colors",
        "اللون", "لون الحذاء", "اللون المعتمد"
    ],
    "brand": [
        "marque", "brand", "fabricant", "label", "fournisseur_marque",
        "العلامة", "الماركة", "العلامة التجارية", "الشركة المصنعة"
    ],
    "location": [
        "emplacement", "rayon", "etagere", "étagère", "casier", "location", "shelf", "bin",
        "الموقع", "الرف", "مكان التخزين"
    ],
}


# ─────────────────────────────────────────────────────────────────────────────
# Normalization & Fuzzy Helpers
# ─────────────────────────────────────────────────────────────────────────────

def normalize_text(val: Any) -> str:
    """Normalize text: stripped, lowercased, accents stripped, Arabic forms unified."""
    if val is None:
        return ""
    s = str(val).strip().lower()
    # Remove accents/diacritics
    nfkd_form = unicodedata.normalize("NFKD", s)
    s = "".join([c for c in nfkd_form if not unicodedata.combining(c)])
    # Unify Arabic letters
    s = re.sub(r"[أإآٱ]", "ا", s)
    s = re.sub(r"ة\b", "ه", s)
    s = re.sub(r"ى\b", "ي", s)
    s = re.sub(r"ئ", "ي", s)
    s = re.sub(r"ؤ", "و", s)
    # Collapse punctuation and spaces
    s = re.sub(r"[\s_\-\.:;,/\\'\"]+", " ", s).strip()
    return s


def parse_decimal_value(val: Any) -> Optional[Decimal]:
    """
    Parses numeric/currency values supporting French comma decimals ('1 250,50' / '1250,50'),
    dot decimals ('1250.50' / '1,250.50'), thousand separators ('2.450' / '1,250'),
    and stripping currency suffixes ('DA', 'DZD', '€', etc.).
    """
    if val is None:
        return None
    if isinstance(val, (int, float, Decimal)):
        try:
            return Decimal(str(val)).quantize(Decimal("0.01"))
        except (InvalidOperation, ValueError):
            return None

    s = str(val).strip()
    if not s:
        return None

    # Strip currency suffixes and symbols without requiring word boundary
    s = re.sub(r"(?i)(da|dzd|eur|usd|dinar|dinars)", "", s)
    s = re.sub(r"[دج\$€£\s\xa0]", "", s).strip()
    if not s:
        return None

    # Determine decimal point vs thousands grouping
    if "." in s and "," in s:
        if s.rfind(",") > s.rfind("."):
            # French style: 1.250,50 -> 1250.50
            s = s.replace(".", "").replace(",", ".")
        else:
            # English style: 1,250.50 -> 1250.50
            s = s.replace(",", "")
    elif re.match(r"^\d{1,3}([.,]\d{3})+$", s):
        # Thousand grouping without decimals: "2.450", "1,250", "12.000", "1.250.000"
        s = re.sub(r"[.,]", "", s)
    elif "," in s:
        # e.g. 1250,50 -> 1250.50
        s = s.replace(",", ".")

    try:
        dec = Decimal(s).quantize(Decimal("0.01"))
        return dec
    except (InvalidOperation, ValueError):
        return None


def parse_integer_value(val: Any, default: int = 0) -> int:
    """Safely parse integer from string, float, or int, guaranteeing an int return."""
    safe_default = 0
    if default is not None:
        try:
            safe_default = int(default)
        except (ValueError, TypeError):
            safe_default = 0

    if val is None:
        return safe_default

    if isinstance(val, int):
        return val

    if isinstance(val, float):
        if val.is_integer():
            return int(val)
        return safe_default

    s = str(val).strip()
    if not s:
        return safe_default

    # Strip simple unit suffixes
    s_clean = re.sub(r"(?i)\b(paires?|pairs?|cartons?|ctns?|pcs|u)\b", "", s).strip()

    # Try direct int conversion first
    try:
        return int(s_clean)
    except (ValueError, TypeError):
        pass

    # Try decimal/float representation like "12.0" or "12,00"
    try:
        s_norm = s_clean.replace(",", ".")
        dec = Decimal(s_norm)
        if dec == dec.to_integral_value():
            return int(dec)
        return safe_default
    except (InvalidOperation, ValueError, TypeError):
        return safe_default


# ─────────────────────────────────────────────────────────────────────────────
# Encoding & Delimiter Auto-Detection
# ─────────────────────────────────────────────────────────────────────────────

def detect_encoding_and_decode(raw_bytes: bytes) -> Tuple[str, str]:
    """
    Detect encoding and decode raw bytes to text.
    Probes utf-8-sig, utf-8 first.
    For single-byte encodings (cp1252 French vs cp1256 Arabic), scores candidate
    decodings based on presence of Arabic script words vs isolated mojibake letters
    in Latin text. Falls back to charset_normalizer and latin-1.
    Returns (decoded_text, detected_encoding).
    """
    # 1. Probe clean UTF-8
    for enc in ["utf-8-sig", "utf-8"]:
        try:
            text = raw_bytes.decode(enc)
            return text, enc
        except (UnicodeDecodeError, LookupError):
            continue

    # 2. Score candidate single-byte encodings: cp1252 vs cp1256
    text_1252 = None
    try:
        text_1252 = raw_bytes.decode("cp1252")
    except (UnicodeDecodeError, LookupError):
        pass

    text_1256 = None
    try:
        text_1256 = raw_bytes.decode("cp1256")
    except (UnicodeDecodeError, LookupError):
        pass

    if text_1252 is not None and text_1256 is not None:
        # Check for genuine Arabic words (2 or more consecutive Arabic letters)
        arabic_words_1256 = len(re.findall(r"[\u0600-\u06FF]{2,}", text_1256))
        # Check for mojibake: Arabic character isolated adjacent to Latin letters (e.g. RةFةRENCE)
        mixed_mojibake_1256 = len(re.findall(r"[A-Za-z][\u0600-\u06FF]|[\u0600-\u06FF][A-Za-z]", text_1256))
        # Check French accented letters in cp1252
        french_accents_1252 = len(re.findall(r"[éèêëàâîïôùûçÉÈÊËÀÂÎÏÔÙÛÇœæ]", text_1252))

        if arabic_words_1256 > 0 and mixed_mojibake_1256 == 0:
            return text_1256, "cp1256"
        if french_accents_1252 > 0 or mixed_mojibake_1256 > 0:
            return text_1252, "cp1252"
        if arabic_words_1256 > french_accents_1252:
            return text_1256, "cp1256"
        return text_1252, "cp1252"

    if text_1252 is not None:
        return text_1252, "cp1252"
    if text_1256 is not None:
        return text_1256, "cp1256"

    # 3. Fallback to charset_normalizer
    match = charset_normalizer.from_bytes(raw_bytes).best()
    if match and match.encoding:
        try:
            return raw_bytes.decode(match.encoding), match.encoding
        except Exception:
            pass

    # 4. Last-ditch Latin-1 fallback (never fails decoding)
    return raw_bytes.decode("latin-1", errors="replace"), "latin-1"


def detect_delimiter(sample_text: str) -> str:
    """
    Detect delimiter: ';' (French default), ',', '\t' (TSV), '|'.
    Scores candidate delimiters across lines.
    """
    lines = [ln.strip() for ln in sample_text.splitlines() if ln.strip()][:15]
    if not lines:
        return ";"

    candidates = [";", ",", "\t", "|"]
    best_delim = ";"
    best_score = -1

    for delim in candidates:
        counts = [ln.count(delim) for ln in lines if ln]
        if not counts or max(counts) == 0:
            continue
        # Consistency score: how many lines have the same non-zero count
        avg_count = sum(counts) / len(counts)
        variance = sum(abs(c - avg_count) for c in counts) / len(counts)
        # Score favors higher average column count with lower variance
        score = (avg_count * 10) - (variance * 5)
        if score > best_score:
            best_score = score
            best_delim = delim

    return best_delim


# ─────────────────────────────────────────────────────────────────────────────
# Multi-Lingual Column Matching & Size Matrix Detection
# ─────────────────────────────────────────────────────────────────────────────

DISQUALIFIED_SIZE_TERMS = {
    "tva", "vat", "tax", "taxe", "taxes", "remise", "discount", "rabais", "ristourne",
    "taux", "pourcent", "pourcentage", "total", "montant", "sum", "amount",
    "prix", "price", "cout", "cost", "pu", "ht", "ttc",
    "ref", "reference", "code", "article", "sku", "item", "designation", "libelle",
    "qte", "qty", "quantite", "quantity", "colis", "carton", "box", "paire", "pair",
}

UNIT_PRICE_DISQUALIFIED_TERMS = {
    "total", "montant", "ttc", "global", "somme", "sum", "amount",
    "مجموع", "اجمالي", "المجموع", "الإجمالي",
}

QUANTITY_DISQUALIFIED_TERMS = {
    "prix", "price", "montant", "amount", "valeur", "tva", "cout", "cost",
}


def score_header_match(header: str, field: str) -> int:
    """
    Computes a match score for a raw header against a canonical PO field.
    Returns 0 if disqualified or no match, or a positive integer score.
    """
    cleaned = normalize_text(header)
    if not cleaned:
        return 0

    tokens = set(cleaned.split())

    # Hard disqualifiers
    if field == "unit_price":
        if any(term in cleaned for term in UNIT_PRICE_DISQUALIFIED_TERMS):
            return 0
    elif field == "quantity":
        if tokens & QUANTITY_DISQUALIFIED_TERMS:
            return 0
    elif field == "reference":
        if any(w in cleaned for w in ["couleur", "color", "designation", "libelle", "nom", "name", "prix", "price"]):
            return 0
    elif field == "description":
        if any(w in cleaned for w in ["couleur", "color", "prix", "price"]):
            return 0

    score = 0
    # Exact match with canonical field name
    if cleaned == field:
        score = 2000

    synonyms = PO_SYNONYMS.get(field, [])
    for syn in synonyms:
        syn_norm = normalize_text(syn)
        if not syn_norm:
            continue

        if cleaned == syn_norm:
            # Exact synonym match
            score = max(score, 1500 + len(syn_norm))
        elif re.search(rf"\b{re.escape(syn_norm)}\b", cleaned):
            # Whole word match in compound header
            word_score = 100 + (len(syn_norm) * 10)
            if cleaned.startswith(syn_norm):
                word_score += 20
            score = max(score, word_score)
        elif len(syn_norm) >= 4 and syn_norm in cleaned:
            # Substring match without word boundary
            score = max(score, 50 + len(syn_norm))

    return score


def match_column_to_canonical(header: str) -> Optional[str]:
    """
    Matches raw header to a canonical PO field using trilingual synonyms and scored ranking.
    Returns canonical field key or None.
    """
    best_field = None
    best_score = 0

    for field in PO_SYNONYMS.keys():
        sc = score_header_match(header, field)
        if sc > best_score:
            best_score = sc
            best_field = field

    return best_field


def detect_size_matrix_column(header: str) -> Optional[int]:
    """
    Determines if a column header represents an EU footwear size (typically 15 to 60).
    Matches patterns like '37', '38', 'P36', 'P.40', 'T42', 'Pointure 39', 'Size 41', 'مقاس 42'.
    Strictly ignores tax, discount, total, price, reference, or non-size columns (e.g. 'TVA 19', 'Remise 20%').
    Returns the integer size or None.
    """
    if not header:
        return None

    raw = str(header).strip()
    # Strip potential float suffix like '38.0' or '38,0' from Excel/CSV number formatting
    raw = re.sub(r"[\.,]0+$", "", raw).strip()

    cleaned = normalize_text(raw)
    if not cleaned:
        return None

    # Disqualify if any financial, tax, discount, or reference word appears
    tokens = set(cleaned.split())
    if tokens & DISQUALIFIED_SIZE_TERMS or "%" in raw:
        return None

    # Check 1: Direct integer 15..60
    if re.fullmatch(r"([1-5][0-9]|60)", cleaned):
        sz = int(cleaned)
        if 15 <= sz <= 60:
            return sz

    # Check 2: Explicit size prefix required: p37, p.40, t42, pointure 39, size 41, etc.
    prefix_pattern = r"(?:p|pt|pointure|pointures|t|tl|taille|tailles|size|sizes|sz|eu|مقاس|نمره|نمرة|قياس|حجم)"
    m = re.fullmatch(rf"{prefix_pattern}\s*([1-5][0-9]|60)", cleaned)
    if m:
        sz = int(m.group(1))
        if 15 <= sz <= 60:
            return sz

    # Check 3: Postfix size pattern: 40 eu, 42p, etc.
    postfix_pattern = r"(?:eu|p|t|pointure|taille|size|مقاس|نمره|نمرة|قياس)"
    m = re.fullmatch(rf"([1-5][0-9]|60)\s*{postfix_pattern}", cleaned)
    if m:
        sz = int(m.group(1))
        if 15 <= sz <= 60:
            return sz

    return None


def auto_map_headers(headers: List[str]) -> Tuple[Dict[str, Optional[str]], Dict[str, int], str]:
    """
    Inspects list of column headers.
    Returns:
      - canonical_mapping: {header: canonical_field or None}
      - size_matrix_columns: {header: size_eu}
      - suggested_size_mode: 'matrix' if >=3 size columns, else 'single'
    """
    canonical_mapping: Dict[str, Optional[str]] = {h: None for h in headers}
    size_matrix_columns: Dict[str, int] = {}
    candidate_scores: List[Tuple[int, str, str]] = []

    for h in headers:
        size_eu = detect_size_matrix_column(h)
        if size_eu is not None:
            size_matrix_columns[h] = size_eu
            continue

        for field in PO_SYNONYMS.keys():
            sc = score_header_match(h, field)
            if sc > 0:
                candidate_scores.append((sc, h, field))

    # Sort candidates by score descending
    candidate_scores.sort(key=lambda x: x[0], reverse=True)

    assigned_headers: Set[str] = set()
    assigned_fields: Set[str] = set()

    for sc, h, f in candidate_scores:
        if h not in assigned_headers and f not in assigned_fields:
            canonical_mapping[h] = f
            assigned_headers.add(h)
            assigned_fields.add(f)

    suggested_mode = "matrix" if len(size_matrix_columns) >= 3 else "single"
    return canonical_mapping, size_matrix_columns, suggested_mode


def detect_header_row_and_headers(raw_rows: List[List[Any]]) -> Tuple[int, List[str], List[List[Any]]]:
    """
    Finds best header row among the first 10 rows by scoring matches against synonyms and size numbers.
    Returns (header_row_1_indexed, headers_list, data_rows_after_header).
    """
    if not raw_rows:
        return 1, [], []

    best_idx = 0
    best_score = -1

    for idx, row in enumerate(raw_rows[:10]):
        row_str = [str(c or "").strip() for c in row]
        if not any(row_str):
            continue

        score = 0
        for cell in row_str:
            if not cell:
                continue
            if detect_size_matrix_column(cell) is not None:
                score += 3
            elif match_column_to_canonical(cell) is not None:
                score += 5

        if score > best_score:
            best_score = score
            best_idx = idx

    header_row_1_indexed = best_idx + 1
    raw_headers = [str(c or "").strip() for c in raw_rows[best_idx]]
    data_rows = raw_rows[best_idx + 1:]

    # Handle unnamed/empty header columns with default labels
    headers = []
    for c_idx, h in enumerate(raw_headers):
        if h:
            headers.append(h)
        else:
            headers.append(f"Colonne {c_idx + 1}")

    return header_row_1_indexed, headers, data_rows


# ─────────────────────────────────────────────────────────────────────────────
# File Parsers (CSV & Excel)
# ─────────────────────────────────────────────────────────────────────────────

def parse_csv_file(raw_bytes: bytes) -> Tuple[List[List[str]], str, str, Optional[str]]:
    """
    Parses CSV bytes with auto-encoding and delimiter detection.
    Returns (raw_rows_grid, encoding, delimiter, error_message).
    """
    decoded_text, encoding = detect_encoding_and_decode(raw_bytes)
    if not decoded_text.strip():
        return [], encoding, ";", _("Le fichier CSV est vide.")

    delimiter = detect_delimiter(decoded_text[:4096])

    try:
        reader = csv.reader(io.StringIO(decoded_text), delimiter=delimiter)
        raw_rows = [[str(cell or "").strip() for cell in row] for row in reader]
        # Filter completely empty rows
        filtered_rows = [r for r in raw_rows if any(cell for cell in r)]
        return filtered_rows, encoding, delimiter, None
    except Exception as exc:
        return [], encoding, delimiter, f"{_('Erreur de lecture CSV')}: {exc}"


def parse_xlsx_file(raw_bytes: bytes) -> Tuple[List[List[str]], Optional[str]]:
    """
    Parses Excel XLSX bytes.
    Returns (raw_rows_grid, error_message).
    """
    try:
        wb = openpyxl.load_workbook(io.BytesIO(raw_bytes), data_only=True, read_only=True)
        ws = wb.active
        if not ws:
            return [], _("Le classeur Excel ne contient aucune feuille active.")

        raw_rows = []
        for row in ws.iter_rows(values_only=True):
            if not row or not any(v is not None and str(v).strip() for v in row):
                continue
            raw_rows.append([str(v or "").strip() if v is not None else "" for v in row])

        if not raw_rows:
            return [], _("Le fichier Excel est vide.")

        return raw_rows, None
    except Exception as exc:
        return [], f"{_('Erreur de lecture Excel')}: {exc}"


def parse_supplier_order_file(
    raw_bytes: bytes, filename: str
) -> Tuple[List[List[str]], str, str, Optional[str]]:
    """
    Parses either CSV or Excel file.
    Returns (raw_rows_grid, encoding, delimiter, error_message).
    """
    fname = filename.lower()
    if fname.endswith((".xlsx", ".xlsm", ".xltx")):
        rows, err = parse_xlsx_file(raw_bytes)
        return rows, "binary", "excel", err
    return parse_csv_file(raw_bytes)


# ─────────────────────────────────────────────────────────────────────────────
# Size Mode Expansion Engine
# ─────────────────────────────────────────────────────────────────────────────

def expand_imported_order_lines(
    headers: List[str],
    data_rows: List[List[str]],
    column_map: Dict[str, str],
    size_mode: str = "single",
    default_colour: str = "",
    default_pairs_per_carton: Optional[int] = None,
    tenant=None,
) -> List[Dict[str, Any]]:
    """
    Expands raw spreadsheet rows into normalized line item dictionaries based on size_mode.
    Supported size modes:
      - 'single': 1 row -> 1 variant line
      - 'range': size string like '37-41' -> expands into lines per size via carton_breakdown or distribute_quantity
      - 'matrix': columns matching sizes (e.g. 36..46) transposed into lines
    """
    inv_map = {field: header for header, field in column_map.items() if field}
    header_indices = {h: idx for idx, h in enumerate(headers)}

    def get_val(row: List[str], field: str) -> str:
        header_name = inv_map.get(field)
        if not header_name:
            return ""
        idx = header_indices.get(header_name)
        if idx is not None and idx < len(row):
            return row[idx].strip()
        return ""

    expanded_lines: List[Dict[str, Any]] = []

    ppc_default = parse_integer_value(default_pairs_per_carton, default=10)
    if ppc_default <= 0:
        ppc_default = 10

    # Pre-fetch products by reference if tenant is provided (for range breakdown lookup)
    product_map: Dict[str, Product] = {}
    if tenant and size_mode == "range":
        refs = {get_val(r, "reference") for r in data_rows if get_val(r, "reference")}
        if refs:
            for p in Product.objects.filter(tenant=tenant, reference__in=refs):
                product_map[p.reference.lower()] = p

    for row_idx, row in enumerate(data_rows, start=1):
        if not any(row):
            continue

        ref = get_val(row, "reference")
        desc = get_val(row, "description")
        colour = get_val(row, "colour") or default_colour or "Standard"
        brand = get_val(row, "brand")
        location = get_val(row, "location")

        price_raw = get_val(row, "unit_price")
        parsed_price = parse_decimal_value(price_raw)
        unit_price = parsed_price if parsed_price is not None else Decimal("0.00")
        has_price_warning = bool(price_raw and str(price_raw).strip() and parsed_price is None)

        cartons_raw = parse_integer_value(get_val(row, "cartons"), default=0)
        ppc_val = parse_integer_value(get_val(row, "pairs_per_carton"), default=ppc_default)
        if ppc_val <= 0:
            ppc_val = ppc_default

        # ── MATRIX MODE: Columns 35..46 Transposed ──────────────────────────
        if size_mode == "matrix":
            # Detect which headers are size columns
            for h in headers:
                sz = detect_size_matrix_column(h)
                if sz is None:
                    continue
                h_idx = header_indices.get(h)
                if h_idx is None or h_idx >= len(row):
                    continue
                cell_val = row[h_idx]
                qty = parse_integer_value(cell_val, default=0)
                if qty <= 0:
                    continue

                line_desc = desc or f"{ref} - {colour} - EU {sz}".strip(" -")
                expanded_lines.append({
                    "row_index": row_idx,
                    "reference": ref,
                    "description": line_desc,
                    "size_eu": sz,
                    "colour": colour,
                    "brand": brand,
                    "location": location,
                    "quantity": qty,
                    "cartons": cartons_raw,
                    "pairs_per_carton": ppc_val,
                    "unit_price": unit_price,
                    "price_warning": has_price_warning,
                })

        # ── RANGE MODE: Plages de pointures (ex: 37-41) ──────────────────────
        elif size_mode == "range":
            raw_size = get_val(row, "size")
            qty_raw = parse_integer_value(get_val(row, "quantity"), default=0)

            # Check if this row is a size range
            parsed_sizes = parse_pointure_range(raw_size, default_sizes=[])
            matched_prod = product_map.get(ref.lower()) if ref else None

            if len(parsed_sizes) > 1:
                # Check for configured carton_breakdown on existing product
                if matched_prod and matched_prod.carton_breakdown and cartons_raw > 0:
                    for s_str, p_count in matched_prod.carton_breakdown.items():
                        s_int = parse_integer_value(s_str, default=0)
                        pairs_qty = parse_integer_value(p_count, default=0) * cartons_raw
                        if pairs_qty > 0 and s_int > 0:
                            line_desc = desc or f"{ref} - {colour} - EU {s_int}".strip(" -")
                            expanded_lines.append({
                                "row_index": row_idx,
                                "reference": ref,
                                "description": line_desc,
                                "size_eu": s_int,
                                "colour": colour,
                                "brand": brand,
                                "location": location,
                                "quantity": pairs_qty,
                                "cartons": cartons_raw,
                                "pairs_per_carton": ppc_val,
                                "unit_price": unit_price,
                                "price_warning": has_price_warning,
                            })
                else:
                    # Distribute total pairs across sizes
                    total_pairs = qty_raw
                    if total_pairs <= 0 and cartons_raw > 0:
                        total_pairs = cartons_raw * ppc_val

                    distribution = distribute_quantity(total_pairs, parsed_sizes)
                    for sz, sz_qty in distribution.items():
                        if sz_qty <= 0:
                            continue
                        line_desc = desc or f"{ref} - {colour} - EU {sz}".strip(" -")
                        expanded_lines.append({
                            "row_index": row_idx,
                            "reference": ref,
                            "description": line_desc,
                            "size_eu": sz,
                            "colour": colour,
                            "brand": brand,
                            "location": location,
                            "quantity": sz_qty,
                            "cartons": cartons_raw,
                            "pairs_per_carton": ppc_val,
                            "unit_price": unit_price,
                            "price_warning": has_price_warning,
                        })
            else:
                # Single size or empty
                single_sz = parsed_sizes[0] if parsed_sizes else parse_integer_value(raw_size, default=0)
                tot_qty = qty_raw if qty_raw > 0 else (cartons_raw * ppc_val if cartons_raw > 0 else 1)
                line_desc = desc or f"{ref} - {colour} - EU {single_sz}".strip(" -")
                expanded_lines.append({
                    "row_index": row_idx,
                    "reference": ref,
                    "description": line_desc,
                    "size_eu": single_sz,
                    "colour": colour,
                    "brand": brand,
                    "location": location,
                    "quantity": tot_qty,
                    "cartons": cartons_raw,
                    "pairs_per_carton": ppc_val,
                    "unit_price": unit_price,
                    "price_warning": has_price_warning,
                })

        # ── SINGLE MODE: 1 row = 1 size/variant ──────────────────────────────
        else:
            raw_size = get_val(row, "size")
            size_eu = parse_integer_value(raw_size, default=0)
            qty_raw = parse_integer_value(get_val(row, "quantity"), default=0)
            tot_qty = qty_raw if qty_raw > 0 else (cartons_raw * ppc_val if cartons_raw > 0 else 1)

            line_desc = desc or f"{ref} - {colour} - EU {size_eu}".strip(" -")
            expanded_lines.append({
                "row_index": row_idx,
                "reference": ref,
                "description": line_desc,
                "size_eu": size_eu,
                "colour": colour,
                "brand": brand,
                "location": location,
                "quantity": tot_qty,
                "cartons": cartons_raw,
                "pairs_per_carton": ppc_val,
                "unit_price": unit_price,
                "price_warning": has_price_warning,
            })

    return expanded_lines


# ─────────────────────────────────────────────────────────────────────────────
# Catalog Matching & Preview Engine
# ─────────────────────────────────────────────────────────────────────────────

def reconcile_with_catalog(
    lines: List[Dict[str, Any]], tenant
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Matches expanded imported lines to catalog Products and Variants by reference, colour, size.
    Flags status:
      - 'matched': Variant exists in catalog
      - 'missing_variant': Product exists, but needs this size/colour variant created
      - 'new_product': Product does not exist in catalog (flags as New Product)
    Calculates summary totals (lines, cartons, pairs, estimated amount).
    """
    if not lines:
        return [], {
            "total_lines": 0,
            "total_cartons": 0,
            "total_pairs": 0,
            "total_estimated_amount": Decimal("0.00"),
            "matched_count": 0,
            "missing_variants_count": 0,
            "new_products_count": 0,
            "price_warnings_count": 0,
        }

    # Fetch existing products in tenant
    refs = {l["reference"].strip() for l in lines if l.get("reference")}
    products = Product.objects.filter(tenant=tenant, reference__in=refs).prefetch_related("variants")
    product_map: Dict[str, Product] = {p.reference.lower(): p for p in products}

    matched_lines = []
    total_cartons = 0
    total_pairs = 0
    total_estimated_amount = Decimal("0.00")

    matched_count = 0
    missing_variants_count = 0
    new_products_count = 0

    seen_new_products: Set[str] = set()

    for item in lines:
        ref = (item.get("reference") or "").strip()
        size_eu = item.get("size_eu") or 0
        colour = (item.get("colour") or "Standard").strip()
        qty = item.get("quantity") or 0
        price = item.get("unit_price") or Decimal("0.00")
        cartons = item.get("cartons") or 0

        total_cartons += cartons
        total_pairs += qty
        total_estimated_amount += (Decimal(qty) * price)

        product = product_map.get(ref.lower()) if ref else None

        line_result = {
            **item,
            "product_id": None,
            "product_name": None,
            "variant_id": None,
            "match_status": "new_product",
        }

        if product:
            line_result["product_id"] = product.id
            line_result["product_name"] = product.name

            # Look for matching variant
            variant = None
            for v in product.variants.all():
                if v.size_eu == size_eu and (
                    v.colour.lower() == colour.lower()
                    or (colour in ("Standard", "N/A", "") and v.colour in ("Standard", "N/A", ""))
                ):
                    variant = v
                    break

            if variant:
                line_result["variant_id"] = variant.id
                line_result["match_status"] = "matched"
                matched_count += 1
            else:
                line_result["match_status"] = "missing_variant"
                missing_variants_count += 1
        else:
            line_result["match_status"] = "new_product"
            new_products_count += 1
            if ref:
                seen_new_products.add(ref.lower())

        matched_lines.append(line_result)

    summary = {
        "total_lines": len(matched_lines),
        "total_cartons": total_cartons,
        "total_pairs": total_pairs,
        "total_estimated_amount": total_estimated_amount,
        "matched_count": matched_count,
        "missing_variants_count": missing_variants_count,
        "new_products_count": len(seen_new_products) if seen_new_products else new_products_count,
        "price_warnings_count": sum(1 for l in matched_lines if l.get("price_warning")),
    }

    return matched_lines, summary


# ─────────────────────────────────────────────────────────────────────────────
# Import Execution & PO Creation
# ─────────────────────────────────────────────────────────────────────────────

def execute_po_import(
    tenant,
    user,
    supplier: Supplier,
    lines: List[Dict[str, Any]],
    reference: str = "",
    expected_date: Optional[Any] = None,
    notes: str = "",
    quick_create_products: bool = True,
    save_as_template: bool = False,
    template_name: str = "",
    template_data: Optional[Dict[str, Any]] = None,
) -> Tuple[PurchaseOrder, Dict[str, Any]]:
    """
    Creates a PurchaseOrder(status="draft") and POLine items from imported lines.
    Auto-resolves or creates Product/Variant if quick_create_products is True.
    Optionally saves a SupplierImportTemplate for this supplier.
    """
    from apps.suppliers.views import _resolve_product, _resolve_variant

    with transaction.atomic():
        po = PurchaseOrder.objects.create(
            tenant=tenant,
            supplier=supplier,
            reference=reference,
            expected_date=expected_date,
            notes=notes,
            created_by=user,
            status=POStatusChoices.DRAFT,
        )

        total_amount = Decimal("0.00")
        created_lines_count = 0
        created_products_count = 0
        created_variants_count = 0

        # Cache created products within this transaction to avoid duplicates
        txn_product_cache: Dict[str, Product] = {}

        for item in lines:
            ref = (item.get("reference") or "").strip()
            desc = (item.get("description") or ref or "Article").strip()
            colour = (item.get("colour") or "Standard").strip()
            size_str = str(item.get("size") or "").strip()
            size_eu = item.get("size_eu") or 0
            if not size_eu and size_str.isdigit():
                sz_int = int(size_str)
                if 15 <= sz_int <= 60:
                    size_eu = sz_int
            elif size_str and not size_str.isdigit() and size_str not in desc:
                desc = f"{desc} ({size_str})"

            qty = parse_integer_value(item.get("quantity"), default=1)
            cartons = parse_integer_value(item.get("cartons"), default=0)
            ppc = parse_integer_value(item.get("pairs_per_carton"), default=10)
            price = parse_decimal_value(item.get("unit_price")) or Decimal("0.00")

            variant = None
            explicit_variant_id = item.get("variant_id")
            explicit_product_id = item.get("product_id")

            if explicit_variant_id:
                variant = Variant.objects.filter(tenant=tenant, id=explicit_variant_id).first()

            if not variant and (quick_create_products or explicit_product_id):
                product = None
                if explicit_product_id:
                    product = Product.objects.filter(tenant=tenant, id=explicit_product_id).first()

                cache_key = ref.lower() if ref else desc.lower()
                if not product:
                    product = txn_product_cache.get(cache_key)
                if not product and ref:
                    product = Product.objects.filter(tenant=tenant, reference__iexact=ref).first()
                if not product and desc:
                    product = Product.objects.filter(tenant=tenant, name__iexact=desc).first()

                if not product and quick_create_products:
                    product = _resolve_product(tenant, {
                        "reference": ref,
                        "product_name": desc,
                        "brand": item.get("brand", ""),
                        "category": "other",
                        "purchase_price": price,
                        "sale_price": (price * Decimal("1.30")).quantize(Decimal("0.01")) if price > 0 else Decimal("0.00"),
                        "pairs_per_carton": ppc,
                    })
                    created_products_count += 1

                if product:
                    txn_product_cache[cache_key] = product
                    variant = _resolve_variant(tenant, product, size_eu=size_eu, colour=colour)
                    if variant:
                        created_variants_count += 1

            line = POLine.objects.create(
                order=po,
                variant=variant,
                description=desc,
                quantity_ordered=qty,
                agreed_unit_price=price,
                cartons=cartons,
                pairs_per_carton=ppc,
            )
            total_amount += (price * Decimal(qty))
            created_lines_count += 1

        po.total_amount = total_amount
        po.save(update_fields=["total_amount"])

        # Optional Template Saving
        saved_template = None
        if save_as_template and template_name and template_data:
            saved_template, _ = SupplierImportTemplate.objects.update_or_create(
                tenant=tenant,
                supplier=supplier,
                name=template_name.strip(),
                defaults={
                    "header_row": template_data.get("header_row", 1),
                    "column_map": template_data.get("column_map", {}),
                    "size_mode": template_data.get("size_mode", ImportSizeModeChoices.SINGLE),
                    "default_colour": template_data.get("default_colour", ""),
                    "default_pairs_per_carton": template_data.get("default_pairs_per_carton"),
                },
            )

    stats = {
        "lines_count": created_lines_count,
        "created_products_count": created_products_count,
        "created_variants_count": created_variants_count,
        "total_amount": total_amount,
        "template_saved": bool(saved_template),
    }

    return po, stats

