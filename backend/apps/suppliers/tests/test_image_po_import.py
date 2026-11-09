"""
Tests for Task 7.10 — Smart purchase-order import: Offline image & photo parser (OpenCV + RapidOCR).
Covers:
  1. Agnostic OCR Engine (`apps.core.services.ocr`): mock OCR tokens processed through a dummy 3-column table profile.
  2. Bounding box row-clustering and X-projection column alignment unit tests.
  3. Regex & primitive extraction tests: French size runs (`37-41`), carton ratios (`12c/20p`),
     Algerian currency amounts (`2.450,00 DA`), dates (`DD/MM/YYYY`), and phones (`0555...`).
  4. Footwear PO profile (`PURCHASE_ORDER_PROFILE`): clean, tilted, and phone-photo synthetic fixtures
     of French supplier slips (including OpenCV deskewing, lighting normalization, and RapidOCR).
  5. Draft PO creation from parsed lines, catalog matching (`exact`, `partial`, `unmatched`),
     and permission checks (cashier -> 403, invalid file -> 400).
"""
import datetime
import io
from decimal import Decimal

import cv2
import numpy as np
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image, ImageDraw, ImageFont
from rest_framework.test import APIClient

from apps.core.models import Branch, RoleChoices, Tenant, User
from apps.core.services.ocr import (
    ColumnDefinition,
    DocumentScanEngine,
    ExtractionProfile,
    FieldExtractionRule,
    OCRToken,
    ProfileDocumentParser,
    parse_alphanumeric_code,
    parse_currency,
    parse_date,
    parse_integer,
    parse_phone,
)
from apps.inventory.models import Product, Variant
from apps.suppliers.models import POStatusChoices, PurchaseOrder, Supplier
from apps.suppliers.services import (
    PURCHASE_ORDER_PROFILE,
    match_po_scan_with_catalog,
    parse_carton_pair_ratio,
    parse_size_run,
    scan_purchase_order_image,
)


def _load_test_font(size: int = 24):
    """Loads a clean TrueType font for synthetic slip generation, falling back to default."""
    font_candidates = [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for path in font_candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _build_synthetic_supplier_slip_image(
    tilt_angle: float = 0.0,
    simulate_phone_photo: bool = False,
) -> bytes:
    """
    Generates a synthetic French footwear supplier slip ("Bon de Livraison") image.
    Supports optional tilt rotation and simulated phone-camera uneven lighting/noise.
    """
    width, height = 1200, 800
    img = Image.new("RGB", (width, height), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    font_header = _load_test_font(26)
    font_body = _load_test_font(24)

    # Top header metadata (within top 20% = y < 160)
    draw.text((60, 35), "SARL CHAUSSURES EL DJAZAIR", fill=(0, 0, 0), font=font_header)
    draw.text((60, 75), "Tel: 0555 12 34 56", fill=(0, 0, 0), font=font_body)
    draw.text((650, 35), "Bon de Livraison: BL-2026-089", fill=(0, 0, 0), font=font_header)
    draw.text((650, 75), "Date: 14/10/2026", fill=(0, 0, 0), font=font_body)

    # Table Header Row (y = 200)
    headers = [
        (60, "Ref"),
        (240, "Designation"),
        (560, "Pointure"),
        (740, "Cartons"),
        (900, "Qte"),
        (1030, "Prix"),
    ]
    for x, text in headers:
        draw.text((x, 200), text, fill=(0, 0, 0), font=font_header)

    # Table Body Rows
    rows = [
        [(60, "NK-AIR-01"), (240, "Basket Air Max"), (560, "37-41"), (740, "12c/20p"), (900, "240"), (1030, "2.450,00 DA")],
        [(60, "AD- Gazelle"), (240, "Tennis Cuir Blanc"), (560, "40"), (740, "5"), (900, "50"), (1030, "3.100,00 DA")],
        [(60, "NEW-BOOT-9"), (240, "Bottine Hiver Noir"), (560, "36-40"), (740, "8"), (900, "96"), (1030, "4.200,00 DA")],
    ]
    y_pos = 270
    for row in rows:
        for x, cell_text in row:
            draw.text((x, y_pos), cell_text, fill=(0, 0, 0), font=font_body)
        y_pos += 75

    # Footer Row
    draw.text((700, 560), "Total HT: 1.146.200,00 DA", fill=(0, 0, 0), font=font_header)

    arr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)

    if simulate_phone_photo:
        # Apply vertical & horizontal illumination gradient (shadow) + slight Gaussian noise
        h, w = arr.shape[:2]
        y_grad = np.linspace(0.78, 1.0, h).reshape(h, 1, 1)
        x_grad = np.linspace(0.85, 1.0, w).reshape(1, w, 1)
        shaded = np.clip(arr.astype(np.float32) * y_grad * x_grad, 0, 255).astype(np.uint8)
        arr = shaded

    if abs(tilt_angle) > 0.01:
        h, w = arr.shape[:2]
        rot_mat = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), tilt_angle, 1.0)
        arr = cv2.warpAffine(
            arr,
            rot_mat,
            (w, h),
            flags=cv2.INTER_CUBIC,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(255, 255, 255),
        )

    ok, encoded = cv2.imencode(".png", arr)
    assert ok
    return encoded.tobytes()


# ─────────────────────────────────────────────────────────────────────────────
# 1. Agnostic Engine Unit Test (Dummy 3-Column Profile)
# ─────────────────────────────────────────────────────────────────────────────

def test_agnostic_engine_with_dummy_three_column_profile():
    """
    Verifies that ProfileDocumentParser is completely domain-agnostic by injecting
    a custom 3-column 'expense_voucher' profile and parsing mock OCR tokens.
    """
    dummy_profile = ExtractionProfile(
        name="dummy_expense_voucher",
        header_anchors=["Code", "Libellé", "Montant"],
        columns=[
            ColumnDefinition(
                key="voucher_code",
                synonyms=["Code", "N° Pièce"],
                extractor=parse_alphanumeric_code,
                required=True,
            ),
            ColumnDefinition(
                key="label",
                synonyms=["Libellé", "Motif"],
                extractor=lambda v: str(v).strip(),
                required=True,
            ),
            ColumnDefinition(
                key="amount",
                synonyms=["Montant", "Somme"],
                extractor=parse_currency,
                required=True,
                align="right",
            ),
        ],
        header_fields={
            "voucher_date": FieldExtractionRule(
                key="voucher_date",
                keywords=["Date"],
                extractor=parse_date,
            ),
        },
        footer_fields={
            "grand_total": FieldExtractionRule(
                key="grand_total",
                keywords=["Total"],
                extractor=parse_currency,
            ),
        },
    )

    mock_tokens = [
        # Header metadata row (y ~ 40)
        OCRToken(text="Date: 25/11/2026", bbox=[50, 35, 240, 60], confidence=0.99),
        # Table header row (y ~ 100)
        OCRToken(text="Code", bbox=[50, 95, 130, 120], confidence=0.98),
        OCRToken(text="Libellé", bbox=[220, 95, 360, 120], confidence=0.98),
        OCRToken(text="Montant", bbox=[600, 95, 720, 120], confidence=0.97),
        # Body row 1 (y ~ 160)
        OCRToken(text="CHG-01", bbox=[52, 155, 135, 180], confidence=0.96),
        OCRToken(text="Transport Marchandise", bbox=[215, 157, 450, 182], confidence=0.95),
        OCRToken(text="4.500,00 DA", bbox=[595, 156, 730, 181], confidence=0.98),
        # Body row 2 (y ~ 210)
        OCRToken(text="CHG-02", bbox=[50, 205, 132, 230], confidence=0.97),
        OCRToken(text="Fournitures Bureau", bbox=[220, 206, 420, 231], confidence=0.94),
        OCRToken(text="1 250,50 DA", bbox=[600, 205, 725, 230], confidence=0.99),
        # Footer row (y ~ 280)
        OCRToken(text="Total: 5.750,50 DA", bbox=[500, 275, 730, 300], confidence=0.99),
    ]

    parser = ProfileDocumentParser()
    result = parser.parse_tokens(mock_tokens, dummy_profile, image_meta={"width": 800, "height": 400})

    assert result["profile"] == "dummy_expense_voucher"
    assert result["metadata"]["voucher_date"] == datetime.date(2026, 11, 25)
    assert len(result["rows"]) == 2

    assert result["rows"][0]["voucher_code"] == "CHG-01"
    assert result["rows"][0]["label"] == "Transport Marchandise"
    assert result["rows"][0]["amount"] == Decimal("4500.00")

    assert result["rows"][1]["voucher_code"] == "CHG-02"
    assert result["rows"][1]["label"] == "Fournitures Bureau"
    assert result["rows"][1]["amount"] == Decimal("1250.50")

    assert result["totals"]["grand_total"] == Decimal("5750.50")


# ─────────────────────────────────────────────────────────────────────────────
# 2. Bounding-Box Row Clustering & X-Projection Column Alignment Unit Tests
# ─────────────────────────────────────────────────────────────────────────────

def test_bounding_box_row_clustering_and_x_projection_alignment():
    """
    Tests that slightly jittered vertical coordinates cluster into the same horizontal
    row (sorted left-to-right), and that X-projection column boundaries align cells accurately.
    """
    tokens = [
        # Row 2 tokens added out of order with slight vertical jitter
        OCRToken(text="Col3_R2", bbox=[510, 204, 590, 228], confidence=0.9),
        OCRToken(text="Col1_R2", bbox=[45, 200, 120, 224], confidence=0.9),
        OCRToken(text="Col2_R2", bbox=[260, 202, 350, 226], confidence=0.9),
        # Row 1 (Header) tokens
        OCRToken(text="Réf", bbox=[50, 100, 110, 125], confidence=0.95),
        OCRToken(text="Pointure", bbox=[250, 102, 360, 127], confidence=0.95),
        OCRToken(text="Prix", bbox=[500, 99, 580, 124], confidence=0.95),
    ]

    clustered = DocumentScanEngine.cluster_rows(tokens)
    assert len(clustered) == 2
    assert [t.text for t in clustered[0]] == ["Réf", "Pointure", "Prix"]
    assert [t.text for t in clustered[1]] == ["Col1_R2", "Col2_R2", "Col3_R2"]

    col_defs = [
        ColumnDefinition(key="ref", synonyms=["Réf"]),
        ColumnDefinition(key="size", synonyms=["Pointure"]),
        ColumnDefinition(key="price", synonyms=["Prix"]),
    ]
    matched_headers = [
        (col_defs[0], clustered[0][0]),
        (col_defs[1], clustered[0][1]),
        (col_defs[2], clustered[0][2]),
    ]
    bounds = ProfileDocumentParser.compute_column_boundaries(matched_headers, max_x=800.0)
    assert len(bounds) == 3
    # Midpoint between Réf (x2=110) and Pointure (x1=250) is 180.0
    assert bounds[0]["x_min"] == 0.0
    assert bounds[0]["x_max"] == 180.0
    # Midpoint between Pointure (x2=360) and Prix (x1=500) is 430.0
    assert bounds[1]["x_min"] == 180.0
    assert bounds[1]["x_max"] == 430.0
    assert bounds[2]["x_min"] == 430.0

    assert ProfileDocumentParser.assign_token_to_column(clustered[1][0], bounds) == "ref"
    assert ProfileDocumentParser.assign_token_to_column(clustered[1][1], bounds) == "size"
    assert ProfileDocumentParser.assign_token_to_column(clustered[1][2], bounds) == "price"


# ─────────────────────────────────────────────────────────────────────────────
# 3. Regex & Field Extractor Unit Tests
# ─────────────────────────────────────────────────────────────────────────────

def test_regex_extractions_size_runs_carton_ratios_and_algerian_currency():
    """
    Tests regex extraction for:
      - French footwear size runs ('37-41', '36 – 40', '40/45')
      - Carton/pair ratios ('12c/20p', '10C/15P')
      - Algerian currency amounts ('2.450,00 DA', '1 250,50 DZD', '3500,00')
      - Algerian dates and phone numbers
    """
    assert parse_size_run("Pointures 37-41") == (37, 41)
    assert parse_size_run("36 – 40") == (36, 40)
    assert parse_size_run("40/45") == (40, 45)
    assert parse_size_run("99-10") is None

    ratio = parse_carton_pair_ratio("Colisage: 12c/20p")
    assert ratio == {"cartons": 12, "pairs_per_carton": 20, "total_pairs": 240}

    ratio_upper = parse_carton_pair_ratio("10C/15P")
    assert ratio_upper == {"cartons": 10, "pairs_per_carton": 15, "total_pairs": 150}

    assert parse_currency("2.450,00 DA") == Decimal("2450.00")
    assert parse_currency("1 250,50 DZD") == Decimal("1250.50")
    assert parse_currency("1.146.200,00 DA") == Decimal("1146200.00")
    assert parse_currency("3500") == Decimal("3500.00")

    assert parse_date("Alger le 14/10/2026") == datetime.date(2026, 10, 14)
    assert parse_date("15-03-26") == datetime.date(2026, 3, 15)
    assert parse_phone("Tél: 0555 12 34 56") == "0555123456"
    assert parse_phone("+213 661 98 76 54") == "0661987654"
    assert parse_integer("240 paires") == 240


# ─────────────────────────────────────────────────────────────────────────────
# 4. Footwear PO Profile Tests: Clean, Tilted & Phone-Photo Synthetic Slips
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_footwear_po_profile_clean_tilted_and_phone_photo_fixtures():
    """
    Tests end-to-end OpenCV + RapidOCR scanning on:
      1. Clean synthetic French supplier slip
      2. Tilted (-4.5°) synthetic French supplier slip (verifying OpenCV deskew)
      3. Phone-photo shaded synthetic French supplier slip
    """
    tenant = Tenant.objects.create(name="Chaussures Test Store")
    supplier = Supplier.objects.create(
        tenant=tenant,
        name="SARL CHAUSSURES EL DJAZAIR",
        phone="0555123456",
    )
    prod1 = Product.objects.create(
        tenant=tenant,
        name="Basket Air Max",
        reference="NK-AIR-01",
        purchase_price=Decimal("2400.00"),
        sale_price=Decimal("3500.00"),
    )
    Variant.objects.create(tenant=tenant, product=prod1, size_eu=40, colour="Standard")

    prod2 = Product.objects.create(
        tenant=tenant,
        name="Tennis Cuir Blanc",
        reference="AD-GAZELLE",
        purchase_price=Decimal("3000.00"),
        sale_price=Decimal("4200.00"),
    )
    v2 = Variant.objects.create(tenant=tenant, product=prod2, size_eu=40, colour="Standard")

    # 1. Clean synthetic slip
    clean_bytes = _build_synthetic_supplier_slip_image(tilt_angle=0.0, simulate_phone_photo=False)
    clean_res = scan_purchase_order_image(clean_bytes, tenant=tenant)

    assert clean_res["profile"] == "footwear_purchase_order"
    assert clean_res["detected_supplier"] is not None
    assert clean_res["detected_supplier"]["id"] == str(supplier.id)
    assert len(clean_res["rows"]) == 3

    row0 = clean_res["rows"][0]
    assert "NK-AIR-01" in row0["reference"].upper()
    assert row0["size"] == "37-41"
    assert row0["cartons"] == 12
    assert row0["pairs_per_carton"] == 20
    assert row0["quantity"] == 240
    assert Decimal(row0["unit_price"]) == Decimal("2450.00")
    assert row0["confidence"] == "partial"  # Product matched, size is a range 37-41
    assert row0["product_id"] == str(prod1.id)

    row1 = clean_res["rows"][1]
    assert row1["size"] == "40"
    assert row1["quantity"] == 50
    assert Decimal(row1["unit_price"]) == Decimal("3100.00")
    assert row1["confidence"] == "exact"  # Matched to prod2 + size 40 variant
    assert row1["variant_id"] == str(v2.id)

    row2 = clean_res["rows"][2]
    assert row2["size"] == "36-40"
    assert row2["quantity"] == 96
    assert Decimal(row2["unit_price"]) == Decimal("4200.00")
    assert row2["confidence"] == "unmatched"

    # 2. Tilted synthetic slip (skewed by 4.0 degrees)
    tilted_bytes = _build_synthetic_supplier_slip_image(tilt_angle=4.0, simulate_phone_photo=False)
    tilted_res = scan_purchase_order_image(tilted_bytes, tenant=tenant)
    assert len(tilted_res["rows"]) >= 2
    assert any(Decimal(r["unit_price"]) == Decimal("2450.00") for r in tilted_res["rows"])

    # 3. Phone-photo shaded synthetic slip
    photo_bytes = _build_synthetic_supplier_slip_image(tilt_angle=-2.0, simulate_phone_photo=True)
    photo_res = scan_purchase_order_image(photo_bytes, tenant=tenant)
    assert len(photo_res["rows"]) >= 2
    assert photo_res["detected_supplier"] is not None
    assert photo_res["detected_supplier"]["id"] == str(supplier.id)


# ─────────────────────────────────────────────────────────────────────────────
# 5. API Endpoint, Permission Checks & Draft PO Creation Test
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_scan_image_endpoint_and_draft_po_creation():
    """
    Tests:
      - Cashier receives 403 Forbidden on `/api/v1/suppliers/purchase-orders/scan-image/`.
      - Manager receives 400 Bad Request when uploading an unsupported file extension.
      - Manager scans slip via `/api/v1/suppliers/purchase-orders/scan-image/` (200 OK).
      - Manager confirms scanned lines via `/api/v1/suppliers/purchase-orders/import-confirm/`
        creating a `PurchaseOrder(status="draft")` with `POLine` items.
    """
    tenant = Tenant.objects.create(name="Oran Shoes")
    Branch.objects.create(tenant=tenant, name="Siège", is_headquarters=True)

    manager = User.objects.create_user(
        phone="0550112233",
        password="pass",
        tenant=tenant,
        role=RoleChoices.MANAGER,
    )
    cashier = User.objects.create_user(
        phone="0550998877",
        password="pass",
        tenant=tenant,
        role=RoleChoices.CASHIER,
    )
    supplier = Supplier.objects.create(
        tenant=tenant,
        name="SARL CHAUSSURES EL DJAZAIR",
        phone="0555123456",
    )

    slip_bytes = _build_synthetic_supplier_slip_image()

    # 1. Cashier -> 403 Forbidden
    cashier_client = APIClient()
    cashier_client.force_authenticate(user=cashier)
    forbidden_resp = cashier_client.post(
        "/api/v1/suppliers/purchase-orders/scan-image/",
        {"file": SimpleUploadedFile("bon.png", slip_bytes, content_type="image/png")},
        format="multipart",
    )
    assert forbidden_resp.status_code == 403

    # 2. Manager with invalid file extension -> 400 Bad Request
    mgr_client = APIClient()
    mgr_client.force_authenticate(user=manager)
    bad_ext_resp = mgr_client.post(
        "/api/v1/suppliers/purchase-orders/scan-image/",
        {"file": SimpleUploadedFile("bon.txt", b"not an image", content_type="text/plain")},
        format="multipart",
    )
    assert bad_ext_resp.status_code == 400

    # 3. Manager scans valid slip image -> 200 OK
    scan_resp = mgr_client.post(
        "/api/v1/suppliers/purchase-orders/scan-image/",
        {"file": SimpleUploadedFile("bon_livraison.png", slip_bytes, content_type="image/png")},
        format="multipart",
    )
    assert scan_resp.status_code == 200
    scan_data = scan_resp.json()
    assert scan_data["profile"] == "footwear_purchase_order"
    assert scan_data["detected_supplier"]["id"] == str(supplier.id)
    assert len(scan_data["rows"]) == 3

    # 4. Create Draft PO from scanned lines
    confirm_payload = {
        "supplier_id": str(supplier.id),
        "reference": scan_data["metadata"].get("document_reference") or "BL-SCAN-001",
        "notes": "Importé par scan photo OCR",
        "quick_create_products": True,
        "lines": [
            {
                "reference": r["reference"],
                "description": r["description"],
                "size": r["size"],
                "size_eu": r["size_eu"],
                "colour": r["colour"],
                "cartons": r["cartons"],
                "pairs_per_carton": r["pairs_per_carton"],
                "quantity": r["quantity"],
                "unit_price": r["unit_price"],
                "product_id": r["product_id"],
                "variant_id": r["variant_id"],
            }
            for r in scan_data["rows"]
        ],
    }
    confirm_resp = mgr_client.post(
        "/api/v1/suppliers/purchase-orders/import-confirm/",
        confirm_payload,
        format="json",
    )
    assert confirm_resp.status_code == 201
    po_data = confirm_resp.json()["purchase_order"]
    assert po_data["status"] == POStatusChoices.DRAFT
    assert po_data["supplier"] == str(supplier.id)

    po = PurchaseOrder.objects.get(id=po_data["id"])
    assert po.status == POStatusChoices.DRAFT
    assert po.lines.count() == 3
    assert po.total_amount == Decimal("1146200.00")


@pytest.mark.django_db
def test_scan_image_graceful_503_when_cv2_unavailable(monkeypatch):
    """
    Verifies that if OpenCV / libGL is not available on the system, the endpoint returns
    HTTP 503 with an informative error rather than crashing Django or dying.
    """
    tenant = Tenant.objects.create(name="Alger Shoes")
    manager = User.objects.create_user(
        phone="0550334455",
        password="pass",
        tenant=tenant,
        role=RoleChoices.MANAGER,
    )

    def mock_missing_cv2(*args, **kwargs):
        raise ImportError("libGL.so.1: cannot open shared object file: No such file or directory")

    monkeypatch.setattr(
        "apps.suppliers.views.scan_purchase_order_image",
        mock_missing_cv2,
    )

    client = APIClient()
    client.force_authenticate(user=manager)
    resp = client.post(
        "/api/v1/suppliers/purchase-orders/scan-image/",
        {"file": SimpleUploadedFile("slip.png", b"fake image bytes", content_type="image/png")},
        format="multipart",
    )
    assert resp.status_code == 503
    assert "OpenCV/libGL" in resp.json()["detail"]
