"""
Sales workflow integration tests.
Covers: sale creation, stock deduction, validation, returns.
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient


@pytest.mark.django_db
class TestSaleCreation:
    """Complete sale lifecycle: create → stock deducted → payments recorded."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.core.models import PlanChoices, RoleChoices, Tenant, User
        from apps.inventory.models import Product, StockMovement, Variant

        self.tenant = Tenant.objects.create(name="Test Shop", plan=PlanChoices.PRO_RETAIL)
        self.cashier = User.objects.create_user(
            email="cashier@test.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )
        self.manager = User.objects.create_user(
            email="manager@test.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )

        # Create product + variant with stock
        self.product = Product.objects.create(
            tenant=self.tenant,
            name="Running Shoe",
            brand="Nike",
            sale_price="8000.00",
            purchase_price="5000.00",
        )
        self.variant = Variant.objects.create(
            tenant=self.tenant,
            product=self.product,
            size_eu=42,
            colour="Noir",
        )
        # Seed initial stock via movement
        StockMovement.objects.create(
            tenant=self.tenant,
            variant=self.variant,
            quantity_delta=20,
            reason="initial",
            user=self.manager,
        )
        self.variant.refresh_from_db()
        assert self.variant.stock_qty == 20

        self.client = APIClient()

    def _login(self, user):
        self.client.force_authenticate(user=user)

    def test_cashier_can_create_sale(self):
        """A cashier can create a complete sale and stock is deducted."""
        self._login(self.cashier)

        payload = {
            "items": [
                {
                    "variant_id": self.variant.pk,
                    "quantity": 2,
                    "unit_price": "8000.00",
                    "discount_amount": "0.00",
                }
            ],
            "payments": [{"method": "cash", "amount": "16000.00"}],
            "cart_discount": "0.00",
        }

        resp = self.client.post("/api/v1/sales/", payload, format="json")
        assert resp.status_code == 201, resp.data

        data = resp.data
        assert data["total_amount"] == "16000.00"
        assert len(data["items"]) == 1
        assert len(data["payments"]) == 1
        assert data["receipt_number"].startswith("RC-")
        assert data["status"] == "completed"

        # Stock was deducted
        self.variant.refresh_from_db()
        assert self.variant.stock_qty == 18

    def test_stock_movement_created_on_sale(self):
        """Each sale creates a negative StockMovement for each line item."""
        from apps.inventory.models import MovementReasonChoices, StockMovement

        self._login(self.cashier)

        stock_before = self.variant.stock_qty  # 20

        self.client.post(
            "/api/v1/sales/",
            {
                "items": [{"variant_id": self.variant.pk, "quantity": 3, "unit_price": "8000.00", "discount_amount": "0.00"}],
                "payments": [{"method": "cash", "amount": "24000.00"}],
                "cart_discount": "0.00",
            },
            format="json",
        )

        movement = StockMovement.objects.filter(
            variant=self.variant, reason=MovementReasonChoices.SALE
        ).latest("id")
        assert movement.quantity_delta == -3
        assert movement.tenant == self.tenant

    def test_cart_discount_applied_to_total(self):
        """Cart-level discount reduces the sale total."""
        self._login(self.cashier)

        resp = self.client.post(
            "/api/v1/sales/",
            {
                "items": [{"variant_id": self.variant.pk, "quantity": 1, "unit_price": "8000.00", "discount_amount": "0.00"}],
                "payments": [{"method": "cash", "amount": "7500.00"}],
                "cart_discount": "500.00",
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        assert resp.data["total_amount"] == "7500.00"
        assert resp.data["discount_amount"] == "500.00"

    def test_split_payment_recorded(self):
        """A sale can have multiple payment lines (split payment)."""
        self._login(self.cashier)

        resp = self.client.post(
            "/api/v1/sales/",
            {
                "items": [{"variant_id": self.variant.pk, "quantity": 2, "unit_price": "8000.00", "discount_amount": "0.00"}],
                "payments": [
                    {"method": "cash", "amount": "10000.00"},
                    {"method": "ccp", "amount": "6000.00"},
                ],
                "cart_discount": "0.00",
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        assert len(resp.data["payments"]) == 2


@pytest.mark.django_db
class TestSaleValidation:
    """Validation rejects bad inputs before any DB writes."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.core.models import PlanChoices, RoleChoices, Tenant, User
        from apps.inventory.models import Product, StockMovement, Variant

        self.tenant = Tenant.objects.create(name="Validation Shop", plan=PlanChoices.PRO_RETAIL)
        self.cashier = User.objects.create_user(
            email="cashier2@test.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )
        self.manager = User.objects.create_user(
            email="manager2@test.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )

        self.product = Product.objects.create(
            tenant=self.tenant,
            name="Boot",
            brand="Timberland",
            sale_price="12000.00",
            purchase_price="8000.00",
        )
        self.variant = Variant.objects.create(
            tenant=self.tenant,
            product=self.product,
            size_eu=43,
            colour="Marron",
        )
        # Only 5 in stock
        StockMovement.objects.create(
            tenant=self.tenant,
            variant=self.variant,
            quantity_delta=5,
            reason="initial",
            user=self.manager,
        )
        self.variant.refresh_from_db()

        self.client = APIClient()
        self.client.force_authenticate(user=self.cashier)

    def test_insufficient_stock_rejected(self):
        """Requesting more than available stock returns 400."""
        resp = self.client.post(
            "/api/v1/sales/",
            {
                "items": [{"variant_id": self.variant.pk, "quantity": 10, "unit_price": "12000.00", "discount_amount": "0.00"}],
                "payments": [{"method": "cash", "amount": "120000.00"}],
                "cart_discount": "0.00",
            },
            format="json",
        )
        assert resp.status_code == 400
        # Stock should be unchanged
        self.variant.refresh_from_db()
        assert self.variant.stock_qty == 5

    def test_payment_over_110pct_rejected(self):
        """Payment total > 110% of sale total is rejected."""
        resp = self.client.post(
            "/api/v1/sales/",
            {
                "items": [{"variant_id": self.variant.pk, "quantity": 1, "unit_price": "12000.00", "discount_amount": "0.00"}],
                # 15000 is 125% of 12000 — too much
                "payments": [{"method": "cash", "amount": "15000.00"}],
                "cart_discount": "0.00",
            },
            format="json",
        )
        assert resp.status_code == 400

    def test_zero_items_rejected(self):
        """Empty items list is rejected."""
        resp = self.client.post(
            "/api/v1/sales/",
            {"items": [], "payments": [{"method": "cash", "amount": "1000.00"}]},
            format="json",
        )
        assert resp.status_code == 400

    def test_nonexistent_variant_rejected(self):
        """Sale with a variant ID that doesn't exist in the tenant is rejected."""
        resp = self.client.post(
            "/api/v1/sales/",
            {
                "items": [{"variant_id": 99999, "quantity": 1, "unit_price": "1000.00", "discount_amount": "0.00"}],
                "payments": [{"method": "cash", "amount": "1000.00"}],
                "cart_discount": "0.00",
            },
            format="json",
        )
        assert resp.status_code == 400

    def test_underpayment_allowed(self):
        """Underpayment (account balance) is allowed — creates balance_due."""
        resp = self.client.post(
            "/api/v1/sales/",
            {
                "items": [{"variant_id": self.variant.pk, "quantity": 1, "unit_price": "12000.00", "discount_amount": "0.00"}],
                # Pay only 5000 — leaving 7000 on account
                "payments": [{"method": "account", "amount": "5000.00"}],
                "cart_discount": "0.00",
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        assert Decimal(resp.data["balance_due"]) == Decimal("7000.00")


@pytest.mark.django_db
class TestSaleReturns:
    """Return processing: stock restocked, refund recorded."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.core.models import PlanChoices, RoleChoices, Tenant, User
        from apps.inventory.models import Product, StockMovement, Variant

        self.tenant = Tenant.objects.create(name="Return Shop", plan=PlanChoices.PRO_RETAIL)
        self.manager = User.objects.create_user(
            email="manager3@test.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cashier3@test.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )

        self.product = Product.objects.create(
            tenant=self.tenant,
            name="Sandal",
            brand="Adidas",
            sale_price="4000.00",
            purchase_price="2500.00",
        )
        self.variant = Variant.objects.create(
            tenant=self.tenant,
            product=self.product,
            size_eu=40,
            colour="Blanc",
        )
        StockMovement.objects.create(
            tenant=self.tenant,
            variant=self.variant,
            quantity_delta=10,
            reason="initial",
            user=self.manager,
        )
        self.variant.refresh_from_db()

        self.api = APIClient()

    def _login(self, user):
        self.api.force_authenticate(user=user)

    def _make_sale(self, qty=2):
        """Helper to create a completed sale."""
        resp = self.api.post(
            "/api/v1/sales/",
            {
                "items": [{"variant_id": self.variant.pk, "quantity": qty, "unit_price": "4000.00", "discount_amount": "0.00"}],
                "payments": [{"method": "cash", "amount": str(qty * 4000)}],
                "cart_discount": "0.00",
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        return resp.data

    def test_return_with_restock(self):
        """Return with restock=True increments stock back."""
        self._login(self.cashier)
        sale = self._make_sale(qty=3)

        stock_after_sale = self.variant.stock_qty
        self.variant.refresh_from_db()
        assert self.variant.stock_qty == 7  # 10 - 3

        # Process return
        resp = self.api.post(
            f"/api/v1/sales/{sale['id']}/returns/",
            {
                "items": [{"variant_id": self.variant.pk, "quantity": 2, "restock": True}],
                "reason": "Mauvaise taille",
                "refund_amount": "8000.00",
                "refund_method": "cash",
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data

        self.variant.refresh_from_db()
        assert self.variant.stock_qty == 9  # 7 + 2 returned

    def test_return_without_restock(self):
        """Return with restock=False keeps stock unchanged."""
        self._login(self.cashier)
        sale = self._make_sale(qty=2)

        self.variant.refresh_from_db()
        stock_after_sale = self.variant.stock_qty  # 8

        resp = self.api.post(
            f"/api/v1/sales/{sale['id']}/returns/",
            {
                "items": [{"variant_id": self.variant.pk, "quantity": 1, "restock": False}],
                "reason": "Défaut — jeté",
                "refund_amount": "4000.00",
                "refund_method": "cash",
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data

        self.variant.refresh_from_db()
        assert self.variant.stock_qty == stock_after_sale  # unchanged
