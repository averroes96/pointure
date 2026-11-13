"""
backend/apps/clients/tests/test_client_risk.py

Tests for Task 7.8:
- Client risk scoring engine (Grades A, B, C, D)
- Bounced cheques and overdue thresholds
- Bulk risk calculation without N+1
- Blocked client enforcement at POS (cash allowed, credit blocked)
- Blocked client invoice creation rejection
- RBAC permissions on is_blocked (manager/owner only, cashier denied)
"""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.clients.models import Cheque, ChequeDirectionChoices, ChequeStatusChoices, Client, ClientLedger, LedgerEntryTypeChoices
from apps.clients.services.risk import (
    GRADE_A,
    GRADE_B,
    GRADE_C,
    GRADE_D,
    bulk_client_risk,
    client_risk,
)
from apps.clients.serializers import ClientSerializer
from apps.core.models import Branch, Tenant, User
from apps.invoicing.models import Invoice, InvoiceLine, InvoicePayment, InvoiceStatusChoices
from apps.inventory.models import Product, Variant


class ClientRiskScoringTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name="Risk Tenant")
        self.branch = Branch.objects.create(tenant=self.tenant, name="Siège", is_headquarters=True)
        self.today = timezone.localdate()

    def _create_invoice(self, client, date, due_date, amount, status=InvoiceStatusChoices.SENT):
        inv = Invoice.objects.create(
            tenant=self.tenant,
            client=client,
            branch=self.branch,
            date=date,
            due_date=due_date,
            apply_tva=False,
            status=status,
        )
        InvoiceLine.objects.create(
            invoice=inv,
            description="Chaussure Test",
            quantity=1,
            unit_price=amount,
        )
        inv.save()
        return inv

    def test_grade_a_prompt_settlement_or_no_overdue(self):
        """A client with no overdue debt and fast payments receives Grade A."""
        client = Client.objects.create(
            tenant=self.tenant,
            name="Client Alpha",
            cached_balance=Decimal("0.00"),
        )
        inv = self._create_invoice(
            client=client,
            date=self.today - timedelta(days=20),
            due_date=self.today + timedelta(days=10),
            amount=Decimal("10000.00"),
        )
        # Settled 10 days after issuance
        InvoicePayment.objects.create(
            invoice=inv,
            amount=Decimal("10000.00"),
            method="cash",
            date=self.today - timedelta(days=10),
        )

        risk = client_risk(client, today=self.today)
        self.assertEqual(risk["grade"], GRADE_A)
        self.assertEqual(risk["avg_days_to_pay"], 10.0)
        self.assertEqual(risk["overdue_amount"], Decimal("0.00"))
        self.assertEqual(risk["bounced_cheques_12m"], 0)
        self.assertEqual(risk["last_payment_date"], self.today - timedelta(days=10))

    def test_grade_b_average_delay_above_30_days(self):
        """A client whose average invoice settlement takes > 30 days (and <= 60) receives Grade B."""
        client = Client.objects.create(
            tenant=self.tenant,
            name="Client Beta",
            cached_balance=Decimal("0.00"),
        )
        inv = self._create_invoice(
            client=client,
            date=self.today - timedelta(days=50),
            due_date=self.today - timedelta(days=20),
            amount=Decimal("15000.00"),
        )
        # Settled 40 days after issuance
        InvoicePayment.objects.create(
            invoice=inv,
            amount=Decimal("15000.00"),
            method="virement",
            date=self.today - timedelta(days=10),
        )

        risk = client_risk(client, today=self.today)
        self.assertEqual(risk["grade"], GRADE_B)
        self.assertEqual(risk["avg_days_to_pay"], 40.0)
        self.assertEqual(risk["overdue_amount"], Decimal("0.00"))

    def test_grade_b_overdue_31_to_60_days(self):
        """A client with open debt in the 31-60 days bucket receives Grade B."""
        client = Client.objects.create(
            tenant=self.tenant,
            name="Client Beta Debt",
            cached_balance=Decimal("5000.00"),
        )
        self._create_invoice(
            client=client,
            date=self.today - timedelta(days=75),
            due_date=self.today - timedelta(days=45),
            amount=Decimal("5000.00"),
            status=InvoiceStatusChoices.SENT,
        )

        risk = client_risk(client, today=self.today)
        self.assertEqual(risk["grade"], GRADE_B)
        self.assertEqual(risk["overdue_amount"], Decimal("5000.00"))

    def test_invoice_not_past_due_is_not_aged_from_invoice_date(self):
        client = Client.objects.create(
            tenant=self.tenant,
            name="Client Not Yet Due",
            cached_balance=Decimal("5000.00"),
        )
        self._create_invoice(
            client=client,
            date=self.today - timedelta(days=45),
            due_date=self.today + timedelta(days=10),
            amount=Decimal("5000.00"),
            status=InvoiceStatusChoices.SENT,
        )

        risk = client_risk(client, today=self.today)

        self.assertEqual(risk["grade"], GRADE_A)
        self.assertEqual(risk["overdue_amount"], Decimal("0.00"))
        self.assertEqual(risk["buckets"]["current"], Decimal("5000.00"))

    def test_grade_c_average_delay_above_60_days(self):
        """A client whose average invoice settlement exceeds 60 days receives Grade C."""
        client = Client.objects.create(
            tenant=self.tenant,
            name="Client Gamma",
            cached_balance=Decimal("0.00"),
        )
        inv = self._create_invoice(
            client=client,
            date=self.today - timedelta(days=90),
            due_date=self.today - timedelta(days=60),
            amount=Decimal("20000.00"),
        )
        # Settled 75 days after issuance
        InvoicePayment.objects.create(
            invoice=inv,
            amount=Decimal("20000.00"),
            method="virement",
            date=self.today - timedelta(days=15),
        )

        risk = client_risk(client, today=self.today)
        self.assertEqual(risk["grade"], GRADE_C)
        self.assertEqual(risk["avg_days_to_pay"], 75.0)

    def test_grade_c_overdue_61_to_90_days(self):
        """A client with unpaid debt 61-90 days old receives Grade C."""
        client = Client.objects.create(
            tenant=self.tenant,
            name="Client Gamma Debt",
            cached_balance=Decimal("8000.00"),
        )
        self._create_invoice(
            client=client,
            date=self.today - timedelta(days=105),
            due_date=self.today - timedelta(days=75),
            amount=Decimal("8000.00"),
            status=InvoiceStatusChoices.SENT,
        )

        risk = client_risk(client, today=self.today)
        self.assertEqual(risk["grade"], GRADE_C)
        self.assertEqual(risk["overdue_amount"], Decimal("8000.00"))

    def test_grade_d_bounced_cheque_in_last_12m(self):
        """A client with any bounced cheque in the last 12 months gets Grade D immediately."""
        client = Client.objects.create(
            tenant=self.tenant,
            name="Client Delta Cheque",
            cached_balance=Decimal("0.00"),
        )
        Cheque.objects.create(
            tenant=self.tenant,
            client=client,
            direction=ChequeDirectionChoices.RECEIVABLE,
            number="CHQ-9988",
            amount=Decimal("30000.00"),
            due_date=self.today - timedelta(days=60),
            status=ChequeStatusChoices.BOUNCED,
        )

        risk = client_risk(client, today=self.today)
        self.assertEqual(risk["grade"], GRADE_D)
        self.assertEqual(risk["bounced_cheques_12m"], 1)

    def test_grade_d_overdue_above_90_days(self):
        """A client with debt older than 90 days gets Grade D."""
        client = Client.objects.create(
            tenant=self.tenant,
            name="Client Delta 90Plus",
            cached_balance=Decimal("12000.00"),
        )
        self._create_invoice(
            client=client,
            date=self.today - timedelta(days=121),
            due_date=self.today - timedelta(days=91),
            amount=Decimal("12000.00"),
            status=InvoiceStatusChoices.SENT,
        )

        risk = client_risk(client, today=self.today)
        self.assertEqual(risk["grade"], GRADE_D)
        self.assertEqual(risk["overdue_amount"], Decimal("12000.00"))

    def test_bulk_client_risk_consistency(self):
        """bulk_client_risk produces the exact same results as individual client_risk calls."""
        c1 = Client.objects.create(tenant=self.tenant, name="C1", cached_balance=Decimal("0.00"))
        c2 = Client.objects.create(tenant=self.tenant, name="C2", cached_balance=Decimal("5000.00"))
        self._create_invoice(
            client=c2,
            date=self.today - timedelta(days=45),
            due_date=self.today,
            amount=Decimal("5000.00"),
            status=InvoiceStatusChoices.SENT,
        )

        bulk_res = bulk_client_risk([c1, c2], today=self.today)
        res1 = client_risk(c1, today=self.today)
        res2 = client_risk(c2, today=self.today)

        self.assertEqual(bulk_res[c1.id]["grade"], res1["grade"])
        self.assertEqual(bulk_res[c2.id]["grade"], res2["grade"])

    def test_serializer_calculates_risk_once_for_grade_and_details(self):
        client = Client.objects.create(
            tenant=self.tenant,
            name="Client Cached Risk",
            cached_balance=Decimal("0.00"),
        )
        serializer = ClientSerializer(context={})

        with patch(
            "apps.clients.services.risk.client_risk", wraps=client_risk
        ) as calculate_risk:
            grade = serializer.get_risk_grade(client)
            details = serializer.get_risk_details(client)

        self.assertEqual(calculate_risk.call_count, 1)
        self.assertEqual(grade, details["grade"])


class BlockedClientEnforcementTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name="Blocked Tenant", plan="pro_wholesale")
        self.branch = Branch.objects.create(tenant=self.tenant, name="Agence 1")
        self.owner = User.objects.create_user(
            phone="0555000001", password="password", tenant=self.tenant, role="owner", first_name="Owner"
        )
        self.cashier = User.objects.create_user(
            phone="0555000002", password="password", tenant=self.tenant, role="cashier", first_name="Cashier"
        )
        self.blocked_client = Client.objects.create(
            tenant=self.tenant,
            name="Blocked Client",
            is_blocked=True,
            credit_limit=Decimal("50000.00"),
            cached_balance=Decimal("0.00"),
        )
        self.product = Product.objects.create(
            tenant=self.tenant, name="Chaussure Sport", brand="Nike", sale_price=Decimal("4000.00")
        )
        self.variant = Variant.objects.create(
            tenant=self.tenant, product=self.product, size_eu=42
        )
        from apps.inventory.models import StockMovement
        StockMovement.objects.create(
            tenant=self.tenant, branch=self.branch, variant=self.variant,
            reason="purchase", quantity_delta=50, reference_type="test", reference_id="TEST-01"
        )

        self.client_api = APIClient()

    def test_blocked_client_credit_sale_rejected_at_pos(self):
        """A blocked client cannot buy on credit/on-account at the POS."""
        self.client_api.force_authenticate(user=self.cashier)
        payload = {
            "branch_id": str(self.branch.id),
            "client_id": str(self.blocked_client.id),
            "items": [
                {
                    "variant_id": str(self.variant.id),
                    "quantity": 1,
                    "unit_price": "4000.00",
                    "discount_amount": "0.00",
                }
            ],
            # Underpayment: paid 1000 out of 4000 -> credit/on-account
            "payments": [
                {"method": "cash", "amount": "1000.00"}
            ],
        }
        resp = self.client_api.post("/api/v1/sales/", payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("client_id", str(resp.data))

    def test_blocked_client_versement_rejected_at_pos(self):
        """A blocked client cannot make an installment / versement sale at POS."""
        self.client_api.force_authenticate(user=self.cashier)
        payload = {
            "branch_id": str(self.branch.id),
            "client_id": str(self.blocked_client.id),
            "is_versement": True,
            "items": [
                {
                    "variant_id": str(self.variant.id),
                    "quantity": 1,
                    "unit_price": "4000.00",
                    "discount_amount": "0.00",
                }
            ],
            "payments": [
                {"method": "cash", "amount": "2000.00"}
            ],
        }
        resp = self.client_api.post("/api/v1/sales/", payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("client_id", str(resp.data))

    def test_blocked_client_cash_full_payment_allowed_at_pos(self):
        """A blocked client CAN buy if they pay in full in cash."""
        self.client_api.force_authenticate(user=self.cashier)
        payload = {
            "branch_id": str(self.branch.id),
            "client_id": str(self.blocked_client.id),
            "items": [
                {
                    "variant_id": str(self.variant.id),
                    "quantity": 1,
                    "unit_price": "4000.00",
                    "discount_amount": "0.00",
                }
            ],
            "payments": [
                {"method": "cash", "amount": "4000.00"}
            ],
        }
        resp = self.client_api.post("/api/v1/sales/", payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_blocked_client_invoice_creation_rejected(self):
        """Creating an invoice for a blocked client is rejected with 400 ValidationError."""
        self.client_api.force_authenticate(user=self.owner)
        today = timezone.localdate()
        payload = {
            "client_id": str(self.blocked_client.id),
            "branch_id": str(self.branch.id),
            "date": str(today),
            "due_date": str(today + timedelta(days=30)),
            "series_prefix": "FA",
            "apply_tva": False,
            "tva_rate": "0.00",
            "lines": [
                {
                    "description": "Chaussure Sport",
                    "variant": str(self.variant.id),
                    "quantity": 2,
                    "unit_price": "4000.00",
                    "discount_pct": "0.00",
                }
            ],
        }
        resp = self.client_api.post("/api/v1/invoicing/invoices/", payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("client_id", str(resp.data))

    def test_cashier_cannot_modify_is_blocked(self):
        """Cashiers are forbidden from blocking or unblocking a client."""
        self.client_api.force_authenticate(user=self.cashier)
        # Attempt PATCH
        resp = self.client_api.patch(
            f"/api/v1/clients/{self.blocked_client.id}/",
            {"is_blocked": False},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

        # Attempt toggle-block endpoint
        resp_toggle = self.client_api.post(
            f"/api/v1/clients/{self.blocked_client.id}/toggle-block/"
        )
        self.assertEqual(resp_toggle.status_code, status.HTTP_403_FORBIDDEN)

    def test_owner_can_toggle_is_blocked(self):
        """Owner can toggle client blocked status."""
        self.client_api.force_authenticate(user=self.owner)
        resp = self.client_api.post(
            f"/api/v1/clients/{self.blocked_client.id}/toggle-block/"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(resp.data["is_blocked"])
        self.blocked_client.refresh_from_db()
        self.assertFalse(self.blocked_client.is_blocked)

    def test_cashier_cannot_set_wholesale_price_tier_or_client_type(self):
        """Cashiers cannot grant wholesale pricing (gros, demi_gros) or wholesale client_type."""
        self.client_api.force_authenticate(user=self.cashier)

        # 1. Attempt create client with price_tier="gros" -> 403
        resp = self.client_api.post(
            "/api/v1/clients/",
            {"name": "Client Wholesale Test", "price_tier": "gros", "phone": "0555123456"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

        # 2. Attempt create client with client_type="wholesale" -> 403
        resp = self.client_api.post(
            "/api/v1/clients/",
            {"name": "Client Wholesale Test 2", "client_type": "wholesale", "phone": "0555123457"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

        # 3. Create retail client with default/detail tier -> 201
        resp = self.client_api.post(
            "/api/v1/clients/",
            {"name": "Retail Client", "price_tier": "detail", "client_type": "retail", "phone": "0555123458"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        client_id = resp.data["id"]

        # 4. Attempt to update retail client to price_tier="demi_gros" -> 403
        resp = self.client_api.patch(
            f"/api/v1/clients/{client_id}/",
            {"price_tier": "demi_gros"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

        # 5. Attempt to update retail client to client_type="wholesale" -> 403
        resp = self.client_api.patch(
            f"/api/v1/clients/{client_id}/",
            {"client_type": "wholesale"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_owner_can_set_wholesale_price_tier_and_client_type(self):
        """Owners can create and update clients with wholesale pricing tiers."""
        self.client_api.force_authenticate(user=self.owner)

        resp = self.client_api.post(
            "/api/v1/clients/",
            {"name": "Grossiste Client", "price_tier": "gros", "client_type": "wholesale", "phone": "0555999888"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        client_id = resp.data["id"]

        resp = self.client_api.patch(
            f"/api/v1/clients/{client_id}/",
            {"price_tier": "demi_gros"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["price_tier"], "demi_gros")
