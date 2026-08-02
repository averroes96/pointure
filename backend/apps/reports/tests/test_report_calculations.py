"""
Report calculation tests.
Verifies that the daily summary and dashboard KPI endpoints return
correctly aggregated values given known sales data.
"""
import datetime
import pytest
from decimal import Decimal
from rest_framework.test import APIClient


def _make_client(user) -> APIClient:
    """Return an APIClient authenticated as `user` via force_authenticate."""
    c = APIClient()
    c.force_authenticate(user=user)
    return c


from django.utils import timezone


def _today():
    return timezone.localdate()


@pytest.mark.django_db
class TestDailySummary:
    """GET /api/v1/sales/daily-summary/ (SaleViewSet action)."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.core.models import PlanChoices, RoleChoices, Tenant, User
        from apps.inventory.models import Product, StockMovement, Variant
        from apps.sales.models import Payment, Sale, SaleItem

        self.tenant = Tenant.objects.create(name="Daily Report Shop", plan=PlanChoices.PRO_RETAIL)
        self.manager = User.objects.create_user(
            email="mgr@daily.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )

        # Seed 3 completed sales for today with different payment methods
        for i, (amount, method) in enumerate([
            (Decimal("5000.00"), "cash"),
            (Decimal("8000.00"), "ccp"),
            (Decimal("3000.00"), "cash"),
        ]):
            sale = Sale.objects.create(
                tenant=self.tenant,
                cashier=self.manager,
                status="completed",
                total_amount=amount,
                receipt_number=f"RC-TEST-{i+1:04d}",
            )
            Payment.objects.create(sale=sale, amount=amount, method=method)

        # One cancelled sale — should NOT appear in totals
        Sale.objects.create(
            tenant=self.tenant,
            cashier=self.manager,
            status="cancelled",
            total_amount=Decimal("9999.00"),
            receipt_number="RC-TEST-CANCEL",
        )

        self.client = _make_client(self.manager)

    def test_daily_summary_total_revenue(self):
        """Total revenue sums only completed sales for the given date."""
        resp = self.client.get(
            "/api/v1/sales/daily-summary/",
            {"date": str(_today())},
        )
        assert resp.status_code == 200, resp.data
        data = resp.data

        # 5000 + 8000 + 3000 = 16000
        assert Decimal(str(data["total_revenue"])) == Decimal("16000.00")
        assert data["sale_count"] == 3

    def test_daily_summary_payment_breakdown(self):
        """Payment method breakdown is correct."""
        resp = self.client.get(
            "/api/v1/sales/daily-summary/",
            {"date": str(_today())},
        )
        assert resp.status_code == 200, resp.data
        breakdown = resp.data["by_payment_method"]

        # cash: 5000 + 3000 = 8000
        assert Decimal(str(breakdown.get("cash", 0))) == Decimal("8000.00")
        # ccp: 8000
        assert Decimal(str(breakdown.get("ccp", 0))) == Decimal("8000.00")

    def test_daily_summary_cancelled_excluded(self):
        """Cancelled sales do not appear in the totals."""
        resp = self.client.get(
            "/api/v1/sales/daily-summary/",
            {"date": str(_today())},
        )
        # If cancelled was included, total would be 16000 + 9999 = 25999
        assert Decimal(str(resp.data["total_revenue"])) == Decimal("16000.00")

    def test_daily_summary_no_date_defaults_to_today(self):
        """Omitting the date param defaults to today."""
        resp = self.client.get("/api/v1/sales/daily-summary/")
        assert resp.status_code == 200
        assert resp.data["date"] == str(_today())

    def test_daily_summary_invalid_date_rejected(self):
        """A non-ISO date string returns 400."""
        resp = self.client.get("/api/v1/sales/daily-summary/", {"date": "not-a-date"})
        assert resp.status_code == 400


@pytest.mark.django_db
class TestDailyReportEndpoint:
    """GET /api/v1/reports/daily/ (ReportsViewSet.daily action)."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.core.models import PlanChoices, RoleChoices, Tenant, User
        from apps.inventory.models import Product, StockMovement, Variant
        from apps.sales.models import Payment, Sale, SaleItem

        self.tenant = Tenant.objects.create(name="Reports Daily Shop", plan=PlanChoices.PRO_RETAIL)
        self.manager = User.objects.create_user(
            email="mgr@reports.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )

        # Create a product + variant for SaleItem
        product = Product.objects.create(
            tenant=self.tenant, name="Sneaker X", brand="Brand",
            sale_price="6000.00", purchase_price="4000.00",
        )
        self.variant = Variant.objects.create(
            tenant=self.tenant, product=product, size_eu=42, colour="Bleu",
        )

        # Two completed sales
        for amount, method, qty in [
            (Decimal("6000.00"), "cash", 1),
            (Decimal("12000.00"), "virement", 2),
        ]:
            sale = Sale.objects.create(
                tenant=self.tenant, cashier=self.manager,
                status="completed", total_amount=amount,
                receipt_number=f"RC-R-{method[:4].upper()}",
            )
            Payment.objects.create(sale=sale, amount=amount, method=method)
            SaleItem.objects.create(
                sale=sale, variant=self.variant,
                quantity=qty, unit_price=Decimal("6000.00"),
            )

        self.client = _make_client(self.manager)

    def test_daily_report_total_revenue(self):
        """total_revenue is sum of completed sale amounts."""
        resp = self.client.get("/api/v1/reports/daily/", {"date": str(_today())})
        assert resp.status_code == 200, resp.data
        assert Decimal(str(resp.data["total_revenue"])) == Decimal("18000.00")

    def test_daily_report_sale_count(self):
        """sale_count matches number of completed sales."""
        resp = self.client.get("/api/v1/reports/daily/", {"date": str(_today())})
        assert resp.data["sale_count"] == 2

    def test_daily_report_cash_breakdown(self):
        """cash_total picks up only cash payments."""
        resp = self.client.get("/api/v1/reports/daily/", {"date": str(_today())})
        assert Decimal(str(resp.data["cash_total"])) == Decimal("6000.00")
        assert Decimal(str(resp.data["virement_total"])) == Decimal("12000.00")

    def test_daily_report_items_sold(self):
        """items_sold is total quantity across all line items."""
        resp = self.client.get("/api/v1/reports/daily/", {"date": str(_today())})
        # 1 + 2 = 3
        assert resp.data["items_sold"] == 3

    def test_daily_report_has_payment_breakdown_list(self):
        """Response includes a payment_breakdown list for all 4 methods."""
        resp = self.client.get("/api/v1/reports/daily/", {"date": str(_today())})
        methods = {entry["method"] for entry in resp.data["payment_breakdown"]}
        assert {"cash", "ccp", "virement", "cheque"}.issubset(methods)


@pytest.mark.django_db
class TestDashboardKPIs:
    """GET /api/v1/reports/dashboard/ — aggregate KPIs."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.core.models import PlanChoices, RoleChoices, Tenant, User
        from apps.clients.models import Cheque, Client
        from apps.inventory.models import Product, StockMovement, Variant
        from apps.sales.models import Payment, Sale

        self.tenant = Tenant.objects.create(name="Dashboard Shop", plan=PlanChoices.PRO_RETAIL)
        self.manager = User.objects.create_user(
            email="mgr@dashboard.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )

        # Today's revenue: 2 sales
        for amount in [Decimal("4000.00"), Decimal("6000.00")]:
            sale = Sale.objects.create(
                tenant=self.tenant, cashier=self.manager,
                status="completed", total_amount=amount,
                receipt_number=f"RC-D-{str(amount)[:4]}",
            )
            Payment.objects.create(sale=sale, amount=amount, method="cash")

        # Client with positive cached_balance (outstanding debt)
        client = Client.objects.create(
            tenant=self.tenant, name="Debtor", phone="0555000001",
            cached_balance=Decimal("15000.00"),
        )

        # Low-stock variant
        product = Product.objects.create(
            tenant=self.tenant, name="Limited Shoe", brand="LimitedBrand",
            sale_price="5000.00", purchase_price="3000.00",
        )
        low_variant = Variant.objects.create(
            tenant=self.tenant, product=product, size_eu=42, colour="Rouge",
            alert_threshold=5,
        )
        StockMovement.objects.create(
            tenant=self.tenant, variant=low_variant, quantity_delta=2,
            reason="initial", user=self.manager,
        )
        low_variant.refresh_from_db()
        assert low_variant.stock_qty == 2  # below threshold of 5

        # Cheque due within this week
        Cheque.objects.create(
            tenant=self.tenant,
            direction="receivable",
            number="CHQ-001",
            bank="BNA",
            amount=Decimal("5000.00"),
            due_date=_today() + datetime.timedelta(days=3),
            status="pending",
        )

        self.client = _make_client(self.manager)

    def test_today_revenue(self):
        """today_revenue sums completed sales from today."""
        resp = self.client.get("/api/v1/reports/dashboard/")
        assert resp.status_code == 200, resp.data
        assert Decimal(str(resp.data["today_revenue"])) == Decimal("10000.00")

    def test_total_outstanding_debt(self):
        """total_outstanding_debt aggregates positive cached_balance across clients."""
        resp = self.client.get("/api/v1/reports/dashboard/")
        assert Decimal(str(resp.data["total_outstanding_debt"])) == Decimal("15000.00")

    def test_low_stock_sku_count(self):
        """low_stock_sku_count counts variants at or below alert_threshold."""
        resp = self.client.get("/api/v1/reports/dashboard/")
        assert resp.data["low_stock_sku_count"] == 1

    def test_cheques_due_this_week(self):
        """cheques_due_this_week counts pending cheques within 7 days."""
        resp = self.client.get("/api/v1/reports/dashboard/")
        assert resp.data["cheques_due_this_week"] == 1
