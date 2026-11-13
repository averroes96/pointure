"""Reorder suggestions: formula, carton rounding, open orders, draft POs."""
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.reports.services.reorder import raw_need, suggest_colour_group


def _at(day: date):
    return timezone.make_aware(datetime(day.year, day.month, day.day, 12, 0))


def test_raw_need_formula():
    assert raw_need(sold=8, cover_weeks=6, stock=2, on_order=1) == Decimal("3")
    assert raw_need(sold=8, cover_weeks=6, stock=0, on_order=6) == Decimal("0")
    assert raw_need(sold=8, cover_weeks=4, stock=0, on_order=0) == Decimal("4")


def test_carton_rounding_buys_a_whole_run():
    ordered, cartons = suggest_colour_group(
        {40: Decimal("3"), 41: Decimal("0"), 42: Decimal("-1")},
        {"40": 2, "41": 2, "42": 2},
    )
    assert cartons == 2
    assert ordered == {40: 4, 41: 4, 42: 4}


@pytest.mark.django_db
class TestReorderApi:
    TODAY = date(2026, 11, 13)

    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.core.models import PlanChoices, RoleChoices, StoreSettings, Tenant, User

        self.tenant = Tenant.objects.create(name="Reorder Shop", plan=PlanChoices.PRO_RETAIL)
        self.manager = User.objects.create_user(
            email="mgr@reorder.com", password="testpass123",
            tenant=self.tenant, role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cash@reorder.com", password="testpass123",
            tenant=self.tenant, role=RoleChoices.CASHIER,
        )
        StoreSettings.objects.create(tenant=self.tenant, reorder_cover_weeks=6)
        self.api = APIClient()
        self.api.force_authenticate(self.manager)

    def _product(self, name, **kwargs):
        from apps.inventory.models import Product
        return Product.objects.create(
            tenant=self.tenant, name=name, brand="Atlas", category="sneakers",
            sale_price=Decimal("5000.00"), purchase_price=Decimal("2000.00"),
            pamp=Decimal("2000.00"), **kwargs,
        )

    def _variant(self, product, size, stock=0):
        from apps.inventory.models import Variant
        return Variant.objects.create(
            tenant=self.tenant, product=product, size_eu=size, colour="Noir", stock_qty=stock,
        )

    def _sell(self, variant, qty, day):
        from apps.sales.models import Sale, SaleItem
        sale = Sale.objects.create(
            tenant=self.tenant, cashier=self.manager, status="completed",
            total_amount=Decimal("1000.00"), receipt_number=f"RC-{variant.pk}-{qty}",
        )
        Sale.objects.filter(pk=sale.pk).update(created_at=_at(day))
        SaleItem.objects.create(sale=sale, variant=variant, quantity=qty, unit_price=Decimal("1000.00"))

    def _supplier(self, name):
        from apps.suppliers.models import Supplier
        return Supplier.objects.create(tenant=self.tenant, name=name)

    def _po(self, supplier, variant, day, status="received", ordered=1, received=1):
        from apps.suppliers.models import POLine, PurchaseOrder
        po = PurchaseOrder.objects.create(
            tenant=self.tenant, supplier=supplier, status=status, created_by=self.manager,
        )
        PurchaseOrder.objects.filter(pk=po.pk).update(created_at=_at(day))
        POLine.objects.create(
            order=po, variant=variant, description="x",
            quantity_ordered=ordered, quantity_received=received,
            agreed_unit_price=Decimal("2000.00"),
        )
        return po

    def test_suggestion_subtracts_stock_and_open_orders(self):
        from apps.reports.services.reorder import build_reorder_suggestions

        product = self._product("City")
        variant = self._variant(product, 42, stock=2)
        recent = self.TODAY - timedelta(days=7)
        self._sell(variant, 8, recent)
        supplier = self._supplier("Usine")
        self._po(supplier, variant, self.TODAY - timedelta(days=30))
        self._po(supplier, variant, self.TODAY - timedelta(days=1), status="sent", ordered=6, received=5)

        report = build_reorder_suggestions(self.tenant, today=self.TODAY, supplier_id=supplier.id)
        assert report["lines"] == [{
            "variant_id": str(variant.pk),
            "product_id": str(product.pk),
            "product_name": "City",
            "brand": "Atlas",
            "category": "sneakers",
            "size_eu": 42,
            "colour": "Noir",
            "supplier_id": str(supplier.pk),
            "supplier_name": "Usine",
            "units_sold": 8,
            "stock": 2,
            "on_order": 1,
            "raw_need": "3.00",
            "suggested_quantity": 3,
            "cartons": 0,
            "unit_price": "2000.00",
        }]

        covered = self._variant(self._product("Full"), 41, stock=0)
        self._sell(covered, 8, recent)
        self._po(supplier, covered, recent, status="sent", ordered=6, received=0)
        again = build_reorder_suggestions(self.tenant, today=self.TODAY)
        assert str(covered.pk) not in {row["variant_id"] for row in again["lines"]}

    def test_carton_breakdown_rounds_the_run(self):
        from apps.reports.services.reorder import build_reorder_suggestions

        product = self._product(
            "Run", pairs_per_carton=6, carton_breakdown={"40": 2, "41": 2, "42": 2},
        )
        size_40 = self._variant(product, 40, stock=0)
        size_41 = self._variant(product, 41, stock=20)
        size_42 = self._variant(product, 42, stock=20)
        recent = self.TODAY - timedelta(days=3)
        self._sell(size_40, 4, recent)
        supplier = self._supplier("Carton")
        self._po(supplier, size_40, recent)

        report = build_reorder_suggestions(self.tenant, today=self.TODAY)
        by_size = {row["size_eu"]: row["suggested_quantity"] for row in report["lines"]}
        assert by_size == {40: 4, 41: 4, 42: 4}
        assert {row["cartons"] for row in report["lines"]} == {2}

    def test_create_po_uses_edited_quantities_and_last_supplier(self):
        from apps.suppliers.models import PurchaseOrder

        product = self._product("Drafted")
        variant = self._variant(product, 42, stock=0)
        self._sell(variant, 8, self.TODAY)
        old = self._supplier("Ancien")
        new = self._supplier("Récent")
        self._po(old, variant, self.TODAY - timedelta(days=40))
        self._po(new, variant, self.TODAY - timedelta(days=2))

        denied = APIClient()
        denied.force_authenticate(self.cashier)
        assert denied.get("/api/v1/reports/reorder-suggestions/").status_code == 403

        listed = self.api.get("/api/v1/reports/reorder-suggestions/")
        assert listed.status_code == 200, listed.data
        assert listed.data["lines"][0]["supplier_id"] == str(new.pk)
        assert listed.data["lines"][0]["suggested_quantity"] == 6

        created = self.api.post("/api/v1/reports/reorder-suggestions/create-po/", {
            "lines": [{"variant_id": str(variant.pk), "quantity": 5}],
        }, format="json")
        assert created.status_code == 201, created.data
        assert created.data["orders"][0]["supplier_name"] == "Récent"
        po = PurchaseOrder.objects.get(pk=created.data["orders"][0]["id"])
        assert po.status == "draft"
        line = po.lines.get()
        assert line.quantity_ordered == 5
        assert line.agreed_unit_price == Decimal("2000.00")

        orphan = self._variant(self._product("Sans fournisseur"), 43, stock=0)
        self._sell(orphan, 8, self.TODAY)
        refused = self.api.post("/api/v1/reports/reorder-suggestions/create-po/", {
            "lines": [{"variant_id": str(orphan.pk), "quantity": 1}],
        }, format="json")
        assert refused.status_code == 400
        assert PurchaseOrder.objects.filter(lines__variant=orphan).count() == 0
