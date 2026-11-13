"""
Tests for credit limit enforcement on invoice creation.
"""
import datetime
from decimal import Decimal

import pytest
from rest_framework.test import APIClient
from apps.invoicing.models import Invoice


def _today():
    return str(datetime.date.today())


def _due():
    return str(datetime.date.today() + datetime.timedelta(days=30))


def _make_client(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user=user)
    return c


@pytest.mark.django_db
class TestCreditLimitEnforcement:
    """Invoice creation is blocked when a client would exceed their credit limit."""

    @pytest.fixture(autouse=True)
    def setup(self, db, monkeypatch):
        from apps.core.models import PlanChoices, RoleChoices, Tenant, User
        from apps.clients.models import Client

        monkeypatch.setattr(
            "apps.invoicing.pdf.render_invoice_pdf",
            lambda invoice, language="fr": b"%PDF-1.4 mock",
        )

        self.tenant = Tenant.objects.create(name="Credit Shop", plan=PlanChoices.PRO_WHOLESALE)
        self.manager = User.objects.create_user(
            email="mgr@credit.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cashier@credit.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )

        # Client with a credit limit
        self.client_50k = Client.objects.create(
            tenant=self.tenant,
            name="Client 50K Limit",
            phone="0550000001",
            credit_limit=Decimal("50000.00"),
            cached_balance=Decimal("0.00"),
        )
        self.client_10k = Client.objects.create(
            tenant=self.tenant,
            name="Client 10K Limit",
            phone="0550000002",
            credit_limit=Decimal("10000.00"),
            cached_balance=Decimal("8000.00"),
        )
        self.client_blocked = Client.objects.create(
            tenant=self.tenant,
            name="Blocked Client",
            phone="0550000099",
            credit_limit=Decimal("50000.00"),
            cached_balance=Decimal("0.00"),
            is_blocked=True,
        )

    def _invoice_payload(self, client, amount="10000.00"):
        return {
            "client_id": client.pk,
            "date": _today(),
            "due_date": _due(),
            "series_prefix": "FA",
            "apply_tva": False,
            "tva_rate": "0.00",
            "notes": "",
            "confirm": False,
            "lines": [
                {
                    "description": "Test product",
                    "variant": None,
                    "quantity": "1",
                    "unit_price": amount,
                    "discount_pct": "0",
                }
            ],
        }

    def test_invoice_within_limit_passes(self):
        """Invoice of 10000 for a client with 50000 limit and 0 balance passes."""
        c = _make_client(self.manager)
        resp = c.post(
            "/api/v1/invoicing/invoices/",
            self._invoice_payload(self.client_50k, "10000.00"),
            format="json",
        )
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.data}"

    def test_invoice_exceeds_limit_blocked(self):
        """Invoice of 5000 when client has 8000 balance and 10000 limit → 400."""
        c = _make_client(self.manager)
        resp = c.post(
            "/api/v1/invoicing/invoices/",
            self._invoice_payload(self.client_10k, "5000.00"),
            format="json",
        )
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.data}"
        # Custom exception handler wraps as {"error": {"code": ..., "details": {credit info}}}
        body = str(resp.data)
        assert "credit_limit_exceeded" in body, f"Expected credit_limit_exceeded in: {body}"

    def test_manager_can_force_override(self):
        """Manager with ?force=true can bypass the credit limit check → 201."""
        c = _make_client(self.manager)
        resp = c.post(
            "/api/v1/invoicing/invoices/?force=true",
            self._invoice_payload(self.client_10k, "5000.00"),
            format="json",
        )
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.data}"

    def test_invoice_creation_tva_multiplier_does_not_multiply_by_20(self):
        """Invoice of 10000 with 19% TVA is 11900, should pass under 15000 credit limit (not 200000)."""
        from apps.clients.models import Client
        client_15k = Client.objects.create(
            tenant=self.tenant,
            name="Client 15K Limit",
            phone="0550000003",
            credit_limit=Decimal("15000.00"),
            cached_balance=Decimal("0.00"),
        )
        c = _make_client(self.manager)
        payload = self._invoice_payload(client_15k, "10000.00")
        payload["apply_tva"] = True
        payload["tva_rate"] = "19.00"
        resp = c.post(
            "/api/v1/invoicing/invoices/",
            payload,
            format="json",
        )
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.data}"

    def test_cashier_cannot_force(self):
        """Cashier is blocked even with ?force=true → 403 (cashier cannot create invoices)."""
        c = _make_client(self.cashier)
        resp = c.post(
            "/api/v1/invoicing/invoices/?force=true",
            self._invoice_payload(self.client_10k, "5000.00"),
            format="json",
        )
        # Cashier gets 403 from require_manager() before credit limit check
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}: {resp.data}"

    def test_blocked_client_cannot_confirm_existing_draft_invoice(self):
        """Blocking a client after draft creation must also block invoice confirmation."""
        invoice = Invoice.objects.create(
            tenant=self.tenant,
            client=self.client_50k,
            date=datetime.date.today(),
            due_date=datetime.date.today() + datetime.timedelta(days=30),
            status="draft",
        )
        self.client_50k.is_blocked = True
        self.client_50k.save(update_fields=["is_blocked"])

        response = _make_client(self.manager).post(
            f"/api/v1/invoicing/invoices/{invoice.pk}/confirm/"
        )

        assert response.status_code == 400, response.data
        invoice.refresh_from_db()
        assert invoice.status == "draft"
        assert invoice.number == ""

    def test_invoice_create_blocked_client_fails(self):
        """Creating an invoice for a blocked client fails with 400."""
        c = _make_client(self.manager)
        resp = c.post(
            "/api/v1/invoicing/invoices/",
            self._invoice_payload(self.client_blocked, "1000.00"),
            format="json",
        )
        assert resp.status_code == 400
        assert "client_blocked" in str(resp.data) or "client_id" in str(resp.data)

    def test_invoice_confirm_blocked_client_fails(self):
        """Confirming a draft invoice for a blocked client fails with 400."""
        from apps.invoicing.models import Invoice, InvoiceLine, InvoiceStatusChoices
        # Create draft invoice directly
        inv = Invoice.objects.create(
            tenant=self.tenant,
            client=self.client_blocked,
            date=datetime.date.today(),
            due_date=datetime.date.today() + datetime.timedelta(days=30),
            series_prefix="FA",
            status=InvoiceStatusChoices.DRAFT,
            total_ht=Decimal("2000.00"),
            total_ttc=Decimal("2000.00"),
        )
        InvoiceLine.objects.create(
            invoice=inv,
            description="Item",
            quantity=1,
            unit_price=Decimal("2000.00"),
        )
        c = _make_client(self.manager)
        resp = c.post(f"/api/v1/invoicing/invoices/{inv.pk}/confirm/")
        assert resp.status_code == 400
        assert "client_blocked" in str(resp.data)

    def test_invoice_confirm_exceeding_credit_limit_fails(self):
        """Confirming a draft invoice that exceeds credit_limit fails with 400 unless forced."""
        from apps.invoicing.models import Invoice, InvoiceLine, InvoiceStatusChoices
        # client_10k has cached_balance 8000 and credit_limit 10000.
        # An invoice of 5000 pushes would_be_balance to 13000 > 10000.
        inv = Invoice.objects.create(
            tenant=self.tenant,
            client=self.client_10k,
            date=datetime.date.today(),
            due_date=datetime.date.today() + datetime.timedelta(days=30),
            series_prefix="FA",
            status=InvoiceStatusChoices.DRAFT,
            total_ht=Decimal("5000.00"),
            total_ttc=Decimal("5000.00"),
        )
        InvoiceLine.objects.create(
            invoice=inv,
            description="Item",
            quantity=1,
            unit_price=Decimal("5000.00"),
        )
        inv.compute_totals()
        inv.save(update_fields=["total_ht", "total_ttc"])
        c = _make_client(self.manager)
        # Attempt without force -> 400
        resp = c.post(f"/api/v1/invoicing/invoices/{inv.pk}/confirm/")
        assert resp.status_code == 400
        assert "credit_limit_exceeded" in str(resp.data)

        # Attempt with force -> 200
        resp_force = c.post(f"/api/v1/invoicing/invoices/{inv.pk}/confirm/?force=true")
        assert resp_force.status_code == 200
        inv.refresh_from_db()
        assert inv.status == InvoiceStatusChoices.SENT

    def test_quote_convert_to_invoice_credit_limit_and_blocked(self):
        """Converting a quote to an invoice checks credit_limit and is_blocked."""
        from apps.invoicing.models import Quote, QuoteLine, QuoteStatusChoices
        # 1. Blocked client
        quote_blocked = Quote.objects.create(
            tenant=self.tenant,
            client=self.client_blocked,
            number="DEV-BLK",
            date=datetime.date.today(),
            status=QuoteStatusChoices.ACCEPTED,
            total_ht=Decimal("1000.00"),
            total_ttc=Decimal("1000.00"),
        )
        QuoteLine.objects.create(quote=quote_blocked, description="Item", quantity=1, unit_price=Decimal("1000.00"))
        quote_blocked.compute_totals()
        quote_blocked.save(update_fields=["total_ht", "total_ttc"])
        c = _make_client(self.manager)
        resp = c.post(f"/api/v1/invoicing/quotes/{quote_blocked.pk}/convert-to-invoice/")
        assert resp.status_code == 400
        assert "client_blocked" in str(resp.data) or "bloqué" in str(resp.data)

        # 2. Over credit limit (5000 on client_10k with balance 8000 > 10000 limit)
        quote_over = Quote.objects.create(
            tenant=self.tenant,
            client=self.client_10k,
            number="DEV-OVR",
            date=datetime.date.today(),
            status=QuoteStatusChoices.ACCEPTED,
            total_ht=Decimal("5000.00"),
            total_ttc=Decimal("5000.00"),
        )
        QuoteLine.objects.create(quote=quote_over, description="Item", quantity=1, unit_price=Decimal("5000.00"))
        quote_over.compute_totals()
        quote_over.save(update_fields=["total_ht", "total_ttc"])
        resp2 = c.post(f"/api/v1/invoicing/quotes/{quote_over.pk}/convert-to-invoice/")
        assert resp2.status_code == 400
        assert "credit_limit_exceeded" in str(resp2.data) or "Plafond de crédit dépassé" in str(resp2.data)

        # 3. Manager force override succeeds
        resp3 = c.post(f"/api/v1/invoicing/quotes/{quote_over.pk}/convert-to-invoice/?force=true")
        assert resp3.status_code == 200
        quote_over.refresh_from_db()
        assert quote_over.status == QuoteStatusChoices.CONVERTED

    def test_quote_convert_to_delivery_note_credit_limit_and_blocked(self):
        """Converting a quote to a delivery note checks credit_limit and is_blocked."""
        from apps.invoicing.models import Quote, QuoteLine, QuoteStatusChoices
        # 1. Blocked client
        quote_blocked = Quote.objects.create(
            tenant=self.tenant,
            client=self.client_blocked,
            number="DEV-BL-BLK",
            date=datetime.date.today(),
            status=QuoteStatusChoices.ACCEPTED,
            total_ht=Decimal("1000.00"),
            total_ttc=Decimal("1000.00"),
        )
        QuoteLine.objects.create(quote=quote_blocked, description="Item", quantity=1, unit_price=Decimal("1000.00"))
        quote_blocked.compute_totals()
        quote_blocked.save(update_fields=["total_ht", "total_ttc"])
        c = _make_client(self.manager)
        resp = c.post(f"/api/v1/invoicing/quotes/{quote_blocked.pk}/convert-to-delivery-note/")
        assert resp.status_code == 400
        assert "client_blocked" in str(resp.data) or "bloqué" in str(resp.data)

        # 2. Over credit limit
        quote_over = Quote.objects.create(
            tenant=self.tenant,
            client=self.client_10k,
            number="DEV-BL-OVR",
            date=datetime.date.today(),
            status=QuoteStatusChoices.ACCEPTED,
            total_ht=Decimal("5000.00"),
            total_ttc=Decimal("5000.00"),
        )
        QuoteLine.objects.create(quote=quote_over, description="Item", quantity=1, unit_price=Decimal("5000.00"))
        quote_over.compute_totals()
        quote_over.save(update_fields=["total_ht", "total_ttc"])
        resp2 = c.post(f"/api/v1/invoicing/quotes/{quote_over.pk}/convert-to-delivery-note/")
        assert resp2.status_code == 400
        assert "credit_limit_exceeded" in str(resp2.data) or "Plafond de crédit dépassé" in str(resp2.data)

        # 3. Manager force override succeeds
        resp3 = c.post(f"/api/v1/invoicing/quotes/{quote_over.pk}/convert-to-delivery-note/?force=true")
        assert resp3.status_code == 200
        quote_over.refresh_from_db()
        assert quote_over.converted_delivery_note is not None
