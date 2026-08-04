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
        assert "Pointure *" in headers

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
