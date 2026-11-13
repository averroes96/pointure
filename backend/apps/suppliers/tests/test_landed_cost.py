"""Landed cost allocation, PAMP on receipt, and the partial-receipt refusal."""
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.suppliers.services.landed_cost import allocate_amounts


def test_allocation_remainder_lands_on_the_largest_share():
    value = allocate_amounts(
        [("a", Decimal("1000"), 10), ("b", Decimal("3000"), 10)],
        Decimal("100.00"),
    )
    assert value == {"a": Decimal("25.00"), "b": Decimal("75.00")}
    assert sum(value.values()) == Decimal("100.00")

    pairs = allocate_amounts(
        [("a", Decimal("1"), 1), ("b", Decimal("1"), 1), ("c", Decimal("1"), 1)],
        Decimal("1.00"),
    )
    assert pairs["a"] == Decimal("0.34")
    assert pairs["b"] == Decimal("0.33")
    assert pairs["c"] == Decimal("0.33")
    assert sum(pairs.values()) == Decimal("1.00")

    cartons = allocate_amounts(
        [("a", Decimal("2"), 20), ("b", Decimal("1"), 10)],
        Decimal("90.00"),
    )
    assert cartons == {"a": Decimal("60.00"), "b": Decimal("30.00")}
    assert sum(cartons.values()) == Decimal("90.00")

    from types import SimpleNamespace
    from apps.suppliers.services.landed_cost import line_weight
    by_cartons = SimpleNamespace(
        quantity_ordered=20, cartons=0, pairs_per_carton=10, agreed_unit_price=Decimal("5"),
    )
    assert line_weight(by_cartons, "cartons", Decimal("1")) == Decimal("2")
    by_value = SimpleNamespace(
        quantity_ordered=10, cartons=0, pairs_per_carton=10, agreed_unit_price=Decimal("100"),
    )
    assert line_weight(by_value, "value", Decimal("2")) == Decimal("2000")


@pytest.mark.django_db
class TestLandedCostApply:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.core.models import Branch, PlanChoices, RoleChoices, Tenant, User
        from apps.inventory.models import Product, Variant
        from apps.suppliers.models import Supplier

        self.tenant = Tenant.objects.create(name="Import Shop", plan=PlanChoices.PRO_RETAIL)
        self.branch = Branch.objects.create(tenant=self.tenant, name="Siège", is_headquarters=True, is_active=True)
        self.manager = User.objects.create_user(
            email="mgr@landed.com", password="testpass123",
            tenant=self.tenant, role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cash@landed.com", password="testpass123",
            tenant=self.tenant, role=RoleChoices.CASHIER,
        )
        self.supplier = Supplier.objects.create(tenant=self.tenant, name="Usine")
        self.product = Product.objects.create(
            tenant=self.tenant, name="City", brand="Atlas",
            sale_price=Decimal("8000.00"), purchase_price=Decimal("0.00"), pamp=Decimal("0.00"),
        )
        self.variant = Variant.objects.create(
            tenant=self.tenant, product=self.product, size_eu=42, colour="Noir", stock_qty=0,
        )
        self.api = APIClient()
        self.api.force_authenticate(self.manager)

    def _po(self, price="1000.00", qty=10):
        from apps.suppliers.models import POLine, PurchaseOrder
        po = PurchaseOrder.objects.create(
            tenant=self.tenant, supplier=self.supplier, reference="PO-IMP", created_by=self.manager,
        )
        line = POLine.objects.create(
            order=po, variant=self.variant, description="City EU42",
            quantity_ordered=qty, agreed_unit_price=Decimal(price),
        )
        return po, line

    def test_receive_uses_landed_cost_and_invoice_stays_on_supplier_price(self):
        from apps.suppliers.models import SupplierInvoice
        po, line = self._po()
        saved = self.api.put(
            f"/api/v1/suppliers/purchase-orders/{po.id}/landed-cost/",
            {
                "currency": "eur",
                "exchange_rate": "2.0000",
                "allocation": "value",
                "lines": [
                    {"label": "Fret", "amount_dzd": "1000.00"},
                    {"label": "Droits de douane", "amount_dzd": "0.00"},
                ],
            },
            format="json",
        )
        assert saved.status_code == 200, saved.data
        assert saved.data["preview"][0]["dzd_unit_price"] == "2000.00"
        assert saved.data["preview"][0]["allocated_cost"] == "1000.00"
        assert saved.data["preview"][0]["landed_unit_cost"] == "2100.00"
        assert saved.data["preview"][0]["estimated_pamp"] == "2100.00"

        applied = self.api.post(f"/api/v1/suppliers/purchase-orders/{po.id}/landed-cost/apply/")
        assert applied.status_code == 200, applied.data
        line.refresh_from_db()
        assert line.landed_unit_cost == Decimal("2100.00")

        received = self.api.post(
            f"/api/v1/suppliers/purchase-orders/{po.id}/receive/",
            {"branch_id": str(self.branch.id), "lines": [{"id": str(line.id), "quantity_received": 10}]},
            format="json",
        )
        assert received.status_code == 200, received.data
        self.product.refresh_from_db()
        assert self.product.pamp == Decimal("2100.00")
        assert self.product.purchase_price == Decimal("2100.00")
        invoice = SupplierInvoice.objects.get(purchase_order=po)
        assert invoice.total_amount == Decimal("20000.00")

    def test_partly_received_order_is_refused(self):
        po, line = self._po()
        line.quantity_received = 1
        line.save(update_fields=["quantity_received"])
        saved = self.api.put(
            f"/api/v1/suppliers/purchase-orders/{po.id}/landed-cost/",
            {
                "currency": "DZD",
                "exchange_rate": "1.0000",
                "allocation": "pairs",
                "lines": [{"label": "Fret", "amount_dzd": "50.00"}],
            },
            format="json",
        )
        assert saved.status_code == 400
        denied = APIClient()
        denied.force_authenticate(self.cashier)
        assert denied.get(f"/api/v1/suppliers/purchase-orders/{po.id}/landed-cost/").status_code == 403
        line.refresh_from_db()
        assert line.landed_unit_cost is None
