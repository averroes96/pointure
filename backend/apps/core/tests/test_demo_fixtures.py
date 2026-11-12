"""
Unit and integration tests for demo data seeding and fixture generation.
Verifies that:
- Pure-Python dBase III generator writes valid binary DBFs readable by dbfread and LegacyDBFImporter.
- Purchase order Excel/CSV files are properly structured and parsed by the Smart PO Import Engine.
- Product catalog files can be parsed by parse_upload.
- python manage.py seed_demo executes cleanly and populates all v1.7 models (wholesale tiers, cartons, quotes, POs, locations).
"""
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
import pytest
from dbfread import DBF
import openpyxl

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command

from apps.clients.models import Client, ClientTypeChoices, PriceTierChoices
from apps.core.imports import parse_upload
from apps.core.models import Branch, BusinessModeChoices, StoreSettings, TaxRegimeChoices, Tenant
from apps.core.services.demo_fixtures_generator import generate_demo_fixtures, write_dbf
from apps.core.services.legacy_dbf import LegacyDBFImporter
from apps.inventory.models import Product, ProductLocation
from apps.invoicing.models import DeliveryNote, Quote
from apps.suppliers.models import PurchaseOrder, Supplier
from apps.suppliers.services.order_importer import parse_supplier_order_file


@pytest.mark.django_db
class TestDemoFixturesGenerator:
    def test_write_and_read_binary_dbf(self, tmp_path):
        dbf_path = str(tmp_path / "TEST_TABLE.DBF")
        fields = [
            {"name": "CODE", "type": "C", "length": 8},
            {"name": "LIBELLE", "type": "C", "length": 25},
            {"name": "PRIX", "type": "N", "length": 10, "decimal": 2},
        ]
        records = [
            {"CODE": "ART01", "LIBELLE": "Basket Air Pro", "PRIX": Decimal("4500.00")},
            {"CODE": "ART02", "LIBELLE": "Bottine Cuir", "PRIX": Decimal("6200.50")},
        ]
        write_dbf(dbf_path, fields, records)

        table = DBF(dbf_path, encoding="cp850")
        rows = list(table)
        assert len(rows) == 2
        assert rows[0]["CODE"].strip() == "ART01"
        assert rows[0]["LIBELLE"].strip() == "Basket Air Pro"
        assert rows[0]["PRIX"] == 4500.0

    def test_generate_all_demo_fixtures(self, tmp_path):
        out_dir = generate_demo_fixtures(output_root=tmp_path)
        assert out_dir.exists()

        # 1. Legacy DBF files
        legacy_dir = out_dir / "legacy_dbf"
        for dbf_name in ["CLIENT.DBF", "FOURNISS.DBF", "ARTICLE.DBF", "FAMILLE.DBF", "CHEQUEXP.DBF", "CREANCE.DBF", "GCPARAM.DBF"]:
            p = legacy_dir / dbf_name
            assert p.exists(), f"Missing {dbf_name}"
            records = list(DBF(str(p), encoding="cp850"))
            assert len(records) > 0

        # 2. Purchase orders
        po_dir = out_dir / "purchase_orders"
        po_files = [
            "bon_commande_fournisseur_french.xlsx",
            "bon_commande_fournisseur_arabic.xlsx",
            "supplier_order_matrix_english.xlsx",
            "bon_commande_simple.csv",
        ]
        for fname in po_files:
            p = po_dir / fname
            assert p.exists(), f"Missing {fname}"
            raw_rows, _, _, err = parse_supplier_order_file(p.read_bytes(), fname)
            assert err is None
            assert len(raw_rows) > 0

        # 3. Products catalog
        prod_dir = out_dir / "products"
        for fname in ["catalogue_produits_import.xlsx", "catalogue_produits_import.csv"]:
            p = prod_dir / fname
            assert p.exists(), f"Missing {fname}"
            upload = SimpleUploadedFile(fname, p.read_bytes())
            rows, err = parse_upload(upload)
            assert err is None
            assert len(rows) == 12

        # 4. README
        assert (out_dir / "README.md").exists()

    def test_legacy_dbf_importer_compatibility(self, tmp_path):
        out_dir = generate_demo_fixtures(output_root=tmp_path)
        legacy_dir = out_dir / "legacy_dbf"

        tenant = Tenant.objects.create(name="Legacy Import Test Shop")
        branch = Branch.objects.create(tenant=tenant, name="Test Branch", is_headquarters=True)

        importer = LegacyDBFImporter(path=str(legacy_dir), tenant=tenant, branch=branch, dry_run=True)
        stats = importer.execute_import()

        assert stats["clients_imported"] == 8
        assert stats["products_imported"] == 8
        assert stats["stock_units_imported"] > 0
        assert stats["cheques_imported"] > 0
        assert stats["client_debts_total"] > Decimal("0.00")
        assert stats["supplier_debts_total"] > Decimal("0.00")


@pytest.mark.django_db
class TestSeedDemoCommand:
    def test_seed_demo_execution(self, tmp_path):
        call_command("seed_demo", "--reset", "--write-fixtures", "--fixtures-dir", str(tmp_path))
        assert (tmp_path / "README.md").exists()

        # 1. Tenant & Settings
        tenant = Tenant.objects.get(name="ShoeDZ Demo Store")
        assert tenant.nif == "123456789012345"
        assert tenant.nis == "123456789012345"
        assert tenant.rc == "16/00-1234567 B 20"
        assert tenant.ai == "16234567890"

        settings_obj = StoreSettings.objects.get(tenant=tenant)
        assert settings_obj.business_mode == BusinessModeChoices.MIXED
        assert settings_obj.tax_regime == TaxRegimeChoices.REEL
        assert settings_obj.enable_variants is True

        # 2. Products with 3 tiers and shelving
        products = Product.objects.filter(tenant=tenant)
        assert products.count() == 20
        p = products.first()
        assert p.wholesale_price > Decimal("0.00")
        assert p.semi_wholesale_price > Decimal("0.00")
        assert p.sale_price > p.wholesale_price
        assert p.pairs_per_carton > 0
        assert p.size_range != ""
        assert len(p.carton_breakdown) > 0
        # Sum of breakdown matches pairs_per_carton
        assert sum(int(q) for q in p.carton_breakdown.values()) == p.pairs_per_carton

        locations = ProductLocation.objects.filter(tenant=tenant)
        assert locations.count() == 20
        loc = locations.first()
        assert "(" in loc.location and ")" in loc.location

        # 3. Clients & Risk profiling
        clients = Client.objects.filter(tenant=tenant)
        assert clients.count() == 6
        wholesale_clients = clients.filter(price_tier=PriceTierChoices.GROS)
        assert wholesale_clients.exists()

        blocked = clients.get(name__icontains="Distri-Risk")
        assert blocked.is_blocked is True
        assert blocked.cached_balance > blocked.credit_limit

        # 4. Suppliers & Purchase Orders
        suppliers = Supplier.objects.filter(tenant=tenant)
        assert suppliers.count() == 3

        pos = PurchaseOrder.objects.filter(tenant=tenant)
        assert pos.count() == 3
        # Check lines have cartons
        po_lines = pos.first().lines.all()
        assert po_lines.exists()
        assert po_lines.first().cartons > 0

        # 5. Quotes & Delivery Notes
        quotes = Quote.objects.filter(tenant=tenant)
        assert quotes.count() == 2
        q = quotes.first()
        assert q.total_ht > Decimal("0.00")

        bns = DeliveryNote.objects.filter(tenant=tenant)
        assert bns.count() == 2
        assert bns.first().lines.first().cartons > 0

    def test_seed_demo_does_not_generate_fixtures_by_default(self):
        with patch("apps.core.services.demo_fixtures_generator.generate_demo_fixtures") as generate:
            call_command("seed_demo", "--reset")

        generate.assert_not_called()

