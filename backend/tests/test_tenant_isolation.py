"""
Critical tests for tenant isolation.
These MUST pass before any other feature work begins.

Tests verify that API calls from tenant A never return tenant B's data.
"""
import pytest
from django.test import TestCase
from rest_framework.test import APIClient


@pytest.mark.django_db
class TestTenantIsolation:
    """
    Verify complete data isolation between tenants.
    Every queryset must be scoped — this test suite enforces it.
    """

    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.core.models import Branch, PlanChoices, RoleChoices, Tenant, User
        from apps.inventory.models import Product, Variant, StockMovement

        # Create two separate tenants
        self.tenant_a = Tenant.objects.create(name="Tenant A", plan=PlanChoices.PRO_WHOLESALE)
        self.tenant_b = Tenant.objects.create(name="Tenant B", plan=PlanChoices.PRO_WHOLESALE)

        # Create owners for each tenant
        self.owner_a = User.objects.create_user(
            email="owner_a@test.com",
            password="testpass123",
            tenant=self.tenant_a,
            role=RoleChoices.OWNER,
        )
        self.owner_b = User.objects.create_user(
            email="owner_b@test.com",
            password="testpass123",
            tenant=self.tenant_b,
            role=RoleChoices.OWNER,
        )

        # Create products for each tenant
        self.product_a = Product.objects.create(
            tenant=self.tenant_a,
            name="Sneaker A",
            brand="Brand A",
            sale_price="5000.00",
            purchase_price="3000.00",
        )
        self.product_b = Product.objects.create(
            tenant=self.tenant_b,
            name="Boot B",
            brand="Brand B",
            sale_price="8000.00",
            purchase_price="5000.00",
        )

        self.client_a = APIClient()
        self.client_b = APIClient()

    def _login(self, api_client, user):
        response = api_client.post(
            "/api/v1/auth/login/",
            {"email": user.email, "password": "testpass123"},
            format="json",
        )
        assert response.status_code == 200, f"Login failed: {response.data}"
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def test_products_scoped_to_tenant(self):
        """Tenant A cannot see Tenant B's products."""
        self._login(self.client_a, self.owner_a)

        response = self.client_a.get("/api/v1/inventory/products/")
        assert response.status_code == 200

        product_ids = [p["id"] for p in response.data["results"]]
        assert self.product_a.pk in product_ids, "Tenant A should see their own products"
        assert self.product_b.pk not in product_ids, "Tenant A must NOT see Tenant B's products"

    def test_tenant_b_cannot_access_tenant_a_product_by_id(self):
        """Tenant B cannot access a specific product from Tenant A by ID."""
        self._login(self.client_b, self.owner_b)

        response = self.client_b.get(f"/api/v1/inventory/products/{self.product_a.pk}/")
        assert response.status_code == 404, "Tenant B must NOT be able to access Tenant A's product"

    def test_clients_scoped_to_tenant(self):
        """Clients are scoped per tenant."""
        from apps.clients.models import Client

        client_a = Client.objects.create(
            tenant=self.tenant_a,
            name="Client A",
            phone="0555000001",
        )
        client_b = Client.objects.create(
            tenant=self.tenant_b,
            name="Client B",
            phone="0555000002",
        )

        self._login(self.client_a, self.owner_a)
        response = self.client_a.get("/api/v1/clients/")
        assert response.status_code == 200

        names = [c["name"] for c in response.data["results"]]
        assert "Client A" in names
        assert "Client B" not in names

    def test_invoices_scoped_to_tenant(self):
        """Invoices are scoped per tenant."""
        import datetime
        from apps.invoicing.models import Invoice

        inv_a = Invoice.objects.create(
            tenant=self.tenant_a,
            date=datetime.date.today(),
            due_date=datetime.date.today(),
            status="draft",
        )
        inv_b = Invoice.objects.create(
            tenant=self.tenant_b,
            date=datetime.date.today(),
            due_date=datetime.date.today(),
            status="draft",
        )

        self._login(self.client_a, self.owner_a)
        response = self.client_a.get("/api/v1/invoicing/invoices/")
        assert response.status_code == 200

        invoice_ids = [i["id"] for i in response.data["results"]]
        assert inv_a.pk in invoice_ids
        assert inv_b.pk not in invoice_ids

    def test_stock_movements_scoped_to_tenant(self):
        """Stock movements cannot be read cross-tenant."""
        from apps.inventory.models import StockMovement, Variant

        variant_a = Variant.objects.create(
            tenant=self.tenant_a, product=self.product_a,
            size_eu=42, colour="Noir",
        )
        movement = StockMovement.objects.create(
            tenant=self.tenant_a,
            variant=variant_a,
            quantity_delta=10,
            reason="initial",
            user=self.owner_a,
        )

        self._login(self.client_b, self.owner_b)
        response = self.client_b.get("/api/v1/inventory/movements/")
        assert response.status_code == 200

        movement_ids = [m["id"] for m in response.data["results"]]
        assert movement.pk not in movement_ids, "Tenant B must NOT see Tenant A's stock movements"

    def test_unauthenticated_request_rejected(self):
        """Unauthenticated requests are rejected."""
        response = APIClient().get("/api/v1/inventory/products/")
        assert response.status_code == 401


@pytest.mark.django_db
class TestInvoiceNumbering:
    """Invoice numbering must be race-condition-safe."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.core.models import PlanChoices, Tenant
        self.tenant = Tenant.objects.create(name="Test Tenant", plan=PlanChoices.PRO_WHOLESALE)

    def test_sequential_numbering(self):
        """Invoice numbers increment correctly."""
        from apps.invoicing.models import InvoiceCounter
        from django.utils import timezone

        n1 = InvoiceCounter.next_number(self.tenant, "FA")
        n2 = InvoiceCounter.next_number(self.tenant, "FA")
        n3 = InvoiceCounter.next_number(self.tenant, "FA")

        year = timezone.now().year
        assert n1 == f"FA-{year}-00001"
        assert n2 == f"FA-{year}-00002"
        assert n3 == f"FA-{year}-00003"

    def test_different_prefixes_independent(self):
        """Different series prefixes have independent counters."""
        from apps.invoicing.models import InvoiceCounter
        from django.utils import timezone

        n_fa = InvoiceCounter.next_number(self.tenant, "FA")
        n_bl = InvoiceCounter.next_number(self.tenant, "BL")
        n_fa2 = InvoiceCounter.next_number(self.tenant, "FA")

        year = timezone.now().year
        assert n_fa == f"FA-{year}-00001"
        assert n_bl == f"BL-{year}-00001"
        assert n_fa2 == f"FA-{year}-00002"


@pytest.mark.django_db
class TestStockLedger:
    """Stock qty must always reflect the sum of StockMovement records."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.core.models import PlanChoices, RoleChoices, Tenant, User
        from apps.inventory.models import Product, Variant

        self.tenant = Tenant.objects.create(name="Stock Test", plan=PlanChoices.FREE)
        self.user = User.objects.create_user(
            email="stock@test.com", password="pass", tenant=self.tenant, role=RoleChoices.OWNER
        )
        product = Product.objects.create(
            tenant=self.tenant, name="Test Shoe", sale_price="1000.00", purchase_price="600.00"
        )
        self.variant = Variant.objects.create(
            tenant=self.tenant, product=product, size_eu=42, colour="Noir"
        )

    def test_stock_qty_reflects_movements(self):
        """stock_qty is always the sum of quantity_delta."""
        from apps.inventory.models import StockMovement

        assert self.variant.stock_qty == 0

        # Add initial stock
        StockMovement.objects.create(
            tenant=self.tenant, variant=self.variant,
            quantity_delta=20, reason="initial", user=self.user
        )
        self.variant.refresh_from_db()
        assert self.variant.stock_qty == 20

        # Deduct for sale
        StockMovement.objects.create(
            tenant=self.tenant, variant=self.variant,
            quantity_delta=-3, reason="sale", user=self.user
        )
        self.variant.refresh_from_db()
        assert self.variant.stock_qty == 17

        # Return 1
        StockMovement.objects.create(
            tenant=self.tenant, variant=self.variant,
            quantity_delta=1, reason="return", user=self.user
        )
        self.variant.refresh_from_db()
        assert self.variant.stock_qty == 18

    def test_cannot_directly_update_stock_qty(self):
        """Directly setting stock_qty doesn't persist — always use StockMovement."""
        from apps.inventory.models import StockMovement, Variant

        # Set initial stock via movement
        StockMovement.objects.create(
            tenant=self.tenant, variant=self.variant,
            quantity_delta=10, reason="initial", user=self.user
        )
        # Try to directly update (this is what you should NOT do)
        Variant.objects.filter(pk=self.variant.pk).update(stock_qty=999)

        # A new movement should override the direct update
        StockMovement.objects.create(
            tenant=self.tenant, variant=self.variant,
            quantity_delta=0, reason="adjustment", user=self.user
        )
        self.variant.refresh_from_db()
        # refresh_stock() recomputes from ledger → 10, not 999
        assert self.variant.stock_qty == 10
