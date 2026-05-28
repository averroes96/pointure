"""
Tests for the profit/loss endpoint.
Verifies gross margin calculations, RBAC for costs, and period grouping.
"""
import datetime
from decimal import Decimal

import pytest
from rest_framework.test import APIClient


def _make_client(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user=user)
    return c


def _today():
    return datetime.date.today()


@pytest.mark.django_db
class TestProfitLoss:
    """GET /api/v1/reports/profit-loss/"""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.core.models import PlanChoices, RoleChoices, Tenant, User
        from apps.inventory.models import Product, Variant
        from apps.sales.models import Payment, Sale, SaleItem

        self.tenant = Tenant.objects.create(name="PL Report Shop", plan=PlanChoices.PRO_RETAIL)
        self.manager = User.objects.create_user(
            email="mgr@pl.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cashier@pl.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )

        # Product with known purchase_price
        self.product = Product.objects.create(
            tenant=self.tenant,
            name="Test Shoe",
            brand="TestBrand",
            sale_price=Decimal("10000.00"),
            purchase_price=Decimal("6000.00"),
        )
        self.variant = Variant.objects.create(
            tenant=self.tenant,
            product=self.product,
            size_eu=42,
            colour="Noir",
        )

        # Create 2 completed sales with SaleItems
        self.sale1 = Sale.objects.create(
            tenant=self.tenant,
            cashier=self.manager,
            status="completed",
            total_amount=Decimal("10000.00"),
            receipt_number="RC-PL-0001",
        )
        SaleItem.objects.create(
            sale=self.sale1,
            variant=self.variant,
            quantity=1,
            unit_price=Decimal("10000.00"),
        )
        Payment.objects.create(sale=self.sale1, amount=Decimal("10000.00"), method="cash")

        self.sale2 = Sale.objects.create(
            tenant=self.tenant,
            cashier=self.manager,
            status="completed",
            total_amount=Decimal("20000.00"),
            receipt_number="RC-PL-0002",
        )
        SaleItem.objects.create(
            sale=self.sale2,
            variant=self.variant,
            quantity=2,
            unit_price=Decimal("10000.00"),
        )
        Payment.objects.create(sale=self.sale2, amount=Decimal("20000.00"), method="cash")

        self.api_manager = _make_client(self.manager)
        self.api_cashier = _make_client(self.cashier)

    def test_gross_margin_correct(self):
        """
        2 sales: 10000 (1 item) + 20000 (2 items).
        Revenue = 30000; COGS = 3 * 6000 = 18000; margin = 12000.
        """
        resp = self.api_manager.get(
            "/api/v1/reports/profit-loss/",
            {"period": "month"},
        )
        assert resp.status_code == 200, f"Got {resp.status_code}: {resp.data}"
        totals = resp.data["totals"]
        assert Decimal(str(totals["revenue"])) == Decimal("30000.00")
        assert Decimal(str(totals["cogs"])) == Decimal("18000.00")
        assert Decimal(str(totals["gross_margin"])) == Decimal("12000.00")

    def test_cashier_cannot_see_cogs(self):
        """Cashier role: response rows should NOT contain 'cogs' key."""
        resp = self.api_cashier.get(
            "/api/v1/reports/profit-loss/",
            {"period": "month"},
        )
        assert resp.status_code == 200, f"Got {resp.status_code}: {resp.data}"
        totals = resp.data["totals"]
        assert "cogs" not in totals, "Cashier should not see COGS"
        assert "gross_margin" not in totals, "Cashier should not see gross_margin"
        # Revenue should still be present
        assert "revenue" in totals

    def test_period_grouping(self):
        """
        Sales created today are grouped under today's period (day).
        Both sales should appear in one period group.
        """
        resp = self.api_manager.get(
            "/api/v1/reports/profit-loss/",
            {"period": "day"},
        )
        assert resp.status_code == 200, f"Got {resp.status_code}: {resp.data}"
        rows = resp.data["rows"]
        # All sales are from today, so there should be exactly 1 period row
        assert len(rows) == 1, f"Expected 1 period row, got {len(rows)}: {rows}"
        assert rows[0]["sale_count"] == 2
        assert Decimal(str(rows[0]["revenue"])) == Decimal("30000.00")
