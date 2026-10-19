from decimal import Decimal
from django.test import TestCase
from rest_framework.test import APIClient
from apps.core.models import Branch, RoleChoices, StoreSettings, Tenant, User
from apps.inventory.models import (
    MovementReasonChoices,
    Product,
    StockMovement,
    StocktakeItem,
    StocktakeSession,
    StocktakeStatusChoices,
    Variant,
)


class StocktakeTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name="Algerian Shoes El Eulma")
        self.branch = Branch.objects.create(tenant=self.tenant, name="Dépôt Central")
        self.settings = StoreSettings.objects.create(
            tenant=self.tenant,
            require_manager_pin_for_returns=True,
        )

        self.manager = User.objects.create_user(
            email="manager@eleulma.dz",
            password="password123",
            role=RoleChoices.MANAGER,
            tenant=self.tenant,
        )
        self.manager.set_pin("4321")
        self.manager.save()

        self.cashier = User.objects.create_user(
            email="cashier@eleulma.dz",
            password="password123",
            role=RoleChoices.CASHIER,
            tenant=self.tenant,
        )

        # Create products and variants with initial stock
        self.product1 = Product.objects.create(
            tenant=self.tenant,
            name="Stan Smith Classic",
            brand="Adidas",
            reference="ADI-SS-01",
            sale_price=Decimal("11000.00"),
            purchase_price=Decimal("7000.00"),
        )
        self.var1 = Variant.objects.create(
            tenant=self.tenant,
            product=self.product1,
            size_eu=42,
            colour="Blanc/Vert",
            barcode="21300100010015",
        )
        StockMovement.objects.create(
            tenant=self.tenant,
            variant=self.var1,
            branch=self.branch,
            quantity_delta=10,
            reason=MovementReasonChoices.INITIAL,
            user=self.manager,
        )
        self.var1.refresh_stock()

        self.var2 = Variant.objects.create(
            tenant=self.tenant,
            product=self.product1,
            size_eu=43,
            colour="Blanc/Vert",
            barcode="21300100010022",
        )
        StockMovement.objects.create(
            tenant=self.tenant,
            variant=self.var2,
            branch=self.branch,
            quantity_delta=4,
            reason=MovementReasonChoices.INITIAL,
            user=self.manager,
        )
        self.var2.refresh_stock()

        self.client = APIClient()

    def tearDown(self):
        from apps.core.signals import set_current_user
        set_current_user(None)

    def test_create_stocktake_session_with_autopopulate(self):
        self.client.force_authenticate(user=self.manager)
        resp = self.client.post("/api/v1/inventory/stocktakes/", {
            "title": "Inventaire Semestriel 2026",
            "branch": self.branch.id,
            "auto_populate": True,
        }, format="json")
        assert resp.status_code == 201, resp.data

        session_id = resp.data["id"]
        session = StocktakeSession.objects.get(pk=session_id)
        assert session.total_expected == 14  # 10 + 4
        assert session.total_counted == 0
        assert session.total_variance == -14
        assert session.items.count() == 2

    def test_scan_barcode_increments_and_carton(self):
        self.client.force_authenticate(user=self.manager)
        session = StocktakeSession.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            title="Inventaire Scan Test",
            created_by=self.manager,
        )

        # Scan 1 pair of var1
        resp = self.client.post(f"/api/v1/inventory/stocktakes/{session.id}/scan/", {
            "barcode": self.var1.barcode,
            "increment": 1,
        }, format="json")
        assert resp.status_code == 200, resp.data
        assert resp.data["success"] is True
        assert resp.data["session_total_counted"] == 1

        item = StocktakeItem.objects.get(session=session, variant=self.var1)
        assert item.counted_qty == 1

        # Scan a carton of 12 for var1
        resp2 = self.client.post(f"/api/v1/inventory/stocktakes/{session.id}/scan/", {
            "barcode": self.var1.barcode,
            "increment": 12,
        }, format="json")
        assert resp2.status_code == 200, resp2.data
        item.refresh_from_db()
        assert item.counted_qty == 13
        assert resp2.data["session_total_counted"] == 13

    def test_scan_unknown_barcode_returns_404(self):
        self.client.force_authenticate(user=self.manager)
        session = StocktakeSession.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            title="Inventaire Inconnu Test",
            created_by=self.manager,
        )
        resp = self.client.post(f"/api/v1/inventory/stocktakes/{session.id}/scan/", {
            "barcode": "99999999999999",
            "increment": 1,
        }, format="json")
        assert resp.status_code == 404
        assert resp.data["error"]["code"] == "not_found"

    def test_manual_item_update(self):
        self.client.force_authenticate(user=self.manager)
        session = StocktakeSession.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            title="Inventaire Manual Edit",
            created_by=self.manager,
        )
        item = StocktakeItem.objects.create(
            tenant=self.tenant,
            session=session,
            variant=self.var1,
            expected_qty=10,
            counted_qty=0,
            unit_cost=self.var1.product.purchase_price,
            unit_price=self.var1.product.sale_price,
        )

        resp = self.client.patch(f"/api/v1/inventory/stocktakes/{session.id}/update-item/", {
            "item_id": item.id,
            "counted_qty": 9,
            "notes": "1 paire manquante",
        }, format="json")
        assert resp.status_code == 200, resp.data
        item.refresh_from_db()
        assert item.counted_qty == 9
        assert item.notes == "1 paire manquante"
        assert item.variance_qty == -1

    def test_apply_inventory_adjusts_stock(self):
        self.client.force_authenticate(user=self.manager)
        session = StocktakeSession.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            title="Inventaire Clôture Test",
            created_by=self.manager,
        )
        # var1: expected 10, counted 8 (-2)
        StocktakeItem.objects.create(
            tenant=self.tenant,
            session=session,
            variant=self.var1,
            expected_qty=10,
            counted_qty=8,
            unit_cost=self.var1.product.purchase_price,
            unit_price=self.var1.product.sale_price,
        )
        # var2: expected 4, counted 6 (+2)
        StocktakeItem.objects.create(
            tenant=self.tenant,
            session=session,
            variant=self.var2,
            expected_qty=4,
            counted_qty=6,
            unit_cost=self.var2.product.purchase_price,
            unit_price=self.var2.product.sale_price,
        )

        resp = self.client.post(f"/api/v1/inventory/stocktakes/{session.id}/apply/", {}, format="json")
        assert resp.status_code == 200, resp.data
        assert resp.data["adjusted_variants_count"] == 2

        session.refresh_from_db()
        assert session.status == StocktakeStatusChoices.COMPLETED

        self.var1.refresh_from_db()
        self.var2.refresh_from_db()
        assert self.var1.stock_qty == 8
        assert self.var2.stock_qty == 6

        # Check stock movements
        mv1 = StockMovement.objects.filter(variant=self.var1, reason=MovementReasonChoices.STOCKTAKE).first()
        assert mv1 is not None
        assert mv1.quantity_delta == -2

        mv2 = StockMovement.objects.filter(variant=self.var2, reason=MovementReasonChoices.STOCKTAKE).first()
        assert mv2 is not None
        assert mv2.quantity_delta == 2

    def test_apply_inventory_pin_protection_for_cashier(self):
        self.client.force_authenticate(user=self.cashier)
        session = StocktakeSession.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            title="Inventaire PIN Test",
            created_by=self.cashier,
        )
        StocktakeItem.objects.create(
            tenant=self.tenant,
            session=session,
            variant=self.var1,
            expected_qty=10,
            counted_qty=9,
            unit_cost=self.var1.product.purchase_price,
            unit_price=self.var1.product.sale_price,
        )

        # Without PIN -> rejects 400
        resp_fail = self.client.post(f"/api/v1/inventory/stocktakes/{session.id}/apply/", {}, format="json")
        assert resp_fail.status_code == 400
        assert resp_fail.data["error"]["code"] == "invalid_pin"

        # With correct PIN -> succeeds 200
        resp_ok = self.client.post(f"/api/v1/inventory/stocktakes/{session.id}/apply/", {
            "manager_pin": "4321",
        }, format="json")
        assert resp_ok.status_code == 200, resp_ok.data
        session.refresh_from_db()
        assert session.status == StocktakeStatusChoices.COMPLETED
