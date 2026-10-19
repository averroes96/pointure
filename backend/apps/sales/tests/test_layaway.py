import datetime
from decimal import Decimal
from django.test import TestCase
from rest_framework.test import APIClient
from apps.core.models import RoleChoices, StoreSettings, Tenant, User
from apps.inventory.models import MovementReasonChoices, Product, StockMovement, Variant
from apps.sales.models import CashMovement, CashMovementType, CashSession, CashSessionStatus, Payment, Sale
from apps.sales.services.z_report import compute_session_stats


class LayawayTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name="Pointure Boutique Alger")
        self.settings = StoreSettings.objects.create(
            tenant=self.tenant,
            enable_layaway=True,
            min_layaway_deposit_pct=20,
            layaway_duration_days=7,
            require_manager_pin_for_returns=True,
        )

        self.manager = User.objects.create_user(
            email="manager@pointure.dz",
            password="password123",
            role=RoleChoices.MANAGER,
            tenant=self.tenant,
        )
        self.manager.set_pin("4321")
        self.manager.save()

        self.cashier = User.objects.create_user(
            email="cashier@pointure.dz",
            password="password123",
            role=RoleChoices.CASHIER,
            tenant=self.tenant,
            can_process_returns=False,
        )

        self.product = Product.objects.create(
            tenant=self.tenant,
            name="Mocassins Cuir Noir",
            brand="Geox",
            reference="GX-MOC-01",
            sale_price=Decimal("10000.00"),
            purchase_price=Decimal("6000.00"),
        )
        self.variant = Variant.objects.create(
            tenant=self.tenant,
            product=self.product,
            size_eu=42,
            colour="Noir",
            stock_qty=5,
        )
        # Create initial stock movement so variant movements reflect quantity
        StockMovement.objects.create(
            tenant=self.tenant,
            variant=self.variant,
            quantity_delta=5,
            reason=MovementReasonChoices.ADJUSTMENT,
            user=self.manager,
        )

        # Open cash session for cashier
        self.session = CashSession.objects.create(
            tenant=self.tenant,
            cashier=self.cashier,
            opening_float=Decimal("5000.00"),
            status=CashSessionStatus.OPEN,
        )

        self.client = APIClient()

    def tearDown(self):
        from apps.core.signals import set_current_user
        set_current_user(None)

    def test_create_layaway_insufficient_deposit(self):
        self.client.force_authenticate(user=self.cashier)
        # 10,000 DZD item, min 20% = 2000 DZD. Provide only 1000 DZD.
        payload = {
            "items": [
                {"variant_id": str(self.variant.id), "quantity": 1, "unit_price": "10000.00", "discount_amount": "0.00"}
            ],
            "payments": [
                {"amount": "1000.00", "method": "cash"}
            ],
            "notes": "Réservation Mme Karima",
            "is_layaway": True,
        }
        resp = self.client.post("/api/v1/sales/", data=payload, format="json")
        self.assertEqual(resp.status_code, 400)
        details = resp.data.get("error", {}).get("details", resp.data)
        self.assertIn("payments", details)

    def test_create_layaway_success_and_stock_locking(self):
        self.client.force_authenticate(user=self.cashier)
        initial_stock = self.variant.stock_qty  # 5
        payload = {
            "items": [
                {"variant_id": str(self.variant.id), "quantity": 1, "unit_price": "10000.00", "discount_amount": "0.00"}
            ],
            "payments": [
                {"amount": "3000.00", "method": "cash"}
            ],
            "notes": "Réservation M. Ahmed 0555123456",
            "is_layaway": True,
            "layaway_duration_days": 10,
        }
        resp = self.client.post("/api/v1/sales/", data=payload, format="json")
        self.assertEqual(resp.status_code, 201)
        data = resp.data

        sale = Sale.objects.get(pk=data["id"])
        self.assertTrue(sale.is_layaway)
        self.assertEqual(sale.status, "layaway")
        self.assertTrue(sale.receipt_number.startswith("RES-"))
        self.assertEqual(sale.amount_paid, Decimal("3000.00"))
        self.assertEqual(sale.balance_due, Decimal("7000.00"))
        expected_expiry = datetime.date.today() + datetime.timedelta(days=10)
        self.assertEqual(sale.layaway_expires_at, expected_expiry)

        # Verify stock locked with LAYAWAY_LOCK
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_qty, initial_stock - 1)
        movement = StockMovement.objects.filter(variant=self.variant, reason=MovementReasonChoices.LAYAWAY_LOCK).first()
        self.assertIsNotNone(movement)
        self.assertEqual(movement.quantity_delta, -1)

    def test_add_intermediate_payment_to_layaway(self):
        self.client.force_authenticate(user=self.cashier)
        payload = {
            "items": [
                {"variant_id": str(self.variant.id), "quantity": 1, "unit_price": "10000.00", "discount_amount": "0.00"}
            ],
            "payments": [
                {"amount": "3000.00", "method": "cash"}
            ],
            "notes": "Réservation",
            "is_layaway": True,
        }
        resp = self.client.post("/api/v1/sales/", data=payload, format="json")
        sale_id = resp.data["id"]

        # Add interim payment of 2000 DZD
        resp_pay = self.client.post(
            f"/api/v1/sales/{sale_id}/add-payment/",
            data={"amount": "2000.00", "method": "cash", "notes": "Acompte supplémentaire"},
            format="json",
        )
        self.assertEqual(resp_pay.status_code, 200)
        self.assertEqual(resp_pay.data["amount_paid"], "5000.00")
        self.assertEqual(resp_pay.data["balance_due"], "5000.00")
        self.assertEqual(resp_pay.data["status"], "layaway")

    def test_collect_layaway_with_balance_payment(self):
        self.client.force_authenticate(user=self.cashier)
        payload = {
            "items": [
                {"variant_id": str(self.variant.id), "quantity": 1, "unit_price": "10000.00", "discount_amount": "0.00"}
            ],
            "payments": [
                {"amount": "4000.00", "method": "cash"}
            ],
            "notes": "Réservation",
            "is_layaway": True,
        }
        resp = self.client.post("/api/v1/sales/", data=payload, format="json")
        sale_id = resp.data["id"]

        # Collect without paying remaining 6000 DZD -> should fail
        resp_fail = self.client.post(f"/api/v1/sales/{sale_id}/collect-layaway/", data={}, format="json")
        self.assertEqual(resp_fail.status_code, 400)

        # Collect with full remaining payment
        resp_collect = self.client.post(
            f"/api/v1/sales/{sale_id}/collect-layaway/",
            data={"amount": "6000.00", "method": "cash"},
            format="json",
        )
        self.assertEqual(resp_collect.status_code, 200)
        self.assertEqual(resp_collect.data["status"], "completed")
        self.assertEqual(resp_collect.data["balance_due"], "0.00")
        self.assertIsNotNone(resp_collect.data["layaway_collected_at"])

    def test_cancel_layaway_refunds_deposit_and_releases_stock(self):
        self.client.force_authenticate(user=self.cashier)
        initial_stock = self.variant.stock_qty  # 5
        payload = {
            "items": [
                {"variant_id": str(self.variant.id), "quantity": 1, "unit_price": "10000.00", "discount_amount": "0.00"}
            ],
            "payments": [
                {"amount": "3000.00", "method": "cash"}
            ],
            "notes": "Réservation",
            "is_layaway": True,
        }
        resp = self.client.post("/api/v1/sales/", data=payload, format="json")
        sale_id = resp.data["id"]

        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_qty, initial_stock - 1)

        # Cashier cancelling without PIN should fail
        resp_cancel_no_pin = self.client.post(
            f"/api/v1/sales/{sale_id}/cancel-layaway/",
            data={"refund_deposit": True},
            format="json",
        )
        self.assertEqual(resp_cancel_no_pin.status_code, 403)

        # Cashier cancelling with manager PIN
        resp_cancel = self.client.post(
            f"/api/v1/sales/{sale_id}/cancel-layaway/",
            data={"refund_deposit": True, "manager_pin": "4321", "notes": "Client a changé d'avis"},
            format="json",
        )
        self.assertEqual(resp_cancel.status_code, 200)
        self.assertEqual(resp_cancel.data["status"], "cancelled")

        # Stock released
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_qty, initial_stock)
        release_mov = StockMovement.objects.filter(variant=self.variant, reason=MovementReasonChoices.LAYAWAY_RELEASE).first()
        self.assertIsNotNone(release_mov)
        self.assertEqual(release_mov.quantity_delta, 1)

        # CashMovement recorded for drawer refund
        cm = CashMovement.objects.filter(session=self.session, type=CashMovementType.OUT).first()
        self.assertIsNotNone(cm)
        self.assertEqual(cm.amount, Decimal("3000.00"))

    def test_cancel_layaway_forfeited_deposit(self):
        self.client.force_authenticate(user=self.manager)
        payload = {
            "items": [
                {"variant_id": str(self.variant.id), "quantity": 1, "unit_price": "10000.00", "discount_amount": "0.00"}
            ],
            "payments": [
                {"amount": "3000.00", "method": "cash"}
            ],
            "notes": "Réservation",
            "is_layaway": True,
        }
        resp = self.client.post("/api/v1/sales/", data=payload, format="json")
        sale_id = resp.data["id"]

        # Cancel with deposit forfeited
        resp_cancel = self.client.post(
            f"/api/v1/sales/{sale_id}/cancel-layaway/",
            data={"deposit_forfeited": True, "refund_deposit": False, "notes": "Délai expiré sans nouvelles"},
            format="json",
        )
        self.assertEqual(resp_cancel.status_code, 200)
        self.assertEqual(resp_cancel.data["status"], "cancelled")
        self.assertTrue(resp_cancel.data["layaway_deposit_forfeited"])

        # No cash movement out created
        cm = CashMovement.objects.filter(session=self.session, type=CashMovementType.OUT).first()
        self.assertIsNone(cm)

    def test_z_report_includes_layaway_deposit(self):
        self.client.force_authenticate(user=self.cashier)
        payload = {
            "items": [
                {"variant_id": str(self.variant.id), "quantity": 1, "unit_price": "10000.00", "discount_amount": "0.00"}
            ],
            "payments": [
                {"amount": "2500.00", "method": "cash"}
            ],
            "notes": "Réservation",
            "is_layaway": True,
        }
        resp = self.client.post("/api/v1/sales/", data=payload, format="json")
        self.assertEqual(resp.status_code, 201)

        stats = compute_session_stats(self.session)
        self.assertEqual(stats["sales_count"], 1)
        self.assertEqual(stats["cash_sales"], Decimal("2500.00"))
        # Expected cash: opening 5000 + cash 2500 = 7500
        self.assertEqual(stats["expected_cash"], Decimal("7500.00"))
