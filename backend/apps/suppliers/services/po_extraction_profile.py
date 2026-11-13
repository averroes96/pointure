"""
Layer 2 — Footwear Purchase Order Extraction Profile (`po_extraction_profile.py`).
Instantiates `ExtractionProfile` for footwear supplier slips, delivery notes ("bon de livraison"),
and physical order photos using the domain-agnostic OCR engine (`apps.core.services.ocr`).
"""
import re
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from apps.core.services.ocr import (
    ColumnDefinition,
    DocumentScanEngine,
    ExtractionProfile,
    FieldExtractionRule,
    OCRToken,
    ProfileDocumentParser,
    normalize_ocr_label,
    parse_alphanumeric_code,
    parse_currency,
    parse_date,
    parse_integer,
    parse_phone,
)
from apps.core.utils.phone import normalize_algerian_phone
from apps.inventory.models import Product, Variant
from apps.suppliers.models import Supplier

# ─────────────────────────────────────────────────────────────────────────────
# Specialized Footwear Grammars
# ─────────────────────────────────────────────────────────────────────────────

# Footwear size run regex: e.g. "36-40", "37-41", "40/45", "38–42"
FOOTWEAR_SIZE_RUN_REGEX = re.compile(r"\b(\d{2})\s*[-–/]\s*(\d{2})\b")

# Carton/pair notation: e.g. "10c/15p", "12C / 20P"
CARTON_PAIR_REGEX = re.compile(r"\b(\d+)\s*[cC]\s*/\s*(\d+)\s*[pP]\b")


def parse_size_run(val: Any) -> Optional[Tuple[int, int]]:
    """
    Extracts a footwear EU size range tuple (min_size, max_size) from text like '37-41' or '40/45'.
    Validates that both bounds are plausible EU footwear sizes (15..60) and start <= end.
    """
    if val is None:
        return None
    m = FOOTWEAR_SIZE_RUN_REGEX.search(str(val))
    if not m:
        return None
    s1, s2 = int(m.group(1)), int(m.group(2))
    if 15 <= s1 <= 60 and 15 <= s2 <= 60 and s1 <= s2:
        return (s1, s2)
    return None


def parse_carton_pair_ratio(val: Any) -> Optional[Dict[str, int]]:
    """
    Extracts carton/pair notation like '10c/15p' or '12c/20p'.
    Returns {'cartons': 12, 'pairs_per_carton': 20, 'total_pairs': 240} or None.
    """
    if val is None:
        return None
    m = CARTON_PAIR_REGEX.search(str(val))
    if not m:
        return None
    cartons = int(m.group(1))
    ppc = int(m.group(2))
    return {
        "cartons": cartons,
        "pairs_per_carton": ppc,
        "total_pairs": cartons * ppc,
    }


def extract_po_size_cell(val: Any) -> Optional[str]:
    """
    Column extractor for the `size` column:
    Returns normalized range string '37-41' if a size run is detected,
    or a single EU size string '40' if a single size is detected.
    """
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None

    rng = parse_size_run(s)
    if rng:
        return f"{rng[0]}-{rng[1]}"

    num = parse_integer(s)
    if num is not None and 15 <= num <= 60:
        return str(num)
    return s


def extract_po_carton_cell(val: Any) -> Optional[int]:
    """
    Column extractor for the `cartons` column:
    Supports '12c/20p' (returns 12) or plain integer '12'.
    """
    if val is None:
        return None
    ratio = parse_carton_pair_ratio(val)
    if ratio:
        return ratio["cartons"]
    return parse_integer(val)


def po_row_grammar_fallback(raw_line: str) -> Optional[Dict[str, Any]]:
    """
    Row-level grammar fallback when RapidOCR merges multiple cells of a footwear
    order line into a single horizontal text box.
    Example input:
      "NK-AIR-01 Basket Air Max Noir 37-41 12c/20p 240 2.450,00 DA"
      or "REF-102 Mocassin Cuir Marron 40-44 5 60 3 200,00 DA"
    """
    if not raw_line or not raw_line.strip():
        return None

    working = raw_line.strip()
    extracted: Dict[str, Any] = {}

    # Skip obvious header or footer lines
    norm = normalize_ocr_label(working)
    if any(
         norm.startswith(prefix)
         for prefix in ("total", "net a payer", "tva", "timbre", "arrete", "bon de", "date", "fournisseur", "tel")
    ):
        return None

    # 1. Extract carton/pair ratio if present (e.g. 12c/20p)
    ratio = parse_carton_pair_ratio(working)
    if ratio:
        extracted["cartons"] = ratio["cartons"]
        extracted["pairs_per_carton"] = ratio["pairs_per_carton"]
        working = CARTON_PAIR_REGEX.sub(" ", working, count=1)

    # 2. Extract footwear size run if present (e.g. 37-41, 40/45)
    rng = parse_size_run(working)
    if rng:
        extracted["size"] = f"{rng[0]}-{rng[1]}"
        working = FOOTWEAR_SIZE_RUN_REGEX.sub(" ", working, count=1)

    # 3. Extract trailing currency amount (unit price and/or line total)
    # Match French formatted decimals (e.g. 2.450,00 DA or 1 850,00 or 2450.00)
    price_matches = list(
        re.finditer(
            r"\b(\d{1,3}(?:[\.\s]\d{3})+,\d{2}|\d+[,\.]\d{2}|\d{3,6})\s*(?:DA|DZD)?\b",
            working,
            flags=re.IGNORECASE,
        )
    )
    if price_matches:
        # If two prices at the end (unit_price and line_total), take the first as unit_price
        # unless the first is a small quantity integer
        if len(price_matches) >= 2:
            last_m = price_matches[-1]
            prev_m = price_matches[-2]
            p_prev = parse_currency(prev_m.group(0))
            p_last = parse_currency(last_m.group(0))
            if p_prev and p_last and p_last >= p_prev and p_prev >= Decimal("100.00"):
                extracted["unit_price"] = p_prev
                working = working[: prev_m.start()] + " " + working[last_m.end() :]
            else:
                extracted["unit_price"] = p_last
                working = working[: last_m.start()] + " " + working[last_m.end() :]
        else:
            m_price = price_matches[-1]
            extracted["unit_price"] = parse_currency(m_price.group(0))
            working = working[: m_price.start()] + " " + working[m_price.end() :]

    # 4. Tokenize remaining text to extract reference, description, and trailing integers (cartons/qty/size)
    tokens = [t for t in working.split() if t]
    if not tokens:
        return extracted if extracted else None

    # First token is reference if it looks like an alphanumeric code (contains digits or hyphen or uppercase code)
    first_tok = tokens[0]
    if re.match(r"^[A-Za-z0-9][A-Za-z0-9\-_/\.]{1,20}$", first_tok) and (
        any(ch.isdigit() for ch in first_tok) or "-" in first_tok or len(first_tok) <= 10
    ):
        extracted["reference"] = parse_alphanumeric_code(first_tok)
        tokens = tokens[1:]

    # Trailing integer tokens represent [size], [cartons], [quantity]
    trailing_ints: List[int] = []
    while tokens and re.fullmatch(r"\d{1,4}", tokens[-1]):
        trailing_ints.insert(0, int(tokens.pop()))

    if trailing_ints:
        if "size" not in extracted and len(trailing_ints) >= 2 and 15 <= trailing_ints[0] <= 60:
            extracted["size"] = str(trailing_ints.pop(0))

        if len(trailing_ints) >= 2:
            if "cartons" not in extracted:
                extracted["cartons"] = trailing_ints[0]
            extracted["quantity"] = trailing_ints[-1]
        elif len(trailing_ints) == 1:
            val = trailing_ints[0]
            if "size" not in extracted and 35 <= val <= 46 and "cartons" in extracted:
                extracted["size"] = str(val)
            else:
                extracted["quantity"] = val

    if tokens:
        extracted["description"] = " ".join(tokens).strip(" -–:")

    if "quantity" not in extracted and ratio:
        extracted["quantity"] = ratio["total_pairs"]

    if not any(extracted.get(k) for k in ("reference", "description", "unit_price")):
        return None

    return extracted


def po_row_post_processor(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Post-processes a parsed Purchase Order row:
    - Extracts embedded carton/pair ratio ('12c/20p') from raw text or cells.
    - Extracts embedded footwear size run ('37-41') if `size` column was empty.
    - Computes total quantity from cartons * pairs_per_carton if quantity is missing.
    - Filters out summary/footer rows that leaked into the table body.
    """
    raw_text = str(row.get("_raw_text") or "")
    norm_raw = normalize_ocr_label(raw_text)

    # Filter out obvious summary lines
    if any(
        norm_raw.startswith(kw)
        for kw in ("total ht", "total ttc", "net a payer", "tva", "timbre", "sous total")
    ):
        return None

    # Check for carton/pair notation in raw_text or description/cartons
    ratio = parse_carton_pair_ratio(raw_text)
    if ratio:
        if not row.get("cartons"):
            row["cartons"] = ratio["cartons"]
        row["pairs_per_carton"] = ratio["pairs_per_carton"]
        if not row.get("quantity"):
            row["quantity"] = ratio["total_pairs"]
    else:
        row.setdefault("pairs_per_carton", 10)

    # Check for size run in raw_text or description if size is missing
    if not row.get("size"):
        rng = parse_size_run(raw_text)
        if rng:
            row["size"] = f"{rng[0]}-{rng[1]}"
            if row.get("description"):
                row["description"] = FOOTWEAR_SIZE_RUN_REGEX.sub("", str(row["description"])).strip(" -")

    # Clean description from any leftover carton/pair notation
    if row.get("description"):
        row["description"] = CARTON_PAIR_REGEX.sub("", str(row["description"])).strip(" -")

    # Default quantity from cartons * pairs_per_carton if missing
    cartons = row.get("cartons") or 0
    ppc = row.get("pairs_per_carton") or 10
    if not row.get("quantity") and cartons > 0:
        row["quantity"] = cartons * ppc

    return row


# ─────────────────────────────────────────────────────────────────────────────
# Footwear Purchase Order ExtractionProfile Instance
# ─────────────────────────────────────────────────────────────────────────────

PURCHASE_ORDER_PROFILE = ExtractionProfile(
    name="footwear_purchase_order",
    header_anchors=[
        "Réf", "Référence", "Code", "Article", "Désignation", "Modèle",
        "Pointure", "Taille", "Qté", "Quantité", "Paires", "Colis", "Cartons",
        "P.U.", "Prix Unitaire", "Montant HT",
    ],
    columns=[
        ColumnDefinition(
            key="reference",
            label="Référence",
            synonyms=["Réf", "Référence", "Ref", "Reference", "Code", "Article", "N°", "Item"],
            extractor=parse_alphanumeric_code,
            required=True,
            align="left",
        ),
        ColumnDefinition(
            key="description",
            label="Désignation",
            synonyms=["Désignation", "Designation", "Modèle", "Modele", "Description", "Libellé", "Libelle"],
            extractor=lambda v: str(v).strip() if v is not None else "",
            required=True,
            align="left",
        ),
        ColumnDefinition(
            key="size",
            label="Pointure",
            synonyms=["Pointure", "Taille", "P.", "Pointures", "Size", "Sizes"],
            extractor=extract_po_size_cell,
            required=False,
            align="center",
        ),
        ColumnDefinition(
            key="cartons",
            label="Cartons",
            synonyms=["Colis", "Cartons", "Ctn", "Série", "Serie", "Nb Ctn", "Carton"],
            extractor=extract_po_carton_cell,
            required=False,
            align="right",
        ),
        ColumnDefinition(
            key="quantity",
            label="Quantité (Paires)",
            synonyms=["Qté", "Qte", "Quantité", "Quantite", "Paires", "Nb Paires", "Qty", "Total Paires"],
            extractor=parse_integer,
            required=True,
            align="right",
        ),
        ColumnDefinition(
            key="unit_price",
            label="Prix Unitaire",
            synonyms=["P.U.", "PU", "Prix Unitaire", "P.U. HT", "PU HT", "Montant HT", "Prix"],
            extractor=parse_currency,
            required=False,
            align="right",
        ),
    ],
    header_fields={
        "document_date": FieldExtractionRule(
            key="document_date",
            keywords=["Date", "Le", "Alger le", "Oran le", "Sétif le", "Tlemcen le", "Du"],
            extractor=parse_date,
        ),
        "supplier_phone": FieldExtractionRule(
            key="supplier_phone",
            keywords=["Tél", "Tel", "Téléphone", "Mobile", "GSM", "Contact", "Phone"],
            extractor=parse_phone,
            regex=r"((?:\+213|00213|0)[\s\-\.]?[2-7](?:[\s\-\.]?\d){7,8})",
        ),
        "supplier_name": FieldExtractionRule(
            key="supplier_name",
            keywords=["Fournisseur", "Ets", "SARL", "EURL", "SPA", "SNC", "Société", "Atelier", "Fabrique"],
            extractor=lambda v: str(v).strip(" :-.") if v else "",
        ),
        "document_reference": FieldExtractionRule(
            key="document_reference",
            keywords=["Bon de Livraison", "Bon de Commande", "BL N°", "BC N°", "Facture N°", "Bon N°"],
            extractor=parse_alphanumeric_code,
            regex=r"(?:BL|BC|Bon|Facture|N°|No)[\s:\-\.]*([A-Za-z0-9\-/]{2,25})",
        ),
    },
    footer_fields={
        "subtotal_ht": FieldExtractionRule(
            key="subtotal_ht",
            keywords=["Total HT", "Montant HT", "Sous-total", "Total Brut"],
            extractor=parse_currency,
        ),
        "tva": FieldExtractionRule(
            key="tva",
            keywords=["TVA", "Taxe"],
            extractor=parse_currency,
        ),
        "total_ttc": FieldExtractionRule(
            key="total_ttc",
            keywords=["Total TTC", "Net à payer", "Net a payer", "Total Général", "Total"],
            extractor=parse_currency,
        ),
    },
    row_grammar_fallback=po_row_grammar_fallback,
    row_post_processor=po_row_post_processor,
)


# ─────────────────────────────────────────────────────────────────────────────
# Metadata Supplier Detector (Top 20% Scan)
# ─────────────────────────────────────────────────────────────────────────────

def detect_supplier_from_scan(
    tokens: List[OCRToken],
    metadata: Dict[str, Any],
    image_height: float,
    tenant,
) -> Optional[Dict[str, Any]]:
    """
    Scans the top 20% of document tokens (and parsed header metadata) for supplier name
    or Algerian phone number (05|06|07...) matched against the tenant's `Supplier` table.
    """
    if not tenant:
        return None

    suppliers = list(Supplier.objects.filter(tenant=tenant, is_active=True))
    if not suppliers:
        return None

    top_y_cutoff = max(200.0, float(image_height or 1000.0) * 0.25)
    top_tokens = [t for t in tokens if t.y1 <= top_y_cutoff]
    top_text = " ".join(t.text for t in top_tokens)

    # 1. Try matching by phone number first (most specific)
    candidate_phones: List[str] = []
    if metadata.get("supplier_phone"):
        candidate_phones.append(str(metadata["supplier_phone"]))

    found_phone = parse_phone(top_text)
    if found_phone and found_phone not in candidate_phones:
        candidate_phones.append(found_phone)

    for ph in candidate_phones:
        norm_ph = normalize_algerian_phone(ph)
        if not norm_ph:
            continue
        for sup in suppliers:
            if sup.phone and normalize_algerian_phone(sup.phone) == norm_ph:
                return {
                    "id": str(sup.id),
                    "name": sup.name,
                    "phone": sup.phone,
                    "matched_by": "phone",
                }

    # 2. Try matching by supplier name in top 20% tokens or metadata["supplier_name"]
    norm_top_text = normalize_ocr_label(top_text)
    norm_meta_name = normalize_ocr_label(metadata.get("supplier_name") or "")

    for sup in suppliers:
        sup_norm = normalize_ocr_label(sup.name)
        if not sup_norm or len(sup_norm) < 3:
            continue
        if sup_norm in norm_top_text or (norm_meta_name and (sup_norm in norm_meta_name or norm_meta_name in sup_norm)):
            return {
                "id": str(sup.id),
                "name": sup.name,
                "phone": sup.phone,
                "matched_by": "name",
            }

    return None


# ─────────────────────────────────────────────────────────────────────────────
# Catalog Matching Post-Processor
# ─────────────────────────────────────────────────────────────────────────────

def match_po_scan_with_catalog(
    parsed_rows: List[Dict[str, Any]],
    tenant,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Matches parsed OCR rows against the tenant's Product.reference, Variant.barcode (SKU),
    and Product.name.
    Computes line confidence:
      - 'exact': matched to a specific Variant (by barcode/SKU or Product.reference + single EU size)
      - 'partial': matched to an existing Product (e.g. size run or missing size variant)
      - 'unmatched': unknown reference not found in catalog
    """
    if not parsed_rows:
        return [], {
            "total_lines": 0,
            "total_cartons": 0,
            "total_pairs": 0,
            "total_estimated_amount": "0.00",
            "exact_count": 0,
            "partial_count": 0,
            "unmatched_count": 0,
        }

    products = list(
        Product.objects.filter(tenant=tenant, is_active=True).prefetch_related("variants")
    ) if tenant else []

    by_ref: Dict[str, Product] = {}
    by_name: Dict[str, Product] = {}
    by_barcode: Dict[str, Variant] = {}

    for prod in products:
        if prod.reference:
            by_ref[prod.reference.strip().lower()] = prod
        if prod.name:
            by_name[normalize_ocr_label(prod.name)] = prod
        for v in prod.variants.all():
            if v.barcode:
                by_barcode[v.barcode.strip().lower()] = v

    enriched_rows: List[Dict[str, Any]] = []
    total_cartons = 0
    total_pairs = 0
    total_amount = Decimal("0.00")
    exact_count = 0
    partial_count = 0
    unmatched_count = 0

    for idx, row in enumerate(parsed_rows):
        ref = str(row.get("reference") or "").strip()
        desc = str(row.get("description") or "").strip()
        size_val = str(row.get("size") or "").strip()
        cartons = int(row.get("cartons") or 0)
        ppc = int(row.get("pairs_per_carton") or 10)
        qty = int(row.get("quantity") or (cartons * ppc if cartons > 0 else 1))
        unit_price = parse_currency(row.get("unit_price")) or Decimal("0.00")

        matched_product: Optional[Product] = None
        matched_variant: Optional[Variant] = None
        confidence = "unmatched"
        match_status = "new_product"

        ref_lower = ref.lower()
        # 1. Check direct Variant barcode / SKU match
        if ref_lower and ref_lower in by_barcode:
            matched_variant = by_barcode[ref_lower]
            matched_product = matched_variant.product
            confidence = "exact"
            match_status = "matched"
        else:
            # 2. Check Product.reference match
            if ref_lower and ref_lower in by_ref:
                matched_product = by_ref[ref_lower]
            # 3. Fallback: check if Product.reference is inside description or description matches Product.name
            if not matched_product and desc:
                desc_norm = normalize_ocr_label(desc)
                if desc_norm in by_name:
                    matched_product = by_name[desc_norm]
                else:
                    for p_ref, prod_obj in by_ref.items():
                        if len(p_ref) >= 3 and p_ref in ref_lower:
                            matched_product = prod_obj
                            break

            if matched_product:
                # Check if size_val is a single integer EU size that matches a Variant
                single_size = parse_integer(size_val) if not parse_size_run(size_val) else None
                if single_size:
                    for v in matched_product.variants.all():
                        if v.size_eu == single_size:
                            matched_variant = v
                            break
                if matched_variant:
                    confidence = "exact"
                    match_status = "matched"
                else:
                    confidence = "partial"
                    match_status = "missing_variant"

        if confidence == "exact":
            exact_count += 1
        elif confidence == "partial":
            partial_count += 1
        else:
            unmatched_count += 1

        if unit_price == Decimal("0.00") and matched_product and matched_product.purchase_price > 0:
            unit_price = matched_product.purchase_price

        line_total = (unit_price * Decimal(qty)).quantize(Decimal("0.01"))
        total_cartons += cartons
        total_pairs += qty
        total_amount += line_total

        enriched_rows.append({
            "row_index": row.get("_row_index", idx + 1),
            "reference": ref,
            "description": desc or (matched_product.name if matched_product else ref),
            "size": size_val,
            "size_eu": matched_variant.size_eu if matched_variant else (parse_integer(size_val) if not parse_size_run(size_val) else 0),
            "colour": matched_variant.colour if matched_variant else "Standard",
            "cartons": cartons,
            "pairs_per_carton": ppc,
            "quantity": qty,
            "unit_price": str(unit_price),
            "line_total": str(line_total),
            "confidence": confidence,
            "ocr_confidence": row.get("_confidence", 1.0),
            "match_status": match_status,
            "product_id": str(matched_product.id) if matched_product else None,
            "product_name": matched_product.name if matched_product else None,
            "product_reference": matched_product.reference if matched_product else None,
            "variant_id": str(matched_variant.id) if matched_variant else None,
            "bbox": row.get("_bbox"),
            "raw_text": row.get("_raw_text", ""),
        })

    summary = {
        "total_lines": len(enriched_rows),
        "total_cartons": total_cartons,
        "total_pairs": total_pairs,
        "total_estimated_amount": str(total_amount.quantize(Decimal("0.01"))),
        "exact_count": exact_count,
        "partial_count": partial_count,
        "unmatched_count": unmatched_count,
    }
    return enriched_rows, summary


MAX_IMAGE_FILE_SIZE = 15 * 1024 * 1024  # 15 MB
MAX_IMAGE_PIXELS = 25_000_000           # 25 Megapixels (e.g. 5000x5000)
MAX_IMAGE_DIMENSION = 8000              # 8000 px max single axis
MAX_DATA_FILE_SIZE = 10 * 1024 * 1024   # 10 MB
MAX_IMPORT_ROWS = 5000                  # 5,000 rows


def validate_image_upload(
    raw_bytes: bytes,
    max_file_size: int = MAX_IMAGE_FILE_SIZE,
    max_pixels: int = MAX_IMAGE_PIXELS,
    max_dim: int = MAX_IMAGE_DIMENSION,
) -> Tuple[bool, Optional[str], int, str, Dict[str, Any]]:
    """
    Validates uploaded image file size and pixel dimensions before raster decoding.
    Inspects image header using Pillow without decompressing the pixel raster into RAM.
    Returns (is_valid, error_message, http_status_code, error_code, metadata_dict).
    """
    import io
    from django.utils.translation import gettext as _

    if len(raw_bytes) > max_file_size:
        msg = _("L'image dépasse la taille maximale autorisée de 15 Mo.")
        return False, msg, 413, "file_too_large", {"max_file_size": max_file_size}

    try:
        from apps.core.services.ocr.engine import get_pil_image
        Image = get_pil_image()
    except Exception:
        from PIL import Image

    try:
        with Image.open(io.BytesIO(raw_bytes)) as img:
            w, h = img.size
            total_pixels = w * h
            if total_pixels > max_pixels or w > max_dim or h > max_dim:
                mp = round(total_pixels / 1_000_000, 1)
                msg = _(
                    "Les dimensions de l'image (%(w)dx%(h)d = %(mp)s mégapixels) dépassent "
                    "la limite autorisée de 25 mégapixels. Veuillez réduire la résolution de l'image."
                ) % {"w": w, "h": h, "mp": mp}
                return False, msg, 413, "image_dimensions_too_large", {
                    "width": w,
                    "height": h,
                    "total_pixels": total_pixels,
                    "max_pixels": max_pixels,
                }
            return True, None, 200, "ok", {"width": w, "height": h, "total_pixels": total_pixels}
    except Exception as exc:
        msg = _("Fichier image corrompu ou illisible.")
        return False, f"{msg} ({exc})", 400, "corrupted_image", {}


def scan_purchase_order_image(
    image_input: Any,
    tenant=None,
    deskew: bool = True,
) -> Dict[str, Any]:
    """
    Full Layer 1 + Layer 2 pipeline for scanning a supplier purchase order / delivery slip image:
      1. Extracts spatial OCR tokens with OpenCV preprocessing + RapidOCR.
      2. Parses table rows, header metadata, and footer totals via `PURCHASE_ORDER_PROFILE`.
      3. Detects supplier from top 20% tokens (phone / name).
      4. Reconciles lines with the tenant's footwear catalog (`exact`, `partial`, `unmatched`).
    """
    if isinstance(image_input, (bytes, bytearray)):
        is_valid, err_msg, _, _, _ = validate_image_upload(image_input)
        if not is_valid:
            raise ValueError(err_msg)

    engine = DocumentScanEngine()
    parser = ProfileDocumentParser(engine=engine)

    tokens, image_meta = engine.extract_tokens(image_input, deskew=deskew)
    parsed = parser.parse_tokens(tokens, PURCHASE_ORDER_PROFILE, image_meta=image_meta)

    detected_supplier = detect_supplier_from_scan(
        tokens=tokens,
        metadata=parsed["metadata"],
        image_height=float(image_meta.get("height") or 1000.0),
        tenant=tenant,
    )

    rows, summary = match_po_scan_with_catalog(parsed["rows"], tenant=tenant)

    # Convert date/Decimal in metadata & totals for JSON serialization
    clean_meta: Dict[str, Any] = {}
    for k, v in parsed["metadata"].items():
        if hasattr(v, "isoformat"):
            clean_meta[k] = v.isoformat()
        elif isinstance(v, Decimal):
            clean_meta[k] = str(v)
        else:
            clean_meta[k] = v

    clean_totals: Dict[str, Any] = {}
    for k, v in parsed["totals"].items():
        clean_totals[k] = str(v) if isinstance(v, Decimal) else v

    return {
        "profile": PURCHASE_ORDER_PROFILE.name,
        "metadata": clean_meta,
        "detected_supplier": detected_supplier,
        "rows": rows,
        "summary": summary,
        "totals": clean_totals,
        "image_meta": image_meta,
        "tokens": parsed["tokens"],
        "column_bounds": parsed["column_bounds"],
    }

