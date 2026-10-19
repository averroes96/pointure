from decimal import Decimal
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate
from apps.core.models import RoleChoices, Tenant, User
from apps.inventory.models import Product, Variant
from apps.inventory.views import ProductViewSet


class BulkPriceUpdateTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name="Price Test Store")
        self.manager = User.objects.create_user(
            email="manager@shoedz.dz",
            password="password123",
            role=RoleChoices.MANAGER,
            tenant=self.tenant,
        )
        self.cashier = User.objects.create_user(
            email="cashier@shoedz.dz",
            password="password123",
            role=RoleChoices.CASHIER,
            tenant=self.tenant,
        )

        self.p1 = Product.objects.create(
            tenant=self.tenant,
            name="Basket Stan Smith",
            brand="Adidas",
            reference="AD-SS-01",
            sale_price=Decimal("10000.00"),
            wholesale_price=Decimal("8000.00"),
        )
        Variant.objects.create(tenant=self.tenant, product=self.p1, size_eu=42, colour="Blanc", stock_qty=5)

        self.p2 = Product.objects.create(
            tenant=self.tenant,
            name="Mocassin Cuir Noir",
            brand="Geox",
            reference="GX-MC-02",
            sale_price=Decimal("14350.00"),
            wholesale_price=Decimal("11000.00"),
        )
        Variant.objects.create(tenant=self.tenant, product=self.p2, size_eu=41, colour="Noir", stock_qty=3)

        self.factory = APIRequestFactory()

    def tearDown(self):
        from apps.core.signals import set_current_user
        set_current_user(None)

    def test_percentage_increase_with_rounding_nearest_100(self):
        view = ProductViewSet.as_view({"post": "bulk_price_update"})
        # Increase p1 (10000) by 12% = 11200
        # Increase p2 (14350) by 12% = 16072 -> rounded to nearest 100 = 16100
        request = self.factory.post(
            "/api/v1/inventory/products/bulk-price-update/",
            {
                "product_ids": [str(self.p1.id), str(self.p2.id)],
                "update_type": "percentage",
                "value": "12",
                "target_field": "sale_price",
                "rounding": "nearest_100",
            },
            format="json",
        )
        force_authenticate(request, user=self.manager)
        response = view(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["updated_count"], 2)

        self.p1.refresh_from_db()
        self.p2.refresh_from_db()
        self.assertEqual(self.p1.sale_price, Decimal("11200.00"))
        self.assertEqual(self.p2.sale_price, Decimal("16100.00"))

    def test_fixed_delta_price_update(self):
        view = ProductViewSet.as_view({"post": "bulk_price_update"})
        # Add 500 DZD to p1 (10000 -> 10500)
        request = self.factory.post(
            "/api/v1/inventory/products/bulk-price-update/",
            {
                "product_ids": [str(self.p1.id)],
                "update_type": "fixed_delta",
                "value": "500",
                "target_field": "sale_price",
                "rounding": "none",
            },
            format="json",
        )
        force_authenticate(request, user=self.manager)
        response = view(request)
        self.assertEqual(response.status_code, 200)
        self.p1.refresh_from_db()
        self.assertEqual(self.p1.sale_price, Decimal("10500.00"))

    def test_fixed_set_price_update(self):
        view = ProductViewSet.as_view({"post": "bulk_price_update"})
        # Set exact price 12000 for both
        request = self.factory.post(
            "/api/v1/inventory/products/bulk-price-update/",
            {
                "product_ids": [str(self.p1.id), str(self.p2.id)],
                "update_type": "fixed_set",
                "value": "12000",
                "target_field": "sale_price",
            },
            format="json",
        )
        force_authenticate(request, user=self.manager)
        response = view(request)
        self.assertEqual(response.status_code, 200)
        self.p1.refresh_from_db()
        self.p2.refresh_from_db()
        self.assertEqual(self.p1.sale_price, Decimal("12000.00"))
        self.assertEqual(self.p2.sale_price, Decimal("12000.00"))

    def test_cashier_cannot_bulk_update_prices(self):
        view = ProductViewSet.as_view({"post": "bulk_price_update"})
        request = self.factory.post(
            "/api/v1/inventory/products/bulk-price-update/",
            {
                "product_ids": [str(self.p1.id)],
                "update_type": "percentage",
                "value": "10",
            },
            format="json",
        )
        force_authenticate(request, user=self.cashier)
        response = view(request)
        self.assertEqual(response.status_code, 403)

    def test_wholesale_price_update_and_psychological_rounding(self):
        view = ProductViewSet.as_view({"post": "bulk_price_update"})
        # p1 wholesale is 8000. Increase by 15% = 9200. Rounding 'end_90': 9200 -> 9200 - 10 = 9190.
        request = self.factory.post(
            "/api/v1/inventory/products/bulk-price-update/",
            {
                "product_ids": [str(self.p1.id)],
                "update_type": "percentage",
                "value": "15",
                "target_field": "wholesale_price",
                "rounding": "end_90",
            },
            format="json",
        )
        force_authenticate(request, user=self.manager)
        response = view(request)
        self.assertEqual(response.status_code, 200)
        self.p1.refresh_from_db()
        self.assertEqual(self.p1.wholesale_price, Decimal("9190.00"))
