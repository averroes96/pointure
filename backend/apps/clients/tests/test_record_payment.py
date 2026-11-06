"""
Tests for Task 1.1:
- ClientViewSet.record_payment credits the client ledger exactly once per real payment
  (whether allocated across two invoices, partially allocated, or unallocated).
- audit_client_ledger management command detects legacy overlapping credits without mutating data.
"""
import datetime
from decimal import Decimal
from io import StringIO

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient


def _today():
    return str(datetime.date.today())


def _due():
    return str(datetime.date.today() + datetime.timedelta(days=30))


def _make_api_client(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user=user)
    return c


@pytest.mark.django_db
class TestClientRecordPaymentLedger:
    """Verify ClientViewSet.record_payment never double-credits ClientLedger."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.clients.models import Client
        from apps.core.models import PlanChoices, RoleChoices, Tenant, User

        self.tenant = Tenant.objects.create(
            name="Ledger Shop", plan=PlanChoices.PRO_WHOLESALE
        )
        self.manager = User.objects.create_user(
            email="mgr@ledgershop.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.client_obj = Client.objects.create(
            tenant=self.tenant,
            name="Grossiste Alger",
            phone="0551112233",
            credit_limit=Decimal("500000.00"),
        )

    def _create_confirmed_invoice(self, amount: Decimal, number: str):
        from apps.invoicing.models import Invoice, InvoiceLine, InvoiceStatusChoices

        inv = Invoice.objects.create(
            tenant=self.tenant,
            client=self.client_obj,
            number=number,
            date=datetime.date.today(),
            due_date=datetime.date.today() + datetime.timedelta(days=30),
            status=InvoiceStatusChoices.SENT,
            apply_tva=False,
            tva_rate=Decimal("0.00"),
        )
        InvoiceLine.objects.create(
            invoice=inv,
            description="Lot chaussures",
            quantity=Decimal("1"),
            unit_price=amount,
            discount_pct=Decimal("0.00"),
            order=0,
        )
        # Save triggers total calculation and _sync_client_ledger debit
        inv.save()
        return inv

    def test_payment_allocated_across_two_invoices_reduces_balance_once(self):
        """
        Two open invoices of 5,000 DZD each → cached_balance = 10,000 DZD.
        A payment of 8,000 DZD allocated across both invoices must reduce
        cached_balance by exactly 8,000 DZD (to 2,000 DZD), not 16,000 DZD.
        """
        inv1 = self._create_confirmed_invoice(Decimal("5000.00"), "FA-2026-00001")
        inv2 = self._create_confirmed_invoice(Decimal("5000.00"), "FA-2026-00002")

        self.client_obj.refresh_from_db()
        assert self.client_obj.cached_balance == Decimal("10000.00")

        api = _make_api_client(self.manager)
        resp = api.post(
            f"/api/v1/clients/{self.client_obj.pk}/record-payment/",
            {
                "amount": "8000.00",
                "method": "cash",
                "date": _today(),
                "notes": "Versement espèces",
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data

        self.client_obj.refresh_from_db()
        inv1.refresh_from_db()
        inv2.refresh_from_db()

        assert inv1.status == "paid"
        assert inv2.status == "partial"
        assert inv2.balance_due == Decimal("2000.00")
        assert self.client_obj.cached_balance == Decimal("2000.00")

    def test_partially_allocated_payment_reduces_balance_once(self):
        """
        One open invoice of 5,000 DZD → cached_balance = 5,000 DZD.
        A payment of 8,000 DZD (5,000 allocated to the invoice + 3,000 unallocated remainder)
        must reduce cached_balance by exactly 8,000 DZD (to -3,000 DZD).
        """
        inv1 = self._create_confirmed_invoice(Decimal("5000.00"), "FA-2026-00003")

        self.client_obj.refresh_from_db()
        assert self.client_obj.cached_balance == Decimal("5000.00")

        api = _make_api_client(self.manager)
        resp = api.post(
            f"/api/v1/clients/{self.client_obj.pk}/record-payment/",
            {
                "amount": "8000.00",
                "method": "virement",
                "date": _today(),
                "notes": "Virement avec acompte",
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data

        self.client_obj.refresh_from_db()
        inv1.refresh_from_db()

        assert inv1.status == "paid"
        assert self.client_obj.cached_balance == Decimal("-3000.00")

        credits = list(
            self.client_obj.ledger_entries.filter(entry_type="credit").order_by("amount")
        )
        assert len(credits) == 2
        assert [c.amount for c in credits] == [Decimal("3000.00"), Decimal("5000.00")]
        assert {c.reference_type for c in credits} == {"Payment", "InvoicePayment"}

    def test_audit_client_ledger_command_detects_overlap_and_is_read_only(self):
        """
        Simulate a legacy double-credited client ledger and verify audit_client_ledger
        reports the overlap without modifying the database.
        """
        from apps.clients.models import ClientLedger

        today = datetime.date.today()
        ClientLedger.objects.create(
            client=self.client_obj,
            entry_type="debit",
            amount=Decimal("10000.00"),
            description="Facture FA-2026-00010",
            reference_type="Invoice",
            reference_id="inv-1",
            date=today,
        )
        # Simulated legacy duplicate pair:
        ClientLedger.objects.create(
            client=self.client_obj,
            entry_type="credit",
            amount=Decimal("6000.00"),
            description="Paiement — ESPÈCES",
            reference_type="Payment",
            date=today,
        )
        ClientLedger.objects.create(
            client=self.client_obj,
            entry_type="credit",
            amount=Decimal("6000.00"),
            description="Paiement sur facture FA-2026-00010",
            reference_type="InvoicePayment",
            reference_id="ip-1",
            date=today,
        )

        self.client_obj.refresh_from_db()
        balance_before = self.client_obj.cached_balance
        count_before = ClientLedger.objects.count()

        out = StringIO()
        call_command("audit_client_ledger", stdout=out)
        output = out.getvalue()

        assert "Grossiste Alger" in output
        assert "6000.00 DZD" in output
        assert "Affected clients: 1" in output

        self.client_obj.refresh_from_db()
        assert self.client_obj.cached_balance == balance_before
        assert ClientLedger.objects.count() == count_before

    def test_audit_client_ledger_no_false_positive_on_distinct_same_day_payments(self):
        """
        Distinct legitimate payments on the same date (e.g. 5,000 on invoice + 3,000 advance)
        must NOT be flagged as duplicates by audit_client_ledger.
        """
        from apps.clients.models import ClientLedger

        today = datetime.date.today()
        # Legitimate invoice payment of 5000 DZD
        ClientLedger.objects.create(
            client=self.client_obj,
            entry_type="credit",
            amount=Decimal("5000.00"),
            description="Paiement sur facture FA-2026-00020",
            reference_type="InvoicePayment",
            reference_id="ip-distinct-1",
            date=today,
        )
        # Distinct legitimate on-account deposit of 3000 DZD on the same day
        ClientLedger.objects.create(
            client=self.client_obj,
            entry_type="credit",
            amount=Decimal("3000.00"),
            description="Acompte client — ESPÈCES",
            reference_type="Payment",
            date=today,
        )

        out = StringIO()
        call_command("audit_client_ledger", stdout=out)
        output = out.getvalue()

        assert "Affected clients: 0" in output
        assert "Overlapping client-date groups: 0" in output
        assert "Total suspected duplicate credit: 0.00 DZD" in output
        assert "[OVERLAP]" not in output

    def test_audit_client_ledger_detects_multi_invoice_split_duplicate(self):
        """
        A pre-v1.6 payment of 8,000 DZD recorded as Payment(8000) alongside
        InvoicePayment(5000) and InvoicePayment(3000) should be detected as an 8,000 duplicate.
        """
        from apps.clients.models import ClientLedger

        today = datetime.date.today()
        ClientLedger.objects.create(
            client=self.client_obj,
            entry_type="credit",
            amount=Decimal("8000.00"),
            description="Paiement — ESPÈCES",
            reference_type="Payment",
            date=today,
        )
        ClientLedger.objects.create(
            client=self.client_obj,
            entry_type="credit",
            amount=Decimal("5000.00"),
            description="Paiement sur facture FA-2026-00001",
            reference_type="InvoicePayment",
            reference_id="ip-split-1",
            date=today,
        )
        ClientLedger.objects.create(
            client=self.client_obj,
            entry_type="credit",
            amount=Decimal("3000.00"),
            description="Paiement sur facture FA-2026-00002",
            reference_type="InvoicePayment",
            reference_id="ip-split-2",
            date=today,
        )

        out = StringIO()
        call_command("audit_client_ledger", stdout=out)
        output = out.getvalue()

        assert "Affected clients: 1" in output
        assert "8000.00 DZD" in output

    def test_audit_client_ledger_runs_on_seeded_demo_db(self):
        """audit_client_ledger runs cleanly after seed_demo without errors."""
        out = StringIO()
        call_command("seed_demo", stdout=StringIO())
        call_command("audit_client_ledger", stdout=out)
        output = out.getvalue()
        assert "=== Audit Client Ledger (Read-Only) ===" in output
        assert "No data was modified." in output


@pytest.mark.django_db
class TestClientCreditLimitAndChequeRBAC:
    """Tests for Task 2.3d: credit_limit field-level RBAC and cheque status actions RBAC."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.clients.models import Cheque, Client
        from apps.core.models import PlanChoices, RoleChoices, Tenant, User

        self.tenant = Tenant.objects.create(name="Clients RBAC Shop", plan=PlanChoices.PRO_WHOLESALE)
        self.manager = User.objects.create_user(
            email="mgr-cli@test.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cashier-cli@test.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )
        self.client_obj = Client.objects.create(
            tenant=self.tenant,
            name="Client Test",
            phone="0552223344",
            credit_limit=Decimal("10000.00"),
        )
        self.cheque = Cheque.objects.create(
            tenant=self.tenant,
            client=self.client_obj,
            direction="receivable",
            number="CHQ-001",
            bank="CPA",
            amount=Decimal("5000.00"),
            due_date=datetime.date.today(),
            status="pending",
        )

    def test_cashier_can_edit_contact_fields_but_gets_403_on_credit_limit_change(self):
        c_cashier = _make_api_client(self.cashier)

        # Updating contact info succeeds (200)
        res_contact = c_cashier.patch(
            f"/api/v1/clients/{self.client_obj.pk}/",
            {"name": "Client Updated", "address": "Alger"},
            format="json",
        )
        assert res_contact.status_code == 200, res_contact.data

        # Changing credit_limit fails with 403
        res_limit = c_cashier.patch(
            f"/api/v1/clients/{self.client_obj.pk}/",
            {"credit_limit": "50000.00"},
            format="json",
        )
        assert res_limit.status_code == 403
        self.client_obj.refresh_from_db()
        assert self.client_obj.credit_limit == Decimal("10000.00")

        # Manager can change credit_limit (200)
        c_mgr = _make_api_client(self.manager)
        res_mgr = c_mgr.patch(
            f"/api/v1/clients/{self.client_obj.pk}/",
            {"credit_limit": "50000.00"},
            format="json",
        )
        assert res_mgr.status_code == 200
        self.client_obj.refresh_from_db()
        assert self.client_obj.credit_limit == Decimal("50000.00")

    def test_cashier_gets_403_on_cheque_status_actions(self):
        c_cashier = _make_api_client(self.cashier)

        for action_slug in ("mark-deposited", "mark-bounced", "mark-pending"):
            res = c_cashier.post(f"/api/v1/clients/cheques/{self.cheque.pk}/{action_slug}/")
            assert res.status_code == 403

        assert (
            c_cashier.patch(
                f"/api/v1/clients/cheques/{self.cheque.pk}/",
                {"status": "deposited"},
                format="json",
            ).status_code
            == 403
        )

        # Manager can mark cheque deposited
        c_mgr = _make_api_client(self.manager)
        res_dep = c_mgr.post(f"/api/v1/clients/cheques/{self.cheque.pk}/mark-deposited/")
        assert res_dep.status_code == 200
        self.cheque.refresh_from_db()
        assert self.cheque.status == "deposited"


