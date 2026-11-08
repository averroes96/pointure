import io
from decimal import Decimal
import pytest
import openpyxl

from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import Branch, RoleChoices, Tenant, User
from apps.core.services.importer import (
    DataImportEngine,
    auto_map_columns,
    match_field_to_column,
    parse_file_data,
)
from apps.inventory.models import MovementReasonChoices, Product, StockMovement, Variant
from apps.suppliers.models import Supplier
from apps.clients.models import Client, ClientTypeChoices


@pytest.fixture
def tenant(db):
    return Tenant.objects.create(name="Import Test Footwear", is_active=True)


@pytest.fixture
def branch(tenant):
    return Branch.objects.create(tenant=tenant, name="Alger Centre", is_headquarters=True)


@pytest.fixture
def manager(tenant):
    user = User.objects.create_user(
        email="manager_import@shoedz.dz",
        password="securepassword123",
        first_name="Karim",
        last_name="Manager",
        role=RoleChoices.MANAGER,
        tenant=tenant,
    )
    return user


@pytest.fixture
def auth_client(manager):
    client = APIClient(HTTP_HOST="localhost")
    client.force_authenticate(user=manager)
    return client


@pytest.mark.django_db
class TestColumnAutoMapping:
    def test_french_headers_mapping(self):
        headers = [
            "Désignation", "Marque", "Pointure", "Couleur", "Prix Vente",
            "Prix Achat", "Stock Initial", "Code-barres", "Plafond Crédit", "Wilaya"
        ]
        prod_map = auto_map_columns(headers, "products")
        assert prod_map["Désignation"] == "name"
        assert prod_map["Marque"] == "brand"
        assert prod_map["Pointure"] == "size_eu"
        assert prod_map["Couleur"] == "colour"
        assert prod_map["Prix Vente"] == "sale_price"
        assert prod_map["Prix Achat"] == "purchase_price"
        assert prod_map["Stock Initial"] == "initial_stock"
        assert prod_map["Code-barres"] == "barcode"

        client_map = auto_map_columns(headers, "clients")
        assert client_map["Plafond Crédit"] == "credit_limit"
        assert client_map["Wilaya"] == "wilaya"

    def test_arabic_headers_mapping(self):
        headers = ["اسم المنتج", "الماركة", "المقاس", "اللون", "سعر البيع", "المخزون الأولي"]
        prod_map = auto_map_columns(headers, "products")
        assert prod_map["اسم المنتج"] == "name"
        assert prod_map["الماركة"] == "brand"
        assert prod_map["المقاس"] == "size_eu"
        assert prod_map["اللون"] == "colour"
        assert prod_map["سعر البيع"] == "sale_price"
        assert prod_map["المخزون الأولي"] == "initial_stock"

    def test_english_headers_mapping(self):
        headers = ["Product Name", "Brand", "EU Size", "Colour", "Sale Price", "Purchase Price"]
        prod_map = auto_map_columns(headers, "products")
        assert prod_map["Product Name"] == "name"
        assert prod_map["Brand"] == "brand"
        assert prod_map["EU Size"] == "size_eu"
        assert prod_map["Colour"] == "colour"
        assert prod_map["Sale Price"] == "sale_price"
        assert prod_map["Purchase Price"] == "purchase_price"


@pytest.mark.django_db
class TestTemplateGeneration:
    def test_generate_xlsx_template(self):
        content, ctype, fname = DataImportEngine.generate_template("products", "xlsx", "fr")
        assert ctype == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        assert fname.endswith(".xlsx")
        wb = openpyxl.load_workbook(io.BytesIO(content))
        ws = wb.active
        headers = [cell.value for cell in ws[1]]
        assert "Nom *" in headers
        assert "Pointure" in headers
        assert "Prix Vente (DZD) *" in headers

    def test_generate_csv_arabic_template(self):
        content, ctype, fname = DataImportEngine.generate_template("clients", "csv", "ar")
        assert ctype.startswith("text/csv")
        assert fname.endswith(".csv")
        assert "اسم العميل *" in content.decode("utf-8-sig")


@pytest.mark.django_db
class TestProductValidationAndExecution:
    def test_product_validation_preview(self, tenant, branch, manager):
        engine = DataImportEngine(tenant=tenant, entity_type="products", user=manager, branch=branch)
        headers = ["Nom", "Marque", "Pointure", "Prix Vente", "Stock Initial"]
        rows = [
            {"Nom": "Sneaker Ultra", "Marque": "Puma", "Pointure": "42", "Prix Vente": "8500", "Stock Initial": "10"},
            {"Nom": "Invalid Size", "Marque": "Nike", "Pointure": "99", "Prix Vente": "7000", "Stock Initial": "5"},
            {"Nom": "", "Marque": "Adidas", "Pointure": "40", "Prix Vente": "5000", "Stock Initial": "0"},
        ]
        mapping = {"Nom": "name", "Marque": "brand", "Pointure": "size_eu", "Prix Vente": "sale_price", "Stock Initial": "initial_stock"}

        preview = engine.validate_and_preview(headers, rows, mapping)
        assert preview["summary"]["total_rows"] == 3
        assert preview["summary"]["valid_rows"] == 1
        assert preview["summary"]["error_rows"] == 2
        assert len(preview["preview_rows"]) == 3

    def test_product_execution_with_stock_movement(self, tenant, branch, manager):
        engine = DataImportEngine(tenant=tenant, entity_type="products", user=manager, branch=branch)
        rows = [
            {
                "name": "Superstar Classic",
                "brand": "Adidas",
                "reference": "ADI-SS-01",
                "size_eu": "42",
                "colour": "Blanc",
                "purchase_price": "4000",
                "sale_price": "6500",
                "initial_stock": "15",
            },
            {
                "name": "Superstar Classic",
                "brand": "Adidas",
                "reference": "ADI-SS-01",
                "size_eu": "43",
                "colour": "Blanc",
                "purchase_price": "4000",
                "sale_price": "6500",
                "initial_stock": "20",
            },
        ]
        mapping = {k: k for k in rows[0].keys()}

        result = engine.execute_import(rows, mapping)
        assert result["success"] is True
        assert result["created_products"] == 1
        assert result["created_variants"] == 2
        assert result["created_stock_movements"] == 2

        # Verify DB records
        product = Product.objects.get(tenant=tenant, reference="ADI-SS-01")
        assert product.name == "Superstar Classic"
        assert product.pamp == Decimal("4000.00")
        assert product.variants.count() == 2

        # Verify stock movements
        movements = StockMovement.objects.filter(tenant=tenant, branch=branch)
        assert movements.count() == 2
        assert sum(m.quantity_delta for m in movements) == 35
        assert all(m.reason == MovementReasonChoices.INITIAL for m in movements)


@pytest.mark.django_db
class TestClientSupplierImport:
    def test_client_import_with_wilaya(self, tenant, manager):
        engine = DataImportEngine(tenant=tenant, entity_type="clients", user=manager)
        rows = [
            {"nom": "Boutique Alger", "tel": "0550112233", "wilaya": "Alger", "type": "wholesale"},
            {"nom": "Boutique Oran", "tel": "0770998877", "wilaya": "31", "type": "retail"},
        ]
        mapping = {"nom": "name", "tel": "phone", "wilaya": "wilaya", "type": "client_type"}

        result = engine.execute_import(rows, mapping)
        assert result["created"] == 2

        c1 = Client.objects.get(tenant=tenant, name="Boutique Alger")
        assert c1.wilaya == "16"
        assert c1.client_type == ClientTypeChoices.WHOLESALE

        c2 = Client.objects.get(tenant=tenant, name="Boutique Oran")
        assert c2.wilaya == "31"
        assert c2.client_type == ClientTypeChoices.RETAIL


@pytest.mark.django_db
class TestImportApiEndpoints:
    def test_template_download_endpoint(self, auth_client):
        res = auth_client.get("/api/v1/core/import/template/?entity=products&format=xlsx&lang=fr")
        assert res.status_code == status.HTTP_200_OK
        assert "modele_import_produits_shoedz.xlsx" in res["Content-Disposition"]

    def test_parse_and_preview_endpoints(self, auth_client):
        csv_data = "Nom,Marque,Pointure,Prix Vente\nAir Force,Nike,42,12000\n"
        csv_file = io.BytesIO(csv_data.encode("utf-8"))
        csv_file.name = "test.csv"

        # Parse
        res_parse = auth_client.post(
            "/api/v1/core/import/parse/",
            {"file": csv_file, "entity": "products"},
            format="multipart"
        )
        assert res_parse.status_code == status.HTTP_200_OK
        assert "Pointure" in res_parse.data["headers"]
        assert res_parse.data["auto_mapping"]["Pointure"] == "size_eu"

        # Preview
        csv_file.seek(0)
        res_preview = auth_client.post(
            "/api/v1/core/import/preview/",
            {"file": csv_file, "entity": "products"},
            format="multipart"
        )
        assert res_preview.status_code == status.HTTP_200_OK
        assert res_preview.data["summary"]["valid_rows"] == 1


@pytest.mark.django_db
class TestLegacyDBFClientOpeningBalances:
    def test_client_opening_balances_debit_and_credit(self, tenant, branch, monkeypatch):
        import datetime
        from django.utils import timezone
        from apps.clients.models import ClientLedger
        from apps.core.services.legacy_dbf import LegacyDBFImporter

        synthetic_clients = [
            {
                "CLIENT": "CLT001",
                "DESIGNAT": "Chaussures El Bahia",
                "TEL1": "0550123456",
                "ADRESSE": "Rue Larbi Ben M'hidi, Oran",
                "MT_RESTE": Decimal("48500.00"),
                "JOUR": datetime.date(2025, 11, 15),
            },
            {
                "CLIENT": "CLT002",
                "DESIGNAT": "Boutique El Amir",
                "TEL1": "0661987654",
                "ADRESSE": "Didouche Mourad, Alger",
                "MT_RESTE": Decimal("-12000.00"),
                "JOUR": None,
            },
            {
                "CLIENT": "CLT003",
                "DESIGNAT": "Client Comptoir Solde Zero",
                "TEL1": "0770112233",
                "ADRESSE": "Blida",
                "MT_RESTE": Decimal("0.00"),
                "JOUR": datetime.date(2025, 10, 1),
            },
        ]

        def fake_get_dbf(self, filename):
            if filename.upper() == "CLIENT.DBF":
                return synthetic_clients
            return []

        monkeypatch.setattr(LegacyDBFImporter, "get_dbf", fake_get_dbf)

        importer = LegacyDBFImporter(
            path="/tmp/fake_legacy",
            tenant=tenant,
            branch=branch,
            options={
                "suppliers": False,
                "clients": True,
                "products": False,
                "purchases": False,
                "defects": False,
                "sales": False,
            },
        )
        stats = importer.execute_import()
        assert stats["clients_imported"] == 3

        c1 = Client.objects.get(tenant=tenant, name="Chaussures El Bahia")
        c2 = Client.objects.get(tenant=tenant, name="Boutique El Amir")
        c3 = Client.objects.get(tenant=tenant, name="Client Comptoir Solde Zero")

        assert c1.cached_balance == Decimal("48500.00")
        assert c2.cached_balance == Decimal("-12000.00")
        assert c3.cached_balance == Decimal("0.00")

        entries_c1 = list(ClientLedger.objects.filter(client=c1))
        assert len(entries_c1) == 1
        assert entries_c1[0].entry_type == "debit"
        assert entries_c1[0].amount == Decimal("48500.00")
        assert entries_c1[0].balance_after == Decimal("48500.00")
        assert entries_c1[0].reference_type == "LegacyOpening"
        assert entries_c1[0].reference_id == "CLT001"
        assert entries_c1[0].date == datetime.date(2025, 11, 15)

        entries_c2 = list(ClientLedger.objects.filter(client=c2))
        assert len(entries_c2) == 1
        assert entries_c2[0].entry_type == "credit"
        assert entries_c2[0].amount == Decimal("12000.00")
        assert entries_c2[0].balance_after == Decimal("-12000.00")
        assert entries_c2[0].reference_type == "LegacyOpening"
        assert entries_c2[0].reference_id == "CLT002"
        assert entries_c2[0].date == timezone.localdate()

        assert ClientLedger.objects.filter(client=c3).count() == 0

        # Re-running the import does not duplicate opening balance entries
        importer_second = LegacyDBFImporter(
            path="/tmp/fake_legacy",
            tenant=tenant,
            branch=branch,
            options={
                "suppliers": False,
                "clients": True,
                "products": False,
                "purchases": False,
                "defects": False,
                "sales": False,
            },
        )
        importer_second.execute_import()
        c1.refresh_from_db()
        c2.refresh_from_db()
        assert c1.cached_balance == Decimal("48500.00")
        assert c2.cached_balance == Decimal("-12000.00")
        assert ClientLedger.objects.filter(client=c1).count() == 1
        assert ClientLedger.objects.filter(client=c2).count() == 1


@pytest.mark.django_db
class TestLegacyDBFDryRun:
    def test_dry_run_report_counts_totals_warnings_and_no_database_changes(self, tenant, branch, monkeypatch):
        import datetime
        from apps.clients.models import Client, ClientLedger
        from apps.suppliers.models import Supplier
        from apps.inventory.models import Product, Variant, StockMovement
        from apps.core.services.legacy_dbf import LegacyDBFImporter

        synthetic_data = {
            "FOURNISS.DBF": [
                {
                    "RAISON": "Fournisseur Alger",
                    "TELEPHONE": "021223344",
                    "ADRESSE": "Alger",
                    "MT_RESTE": Decimal("50000.00"),
                    "CODE_FOURN": "F01",
                },
                {
                    "RAISON": "Fournisseur Oran",
                    "TELEPHONE": "041556677",
                    "ADRESSE": "Oran",
                    "MT_RESTE": Decimal("15000.00"),
                    "CODE_FOURN": "F02",
                },
            ],
            "CLIENT.DBF": [
                {
                    "CLIENT": "C100",
                    "DESIGNAT": "Client Gros Blida",
                    "TEL1": "0550112233",
                    "ADRESSE": "Blida",
                    "MT_RESTE": Decimal("30000.00"),
                    "JOUR": datetime.date(2025, 12, 1),
                },
                {
                    "CLIENT": "C200",
                    "DESIGNAT": "Client Avoir Setif",
                    "TEL1": "0661445566",
                    "ADRESSE": "Setif",
                    "MT_RESTE": Decimal("-5000.00"),
                    "JOUR": None,
                },
            ],
            "FAMILLE.DBF": [
                {"FAMILLE": "HOM", "LIBELLE": "Homme Classique"},
            ],
            "ARTICLEB.DBF": [
                {
                    "ARTICLE": "A001",
                    "REFERENCE": "MOC-400",
                    "LIBELLE": "Mocassin Cuir Noir",
                    "FAMILLE": "HOM",
                    "PRIX_ACHAT": Decimal("2000.00"),
                    "BTARIF1": Decimal("3500.00"),
                    "ST_BL": 12,
                    "POINTURE": "40/43",
                },
                {
                    "ARTICLE": "A002",
                    "REFERENCE": "FREE-ITEM",
                    "LIBELLE": "Article Échantillon Sans Prix",
                    "FAMILLE": "HOM",
                    "PRIX_ACHAT": Decimal("0.00"),
                    "BTARIF1": Decimal("0.00"),
                    "PV_TARIF1": Decimal("0.00"),
                    "ST_BL": 4,
                    "POINTURE": "41",
                },
                {
                    "ARTICLE": "A003",
                    "REFERENCE": "BAD-SZ",
                    "LIBELLE": "Article Pointure Invalide",
                    "FAMILLE": "HOM",
                    "PRIX_ACHAT": Decimal("1500.00"),
                    "BTARIF1": Decimal("2500.00"),
                    "ST_BL": 6,
                    "POINTURE": "INVALID_SIZE",
                },
            ],
            "GCPARAM.DBF": [],
        }

        def fake_get_dbf(self, filename):
            return synthetic_data.get(filename.upper(), [])

        monkeypatch.setattr(LegacyDBFImporter, "get_dbf", fake_get_dbf)

        importer = LegacyDBFImporter(
            path="/tmp/fake_legacy",
            tenant=tenant,
            branch=branch,
            dry_run=True,
            options={
                "suppliers": True,
                "clients": True,
                "products": True,
                "purchases": False,
                "defects": False,
                "sales": False,
                "easy_mode": False,  # Trigger size range estimation warnings
            },
        )

        stats = importer.execute_import(dry_run=True)

        assert stats["dry_run"] is True
        assert stats["counts"]["suppliers"] == 4  # 2 from FOURNISS.DBF + 2 wholesale client vendors from CLIENT.DBF
        assert stats["counts"]["clients"] == 2
        assert stats["counts"]["products"] == 3
        assert stats["counts"]["stock_units"] == 22

        # Financial totals
        assert stats["totals"]["client_debts"] == Decimal("30000.00")
        assert stats["totals"]["client_credits"] == Decimal("5000.00")
        assert stats["totals"]["supplier_debts"] == Decimal("65000.00")
        assert stats["totals"]["stock_pairs"] == 22
        # Cost value: (12 * 2000) + (4 * 0) + (6 * 1500) = 24000 + 0 + 9000 = 33000
        assert stats["totals"]["stock_value"] == Decimal("33000.00")
        # Retail value: (12 * 3500) + (4 * 0) + (6 * 2500) = 42000 + 0 + 15000 = 57000
        assert stats["totals"]["stock_retail_value"] == Decimal("57000.00")

        # Warnings verification
        assert stats["warning_counts"]["products_without_price"] >= 1
        assert stats["warning_counts"]["unknown_sizes"] >= 1
        assert stats["warning_counts"]["guessed_size_ranges"] >= 1
        assert any("sans prix" in w.lower() for w in stats["warnings"])
        assert any("inconnue" in w.lower() for w in stats["warnings"])
        assert any("distribute_quantity" in w for w in stats["warnings"])

        # Strictly verify that NO rows were created in the database during dry run
        assert Supplier.objects.filter(tenant=tenant).count() == 0
        assert Client.objects.filter(tenant=tenant).count() == 0
        assert ClientLedger.objects.filter(client__tenant=tenant).count() == 0
        assert Product.objects.filter(tenant=tenant).count() == 0
        assert Variant.objects.filter(tenant=tenant).count() == 0
        assert StockMovement.objects.filter(tenant=tenant).count() == 0

    def test_legacy_import_view_dry_run_and_execution(self, auth_client, tenant, branch, monkeypatch):
        import io
        import zipfile
        from django.core.files.uploadedfile import SimpleUploadedFile
        from apps.clients.models import Client
        from apps.core.services.legacy_dbf import LegacyDBFImporter

        # Synthetic importer DBF loader
        def fake_get_dbf(self, filename):
            if filename.upper() == "CLIENT.DBF":
                return [
                    {
                        "CLIENT": "PREVIEW_01",
                        "DESIGNAT": "Client Simulation",
                        "TEL1": "0550000000",
                        "ADRESSE": "Tipaza",
                        "MT_RESTE": Decimal("15000.00"),
                    }
                ]
            return []

        monkeypatch.setattr(LegacyDBFImporter, "get_dbf", fake_get_dbf)

        # Build in-memory zip
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w") as zf:
            zf.writestr("CLIENT.DBF", b"placeholder")
        zip_buffer.seek(0)
        uploaded_zip = SimpleUploadedFile("legacy.zip", zip_buffer.read(), content_type="application/zip")

        # 1. Post with dry_run = true
        res_dry = auth_client.post(
            "/api/v1/core/legacy-import/",
            {"zip_file": uploaded_zip, "dry_run": "true"},
            format="multipart",
        )
        assert res_dry.status_code == 200
        assert res_dry.data["dry_run"] is True
        assert res_dry.data["stats"]["counts"]["clients"] == 1
        assert res_dry.data["stats"]["totals"]["client_debts"] == Decimal("15000.00")
        assert Client.objects.filter(tenant=tenant, name="Client Simulation").count() == 0

        # 2. Post with dry_run = false (real execution)
        zip_buffer.seek(0)
        uploaded_zip_live = SimpleUploadedFile("legacy.zip", zip_buffer.read(), content_type="application/zip")
        res_live = auth_client.post(
            "/api/v1/core/legacy-import/",
            {"zip_file": uploaded_zip_live, "dry_run": "false"},
            format="multipart",
        )
        assert res_live.status_code == 200
        assert res_live.data["dry_run"] is False
        assert Client.objects.filter(tenant=tenant, name="Client Simulation").count() == 1

    def test_management_command_dry_run(self, tenant, branch, monkeypatch):
        import io
        from django.core.management import call_command
        from apps.clients.models import Client
        from apps.core.services.legacy_dbf import LegacyDBFImporter

        def fake_get_dbf(self, filename):
            if filename.upper() == "CLIENT.DBF":
                return [
                    {
                        "CLIENT": "CMD_01",
                        "DESIGNAT": "Client Commande Test",
                        "TEL1": "0550111222",
                        "ADRESSE": "Boumerdes",
                        "MT_RESTE": Decimal("9000.00"),
                    }
                ]
            return []

        monkeypatch.setattr(LegacyDBFImporter, "get_dbf", fake_get_dbf)

        out = io.StringIO()
        call_command(
            "import_legacy_dbf",
            "/tmp/fake_dir",
            tenant_id=str(tenant.id),
            branch_id=str(branch.id),
            dry_run=True,
            stdout=out,
        )
        output = out.getvalue()
        assert "DRY-RUN" in output
        assert "Dry-run completed" in output
        assert Client.objects.filter(tenant=tenant, name="Client Commande Test").count() == 0
