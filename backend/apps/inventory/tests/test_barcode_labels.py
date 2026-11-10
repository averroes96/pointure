import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from apps.core.models import Tenant, User, RoleChoices, PlanChoices
from apps.inventory.models import Product, Variant


@pytest.mark.django_db
class TestBarcodeAndShelfLabelsCopies:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.tenant = Tenant.objects.create(name="Label Boutique", plan=PlanChoices.PRO_WHOLESALE)
        self.manager = User.objects.create_user(
            email="manager@labels.dz",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.manager)

        self.product = Product.objects.create(
            tenant=self.tenant,
            name="Basket Cuir Blanche",
            brand="Adidas",
            purchase_price=Decimal("3000.00"),
            sale_price=Decimal("5000.00"),
        )
        self.v40 = Variant.objects.create(
            tenant=self.tenant,
            product=self.product,
            size_eu=40,
            colour="Blanc",
            stock_qty=10,
            barcode="613000000001",
        )
        self.v41 = Variant.objects.create(
            tenant=self.tenant,
            product=self.product,
            size_eu=41,
            colour="Blanc",
            stock_qty=15,
            barcode="613000000002",
        )

    def test_product_barcode_labels_copies_html(self):
        """Requesting copies=3 should duplicate each variant label 3 times."""
        url = f"/api/v1/inventory/products/{self.product.id}/barcode-labels/?output=html&copies=3"
        resp = self.client.get(url)
        assert resp.status_code == 200
        html = resp.content.decode("utf-8")
        # 2 variants * 3 copies = 6 pages
        assert html.count('class="page"') == 6

    def test_single_variant_barcode_label_copies_html(self):
        """Single variant with copies=4 should return 4 pages."""
        url = f"/api/v1/inventory/variants/{self.v40.id}/barcode-label/?output=html&copies=4"
        resp = self.client.get(url)
        assert resp.status_code == 200
        html = resp.content.decode("utf-8")
        assert html.count('class="page"') == 4

    def test_shelf_label_copies_html(self):
        """Shelf label with copies=5 should return 5 pages."""
        url = f"/api/v1/inventory/products/{self.product.id}/shelf-labels/?output=html&copies=5"
        resp = self.client.get(url)
        assert resp.status_code == 200
        html = resp.content.decode("utf-8")
        assert html.count('class="page"') == 5
