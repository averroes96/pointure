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
            amount=Decimal("10000.00"),
            method=PaymentMethodChoices.CASH,
        )
        # TPE payment
        Payment.objects.create(
            sale=sale1,
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
