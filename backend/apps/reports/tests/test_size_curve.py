"""Size curve: sales share, core sizes, and broken runs."""
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.reports.services.size_curve import select_core_sizes


def _make_client(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _at(day: date):
    return timezone.make_aware(datetime(day.year, day.month, day.day, 12, 0))


@pytest.mark.django_db
class TestSizeCurve:
    TODAY = date(2026, 11, 13)

    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.core.models import PlanChoices, RoleChoices, Tenant, User

        self.tenant = Tenant.objects.create(name="Curve Shop", plan=PlanChoices.PRO_RETAIL)
        self.other = Tenant.objects.create(name="Other Shop", plan=PlanChoices.PRO_RETAIL)
        self.manager = User.objects.create_user(
            email="mgr@curve.com", password="testpass123",
            tenant=self.tenant, role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cash@curve.com", password="testpass123",
            tenant=self.tenant, role=RoleChoices.CASHIER,
        )
        self.api = _make_client(self.manager)

    def _product(self, name, gender="M", category="sneakers", pamp="1000.00", tenant=None):
        from apps.inventory.models import Product
        return Product.objects.create(
            tenant=tenant or self.tenant,
            name=name,
            brand="Atlas",
            category=category,
            gender=gender,
            sale_price=Decimal("5000.00"),
            purchase_price=Decimal(pamp),
            pamp=Decimal(pamp),
        )

    def _variant(self, product, size, stock):
        from apps.inventory.models import Variant
        return Variant.objects.create(
            tenant=product.tenant, product=product, size_eu=size, colour="Noir", stock_qty=stock,
        )

    def _sell(self, variant, qty, day, status="completed"):
        from apps.sales.models import Sale, SaleItem
        sale = Sale.objects.create(
            tenant=variant.tenant,
            cashier=self.manager,
            status=status,
            total_amount=Decimal("1000.00") * qty,
            receipt_number=f"RC-{variant.pk}-{day.isoformat()}-{qty}-{status}",
        )
        Sale.objects.filter(pk=sale.pk).update(created_at=_at(day))
        SaleItem.objects.create(
            sale=sale, variant=variant, quantity=qty, unit_price=Decimal("1000.00"),
        )
        return sale

    def _return(self, sale, variant, qty, day):
        from apps.sales.models import Return, ReturnItem
        ret = Return.objects.create(
            tenant=sale.tenant, original_sale=sale, reason="taille", refund_amount=Decimal("1000.00"),
        )
        Return.objects.filter(pk=ret.pk).update(created_at=_at(day))
        ReturnItem.objects.create(return_obj=ret, variant=variant, quantity=qty)
        return ret

    def test_select_core_sizes_stops_at_seventy_percent(self):
        assert select_core_sizes({40: 5, 41: 50, 42: 40, 43: 5}) == [41, 42]
        assert select_core_sizes({40: 70, 41: 30}) == [40]
        assert select_core_sizes({}) == []

    def test_sales_share_is_net_of_returns(self):
        product = self._product("City")
        size_40 = self._variant(product, 40, 1)
        size_41 = self._variant(product, 41, 1)
        size_42 = self._variant(product, 42, 1)
        recent = self.TODAY - timedelta(days=10)
        self._sell(size_40, 10, recent)
        self._sell(size_41, 20, recent)
        sale_42 = self._sell(size_42, 70, recent)
        self._return(sale_42, size_42, 10, recent)
        cancelled = self._variant(product, 43, 0)
        self._sell(cancelled, 100, recent, status="cancelled")

        from apps.reports.services.size_curve import build_size_curve
        report = build_size_curve(self.tenant, today=self.TODAY, product_id=product.id, weeks=8)
        by_size = {row["size_eu"]: row for row in report["sizes"]}
        assert by_size[40]["units_sold"] == 10
        assert by_size[40]["sales_share"] == "11.11"
        assert by_size[41]["units_sold"] == 20
        assert by_size[41]["sales_share"] == "22.22"
        assert by_size[42]["units_sold"] == 60
        assert by_size[42]["sales_share"] == "66.67"
        assert by_size[43]["units_sold"] == 0

    def test_broken_run_uses_52_week_core_sizes(self):
        product = self._product("Runner", pamp="1000.00")
        old = self.TODAY - timedelta(days=100)
        sold = {40: 5, 41: 50, 42: 40, 43: 5}
        stock = {40: 3, 41: 0, 42: 2, 43: 1}
        for size, qty in sold.items():
            variant = self._variant(product, size, stock[size])
            self._sell(variant, qty, old)

        from apps.reports.services.size_curve import build_size_curve
        report = build_size_curve(self.tenant, today=self.TODAY, product_id=product.id, weeks=8)
        assert report["broken"] == [{
            "product_id": str(product.id),
            "name": "Runner",
            "brand": "Atlas",
            "core_sizes": [41, 42],
            "missing_sizes": [41],
            "basis": "product",
            "stock_pairs": 6,
            "stock_value": "6000.00",
        }]
        chart = {row["size_eu"]: row["units_sold"] for row in report["sizes"]}
        assert chart[41] == 0

    def test_category_then_gender_then_default_fallback(self):
        sandals_seller = self._product("Sandal Hit", category="sandals")
        old = self.TODAY - timedelta(days=30)
        self._sell(self._variant(sandals_seller, 39, 2), 90, old)
        self._sell(self._variant(sandals_seller, 38, 2), 10, old)

        boots = self._product("Boot Empty", category="boots")
        self._variant(boots, 42, 4)

        lonely = self._product("No History", category="formal", gender="F", pamp="2000.00")
        self._variant(lonely, 36, 5)

        from apps.reports.services.size_curve import build_size_curve
        report = build_size_curve(self.tenant, today=self.TODAY, weeks=8)
        by_name = {row["name"]: row for row in report["broken"]}
        assert by_name["Boot Empty"]["basis"] == "gender"
        assert by_name["Boot Empty"]["core_sizes"] == [39]
        assert by_name["Boot Empty"]["missing_sizes"] == [39]
        assert by_name["No History"]["basis"] == "default"
        assert by_name["No History"]["missing_sizes"] == [37, 38, 39, 40]
        assert by_name["No History"]["stock_value"] == "10000.00"
        assert "Sandal Hit" not in by_name

        sandals_only = self._product("Sandal Gap", category="sandals")
        self._variant(sandals_only, 38, 3)
        report = build_size_curve(self.tenant, today=self.TODAY, category="sandals", weeks=8)
        names = {row["name"]: row for row in report["broken"]}
        assert names["Sandal Gap"]["basis"] == "category"
        assert names["Sandal Gap"]["core_sizes"] == [39]
        assert names["Sandal Gap"]["missing_sizes"] == [39]

    def test_quantity_on_order_ignores_draft_and_computes_cover(self):
        from apps.suppliers.models import POLine, PurchaseOrder, Supplier

        product = self._product("Cover")
        variant = self._variant(product, 42, 4)
        recent = self.TODAY - timedelta(days=7)
        self._sell(variant, 8, recent)
        supplier = Supplier.objects.create(tenant=self.tenant, name="Usine")
        sent = PurchaseOrder.objects.create(
            tenant=self.tenant, supplier=supplier, status="sent", created_by=self.manager,
        )
        POLine.objects.create(
            order=sent, variant=variant, description="42",
            quantity_ordered=6, quantity_received=2, agreed_unit_price=Decimal("1000.00"),
        )
        draft = PurchaseOrder.objects.create(
            tenant=self.tenant, supplier=supplier, status="draft", created_by=self.manager,
        )
        POLine.objects.create(
            order=draft, variant=variant, description="42",
            quantity_ordered=9, quantity_received=0, agreed_unit_price=Decimal("1000.00"),
        )

        from apps.reports.services.size_curve import build_size_curve
        report = build_size_curve(self.tenant, today=self.TODAY, product_id=product.id, weeks=8)
        row = next(item for item in report["sizes"] if item["size_eu"] == 42)
        assert row["on_order"] == 4
        assert row["weeks_of_cover"] == "4.00"
        assert row["sell_through_pct"] == "66.67"
        assert report["broken"] == []

    def test_endpoint_is_manager_only_and_tenant_scoped(self):
        product = self._product("Mine")
        variant = self._variant(product, 42, 2)
        today = timezone.localdate()
        self._sell(variant, 3, today)
        other_product = self._product("Theirs", tenant=self.other)
        other_variant = self._variant(other_product, 42, 9)
        self._sell(other_variant, 30, today)

        denied = _make_client(self.cashier).get("/api/v1/reports/size-curve/")
        assert denied.status_code == 403

        bad = self.api.get("/api/v1/reports/size-curve/", {"weeks": 0})
        assert bad.status_code == 400

        ok = self.api.get("/api/v1/reports/size-curve/", {"weeks": 8, "gender": "M"})
        assert ok.status_code == 200, ok.data
        sold = sum(row["units_sold"] for row in ok.data["sizes"])
        assert sold == 3
