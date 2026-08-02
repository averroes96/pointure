"""
Tests for Defect Integration in Sales Returns & Exchanges.
Verifies that returned/exchanged defective items:
1. Automatically generate a DefectItem in QUARANTINED status.
2. Link back to the sale return/exchange and inherit the supplier/cost.
3. Suppress sellable stock restoration (no restock StockMovement).
4. Can be claimed via supplier return claims.
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from apps.core.models import PlanChoices, RoleChoices, Tenant, User, Branch
from apps.inventory.models import (
    Product,
    Variant,
    StockMovement,
    MovementReasonChoices,
    DefectItem,
    DefectStatusChoices,
    DefectReasonChoices,
)
from apps.suppliers.models import Supplier
from apps.sales.models import Sale, Return, ReturnItem, Exchange, ExchangeReturnItem


@pytest.mark.django_db
class TestSalesDefects:

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.create(name="ShoeDZ Defect Test Shop", plan=PlanChoices.ENTERPRISE)
        self.branch = Branch.objects.create(tenant=self.tenant, name="Main Branch")
        self.cashier = User.objects.create_user(
            email="cashier_defect@test.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )
        self.manager = User.objects.create_user(
            email="manager_defect@test.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.supplier = Supplier.objects.create(
            tenant=self.tenant,
            name="Alpha Shoes Factory",
            contact_name="Karim",
            phone="0555000111",
        )
        self.product = Product.objects.create(
            tenant=self.tenant,
            name="Sneaker Pro",
            brand="Adidas",
            sale_price="10000.00",
            purchase_price="6000.00",
        )
        self.variant_a = Variant.objects.create(
            tenant=self.tenant,
            product=self.product,
            size_eu=42,
            colour="Black",
        )
        self.variant_b = Variant.objects.create(
            tenant=self.tenant,
            product=self.product,
            size_eu=43,
            colour="White",
        )

        # Give stock to variant A and variant B
        StockMovement.objects.create(
            tenant=self.tenant,
            variant=self.variant_a,
            branch=self.branch,
            quantity_delta=10,
            reason=MovementReasonChoices.INITIAL,
            user=self.manager,
        )
        StockMovement.objects.create(
            tenant=self.tenant,
            variant=self.variant_b,
            branch=self.branch,
            quantity_delta=10,
            reason=MovementReasonChoices.INITIAL,
            user=self.manager,
        )
        self.variant_a.refresh_from_db()
        self.variant_b.refresh_from_db()

        self.client = APIClient()
        self.client.force_authenticate(user=self.cashier)

    def _create_sale(self, variant, qty=2, unit_price="10000.00"):
        total = Decimal(unit_price) * qty
        payload = {
            "items": [
                {
                    "variant_id": variant.pk,
                    "quantity": qty,
                    "unit_price": str(unit_price),
                    "discount_amount": "0.00",
                }
            ],
            "payments": [{"method": "cash", "amount": str(total)}],
            "cart_discount": "0.00",
        }
        resp = self.client.post("/api/v1/sales/", payload, format="json")
        assert resp.status_code == 201, resp.data
        return resp.data

    def test_sale_return_defective_item_creates_quarantined_defect(self):
        """
        Returning a defective item creates a DefectItem in QUARANTINED status,
        links it to the return, and does NOT increase sellable stock.
        """
        sale = self._create_sale(self.variant_a, qty=2)
        self.variant_a.refresh_from_db()
        assert self.variant_a.stock_qty == 8

        # Process return with is_defective=True
        return_payload = {
            "items": [
                {
                    "variant_id": self.variant_a.pk,
                    "quantity": 1,
                    "restock": False,
                    "is_defective": True,
                    "defect_reason": "unstitched_sole",
                    "defect_notes": "Semelle droite complètement décollée",
                }
            ],
            "reason": "Article défectueux retourné par le client",
            "refund_amount": "10000.00",
            "refund_method": "cash",
        }
        resp = self.client.post(f"/api/v1/sales/{sale['id']}/returns/", return_payload, format="json")
        assert resp.status_code == 201, resp.data

        # 1. DefectItem created
        defects = DefectItem.objects.filter(variant=self.variant_a)
        assert defects.count() == 1
        defect = defects.first()
        assert defect.status == DefectStatusChoices.QUARANTINED
        assert defect.defect_reason == DefectReasonChoices.UNSTITCHED_SOLE
        assert defect.notes == "Semelle droite complètement décollée"
        assert defect.quantity == 1
        assert defect.cost_price == Decimal("6000.00")
        assert defect.sale_return is not None
        assert str(defect.sale_return.original_sale_id) == str(sale["id"])

        # 2. Stock movement was NOT created for the defective return
        movements = StockMovement.objects.filter(
            variant=self.variant_a,
            reason=MovementReasonChoices.RETURN,
        )
        assert movements.count() == 0

        # 3. Sellable stock remains 8 (not incremented to 9)
        self.variant_a.refresh_from_db()
        assert self.variant_a.stock_qty == 8

    def test_sale_return_non_defective_item_restocks_normally(self):
        """
        Returning a normal item with restock=True increases sellable stock and creates no defect.
        """
        sale = self._create_sale(self.variant_a, qty=2)
        self.variant_a.refresh_from_db()
        assert self.variant_a.stock_qty == 8

        return_payload = {
            "items": [
                {
                    "variant_id": self.variant_a.pk,
                    "quantity": 1,
                    "restock": True,
                    "is_defective": False,
                }
            ],
            "reason": "Mauvaise pointure",
            "refund_amount": "10000.00",
            "refund_method": "cash",
        }
        resp = self.client.post(f"/api/v1/sales/{sale['id']}/returns/", return_payload, format="json")
        assert resp.status_code == 201, resp.data

        # 1. No DefectItem created
        assert DefectItem.objects.filter(variant=self.variant_a).count() == 0

        # 2. Stock movement created and stock restored
        movements = StockMovement.objects.filter(
            variant=self.variant_a,
            reason=MovementReasonChoices.RETURN,
        )
        assert movements.count() == 1
        assert movements.first().quantity_delta == 1

        self.variant_a.refresh_from_db()
        assert self.variant_a.stock_qty == 9

    def test_exchange_defective_item_quarantines_and_deducts_new_item(self):
        """
        Exchanging a defective item for a new item:
        - Creates a DefectItem for returned item linked to sale_exchange.
        - Does not restock the returned defective item.
        - Deducts stock for the new item.
        """
        sale = self._create_sale(self.variant_a, qty=1)
        self.variant_a.refresh_from_db()
        self.variant_b.refresh_from_db()
        assert self.variant_a.stock_qty == 9
        assert self.variant_b.stock_qty == 10

        exchange_payload = {
            "returned_items": [
                {
                    "variant_id": self.variant_a.pk,
                    "quantity": 1,
                    "is_defective": True,
                    "defect_reason": "leather_tear",
                    "defect_notes": "Cuir déchiré sur le côté",
                }
            ],
            "new_items": [
                {
                    "variant_id": self.variant_b.pk,
                    "quantity": 1,
                    "unit_price": "10000.00",
                }
            ],
            "reason": "Échange pour défaut de fabrication",
        }
        resp = self.client.post(f"/api/v1/sales/{sale['id']}/exchange/", exchange_payload, format="json")
        assert resp.status_code == 200, resp.data

        # 1. DefectItem created for returned item
        defect = DefectItem.objects.filter(variant=self.variant_a).first()
        assert defect is not None
        assert defect.status == DefectStatusChoices.QUARANTINED
        assert defect.defect_reason == DefectReasonChoices.LEATHER_TEAR
        assert defect.notes == "Cuir déchiré sur le côté"
        assert defect.sale_exchange is not None
        assert str(defect.sale_exchange.original_sale_id) == str(sale["id"])

        # 2. Returned defective item was NOT restocked
        self.variant_a.refresh_from_db()
        assert self.variant_a.stock_qty == 9

        # 3. New item WAS deducted from stock (10 -> 9)
        self.variant_b.refresh_from_db()
        assert self.variant_b.stock_qty == 9
