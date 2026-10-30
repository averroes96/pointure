from decimal import Decimal
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate
from apps.core.models import RoleChoices, Tenant, User, Branch
from apps.inventory.models import Product, Variant, StockMovement
from apps.inventory.views import ProductViewSet
from apps.reports.views import ReportsViewSet


class SeedDemoCatalogTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name="Demo Onboarding Store")
        self.branch = Branch.objects.create(
            tenant=self.tenant,
            name="Agence Principale",
            is_headquarters=True,
            is_active=True,
        )
        self.manager = User.objects.create_user(
            email="manager@demo.dz",
            password="password123",
            phone="0555123456",
            role=RoleChoices.MANAGER,
            tenant=self.tenant,
        )
        self.cashier = User.objects.create_user(
            email="cashier@demo.dz",
            password="password123",
            phone="0555654321",
            role=RoleChoices.CASHIER,
            tenant=self.tenant,
        )
        self.factory = APIRequestFactory()

    def tearDown(self):
        from apps.core.signals import set_current_user
        set_current_user(None)

    def test_seed_demo_catalog_as_manager_succeeds(self):
        request = self.factory.post("/api/v1/inventory/products/seed-demo-catalog/")
        force_authenticate(request, user=self.manager)
        view = ProductViewSet.as_view({"post": "seed_demo_catalog"})

        response = view(request)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["created_count"], 20)

        # Verify products in DB
        products_count = Product.objects.filter(tenant=self.tenant).count()
        self.assertEqual(products_count, 20)

        # Verify variants and stock
        variants_count = Variant.objects.filter(tenant=self.tenant).count()
        self.assertGreater(variants_count, 100)

        movements_count = StockMovement.objects.filter(tenant=self.tenant).count()
        self.assertEqual(movements_count, variants_count)

    def test_seed_demo_catalog_as_cashier_forbidden(self):
        request = self.factory.post("/api/v1/inventory/products/seed-demo-catalog/")
        force_authenticate(request, user=self.cashier)
        view = ProductViewSet.as_view({"post": "seed_demo_catalog"})

        response = view(request)
        self.assertEqual(response.status_code, 403)

    def test_dashboard_kpis_includes_onboarding_counts(self):
        request = self.factory.get("/api/v1/reports/dashboard/")
        force_authenticate(request, user=self.manager)
        view = ReportsViewSet.as_view({"get": "dashboard"})

        response = view(request)
        self.assertEqual(response.status_code, 200)
        self.assertIn("product_count", response.data)
        self.assertIn("cashier_count", response.data)
        self.assertIn("sale_count", response.data)
        self.assertIn("has_demo_catalog", response.data)
        self.assertEqual(response.data["product_count"], 0)
        self.assertEqual(response.data["cashier_count"], 1)
        self.assertEqual(response.data["sale_count"], 0)
        self.assertFalse(response.data["has_demo_catalog"])

    def test_clear_demo_catalog_purges_only_demo_data(self):
        # 1. Seed demo products
        req_seed = self.factory.post("/api/v1/inventory/products/seed-demo-catalog/")
        force_authenticate(req_seed, user=self.manager)
        view_seed = ProductViewSet.as_view({"post": "seed_demo_catalog"})
        view_seed(req_seed)

        # 2. Add 1 real non-demo product
        real_prod = Product.objects.create(
            tenant=self.tenant,
            name="Vrai Produit Boutique",
            brand="Artisan",
            sale_price=Decimal("5000.00"),
            is_demo=False,
        )
        Variant.objects.create(
            tenant=self.tenant,
            product=real_prod,
            size_eu=42,
            colour="Noir",
            stock_qty=10,
        )

        self.assertEqual(Product.objects.filter(tenant=self.tenant).count(), 21)
        self.assertEqual(Product.objects.filter(tenant=self.tenant, is_demo=True).count(), 20)

        # 3. Check demo status
        req_status = self.factory.get("/api/v1/inventory/products/demo-status/")
        force_authenticate(req_status, user=self.manager)
        view_status = ProductViewSet.as_view({"get": "demo_status"})
        res_status = view_status(req_status)
        self.assertTrue(res_status.data["has_demo_catalog"])
        self.assertEqual(res_status.data["demo_product_count"], 20)

        # 4. Clear demo catalog
        req_clear = self.factory.post("/api/v1/inventory/products/clear-demo-catalog/")
        force_authenticate(req_clear, user=self.manager)
        view_clear = ProductViewSet.as_view({"post": "clear_demo_catalog"})
        res_clear = view_clear(req_clear)
        self.assertEqual(res_clear.status_code, 200)
        self.assertEqual(res_clear.data["deleted_count"], 20)

        # 5. Verify only real product remains
        remaining_products = Product.objects.filter(tenant=self.tenant)
        self.assertEqual(remaining_products.count(), 1)
        self.assertEqual(remaining_products.first().name, "Vrai Produit Boutique")

