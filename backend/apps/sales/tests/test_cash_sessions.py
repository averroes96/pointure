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

    def test_cash_session_rbac_and_readonly_fields(self):
        from rest_framework.test import APIClient

        manager = User.objects.create_user(
            email="mgr-sess@shoedz.dz",
            password="password123",
            role=RoleChoices.MANAGER,
            tenant=self.tenant,
        )
        owner = User.objects.create_user(
            email="owner-sess@shoedz.dz",
            password="password123",
            role=RoleChoices.OWNER,
            tenant=self.tenant,
        )

        session = CashSession.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            cashier=self.cashier,
            opening_float=Decimal("1000.00"),
            status=CashSessionStatus.OPEN,
        )

        api = APIClient()

        # Cashier gets 403 on PATCH, PUT, DELETE
        api.force_authenticate(user=self.cashier)
        self.assertEqual(
            api.patch(
                f"/api/v1/sales/sessions/{session.pk}/",
                {"closing_notes": "Cashier edit"},
                format="json",
            ).status_code,
            403,
        )
        self.assertEqual(
            api.put(
                f"/api/v1/sales/sessions/{session.pk}/",
                {"cashier": str(self.cashier.pk), "opening_float": "1000.00"},
                format="json",
            ).status_code,
            403,
        )
        self.assertEqual(
            api.delete(f"/api/v1/sales/sessions/{session.pk}/").status_code,
            403,
        )

        # Manager gets 403 on DELETE
        api.force_authenticate(user=manager)
        self.assertEqual(
            api.delete(f"/api/v1/sales/sessions/{session.pk}/").status_code,
            403,
        )

        # Manager PATCH ignores read-only fields (status, actual_cash, cash_gap, system_*)
        patch_resp = api.patch(
            f"/api/v1/sales/sessions/{session.pk}/",
            {
                "status": "closed",
                "actual_cash": "99999.00",
                "cash_gap": "88888.00",
                "system_cash_sales": "77777.00",
                "closing_notes": "Manager note",
            },
            format="json",
        )
        self.assertEqual(patch_resp.status_code, 200, patch_resp.data)
        session.refresh_from_db()
        self.assertEqual(session.status, CashSessionStatus.OPEN)
        self.assertEqual(session.actual_cash, Decimal("0.00"))
        self.assertEqual(session.cash_gap, Decimal("0.00"))
        self.assertEqual(session.system_cash_sales, Decimal("0.00"))
        self.assertEqual(session.closing_notes, "Manager note")

        # Owner cannot DELETE a session that has sales (400)
        sale = Sale.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            session=session,
            cashier=self.cashier,
            total_amount=Decimal("2000.00"),
            status="completed",
            receipt_number="RC-SESS-DEL-1",
        )
        api.force_authenticate(user=owner)
        del_with_sale = api.delete(f"/api/v1/sales/sessions/{session.pk}/")
        self.assertEqual(del_with_sale.status_code, 400)
        self.assertTrue(CashSession.objects.filter(pk=session.pk).exists())

        # Owner can DELETE a session with no sales (204)
        sale.delete()
        del_empty = api.delete(f"/api/v1/sales/sessions/{session.pk}/")
        self.assertEqual(del_empty.status_code, 204)
        self.assertFalse(CashSession.objects.filter(pk=session.pk).exists())

    def test_cash_session_close_restricted_to_session_cashier_or_manager(self):
        from rest_framework.test import APIClient

        other_cashier = User.objects.create_user(
            email="other-cashier@shoedz.dz",
            password="password123",
            role=RoleChoices.CASHIER,
            tenant=self.tenant,
        )

        session = CashSession.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            cashier=self.cashier,
            opening_float=Decimal("1000.00"),
            status=CashSessionStatus.OPEN,
        )

        api = APIClient()

        # Another cashier gets 403 when trying to close this session
        api.force_authenticate(user=other_cashier)
        res_other = api.post(
            f"/api/v1/sales/sessions/{session.pk}/close/",
            {"actual_cash": "1000.00"},
            format="json",
        )
        self.assertEqual(res_other.status_code, 403)
        session.refresh_from_db()
        self.assertEqual(session.status, CashSessionStatus.OPEN)

        # Session's own cashier can close it (200)
        api.force_authenticate(user=self.cashier)
        res_own = api.post(
            f"/api/v1/sales/sessions/{session.pk}/close/",
            {"actual_cash": "1000.00"},
            format="json",
        )
        self.assertEqual(res_own.status_code, 200)
        session.refresh_from_db()
        self.assertEqual(session.status, CashSessionStatus.CLOSED)

    def test_cashier_cannot_create_cash_session_for_another_cashier(self):
        from rest_framework.test import APIClient

        other_cashier = User.objects.create_user(
            email="other-sess-cashier@shoedz.dz",
            password="password123",
            role=RoleChoices.CASHIER,
            tenant=self.tenant,
        )

        api = APIClient()
        api.force_authenticate(user=self.cashier)

        # Cashier tries to create a session for another cashier -> 403 PermissionDenied
        res = api.post(
            "/api/v1/sales/sessions/",
            {
                "cashier": str(other_cashier.pk),
                "opening_float": "15000.00",
                "branch": str(self.branch.pk),
            },
            format="json",
        )
        self.assertEqual(res.status_code, 403)
        self.assertFalse(CashSession.objects.filter(cashier=other_cashier).exists())

    def test_cashier_can_create_cash_session_for_themselves(self):
        from rest_framework.test import APIClient

        api = APIClient()
        api.force_authenticate(user=self.cashier)

        # Cashier creates a session for themselves -> 201 Created
        res = api.post(
            "/api/v1/sales/sessions/",
            {
                "cashier": str(self.cashier.pk),
                "opening_float": "3000.00",
                "branch": str(self.branch.pk),
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        session = CashSession.objects.get(pk=res.data["id"])
        self.assertEqual(session.cashier, self.cashier)
        self.assertEqual(session.opening_float, Decimal("3000.00"))
        self.assertEqual(session.status, CashSessionStatus.OPEN)

        # Attempting to open a second concurrent session fails -> 400 Bad Request
        res_dup = api.post(
            "/api/v1/sales/sessions/",
            {
                "opening_float": "5000.00",
                "branch": str(self.branch.pk),
            },
            format="json",
        )
        self.assertEqual(res_dup.status_code, 400)

    def test_manager_can_create_cash_session_for_another_cashier(self):
        from rest_framework.test import APIClient

        manager = User.objects.create_user(
            email="mgr-opener@shoedz.dz",
            password="password123",
            role=RoleChoices.MANAGER,
            tenant=self.tenant,
        )
        target_cashier = User.objects.create_user(
            email="target-cashier@shoedz.dz",
            password="password123",
            role=RoleChoices.CASHIER,
            tenant=self.tenant,
        )

        api = APIClient()
        api.force_authenticate(user=manager)

        res = api.post(
            "/api/v1/sales/sessions/",
            {
                "cashier": str(target_cashier.pk),
                "opening_float": "4500.00",
                "branch": str(self.branch.pk),
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        session = CashSession.objects.get(pk=res.data["id"])
        self.assertEqual(session.cashier, target_cashier)
        self.assertEqual(session.opening_float, Decimal("4500.00"))



