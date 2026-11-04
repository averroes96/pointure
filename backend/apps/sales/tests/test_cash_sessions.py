from decimal import Decimal
from django.test import TestCase
from django.utils import timezone
from apps.core.models import Branch, RoleChoices, Tenant, User
from apps.sales.models import (
    CashMovement, CashMovementType, CashSession, CashSessionStatus,
    Payment, PaymentMethodChoices, Return, Sale,
)
from apps.sales.services.z_report import compute_session_stats, render_thermal_z_report


class CashSessionTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name="Algeria Shoes Test")
        self.branch = Branch.objects.create(name="Alger Centre", tenant=self.tenant)
        self.cashier = User.objects.create_user(
            email="amine@shoedz.dz",
            password="password123",
            role=RoleChoices.CASHIER,
            tenant=self.tenant,
            first_name="Amine",
            last_name="Benali",
        )

    def test_open_session_and_session_number(self):
        s1 = CashSession.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            cashier=self.cashier,
            opening_float=Decimal("5000.00"),
            status=CashSessionStatus.OPEN,
        )
        self.assertEqual(s1.session_number, 1)

        s2 = CashSession.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            cashier=self.cashier,
            opening_float=Decimal("2000.00"),
            status=CashSessionStatus.OPEN,
        )
        self.assertEqual(s2.session_number, 2)

    def test_cash_movement_and_stats_calculation(self):
        session = CashSession.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            cashier=self.cashier,
            opening_float=Decimal("5000.00"),
            status=CashSessionStatus.OPEN,
        )

        # Record a sale linked to session
        sale1 = Sale.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            session=session,
            cashier=self.cashier,
            total_amount=Decimal("12000.00"),
            status="completed",
            receipt_number="RC-20261019-0001",
        )
        # Cash payment
        Payment.objects.create(
            sale=sale1,
            session=session,
            amount=Decimal("10000.00"),
            method=PaymentMethodChoices.CASH,
        )
        # TPE payment
        Payment.objects.create(
            sale=sale1,
            session=session,
            amount=Decimal("2000.00"),
            method=PaymentMethodChoices.TPE,
        )

        # Petty cash movement: out (Dépense magasin)
        CashMovement.objects.create(
            session=session,
            type=CashMovementType.OUT,
            amount=Decimal("500.00"),
            category="Dépense magasin",
            created_by=self.cashier,
        )

        # Petty cash movement: in (Apport monnaie)
        CashMovement.objects.create(
            session=session,
            type=CashMovementType.IN,
            amount=Decimal("1000.00"),
            category="Apport monnaie",
            created_by=self.cashier,
        )

        stats = compute_session_stats(session)
        self.assertEqual(stats["sales_count"], 1)
        self.assertEqual(stats["cash_sales"], Decimal("10000.00"))
        self.assertEqual(stats["tpe_sales"], Decimal("2000.00"))
        self.assertEqual(stats["total_cash_in"], Decimal("1000.00"))
        self.assertEqual(stats["total_cash_out"], Decimal("500.00"))

        # Expected cash: opening (5000) + cash_sales (10000) + cash_in (1000) - cash_out (500) = 15500
        self.assertEqual(stats["expected_cash"], Decimal("15500.00"))

        # Thermal rendering
        html = render_thermal_z_report(session, is_x_report=False, stats=stats, store_name="Algeria Shoes Test")
        self.assertIn("RAPPORT Z", html)
        self.assertIn("Z-0001", html)
        self.assertIn("15 500,00", html)
        self.assertIn("CIB / Edahabia", html)

    def test_installment_recorded_in_later_session_z_report(self):
        """A sale in session A with a later installment in session B counts the installment in B, not A."""
        from rest_framework.test import APIClient
        from apps.clients.models import Client
        from apps.inventory.models import Product, StockMovement, Variant

        client_obj = Client.objects.create(
            tenant=self.tenant,
            name="Client Versement",
            phone="0555998877",
        )
        product = Product.objects.create(
            tenant=self.tenant,
            name="Shoe",
            brand="Brand",
            sale_price="8000.00",
            purchase_price="5000.00",
        )
        variant = Variant.objects.create(
            tenant=self.tenant,
            product=product,
            size_eu=42,
            colour="Noir",
        )
        StockMovement.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            variant=variant,
            quantity_delta=5,
            reason="initial",
            user=self.cashier,
        )

        session_a = CashSession.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            cashier=self.cashier,
            opening_float=Decimal("1000.00"),
            status=CashSessionStatus.OPEN,
        )

        api = APIClient()
        api.force_authenticate(user=self.cashier)

        # Create partially_paid sale in session A with 3000 DZD deposit
        resp = api.post(
            "/api/v1/sales/",
            {
                "client_id": str(client_obj.pk),
                "branch_id": str(self.branch.pk),
                "is_versement": True,
                "items": [{"variant_id": str(variant.pk), "quantity": 1, "unit_price": "8000.00"}],
                "payments": [{"method": "cash", "amount": "3000.00"}],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        sale_id = resp.data["id"]

        # Close session A
        close_resp = api.post(
            f"/api/v1/sales/sessions/{session_a.pk}/close/",
            {"actual_cash": "4000.00"},
            format="json",
        )
        self.assertEqual(close_resp.status_code, 200, close_resp.data)
        session_a.refresh_from_db()
        self.assertEqual(session_a.system_cash_sales, Decimal("3000.00"))

        # Open session B
        session_b = CashSession.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            cashier=self.cashier,
            opening_float=Decimal("2000.00"),
            status=CashSessionStatus.OPEN,
        )

        # Add 5000 DZD installment in session B
        pay_resp = api.post(
            f"/api/v1/sales/{sale_id}/add-payment/",
            {"amount": "5000.00", "method": "cash"},
            format="json",
        )
        self.assertEqual(pay_resp.status_code, 200, pay_resp.data)

        stats_a = compute_session_stats(session_a)
        stats_b = compute_session_stats(session_b)

        # Session A only has the initial 3000 DZD deposit
        self.assertEqual(stats_a["sales_count"], 1)
        self.assertEqual(stats_a["cash_sales"], Decimal("3000.00"))
        session_a.refresh_from_db()
        self.assertEqual(session_a.system_cash_sales, Decimal("3000.00"))

        # Session B has the 5000 DZD installment and 0 new sales
        self.assertEqual(stats_b["sales_count"], 0)
        self.assertEqual(stats_b["cash_sales"], Decimal("5000.00"))
        self.assertEqual(stats_b["expected_cash"], Decimal("7000.00"))  # 2000 float + 5000 installment

