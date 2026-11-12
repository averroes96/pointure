"""Regression tests for requested label copy counts."""
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.core.models import PlanChoices, RoleChoices, Tenant, User
from apps.inventory.models import Product, Variant


@pytest.mark.django_db
class TestBarcodeLabelCopies:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.create(
            name="Label Store", plan=PlanChoices.PRO_WHOLESALE
        )
        self.manager = User.objects.create_user(
            email="manager@labels.test",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.product = Product.objects.create(
            tenant=self.tenant,
            name="Label Shoe",
            reference="LBL-001",
            sale_price=Decimal("5000.00"),
        )
        self.variant_40 = Variant.objects.create(
            tenant=self.tenant,
            product=self.product,
            size_eu=40,
            colour="Noir",
            barcode="LBL-001-40",
        )
        self.variant_41 = Variant.objects.create(
            tenant=self.tenant,
            product=self.product,
            size_eu=41,
            colour="Noir",
            barcode="LBL-001-41",
        )
        self.api = APIClient()
        self.api.force_authenticate(user=self.manager)

    @staticmethod
    def _page_count(response):
        return response.content.count(b'class="page"')

    def test_product_barcode_labels_repeat_each_variant_for_requested_copies(self):
        response = self.api.get(
            f"/api/v1/inventory/products/{self.product.pk}/barcode-labels/",
            {"output": "html", "copies": 3},
        )

        assert response.status_code == 200
        assert response["Content-Type"].startswith("text/html")
        assert self._page_count(response) == 6

    def test_single_variant_barcode_labels_repeat_requested_copies(self):
        response = self.api.get(
            f"/api/v1/inventory/variants/{self.variant_40.pk}/barcode-label/",
            {"output": "html", "copies": 3},
        )

        assert response.status_code == 200
        assert self._page_count(response) == 3

    def test_shelf_labels_repeat_requested_copies(self):
        response = self.api.get(
            f"/api/v1/inventory/products/{self.product.pk}/shelf-labels/",
            {"output": "html", "copies": 3},
        )

        assert response.status_code == 200
        assert self._page_count(response) == 3
