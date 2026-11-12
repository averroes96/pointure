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

    def test_parse_endpoint_rejects_unsupported_xls(self, auth_client):
        xls_file = io.BytesIO(b"not a csv file")
        xls_file.name = "legacy.xls"

        response = auth_client.post(
            "/api/v1/core/import/parse/",
            {"file": xls_file, "entity": "products"},
            format="multipart",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == {
            "detail": "Format de fichier non pris en charge. Utilisez un fichier .xlsx ou .csv."
        }

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

        def fake_get_dbf(self, filename, optional=False):
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

        def fake_get_dbf(self, filename, optional=False):
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
        assert stats["counts"]["suppliers"] == 2  # Only the two records from FOURNISS.DBF are suppliers without purchase references.
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
        def fake_get_dbf(self, filename, optional=False):
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

        def fake_get_dbf(self, filename, optional=False):
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


@pytest.mark.django_db
class TestLegacyDBFTiersSuppliersChequesPartPayments:
    """Task 7.3 — Import 3 price tiers, supplier opening balances (+/-), unsettled cheques, and open part-payments."""

    def test_import_three_price_tiers_and_client_price_tier(self, tenant, branch, monkeypatch):
        from apps.clients.models import Client
        from apps.inventory.models import Product
        from apps.core.services.legacy_dbf import LegacyDBFImporter

        synthetic_data = {
            "CLIENT.DBF": [
                {
                    "CLIENT": "CLT_T1",
                    "DESIGNAT": "Client Tarif Detail",
                    "TEL1": "0550100001",
                    "CODE_TARIF": "1",
                },
                {
                    "CLIENT": "CLT_T2",
                    "DESIGNAT": "Client Tarif DemiGros",
                    "TEL1": "0550100002",
                    "CODE_TARIF": "2",
                },
                {
                    "CLIENT": "CLT_T3",
                    "DESIGNAT": "Client Tarif Gros",
                    "TEL1": "0550100003",
                    "CODE_TARIF": "3",
                },
            ],
            "FAMILLE.DBF": [
                {"FAMILLE": "SPORT", "LIBELLE": "Basket Sport"},
            ],
            "ARTICLEB.DBF": [
                {
                    "ARTICLE": "ART_3TIERS",
                    "REFERENCE": "BSK-900",
                    "LIBELLE": "Basket Cuir 3 Tarifs",
                    "FAMILLE": "SPORT",
                    "PRIX_ACHAT": Decimal("1800.00"),
                    "BTARIF1": Decimal("3500.00"),
                    "BTARIF2": Decimal("2900.00"),
                    "BTARIF3": Decimal("2500.00"),
                    "ST_BL": 5,
                    "POINTURE": "42",
                },
                {
                    "ARTICLE": "ART_2TIERS",
                    "REFERENCE": "BSK-901",
                    "LIBELLE": "Basket 2 Tarifs Sans BTARIF3",
                    "FAMILLE": "SPORT",
                    "PRIX_ACHAT": Decimal("1500.00"),
                    "PV_TARIF1": Decimal("3200.00"),
                    "PV_TARIF2": Decimal("2700.00"),
                    "PV_TARIF3": Decimal("0.00"),
                    "ST_BL": 3,
                    "POINTURE": "41",
                },
            ],
        }

        monkeypatch.setattr(
            LegacyDBFImporter,
            "get_dbf",
            lambda self, filename, optional=False: synthetic_data.get(filename.upper(), []),
        )

        importer = LegacyDBFImporter(
            path="/tmp/fake_legacy",
            tenant=tenant,
            branch=branch,
            options={
                "suppliers": False,
                "clients": True,
                "products": True,
                "purchases": False,
                "defects": False,
                "sales": False,
                "cheques": False,
                "part_payments": False,
            },
        )
        importer.execute_import()

        c1 = Client.objects.get(tenant=tenant, name="Client Tarif Detail")
        c2 = Client.objects.get(tenant=tenant, name="Client Tarif DemiGros")
        c3 = Client.objects.get(tenant=tenant, name="Client Tarif Gros")
        assert c1.price_tier == "detail"
        assert c2.price_tier == "demi_gros"
        assert c3.price_tier == "gros"

        p3 = Product.objects.get(tenant=tenant, reference="BSK-900")
        assert p3.sale_price == Decimal("3500.00")
        assert p3.semi_wholesale_price == Decimal("2900.00")
        assert p3.wholesale_price == Decimal("2500.00")

        p2 = Product.objects.get(tenant=tenant, reference="BSK-901")
        assert p2.sale_price == Decimal("3200.00")
        assert p2.semi_wholesale_price == Decimal("2700.00")
        # Fallback to Tarif 2 when Tarif 3 is 0
        assert p2.wholesale_price == Decimal("2700.00")

    def test_import_supplier_positive_and_negative_opening_balances(self, tenant, branch, monkeypatch):
        from apps.suppliers.models import Supplier, SupplierInvoice, SupplierPayment
        from apps.core.services.legacy_dbf import LegacyDBFImporter

        synthetic_data = {
            "FOURNISS.DBF": [
                {
                    "CODE_FOURN": "FRN_POS",
                    "RAISON": "Usine Chaussures Tlemcen",
                    "TELEPHONE": "043221100",
                    "ADRESSE": "Tlemcen",
                    "MT_RESTE": Decimal("85000.00"),
                },
                {
                    "CODE_FOURN": "FRN_NEG",
                    "RAISON": "Importateur Cuir Bejaia",
                    "TELEPHONE": "034112233",
                    "ADRESSE": "Bejaia",
                    "MT_RESTE": Decimal("-12000.00"),
                },
            ],
        }

        monkeypatch.setattr(
            LegacyDBFImporter,
            "get_dbf",
            lambda self, filename, optional=False: synthetic_data.get(filename.upper(), []),
        )

        importer = LegacyDBFImporter(
            path="/tmp/fake_legacy",
            tenant=tenant,
            branch=branch,
            options={
                "suppliers": True,
                "clients": False,
                "products": False,
                "purchases": False,
                "defects": False,
                "sales": False,
                "cheques": False,
                "part_payments": False,
            },
        )
        stats = importer.execute_import()

        assert stats["totals"]["supplier_debts"] == Decimal("85000.00")
        assert stats["totals"]["supplier_credits"] == Decimal("12000.00")

        sup_pos = Supplier.objects.get(tenant=tenant, name="Usine Chaussures Tlemcen")
        sup_neg = Supplier.objects.get(tenant=tenant, name="Importateur Cuir Bejaia")
        assert sup_pos.outstanding_balance == Decimal("85000.00")
        assert sup_neg.outstanding_balance == Decimal("-12000.00")

        inv = SupplierInvoice.objects.get(tenant=tenant, supplier=sup_pos, invoice_number="SOLDE-OUVERTURE")
        assert inv.total_amount == Decimal("85000.00")

        pmt = SupplierPayment.objects.get(
            tenant=tenant,
            supplier=sup_neg,
            notes="Solde créditeur d'ouverture",
        )
        assert pmt.amount == Decimal("12000.00")

        # Verify idempotency when re-importing
        importer2 = LegacyDBFImporter(
            path="/tmp/fake_legacy",
            tenant=tenant,
            branch=branch,
            options={
                "suppliers": True,
                "clients": False,
                "products": False,
                "purchases": False,
                "defects": False,
                "sales": False,
                "cheques": False,
                "part_payments": False,
            },
        )
        importer2.execute_import()
        sup_pos.refresh_from_db()
        sup_neg.refresh_from_db()
        assert sup_pos.outstanding_balance == Decimal("85000.00")
        assert sup_neg.outstanding_balance == Decimal("-12000.00")
        assert SupplierInvoice.objects.filter(tenant=tenant, supplier=sup_pos).count() == 1
        assert SupplierPayment.objects.filter(tenant=tenant, supplier=sup_neg).count() == 1

    def test_import_unsettled_cheques_from_chequexp_and_creance(self, tenant, branch, monkeypatch):
        import datetime
        from apps.clients.models import Client, Cheque
        from apps.core.services.legacy_dbf import LegacyDBFImporter

        synthetic_data = {
            "CLIENT.DBF": [
                {
                    "CLIENT": "C_CHQ",
                    "DESIGNAT": "Client Cheque Un",
                    "TEL1": "0550778899",
                    "MT_RESTE": Decimal("0.00"),
                },
            ],
            "CHEQUEXP.DBF": [
                {
                    "NUM": "10",
                    "CLIENT": "C_CHQ",
                    "DESIGNAT": "Client Cheque Un",
                    "CHEQUE": "CHQ-9988",
                    "COMPTE": "CPA",
                    "MONTANT": Decimal("45000.00"),
                    "REGLE": "N",
                    "DATE_FACT": datetime.date(2026, 2, 10),
                    "DATE_BNA": datetime.date(2026, 3, 15),
                },
                {
                    "NUM": "11",
                    "CLIENT": "C_CHQ",
                    "DESIGNAT": "Client Cheque Un",
                    "CHEQUE": "CHQ-SETTLED",
                    "COMPTE": "BNA",
                    "MONTANT": Decimal("20000.00"),
                    "REGLE": "O",
                },
            ],
            "CREANCE.DBF": [
                {
                    "NUM": "20",
                    "CLIENT": "C_CHQ",
                    "DESIGNAT": "Client Cheque Un",
                    "CHEQUE": "CHQ-7766",
                    "COMPTE": "BEA",
                    "MONTANT": Decimal("15000.00"),
                    "REGLE": "",
                    "DATE_FACT": datetime.date(2026, 2, 20),
                },
                {
                    "NUM": "21",
                    "CLIENT": "C_CHQ",
                    "DESIGNAT": "Client Cheque Un",
                    "CHEQUE": "CHQ-CRE-DONE",
                    "MONTANT": Decimal("10000.00"),
                    "REGLE": "O",
                },
            ],
        }

        monkeypatch.setattr(
            LegacyDBFImporter,
            "get_dbf",
            lambda self, filename, optional=False: synthetic_data.get(filename.upper(), []),
        )

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
                "cheques": True,
                "part_payments": False,
            },
        )
        stats = importer.execute_import()

        assert stats["cheques_imported"] == 2
        assert stats["counts"]["cheques"] == 2
        assert stats["totals"]["unsettled_cheques"] == Decimal("60000.00")

        cheques = Cheque.objects.filter(tenant=tenant).order_by("number")
        assert cheques.count() == 2

        c_7766 = cheques.get(number="CHQ-7766")
        assert c_7766.direction == "receivable"
        assert c_7766.status == "pending"
        assert c_7766.amount == Decimal("15000.00")
        assert c_7766.client is not None
        assert c_7766.client.name == "Client Cheque Un"

        c_9988 = cheques.get(number="CHQ-9988")
        assert c_9988.direction == "receivable"
        assert c_9988.status == "pending"
        assert c_9988.amount == Decimal("45000.00")
        assert c_9988.bank == "CPA"
        assert c_9988.due_date == datetime.date(2026, 3, 15)

        # Re-importing does not duplicate cheques
        importer2 = LegacyDBFImporter(
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
                "cheques": True,
                "part_payments": False,
            },
        )
        importer2.execute_import()
        assert Cheque.objects.filter(tenant=tenant).count() == 2

    def test_import_open_part_payments_from_verseclt(self, tenant, branch, monkeypatch):
        import datetime
        from apps.clients.models import Client, ClientLedger
        from apps.core.services.legacy_dbf import LegacyDBFImporter

        synthetic_data = {
            "CLIENT.DBF": [
                {
                    "CLIENT": "C_VRS",
                    "DESIGNAT": "Client Versement",
                    "TEL1": "0550998877",
                    "MT_RESTE": Decimal("0.00"),
                },
            ],
            "VERSECLT.DBF": [
                {
                    "NUM": "101",
                    "NOM": "Client Versement",
                    "TEL": "0550998877",
                    "LIBELLE": "Bottes Cuir",
                    "POINTURE": "39",
                    "PRIX_VENTE": Decimal("6500.00"),
                    "VERSE1": Decimal("2000.00"),
                    "VERSE2": Decimal("1500.00"),
                    "ECARTV": Decimal("3000.00"),
                    "LIVREE": "N",
                    "DATE_FACT": datetime.date(2026, 1, 15),
                },
                {
                    "NUM": "102",
                    "NOM": "Client Versement",
                    "LIBELLE": "Article Deja Livre",
                    "PRIX_VENTE": Decimal("5000.00"),
                    "VERSE1": Decimal("5000.00"),
                    "VERSE2": Decimal("0.00"),
                    "ECARTV": Decimal("0.00"),
                    "LIVREE": "O",
                },
            ],
        }

        monkeypatch.setattr(
            LegacyDBFImporter,
            "get_dbf",
            lambda self, filename, optional=False: synthetic_data.get(filename.upper(), []),
        )

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
                "cheques": False,
                "part_payments": True,
            },
        )
        stats = importer.execute_import()

        assert stats["part_payments_imported"] == 1
        assert stats["counts"]["part_payments"] == 1
        assert stats["totals"]["part_payments"] == Decimal("3000.00")
        assert stats["totals"]["client_debts"] == Decimal("3000.00")

        client = Client.objects.get(tenant=tenant, name="Client Versement")
        assert client.cached_balance == Decimal("3000.00")

        entries = ClientLedger.objects.filter(client=client, reference_type="LegacyPartPayment")
        assert entries.count() == 1
        entry = entries.first()
        assert entry.entry_type == "debit"
        assert entry.amount == Decimal("3000.00")
        assert "Bottes Cuir" in entry.description

        # Re-importing does not duplicate part-payment ledger entries
        importer2 = LegacyDBFImporter(
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
                "cheques": False,
                "part_payments": True,
            },
        )
        importer2.execute_import()
        client.refresh_from_db()
        assert client.cached_balance == Decimal("3000.00")
        assert ClientLedger.objects.filter(client=client, reference_type="LegacyPartPayment").count() == 1


@pytest.mark.django_db
def test_legacy_supplier_import_filters_client_rows_by_purchase_references(tenant, branch, monkeypatch):
    from apps.core.services.legacy_dbf import LegacyDBFImporter

    legacy_records = {
        "FOURNISS.DBF": [],
        "CLIENT.DBF": [
            {"CLIENT": "CUST-1", "DESIGNAT": "Boutique des Lilas"},
            {"CLIENT": "SUPP-1", "DESIGNAT": "Importateur référencé"},
            {"CLIENT": "CUST-2", "DESIGNAT": "Société El Wiam"},
        ],
        "ACHATART.DBF": [{"FACTURE": "ACH-001", "CLIENT": "SUPP-1"}],
        "ACHATMVT.DBF": [],
        "FOURND.DBF": [],
    }

    importer = LegacyDBFImporter(
        path="/tmp/fake_legacy",
        tenant=tenant,
        branch=branch,
    )
    monkeypatch.setattr(
        importer,
        "get_dbf",
        lambda filename, optional=False: legacy_records.get(filename.upper(), []),
    )

    importer._import_suppliers()

    assert importer.stats["suppliers_imported"] == 1
    assert list(Supplier.objects.filter(tenant=tenant).values_list("name", flat=True)) == [
        "Importateur référencé"
    ]


@pytest.mark.django_db
def test_legacy_wholesale_invoice_recalculates_totals_and_client_ledger(tenant, branch, monkeypatch):
    import datetime

    from apps.clients.models import Client, ClientLedger
    from apps.core.services.legacy_dbf import LegacyDBFImporter
    from apps.invoicing.models import Invoice
    from apps.inventory.models import Product, Variant

    client = Client.objects.create(tenant=tenant, name="Client importé")
    product = Product.objects.create(tenant=tenant, name="Mocassin importé")
    variant = Variant.objects.create(
        tenant=tenant,
        product=product,
        size_eu=42,
        colour="Noir",
    )
    importer = LegacyDBFImporter(
        path="/tmp/fake_legacy",
        tenant=tenant,
        branch=branch,
        options={"software_type": "wholesale"},
    )
    importer.product_map["ART-1"] = variant
    importer.client_map["CLIENT-1"] = client
    legacy_records = {
        "VENTEMVT.DBF": [
            {
                "FACTURE": "LEG-001",
                "DATE_FACT": datetime.date(2026, 1, 15),
                "CLIENT": "CLIENT-1",
                "QUANTITE": Decimal("2"),
                "PRIX_VENTE": Decimal("100.00"),
                "ARTICLE": "ART-1",
            }
        ],
        "VENTMVTX.DBF": [],
    }
    monkeypatch.setattr(
        importer,
        "get_dbf",
        lambda filename, optional=False: legacy_records.get(filename.upper(), []),
    )

    importer._import_invoices()

    invoice = Invoice.objects.get(tenant=tenant, number="LEG-001")
    assert invoice.total_ht == Decimal("200.00")
    assert invoice.tva_amount == Decimal("38.00")
    assert invoice.total_ttc == Decimal("238.00")
    assert list(
        ClientLedger.objects.filter(client=client, reference_type="Invoice").values_list("amount", flat=True)
    ) == [Decimal("238.00")]
    client.refresh_from_db()
    assert client.cached_balance == Decimal("238.00")

