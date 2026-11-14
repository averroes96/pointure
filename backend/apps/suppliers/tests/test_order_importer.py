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
from django.core.files.uploadedfile import SimpleUploadedFile
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

        # Currency suffixes without word boundaries
        assert parse_decimal_value("1200DA") == Decimal("1200.00")
        assert parse_decimal_value("1200dzd") == Decimal("1200.00")

        # Thousands separator without cents
        assert parse_decimal_value("2.450") == Decimal("2450.00")
        assert parse_decimal_value("1,250") == Decimal("1250.00")
        assert parse_decimal_value("12.500") == Decimal("12500.00")
        assert parse_decimal_value("1200 dinars") == Decimal("1200.00")
        assert parse_decimal_value("1.200 د.ج") == Decimal("1200.00")
        assert parse_decimal_value("0,500") == Decimal("0.50")
        assert parse_decimal_value("0.500") == Decimal("0.50")

        # Arabic text with currency
        assert parse_decimal_value("4500 دج") == Decimal("4500.00")

        # Invalid / None
        assert parse_decimal_value("") is None
        assert parse_decimal_value("N/A") is None
        assert parse_decimal_value(None) is None

    def test_integer_parsing_and_ranges(self):
        from apps.suppliers.services.order_importer import parse_integer_value
        from apps.core.services.legacy_dbf import parse_pointure_range

        # Float / decimal strings must yield their integral integer value, not multiplied by 10
        assert parse_integer_value("12.0") == 12
        assert parse_integer_value("12,0") == 12
        assert parse_integer_value(12.0) == 12

        # Non-integral decimal should not concatenate digits
        assert parse_integer_value("38.5") is None

        # Ranges should not concatenate into one large integer
        assert parse_integer_value("37 à 41") is None
        assert parse_integer_value("37-41") is None

        # parse_pointure_range should support 'à', 'a', 'au'
        assert parse_pointure_range("37 à 41", []) == [37, 38, 39, 40, 41]
        assert parse_pointure_range("37 a 41", []) == [37, 38, 39, 40, 41]
        assert parse_pointure_range("37 au 41", []) == [37, 38, 39, 40, 41]

    def test_price_warning_and_reconciliation(self):
        headers = ["Référence", "Désignation", "Pointure", "Quantité", "Prix Achat"]
        data_rows = [
            ["REF-VALID", "Chaussure Valid", "42", "5", "2500 DA"],
            ["REF-INVALID", "Chaussure Sans Prix", "40", "3", "SUR DEMANDE"],
        ]
        column_map = {
            "Référence": "reference",
            "Désignation": "description",
            "Pointure": "size",
            "Quantité": "quantity",
            "Prix Achat": "unit_price",
        }

        expanded = expand_imported_order_lines(
            headers=headers,
            data_rows=data_rows,
            column_map=column_map,
            size_mode="single",
            tenant=self.tenant,
        )

        assert len(expanded) == 2
        assert expanded[0]["unit_price"] == Decimal("2500.00")
        assert expanded[0]["price_warning"] is False

        assert expanded[1]["unit_price"] == Decimal("0.00")
        assert expanded[1]["price_warning"] is True

        matched_lines, summary = reconcile_with_catalog(expanded, tenant=self.tenant)
        assert len(matched_lines) == 2
        assert matched_lines[0]["match_status"] == "new_product"
        assert summary["price_warnings_count"] == 1
        assert summary["total_pairs"] == 8
        assert summary["total_estimated_amount"] == Decimal("12500.00")

    def test_invalid_quantity_size_and_price_are_preserved_as_warnings(self):
        headers = ["Référence", "Pointure", "Quantité", "Prix Achat"]
        data_rows = [
            ["REF-BAD-1", "38.5", "2.5", "SUR DEMANDE"],
            ["REF-BAD-2", "37 à 41", "3", "1200 dinars"],
        ]
        column_map = {
            "Référence": "reference",
            "Pointure": "size",
            "Quantité": "quantity",
            "Prix Achat": "unit_price",
        }

        expanded = expand_imported_order_lines(
            headers=headers,
            data_rows=data_rows,
            column_map=column_map,
            size_mode="single",
            tenant=self.tenant,
        )

        assert len(expanded) == 2
        assert expanded[0]["quantity"] is None
        assert expanded[0]["quantity_raw"] == "2.5"
        assert expanded[0]["qty_warning"] is True
        assert expanded[0]["size_eu"] is None
        assert expanded[0]["size_raw"] == "38.5"
        assert expanded[0]["size_warning"] is True
        assert expanded[0]["unit_price"] == Decimal("0.00")
        assert expanded[0]["unit_price_raw"] == "SUR DEMANDE"
        assert expanded[0]["price_warning"] is True
        assert expanded[1]["quantity"] == 3
        assert expanded[1]["qty_warning"] is False
        assert expanded[1]["size_eu"] is None
        assert expanded[1]["size_warning"] is True
        assert expanded[1]["unit_price"] == Decimal("1200.00")
        assert expanded[1]["price_warning"] is False

        matched, summary = reconcile_with_catalog(expanded, tenant=self.tenant)
        assert len(matched) == 2
        assert summary["qty_warnings_count"] == 1
        assert summary["size_warnings_count"] == 2
        assert summary["price_warnings_count"] == 1

    # ── 2. Arabic CP1256 CSV Import ───────────────────────────────────────────

    def test_arabic_cp1256_csv_import(self):
        # CSV encoded in Windows CP1256 with Arabic headers
        csv_text = (
            "المرجع;التعيين;المقاس;الكمية;سعر الشراء;اللون\n"
            "MOD-ARB-1;حذاءNike جلد كلاسيك;42;10;3 500,00 دج;بني\n"
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
        assert lines[0]["description"] == "حذاءNike جلد كلاسيك"
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

    def test_french_cp1252_csv_import(self):
        csv_text = (
            "RÉFÉRENCE;DÉSIGNATION;POINTURE;QUANTITÉ;PRIX ACHAT;COULEUR\n"
            "MOD-FR-01;Mocassin Cuir;41;12;2.450;Noir\n"
            "MOD-FR-02;Bottine Daim;42;8;3.800 DA;Marron\n"
        )
        raw_bytes = csv_text.encode("cp1252")

        decoded, enc = detect_encoding_and_decode(raw_bytes)
        assert enc == "cp1252"
        assert "RÉFÉRENCE" in decoded
        assert "DÉSIGNATION" in decoded
        assert "ة" not in decoded  # Must not corrupt into Arabic teh marbuta

        raw_rows, _, delimiter, err = parse_supplier_order_file(raw_bytes, "commande_fr.csv")
        assert err is None
        assert delimiter == ";"
        header_idx, headers, data_rows = detect_header_row_and_headers(raw_rows)
        assert any("RÉFÉRENCE" in h.upper() for h in headers)

        auto_map, _, _ = auto_map_headers(headers)
        lines = expand_imported_order_lines(
            headers=headers,
            data_rows=data_rows,
            column_map={h: auto_map[h] for h in headers if auto_map.get(h)},
            size_mode="single",
            tenant=self.tenant,
        )
        assert len(lines) == 2
        assert lines[0]["unit_price"] == Decimal("2450.00")
        assert lines[1]["unit_price"] == Decimal("3800.00")

    @pytest.mark.parametrize("filename", ["legacy.xls", "macro.xlsm", "template.xltx"])
    def test_unsupported_excel_extensions_are_rejected(self, filename):
        rows, encoding, delimiter, error = parse_supplier_order_file(b"not a csv file", filename)

        assert rows == []
        assert encoding == ""
        assert delimiter == ""
        assert str(error) == "Format de fichier non pris en charge. Utilisez un fichier .xlsx ou .csv."

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
        csv_file = io.BytesIO(raw_bytes)
        csv_file.name = "supplier-order.csv"

        self.client.force_authenticate(user=self.owner)
        resp = self.client.post(
            "/api/v1/suppliers/purchase-orders/import-preview/",
            {"file": csv_file, "supplier_id": str(self.supplier.id)},
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

    @pytest.mark.parametrize("warning_field", ["qty_warning", "size_warning", "price_warning"])
    def test_api_import_confirm_rejects_preview_warning(self, warning_field):
        self.client.force_authenticate(user=self.owner)
        line = {
            "reference": "WARNING-PRODUCT",
            "description": "Basket avec valeur invalide",
            "size_eu": None if warning_field == "size_warning" else 42,
            "quantity": 1,
            "unit_price": "0.00" if warning_field == "price_warning" else "2500.00",
            warning_field: True,
        }

        response = self.client.post(
            "/api/v1/suppliers/purchase-orders/import-confirm/",
            {"supplier_id": str(self.supplier.id), "lines": [line]},
            format="json",
        )

        expected_message = (
            "Corrigez les quantités, pointures et prix signalés avant de confirmer l'import."
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == {
            "error": {
                "code": "import_warnings",
                "message": expected_message,
                "details": {"non_field_errors": [expected_message]},
                "status_code": status.HTTP_400_BAD_REQUEST,
            }
        }
        assert PurchaseOrder.objects.filter(tenant=self.tenant).count() == 0
        assert Product.objects.filter(tenant=self.tenant, reference="WARNING-PRODUCT").count() == 0

    def test_api_import_confirm_rejects_identical_supplier_lines_for_10_seconds(self):
        self.client.force_authenticate(user=self.owner)
        payload = {
            "supplier_id": str(self.supplier.id),
            "reference": "BC-IDEMPOTENT-1",
            "lines": [
                {
                    "reference": "IDEMPOTENT-PRODUCT",
                    "description": "Basket de test",
                    "size_eu": 42,
                    "quantity": 10,
                    "unit_price": "2500.00",
                }
            ],
            "quick_create_products": False,
        }

        first_resp = self.client.post(
            "/api/v1/suppliers/purchase-orders/import-confirm/",
            payload,
            format="json",
        )
        assert first_resp.status_code == status.HTTP_201_CREATED

        duplicate_payload = {**payload, "reference": "BC-IDEMPOTENT-2"}
        duplicate_resp = self.client.post(
            "/api/v1/suppliers/purchase-orders/import-confirm/",
            duplicate_payload,
            format="json",
        )
        assert duplicate_resp.status_code == status.HTTP_409_CONFLICT
        assert duplicate_resp.data == {
            "error": {
                "code": "duplicate_po_import",
                "message": "Une confirmation identique a été reçue récemment. Réessayez dans 10 secondes.",
                "details": {},
                "status_code": status.HTTP_409_CONFLICT,
            }
        }

        changed_lines_payload = {
            **payload,
            "lines": [{**payload["lines"][0], "quantity": 11}],
        }
        changed_lines_resp = self.client.post(
            "/api/v1/suppliers/purchase-orders/import-confirm/",
            changed_lines_payload,
            format="json",
        )
        assert changed_lines_resp.status_code == status.HTTP_201_CREATED

        other_supplier = Supplier.objects.create(tenant=self.tenant, name="Autre fournisseur")
        other_supplier_payload = {**payload, "supplier_id": str(other_supplier.id)}
        other_supplier_resp = self.client.post(
            "/api/v1/suppliers/purchase-orders/import-confirm/",
            other_supplier_payload,
            format="json",
        )
        assert other_supplier_resp.status_code == status.HTTP_201_CREATED
        assert PurchaseOrder.objects.filter(tenant=self.tenant).count() == 3

    def test_cashier_forbidden_from_import(self):
        self.client.force_authenticate(user=self.cashier)
        resp = self.client.post(
            "/api/v1/suppliers/purchase-orders/import-preview/",
            {"file": io.BytesIO(b"Ref;Size\nA;40\n")},
            format="multipart",
        )
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_import_preview_with_string_default_pairs_per_carton(self):
        self.client.force_authenticate(user=self.owner)
        csv_bytes = b"Reference;Designation;Pointure;Quantite;Prix\nART-01;Basket Test;42;10;2500\n"
        upload = SimpleUploadedFile("commande.csv", csv_bytes, content_type="text/csv")

        # Frontend forms submit string values in multipart form data
        resp = self.client.post(
            "/api/v1/suppliers/purchase-orders/import-preview/",
            {
                "file": upload,
                "default_pairs_per_carton": "10",
            },
            format="multipart",
        )
        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data["preview_lines"]) == 1
        assert resp.data["preview_lines"][0]["pairs_per_carton"] == 10

        # Also test direct expand_imported_order_lines with string & edge case defaults
        for ppc_arg in ("12", "10", "", "invalid", None):
            lines = expand_imported_order_lines(
                headers=["Reference", "Designation", "Pointure", "Quantite", "Prix"],
                data_rows=[["ART-01", "Basket Test", "42", "10", "2500"]],
                column_map={"Reference": "reference", "Designation": "description", "Pointure": "size", "Quantite": "quantity", "Prix": "unit_price"},
                default_pairs_per_carton=ppc_arg,
                tenant=self.tenant,
            )
            assert len(lines) == 1
            assert isinstance(lines[0]["pairs_per_carton"], int)
            assert lines[0]["pairs_per_carton"] > 0

    def test_detect_size_matrix_column_ignores_tva_and_remise(self):
        # Tax, discount, totals, or non-size columns must NEVER be identified as sizes
        assert detect_size_matrix_column("TVA 19") is None
        assert detect_size_matrix_column("TVA 19%") is None
        assert detect_size_matrix_column("TVA 19 %") is None
        assert detect_size_matrix_column("Remise 20%") is None
        assert detect_size_matrix_column("Remise 20 %") is None
        assert detect_size_matrix_column("Discount 15%") is None
        assert detect_size_matrix_column("Article 42") is None
        assert detect_size_matrix_column("Prix 38") is None
        assert detect_size_matrix_column("Total 40") is None

        # Exact and prefixed sizes must match
        assert detect_size_matrix_column("38") == 38
        assert detect_size_matrix_column("38.0") == 38
        assert detect_size_matrix_column("38,0") == 38
        assert detect_size_matrix_column("P38") == 38
        assert detect_size_matrix_column("P.40") == 40
        assert detect_size_matrix_column("T42") == 42
        assert detect_size_matrix_column("T.42") == 42
        assert detect_size_matrix_column("Pointure 39") == 39
        assert detect_size_matrix_column("Size 41") == 41
        assert detect_size_matrix_column("42 EU") == 42
        assert detect_size_matrix_column("42 eu") == 42
        assert detect_size_matrix_column("مقاس 38") == 38
        assert detect_size_matrix_column("قياس 40") == 40

    def test_auto_map_headers_prix_total_vs_pu_ht(self):
        # Ensure 'Prix Total' is excluded from unit_price and does not steal mapping from 'PU HT'
        headers = ["Référence", "Désignation", "Prix Total", "PU HT", "Qté"]
        auto_map, size_cols, mode = auto_map_headers(headers)

        assert auto_map.get("PU HT") == "unit_price"
        assert auto_map.get("Prix Total") is None
        assert auto_map.get("Référence") == "reference"
        assert auto_map.get("Désignation") == "description"
        assert auto_map.get("Qté") == "quantity"

    def test_auto_map_headers_designation_article_and_code_couleur(self):
        # Compound headers should map to their specific target, not steal reference
        headers = ["Désignation article", "Code couleur", "Référence", "P.U."]
        auto_map, _, _ = auto_map_headers(headers)

        assert auto_map.get("Désignation article") == "description"
        assert auto_map.get("Code couleur") == "colour"
        assert auto_map.get("Référence") == "reference"
        assert auto_map.get("P.U.") == "unit_price"

    def test_resolve_variant_no_arbitrary_fallback(self):
        from apps.suppliers.views import _resolve_variant

        product = Product.objects.create(
            tenant=self.tenant,
            name="Basket Falcon",
            reference="FALCON-01",
            purchase_price=Decimal("4000.00"),
        )
        # Sized variants
        var40 = Variant.objects.create(tenant=self.tenant, product=product, size_eu=40, colour="Noir")
        var42 = Variant.objects.create(tenant=self.tenant, product=product, size_eu=42, colour="Noir")

        # Resolving size 0 for a sized product MUST NOT fall back to arbitrary variant (e.g. var40)
        resolved_invalid = _resolve_variant(self.tenant, product, size_eu=0, colour="Noir")
        assert resolved_invalid is None

        # Resolving an existing valid size returns the exact variant
        resolved_40 = _resolve_variant(self.tenant, product, size_eu=40, colour="Noir")
        assert resolved_40 is not None
        assert resolved_40.id == var40.id

        # Resolving a new valid size creates that specific variant
        resolved_41 = _resolve_variant(self.tenant, product, size_eu=41, colour="Noir")
        assert resolved_41 is not None
        assert resolved_41.size_eu == 41

    def test_import_preview_rejects_oversized_file(self):
        self.client.force_authenticate(user=self.owner)
        oversized_bytes = b"Reference;Pointure;Quantite;Prix\n" + (b"ART-01;40;10;2500\n" * 600000)
        upload = SimpleUploadedFile("big.csv", oversized_bytes, content_type="text/csv")

        resp = self.client.post(
            "/api/v1/suppliers/purchase-orders/import-preview/",
            {"file": upload},
            format="multipart",
        )
        assert resp.status_code == status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
        assert resp.data["error"]["code"] in ("file_too_large", "import_limit_exceeded")

    def test_import_preview_rejects_over_5000_rows(self):
        self.client.force_authenticate(user=self.owner)
        # Create CSV with header + 5,005 rows
        csv_lines = ["Reference;Pointure;Quantite;Prix"]
        for i in range(5005):
            csv_lines.append(f"ART-{i};40;10;2500")
        csv_bytes = "\n".join(csv_lines).encode("utf-8")
        upload = SimpleUploadedFile("many_rows.csv", csv_bytes, content_type="text/csv")

        resp = self.client.post(
            "/api/v1/suppliers/purchase-orders/import-preview/",
            {"file": upload},
            format="multipart",
        )
        assert resp.status_code == status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
        assert resp.data["error"]["code"] in ("too_many_rows", "import_limit_exceeded")

    def test_parse_csv_and_xlsx_row_and_size_limits(self):
        from apps.suppliers.services.order_importer import parse_csv_file, parse_xlsx_file

        # 1. parse_csv_file oversized
        huge_bytes = b"X" * (11 * 1024 * 1024)
        rows, enc, delim, err = parse_csv_file(huge_bytes)
        assert len(rows) == 0
        assert "10 Mo" in str(err)

        # 2. parse_csv_file too many rows
        lines = ["Ref,Qty"] + [f"Item{i},1" for i in range(5005)]
        csv_bytes = "\n".join(lines).encode("utf-8")
        rows, enc, delim, err = parse_csv_file(csv_bytes)
        assert len(rows) == 0
        assert "5000" in str(err)

        # 3. parse_xlsx_file oversized
        rows, err = parse_xlsx_file(huge_bytes)
        assert len(rows) == 0
        assert "10 Mo" in str(err)




