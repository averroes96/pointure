from decimal import Decimal
from django.test import TestCase
from rest_framework.test import APIClient
from apps.clients.models import Client, ClientLedger
from apps.core.models import RoleChoices, StoreSettings, Tenant, User
from apps.inventory.models import Product, Variant
from apps.sales.models import Sale, SaleItem, Payment, PaymentMethodChoices, Return


class CashierPermissionsAndPinTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name="Algerian Shoes Bab Ezzouar")
        self.settings = StoreSettings.objects.create(
            tenant=self.tenant,
            require_manager_pin_for_returns=True,
            require_manager_pin_for_discounts=True,
            default_max_discount_pct=10,
        )

        self.manager = User.objects.create_user(
            email="manager@algerianshoes.dz",
            password="password123",
            role=RoleChoices.MANAGER,
            tenant=self.tenant,
        )
        self.manager.set_pin("1234")
        self.manager.save()

        self.cashier = User.objects.create_user(
            email="cashier@algerianshoes.dz",
            password="password123",
            role=RoleChoices.CASHIER,
            tenant=self.tenant,
            max_discount_pct=10,
            can_modify_price=False,
            can_process_returns=False,
        )

        self.product = Product.objects.create(
            tenant=self.tenant,
            name="Air Max 90",
            brand="Nike",
            reference="NK-AM90-01",
            sale_price=Decimal("12000.00"),
            purchase_price=Decimal("8000.00"),
        )
        self.variant = Variant.objects.create(
            tenant=self.tenant,
            product=self.product,
            size_eu=42,
            colour="Noir",
            stock_qty=10,
        )

        self.client = APIClient()

    def tearDown(self):
        from apps.core.signals import set_current_user
        set_current_user(None)

    def test_verify_manager_pin_success_and_failure(self):
        self.client.force_authenticate(user=self.cashier)

        # Failure: Wrong PIN
        res = self.client.post("/api/v1/core/users/verify-manager-pin/", {"pin": "9999"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("error", res.data)

        # Success: Correct PIN
        res = self.client.post("/api/v1/core/users/verify-manager-pin/", {"pin": "1234"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["valid"])
        self.assertEqual(res.data["manager_id"], str(self.manager.id))

    def test_cashier_discount_within_limit_passes(self):
        self.client.force_authenticate(user=self.cashier)
        # 10% on 12000 is 1200 DZD. Let's give 1000 DZD discount (approx 8.3%), which is <= 10%
        res = self.client.post(
            "/api/v1/sales/",
            {
                "items": [
                    {
                        "variant_id": str(self.variant.id),
                        "quantity": 1,
                        "unit_price": "12000.00",
                        "discount_amount": "0.00",
                    }
                ],
                "payments": [{"amount": "11000.00", "method": "cash"}],
                "cart_discount": "1000.00",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["status"], "completed")

    def test_cashier_excess_discount_requires_manager_pin(self):
        self.client.force_authenticate(user=self.cashier)
        # Attempt to give 2000 DZD discount on 12000 DZD (16.6% > 10% limit) without PIN
        res = self.client.post(
            "/api/v1/sales/",
            {
                "items": [
                    {
                        "variant_id": str(self.variant.id),
                        "quantity": 1,
                        "unit_price": "12000.00",
                        "discount_amount": "0.00",
                    }
                ],
                "payments": [{"amount": "10000.00", "method": "cash"}],
                "cart_discount": "2000.00",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        details = res.data.get("error", {}).get("details", res.data)
        self.assertIn("cart_discount", details)
        self.assertIn("Code PIN manager requis", str(details["cart_discount"]))

        # Now submit with correct manager PIN
        res_with_pin = self.client.post(
            "/api/v1/sales/",
            {
                "items": [
                    {
                        "variant_id": str(self.variant.id),
                        "quantity": 1,
                        "unit_price": "12000.00",
                        "discount_amount": "0.00",
                    }
                ],
                "payments": [{"amount": "10000.00", "method": "cash"}],
                "cart_discount": "2000.00",
                "manager_pin": "1234",
            },
            format="json",
        )
        self.assertEqual(res_with_pin.status_code, 201)
        created_sale = Sale.objects.get(pk=res_with_pin.data["id"])
        self.assertEqual(created_sale.authorized_by, self.manager)

    def test_cashier_price_tampering_requires_manager_pin(self):
        self.client.force_authenticate(user=self.cashier)
        # Product sale price is 12000. Cashier tries to sell for 9000 without permission
        res = self.client.post(
            "/api/v1/sales/",
            {
                "items": [
                    {
                        "variant_id": str(self.variant.id),
                        "quantity": 1,
                        "unit_price": "9000.00",
                        "discount_amount": "0.00",
                    }
                ],
                "payments": [{"amount": "9000.00", "method": "cash"}],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        details = res.data.get("error", {}).get("details", res.data)
        self.assertIn("items", details)
        self.assertIn("Code PIN manager requis", str(details["items"]))

        # Now with manager PIN
        res_with_pin = self.client.post(
            "/api/v1/sales/",
            {
                "items": [
                    {
                        "variant_id": str(self.variant.id),
                        "quantity": 1,
                        "unit_price": "9000.00",
                        "discount_amount": "0.00",
                    }
                ],
                "payments": [{"amount": "9000.00", "method": "cash"}],
                "manager_pin": "1234",
            },
            format="json",
        )
        self.assertEqual(res_with_pin.status_code, 201)

    def test_cashier_return_requires_manager_pin(self):
        # Create a completed sale first as manager
        sale = Sale.objects.create(
            tenant=self.tenant,
            cashier=self.cashier,
            total_amount=Decimal("12000.00"),
            status="completed",
            receipt_number="TICK-0001",
        )
        SaleItem.objects.create(
            sale=sale,
            variant=self.variant,
            quantity=1,
            unit_price=Decimal("12000.00"),
        )
        Payment.objects.create(
            sale=sale,
            amount=Decimal("12000.00"),
            method=PaymentMethodChoices.CASH,
        )

        self.client.force_authenticate(user=self.cashier)

        # Attempt return without PIN
        res = self.client.post(
            f"/api/v1/sales/{sale.id}/returns/",
            {
                "items": [{"variant_id": str(self.variant.id), "quantity": 1, "restock": True}],
                "reason": "Mauvaise pointure",
                "refund_amount": "12000.00",
                "refund_method": "cash",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        details = res.data.get("error", {}).get("details", res.data)
        self.assertIn("manager_pin", details)

        # Attempt return with wrong PIN
        res_wrong = self.client.post(
            f"/api/v1/sales/{sale.id}/returns/",
            {
                "items": [{"variant_id": str(self.variant.id), "quantity": 1, "restock": True}],
                "reason": "Mauvaise pointure",
                "refund_amount": "12000.00",
                "refund_method": "cash",
                "manager_pin": "0000",
            },
            format="json",
        )
        self.assertEqual(res_wrong.status_code, 400)
        details_wrong = res_wrong.data.get("error", {}).get("details", res_wrong.data)
        self.assertIn("manager_pin", details_wrong)

        # Return with valid manager PIN
        res_ok = self.client.post(
            f"/api/v1/sales/{sale.id}/returns/",
            {
                "items": [{"variant_id": str(self.variant.id), "quantity": 1, "restock": True}],
                "reason": "Mauvaise pointure",
                "refund_amount": "12000.00",
                "refund_method": "cash",
                "manager_pin": "1234",
            },
            format="json",
        )
        self.assertEqual(res_ok.status_code, 201)
        ret = Return.objects.get(pk=res_ok.data["id"])
        self.assertEqual(ret.authorized_by, self.manager)

    def test_verify_manager_pin_endpoint_rate_limited_after_5_attempts(self):
        from django.core.cache import cache

        cache.clear()
        self.client.force_authenticate(user=self.cashier)

        for _ in range(5):
            res = self.client.post(
                "/api/v1/core/users/verify-manager-pin/",
                {"pin": "9999"},
                format="json",
            )
            self.assertEqual(res.status_code, 400)

        # 6th attempt within 1 minute must be throttled with HTTP 429
        res_6 = self.client.post(
            "/api/v1/core/users/verify-manager-pin/",
            {"pin": "9999"},
            format="json",
        )
        self.assertEqual(res_6.status_code, 429)

    def test_in_serializer_manager_pin_rate_limited_after_5_wrong_pins(self):
        from django.core.cache import cache

        cache.clear()
        self.client.force_authenticate(user=self.cashier)

        payload = {
            "items": [
                {
                    "variant_id": str(self.variant.id),
                    "quantity": 1,
                    "unit_price": "12000.00",
                    "discount_amount": "0.00",
                }
            ],
            "payments": [{"amount": "10000.00", "method": "cash"}],
            "cart_discount": "2000.00",
            "manager_pin": "9999",
        }

        for _ in range(5):
            res = self.client.post("/api/v1/sales/", payload, format="json")
            self.assertEqual(res.status_code, 400)

        # 6th wrong PIN within a minute -> HTTP 429
        res_6 = self.client.post("/api/v1/sales/", payload, format="json")
        self.assertEqual(res_6.status_code, 429)

    def test_in_serializer_manager_pin_rate_limiting_is_isolated_per_user(self):
        from django.core.cache import cache

        cache.clear()
        other_cashier = User.objects.create_user(
            email="cashier2@algerianshoes.dz",
            password="password123",
            role=RoleChoices.CASHIER,
            tenant=self.tenant,
            max_discount_pct=10,
        )

        payload = {
            "items": [
                {
                    "variant_id": str(self.variant.id),
                    "quantity": 1,
                    "unit_price": "12000.00",
                    "discount_amount": "0.00",
                }
            ],
            "payments": [{"amount": "10000.00", "method": "cash"}],
            "cart_discount": "2000.00",
            "manager_pin": "9999",
        }

        # Cashier 1 fails 5 times and gets throttled on 6th
        self.client.force_authenticate(user=self.cashier)
        for _ in range(5):
            res = self.client.post("/api/v1/sales/", payload, format="json")
            self.assertEqual(res.status_code, 400)
        res_throttled = self.client.post("/api/v1/sales/", payload, format="json")
        self.assertEqual(res_throttled.status_code, 429)

        # Cashier 2 is NOT throttled by Cashier 1's failures
        self.client.force_authenticate(user=other_cashier)
        res_cashier2 = self.client.post("/api/v1/sales/", payload, format="json")
        self.assertEqual(res_cashier2.status_code, 400)

    def test_in_serializer_correct_pin_resets_failure_count(self):
        from django.core.cache import cache

        cache.clear()
        self.client.force_authenticate(user=self.cashier)

        wrong_payload = {
            "items": [
                {
                    "variant_id": str(self.variant.id),
                    "quantity": 1,
                    "unit_price": "12000.00",
                    "discount_amount": "0.00",
                }
            ],
            "payments": [{"amount": "10000.00", "method": "cash"}],
            "cart_discount": "2000.00",
            "manager_pin": "9999",
        }
        correct_payload = {
            "items": [
                {
                    "variant_id": str(self.variant.id),
                    "quantity": 1,
                    "unit_price": "12000.00",
                    "discount_amount": "0.00",
                }
            ],
            "payments": [{"amount": "10000.00", "method": "cash"}],
            "cart_discount": "2000.00",
            "manager_pin": "1234",
        }

        # 3 failures
        for _ in range(3):
            res = self.client.post("/api/v1/sales/", wrong_payload, format="json")
            self.assertEqual(res.status_code, 400)

        # 1 success with correct PIN
        res_ok = self.client.post("/api/v1/sales/", correct_payload, format="json")
        self.assertEqual(res_ok.status_code, 201)

        # Counter should be reset: 3 more failures should not trigger 429 (would have been 6 total without reset)
        for _ in range(3):
            res = self.client.post("/api/v1/sales/", wrong_payload, format="json")
            self.assertEqual(res.status_code, 400)

    def test_cashier_discount_hard_limit_when_pin_disabled(self):
        """When require_manager_pin_for_discounts is False, discounts exceeding limit are strictly rejected."""
        self.settings.require_manager_pin_for_discounts = False
        self.settings.save()

        self.client.force_authenticate(user=self.cashier)

        # 2000 DZD discount on 12000 DZD is ~16.6% > 10% limit
        payload = {
            "items": [
                {
                    "variant_id": str(self.variant.id),
                    "quantity": 1,
                    "unit_price": "12000.00",
                    "discount_amount": "0.00",
                }
            ],
            "payments": [{"amount": "10000.00", "method": "cash"}],
            "cart_discount": "2000.00",
            "manager_pin": "1234",  # Even with manager PIN, hard limit is enforced
        }
        res = self.client.post("/api/v1/sales/", payload, format="json")
        self.assertEqual(res.status_code, 400)
        details = res.data.get("error", {}).get("details", res.data)
        self.assertIn("cart_discount", details)

    def test_on_account_payment_requires_client_and_validates_credit_limit(self):
        """Paying with method='account' must require client and enforce credit limits (Task 2.5)."""
        client = Client.objects.create(
            tenant=self.tenant,
            name="Credited Customer",
            phone="0550998877",
            credit_limit=Decimal("5000.00"),
        )
        self.client.force_authenticate(user=self.cashier)

        # 1. On-account payment without client -> 400
        res_no_client = self.client.post(
            "/api/v1/sales/",
            {
                "items": [
                    {
                        "variant_id": str(self.variant.id),
                        "quantity": 1,
                        "unit_price": "12000.00",
                        "discount_amount": "0.00",
                    }
                ],
                "payments": [{"amount": "12000.00", "method": "account"}],
            },
            format="json",
        )
        self.assertEqual(res_no_client.status_code, 400)
        details = res_no_client.data.get("error", {}).get("details", res_no_client.data)
        self.assertIn("client_id", details)

        # 2. On-account payment exceeding credit limit without PIN -> 400
        res_exceed = self.client.post(
            "/api/v1/sales/",
            {
                "client_id": str(client.id),
                "items": [
                    {
                        "variant_id": str(self.variant.id),
                        "quantity": 1,
                        "unit_price": "12000.00",
                        "discount_amount": "0.00",
                    }
                ],
                "payments": [{"amount": "12000.00", "method": "account"}],
            },
            format="json",
        )
        self.assertEqual(res_exceed.status_code, 400)
        details_exceed = res_exceed.data.get("error", {}).get("details", res_exceed.data)
        self.assertIn("credit_limit", details_exceed)

        # 3. On-account payment with manager PIN -> 201 & creates ClientLedger debit
        res_ok = self.client.post(
            "/api/v1/sales/",
            {
                "client_id": str(client.id),
                "items": [
                    {
                        "variant_id": str(self.variant.id),
                        "quantity": 1,
                        "unit_price": "12000.00",
                        "discount_amount": "0.00",
                    }
                ],
                "payments": [{"amount": "12000.00", "method": "account"}],
                "manager_pin": "1234",
            },
            format="json",
        )
        self.assertEqual(res_ok.status_code, 201)
        created_sale = Sale.objects.get(pk=res_ok.data["id"])

        # Check ClientLedger debit entry
        debit = ClientLedger.objects.filter(
            client=client, reference_type="Sale", reference_id=str(created_sale.pk)
        ).first()
        self.assertIsNotNone(debit)
        self.assertEqual(debit.entry_type, "debit")
        self.assertEqual(debit.amount, Decimal("12000.00"))
        client.refresh_from_db()
        self.assertEqual(client.cached_balance, Decimal("12000.00"))

    def test_return_of_on_account_sale_creates_ledger_reversal(self):
        """Returning an on-account sale creates a reversing credit in ClientLedger (Task 2.5)."""
        client = Client.objects.create(
            tenant=self.tenant,
            name="Return Account Customer",
            phone="0550112233",
            credit_limit=Decimal("20000.00"),
        )
        # Create sale directly with client debit
        sale = Sale.objects.create(
            tenant=self.tenant,
            cashier=self.cashier,
            client=client,
            total_amount=Decimal("12000.00"),
            status="completed",
            receipt_number="TICK-ACCT-01",
        )
        SaleItem.objects.create(
            sale=sale,
            variant=self.variant,
            quantity=1,
            unit_price=Decimal("12000.00"),
        )
        Payment.objects.create(
            sale=sale,
            amount=Decimal("12000.00"),
            method=PaymentMethodChoices.ACCOUNT,
        )
        ClientLedger.objects.create(
            client=client,
            entry_type="debit",
            amount=Decimal("12000.00"),
            description=f"Solde sur vente {sale.receipt_number}",
            reference_type="Sale",
            reference_id=str(sale.pk),
            date=sale.created_at.date(),
        )
        client.refresh_from_db()
        self.assertEqual(client.cached_balance, Decimal("12000.00"))

        # Process return with manager PIN
        self.client.force_authenticate(user=self.cashier)
        res_ret = self.client.post(
            f"/api/v1/sales/{sale.id}/returns/",
            {
                "items": [{"variant_id": str(self.variant.id), "quantity": 1, "restock": True}],
                "reason": "Défaut d'aspect",
                "refund_amount": "12000.00",
                "refund_method": "account",
                "manager_pin": "1234",
            },
            format="json",
        )
        self.assertEqual(res_ret.status_code, 201)

        # Verify ClientLedger credit reversal was written
        credit_entry = ClientLedger.objects.filter(
            client=client,
            reference_type="Sale",
            reference_id=str(sale.pk),
            entry_type="credit",
        ).first()
        self.assertIsNotNone(credit_entry)
        self.assertEqual(credit_entry.amount, Decimal("12000.00"))

        client.refresh_from_db()
        self.assertEqual(client.cached_balance, Decimal("0.00"))


