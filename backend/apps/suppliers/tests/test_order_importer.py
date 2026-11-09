"""
Unit & Integration tests for Smart Purchase-Order Import Engine (Task 7.9).
Tests:
- Multi-encoding & delimiter detection (Arabic CP1256, French semicolon with comma decimals).
- Decimal parsing with currency suffixes (DA, DZD, €).
- English Excel matrix/pivot sheet transposition.
- Size range expansion (carton_breakdown and distribute_quantity).
- SupplierImportTemplate saving and re-application.
- API endpoints: import-preview & import-confirm.
"""
import io
from decimal import Decimal
import openpyxl
import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import PlanChoices, RoleChoices, Tenant, User
from apps.inventory.models import Product, Variant
from apps.suppliers.models import (
    ImportSizeModeChoices,
    POLine,
    POStatusChoices,
    PurchaseOrder,
    Supplier,
    SupplierImportTemplate,
)
from apps.suppliers.services.order_importer import (
    auto_map_headers,
    detect_delimiter,
    detect_encoding_and_decode,
    detect_header_row_and_headers,
    detect_size_matrix_column,
    execute_po_import,
    expand_imported_order_lines,
    parse_decimal_value,
    parse_supplier_order_file,
    reconcile_with_catalog,
)


@pytest.mark.django_db
class TestOrderImporter:
    @pytest.fixture(autouse=True)
    def setup_data(self):
        self.tenant = Tenant.objects.create(name="Import Test Shop", plan=PlanChoices.PRO_WHOLESALE)
        self.owner = User.objects.create_user(
            phone="0555112233",
            password="testpassword",
            tenant=self.tenant,
            role=RoleChoices.OWNER,
        )
        self.cashier = User.objects.create_user(
            phone="0555445566",
            password="testpassword",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )
        self.supplier = Supplier.objects.create(
            tenant=self.tenant,
            name="Grossiste El Eulma",
        )
        self.client = APIClient()

    # ── 1. Decimal & Currency Cleaning ─────────────────────────────────────────

    def test_decimal_parsing_multilingual(self):
        # French comma decimal with spaces and currency
        assert parse_decimal_value("1 250,50 DA") == Decimal("1250.50")
        assert parse_decimal_value("1250,50 DZD") == Decimal("1250.50")
        assert parse_decimal_value("1.250,50 €") == Decimal("1250.50")

        # English dot decimal
        assert parse_decimal_value("1,250.50") == Decimal("1250.50")
        assert parse_decimal_value("3500.00") == Decimal("3500.00")

        # Arabic text with currency
        assert parse_decimal_value("4500 دج") == Decimal("4500.00")

        # Invalid / None
        assert parse_decimal_value("") is None
        assert parse_decimal_value("N/A") is None
        assert parse_decimal_value(None) is None

    # ── 2. Arabic CP1256 CSV Import ───────────────────────────────────────────

    def test_arabic_cp1256_csv_import(self):
        # CSV encoded in Windows CP1256 with Arabic headers
        csv_text = (
            "المرجع;التعيين;المقاس;الكمية;سعر الشراء;اللون\n"
            "MOD-ARB-1;حذاء جلد كلاسيك;42;10;3 500,00 دج;بني\n"
            "MOD-ARB-2;حذاء رياضي;40;15;2800.00;أسود\n"
        )
        raw_bytes = csv_text.encode("cp1256")

        decoded, enc = detect_encoding_and_decode(raw_bytes)
        assert enc == "cp1256"
        assert "المرجع" in decoded

        raw_rows, _, delimiter, err = parse_supplier_order_file(raw_bytes, "commande_arabe.csv")
        assert err is None
        assert delimiter == ";"
        assert len(raw_rows) == 3

        header_idx, headers, data_rows = detect_header_row_and_headers(raw_rows)
        assert header_idx == 1
        assert "المرجع" in headers

        auto_map, size_cols, mode = auto_map_headers(headers)
        assert auto_map.get("المرجع") == "reference"
        assert auto_map.get("المقاس") == "size"
        assert auto_map.get("الكمية") == "quantity"
        assert auto_map.get("سعر الشراء") == "unit_price"
        assert auto_map.get("اللون") == "colour"

        lines = expand_imported_order_lines(
            headers=headers,
            data_rows=data_rows,
            column_map={h: auto_map[h] for h in headers if auto_map.get(h)},
            size_mode="single",
            tenant=self.tenant,
        )
        assert len(lines) == 2
        assert lines[0]["reference"] == "MOD-ARB-1"
        assert lines[0]["size_eu"] == 42
        assert lines[0]["quantity"] == 10
        assert lines[0]["unit_price"] == Decimal("3500.00")
        assert lines[0]["colour"] == "بني"

        po, stats = execute_po_import(
            tenant=self.tenant,
            user=self.owner,
            supplier=self.supplier,
            lines=lines,
            reference="BC-ARABIC-01",
        )
        assert po.status == POStatusChoices.DRAFT
        assert po.lines.count() == 2
        assert po.total_amount == (Decimal("3500.00") * 10) + (Decimal("2800.00") * 15)
        assert Product.objects.filter(tenant=self.tenant, reference="MOD-ARB-1").exists()

    # ── 3. French Semicolon CSV with Comma Decimals ────────────────────────────

    def test_french_semicolon_csv_import(self):
        csv_text = (
            "Réf;Désignation;Pointure;Qté;Prix Achat;Couleur\n"
            "CHAUSS-FR-01;Mocassin Confort;41;6;1 850,50 DA;Noir\n"
            "CHAUSS-FR-02;Basket Running;43;12;2 400,00 DA;Blanc\n"
        )
        raw_bytes = csv_text.encode("utf-8")

        raw_rows, enc, delimiter, err = parse_supplier_order_file(raw_bytes, "bon_commande.csv")
        assert err is None
        assert delimiter == ";"

        header_idx, headers, data_rows = detect_header_row_and_headers(raw_rows)
        auto_map, _, _ = auto_map_headers(headers)
        assert auto_map["Réf"] == "reference"
        assert auto_map["Pointure"] == "size"
        assert auto_map["Prix Achat"] == "unit_price"

        lines = expand_imported_order_lines(
            headers=headers,
            data_rows=data_rows,
            column_map={h: auto_map[h] for h in headers if auto_map.get(h)},
            size_mode="single",
            tenant=self.tenant,
        )
        assert len(lines) == 2
        assert lines[0]["unit_price"] == Decimal("1850.50")
        assert lines[1]["unit_price"] == Decimal("2400.00")

    # ── 4. English Excel Matrix/Pivot Sheet Transposition ──────────────────────

    def test_english_excel_matrix_transposition(self):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Order"

        # Headers with sizes 38..42 as column headers
        ws.append(["Reference", "Description", "Colour", "Unit Price", "38", "39", "40", "41", "42"])
        # Row 1: Air Max
        ws.append(["AM-90", "Air Max 90", "White", "4500.00", 2, 4, 6, 4, 2])
        # Row 2: Court Vision (empty for size 38 and 42)
        ws.append(["CV-LOW", "Court Vision Low", "Black", "3800.00", 0, 3, 5, 3, 0])

        out = io.BytesIO()
        wb.save(out)
        excel_bytes = out.getvalue()

        raw_rows, enc, delimiter, err = parse_supplier_order_file(excel_bytes, "order.xlsx")
        assert err is None
        header_idx, headers, data_rows = detect_header_row_and_headers(raw_rows)

        auto_map, size_matrix_cols, suggested_mode = auto_map_headers(headers)
        assert suggested_mode == "matrix"
        assert len(size_matrix_cols) == 5
        assert size_matrix_cols["38"] == 38
        assert size_matrix_cols["42"] == 42

        lines = expand_imported_order_lines(
            headers=headers,
            data_rows=data_rows,
            column_map={h: auto_map[h] for h in headers if auto_map.get(h)},
            size_mode="matrix",
            tenant=self.tenant,
        )
        # AM-90: 5 size lines (38, 39, 40, 41, 42)
        # CV-LOW: 3 size lines (39, 40, 41; sizes with 0 pairs are skipped)
        assert len(lines) == 5 + 3

        am_lines = [l for l in lines if l["reference"] == "AM-90"]
        assert len(am_lines) == 5
        assert {l["size_eu"]: l["quantity"] for l in am_lines} == {38: 2, 39: 4, 40: 6, 41: 4, 42: 2}

        cv_lines = [l for l in lines if l["reference"] == "CV-LOW"]
        assert len(cv_lines) == 3
        assert {l["size_eu"]: l["quantity"] for l in cv_lines} == {39: 3, 40: 5, 41: 3}

    # ── 5. Size Range Expansion (carton_breakdown & distribute_quantity) ──────

    def test_size_range_expansion_with_carton_breakdown(self):
        # Product with carton_breakdown
        product = Product.objects.create(
            tenant=self.tenant,
            name="Bottine Cuir",
            reference="BOT-CUIR",
            purchase_price=Decimal("3000.00"),
            pairs_per_carton=8,
            carton_breakdown={"39": 2, "40": 3, "41": 3},
        )

        headers = ["Réf", "Taille", "Colis", "Prix"]
        data_rows = [["BOT-CUIR", "39-41", "4", "3000.00"]]

        lines = expand_imported_order_lines(
            headers=headers,
            data_rows=data_rows,
            column_map={"Réf": "reference", "Taille": "size", "Colis": "cartons", "Prix": "unit_price"},
            size_mode="range",
            tenant=self.tenant,
        )
        # 4 cartons × breakdown: 39 -> 8, 40 -> 12, 41 -> 12
        assert len(lines) == 3
        qty_by_size = {l["size_eu"]: l["quantity"] for l in lines}
        assert qty_by_size == {39: 8, 40: 12, 41: 12}

    def test_size_range_expansion_with_distribute_quantity(self):
        # Product without carton breakdown, range '37-41' and total quantity 12 pairs
        headers = ["Réf", "Taille", "Qté", "Prix"]
        data_rows = [["SAND-ETÉ", "37-41", "12", "1500.00"]]

        lines = expand_imported_order_lines(
            headers=headers,
            data_rows=data_rows,
            column_map={"Réf": "reference", "Taille": "size", "Qté": "quantity", "Prix": "unit_price"},
            size_mode="range",
            tenant=self.tenant,
        )
        assert len(lines) == 5
        # 12 pairs distributed over 5 sizes (37, 38, 39, 40, 41): base 2, rem 2 to middle sizes 39, 38/40
        total_p = sum(l["quantity"] for l in lines)
        assert total_p == 12

    # ── 6. SupplierImportTemplate Creation & Re-Application ───────────────────

    def test_saved_template_creation_and_reapplication(self):
        # Create template for this supplier
        template = SupplierImportTemplate.objects.create(
            tenant=self.tenant,
            supplier=self.supplier,
            name="Modèle Fournisseur El Eulma",
            header_row=2,
            column_map={"Code": "reference", "Pointure": "size", "Paires": "quantity", "Prix": "unit_price"},
            size_mode=ImportSizeModeChoices.SINGLE,
            default_colour="Noir",
            default_pairs_per_carton=12,
        )

        csv_text = (
            "RAPPORT FOURNISSEUR EL EULMA\n"  # Row 1: title / banner
            "Code;Pointure;Paires;Prix\n"       # Row 2: actual header
            "EE-001;41;24;2100.00\n"
        )
        raw_bytes = csv_text.encode("utf-8")

        self.client.force_authenticate(user=self.owner)
        resp = self.client.post(
            "/api/v1/suppliers/purchase-orders/import-preview/",
            {"file": io.BytesIO(raw_bytes), "supplier_id": str(self.supplier.id)},
            format="multipart",
        )
        assert resp.status_code == status.HTTP_200_OK
        data = resp.data
        assert data["header_row"] == 2
        assert data["applied_template_id"] == str(template.id)
        assert data["default_colour"] == "Noir"
        assert len(data["preview_lines"]) == 1
        assert data["preview_lines"][0]["colour"] == "Noir"
        assert data["preview_lines"][0]["reference"] == "EE-001"

    # ── 7. API Integration: Preview & Confirm Endpoints ───────────────────────

    def test_api_import_preview_and_confirm_lifecycle(self):
        csv_text = (
            "Réf;Désignation;Pointure;Qté;Prix Achat;Couleur\n"
            "PROD-NEW-01;Sneakers Sport;42;10;2500,00;Blanc\n"
            "PROD-NEW-02;Sabot Cuir;40;5;1800,00;Marron\n"
        )
        file_obj = io.BytesIO(csv_text.encode("utf-8"))
        file_obj.name = "import.csv"

        # 1. Preview
        self.client.force_authenticate(user=self.owner)
        preview_resp = self.client.post(
            "/api/v1/suppliers/purchase-orders/import-preview/",
            {"file": file_obj, "supplier_id": str(self.supplier.id)},
            format="multipart",
        )
        assert preview_resp.status_code == status.HTTP_200_OK
        p_data = preview_resp.data
        assert p_data["summary"]["total_lines"] == 2
        assert p_data["summary"]["total_pairs"] == 15
        assert p_data["summary"]["total_estimated_amount"] == (Decimal("2500.00") * 10) + (Decimal("1800.00") * 5)
        assert p_data["summary"]["new_products_count"] == 2

        # 2. Confirm import
        confirm_payload = {
            "supplier_id": str(self.supplier.id),
            "reference": "BC-TEST-API",
            "notes": "Commande importée depuis fichier CSV",
            "lines": p_data["preview_lines"],
            "quick_create_products": True,
            "save_as_template": True,
            "template_name": "Modèle Standard Nouveau",
            "template_data": {
                "header_row": p_data["header_row"],
                "column_map": p_data["column_map"],
                "size_mode": p_data["size_mode"],
            },
        }

        confirm_resp = self.client.post(
            "/api/v1/suppliers/purchase-orders/import-confirm/",
            confirm_payload,
            format="json",
        )
        assert confirm_resp.status_code == status.HTTP_201_CREATED
        c_data = confirm_resp.data
        assert c_data["purchase_order"]["reference"] == "BC-TEST-API"
        assert c_data["purchase_order"]["status"] == "draft"
        assert c_data["stats"]["lines_count"] == 2
        assert c_data["stats"]["created_products_count"] == 2
        assert c_data["stats"]["template_saved"] is True

        # Check DB objects created
        po = PurchaseOrder.objects.get(id=c_data["purchase_order"]["id"])
        assert po.lines.count() == 2
        assert Product.objects.filter(tenant=self.tenant, reference="PROD-NEW-01").exists()
        assert SupplierImportTemplate.objects.filter(tenant=self.tenant, name="Modèle Standard Nouveau").exists()

    def test_cashier_forbidden_from_import(self):
        self.client.force_authenticate(user=self.cashier)
        resp = self.client.post(
            "/api/v1/suppliers/purchase-orders/import-preview/",
            {"file": io.BytesIO(b"Ref;Size\nA;40\n")},
            format="multipart",
        )
        assert resp.status_code == status.HTTP_403_FORBIDDEN

