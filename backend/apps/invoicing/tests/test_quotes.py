"""
Tests for quotes / proformas and their conversions.
"""
import datetime
from decimal import Decimal

import pytest
from rest_framework.test import APIClient
from django.utils import timezone

from apps.clients.models import Client, ClientLedger
from apps.core.models import PlanChoices, RoleChoices, Tenant, User
from apps.inventory.models import Product, StockMovement, Variant
from apps.invoicing.models import Invoice, Quote, QuoteLine, QuoteStatusChoices
from apps.invoicing.tasks import expire_outdated_quotes


def _make_client(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user=user)
    return c


@pytest.mark.django_db
class TestQuotes:
    @pytest.fixture(autouse=True)
    def setup(self, db, monkeypatch):
        monkeypatch.setattr(
            "apps.invoicing.pdf.render_quote_pdf",
            lambda quote, language="fr": b"%PDF-1.4 mock quote",
        )
        monkeypatch.setattr(
            "apps.invoicing.pdf.render_invoice_pdf",
            lambda invoice, language="fr": b"%PDF-1.4 mock invoice",
        )
        monkeypatch.setattr(
            "apps.invoicing.pdf.render_delivery_note_pdf",
            lambda dn, language="fr": b"%PDF-1.4 mock dn",
        )

        self.tenant = Tenant.objects.create(name="Proforma Store", plan=PlanChoices.PRO_WHOLESALE)
        self.manager = User.objects.create_user(
            email="mgr@proforma.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cashier@proforma.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )

        self.client = Client.objects.create(
            tenant=self.tenant,
            name="Grossiste Alger",
            phone="0550123456",
        )

        self.product = Product.objects.create(
            tenant=self.tenant,
            category="sneakers",
            name="Basket Pro",
            wholesale_price=Decimal("2000.00"),
            sale_price=Decimal("2500.00"),
        )
        self.variant = Variant.objects.create(
            tenant=self.tenant,
            product=self.product,
            size_eu=42,
            stock_qty=100,
        )

    def test_create_quote_success_and_invariants(self):
        client = _make_client(self.manager)
        today = str(datetime.date.today())

        payload = {
            "client_id": str(self.client.id),
            "date": today,
            "apply_tva": True,
            "tva_rate": "19.00",
            "notes": "Devis valable 15 jours",
            "lines": [
                {
                    "variant": str(self.variant.id),
                    "description": "Basket Pro 42",
                    "quantity": "10.00",
                    "unit_price": "2000.00",
                    "discount_pct": "5.00",
                    "cartons": 1,
                },
                {
                    "description": "Frais de transport",
                    "quantity": "1.00",
                    "unit_price": "1000.00",
                    "discount_pct": "0.00",
                    "cartons": 0,
                },
            ],
        }

        resp = client.post("/api/v1/invoicing/quotes/", payload, format="json")
        assert resp.status_code == 201, resp.data
        quote_data = resp.data

        # Verify numbering and dates
        assert quote_data["number"].startswith("PF-")
        year = str(datetime.date.today().year)
        assert f"PF-{year}-" in quote_data["number"]
        assert quote_data["status"] == "draft"

        # Valid until should default to today + 15 days
        expected_valid = str(datetime.date.today() + datetime.timedelta(days=15))
        assert quote_data["valid_until"] == expected_valid

        # Total calculations:
        # Line 1: 10 * 2000 * (1 - 0.05) = 19000
        # Line 2: 1 * 1000 = 1000
        # Total HT = 20000.00
        # TVA (19%) = 3800.00
        # Total TTC = 23800.00
        assert Decimal(quote_data["total_ht"]) == Decimal("20000.00")
        assert Decimal(quote_data["tva_amount"]) == Decimal("3800.00")
        assert Decimal(quote_data["total_ttc"]) == Decimal("23800.00")

        # Crucial invariants:
        # Quotes MUST NOT create any StockMovement or ClientLedger entries
        assert StockMovement.objects.filter(variant=self.variant).count() == 0
        assert ClientLedger.objects.filter(client=self.client).count() == 0

    def test_quote_status_transitions_and_cancel(self):
        quote = Quote.objects.create(
            tenant=self.tenant,
            client=self.client,
            date=datetime.date.today(),
            status=QuoteStatusChoices.DRAFT,
        )
        QuoteLine.objects.create(
            quote=quote,
            description="Item 1",
            quantity=Decimal("5.00"),
            unit_price=Decimal("1000.00"),
        )
        quote.compute_totals()
        quote.save()

        client = _make_client(self.manager)

        # Send
        resp = client.post(f"/api/v1/invoicing/quotes/{quote.id}/send/")
        assert resp.status_code == 200
        assert resp.data["status"] == "sent"

        # Accept
        resp = client.post(f"/api/v1/invoicing/quotes/{quote.id}/accept/")
        assert resp.status_code == 200
        assert resp.data["status"] == "accepted"

        # Cancel
        resp = client.post(f"/api/v1/invoicing/quotes/{quote.id}/cancel/")
        assert resp.status_code == 200
        assert resp.data["status"] == "cancelled"

    def test_convert_to_invoice(self):
        quote = Quote.objects.create(
            tenant=self.tenant,
            client=self.client,
            date=datetime.date.today(),
            status=QuoteStatusChoices.ACCEPTED,
            apply_tva=True,
            tva_rate=Decimal("19.00"),
        )
        QuoteLine.objects.create(
            quote=quote,
            variant=self.variant,
            description="Basket Pro 42",
            quantity=Decimal("12.00"),
            unit_price=Decimal("2000.00"),
            discount_pct=Decimal("10.00"),
            cartons=2,
            order=0,
        )
        quote.compute_totals()
        quote.save()

        client = _make_client(self.manager)
        resp = client.post(f"/api/v1/invoicing/quotes/{quote.id}/convert-to-invoice/")
        assert resp.status_code == 200, resp.data
        quote.refresh_from_db()

        assert quote.status == QuoteStatusChoices.CONVERTED
        assert quote.converted_invoice is not None

        invoice = quote.converted_invoice
        assert invoice.status == "draft"  # Must be draft
        assert invoice.client == self.client
        assert invoice.lines.count() == 1
        line = invoice.lines.first()
        assert line.variant == self.variant
        assert line.quantity == Decimal("12.00")
        assert line.unit_price == Decimal("2000.00")
        assert line.discount_pct == Decimal("10.00")
        assert line.cartons == 2

        # Still no stock deduction because invoice is draft
        assert StockMovement.objects.filter(variant=self.variant).count() == 0

        # Cannot cancel converted quote
        resp_cancel = client.post(f"/api/v1/invoicing/quotes/{quote.id}/cancel/")
        assert resp_cancel.status_code == 400

    def test_convert_to_delivery_note(self):
        quote = Quote.objects.create(
            tenant=self.tenant,
            client=self.client,
            date=datetime.date.today(),
            status=QuoteStatusChoices.SENT,
        )
        QuoteLine.objects.create(
            quote=quote,
            variant=self.variant,
            description="Basket Pro 42",
            quantity=Decimal("6.00"),
            unit_price=Decimal("2000.00"),
            cartons=1,
            order=0,
        )
        quote.compute_totals()
        quote.save()

        client = _make_client(self.manager)
        resp = client.post(f"/api/v1/invoicing/quotes/{quote.id}/convert-to-delivery-note/")
        assert resp.status_code == 200, resp.data
        quote.refresh_from_db()

        assert quote.status == QuoteStatusChoices.CONVERTED
        assert quote.converted_delivery_note is not None

        dn = quote.converted_delivery_note
        assert dn.client == self.client
        assert dn.lines.count() == 1
        assert dn.lines.first().quantity == Decimal("6.00")

    def test_quote_conversion_locks_and_prevents_duplicate_invoice(self):
        """Stale second instance of a quote cannot convert again once locked and converted."""
        quote1 = Quote.objects.create(
            tenant=self.tenant,
            client=self.client,
            date=datetime.date.today(),
            status=QuoteStatusChoices.ACCEPTED,
        )
        QuoteLine.objects.create(
            quote=quote1,
            variant=self.variant,
            description="Basket Pro 42",
            quantity=Decimal("5.00"),
            unit_price=Decimal("2000.00"),
            cartons=1,
            order=0,
        )
        quote1.compute_totals()
        quote1.save()

        # Simulate concurrent worker/stale memory reference
        quote2 = Quote.objects.get(pk=quote1.pk)

        inv1 = quote1.convert_to_invoice()
        assert inv1 is not None

        # Attempting conversion on quote2 must raise ValueError
        with pytest.raises(ValueError, match="déjà été converti en facture"):
            quote2.convert_to_invoice()

        # Exactly 1 invoice created
        assert Invoice.objects.filter(client=self.client).count() == 1

    def test_quote_convert_to_bl_then_invoice_links_delivery_note(self):
        """Converting a quote to a BL and then to an invoice links the BL to the invoice."""
        quote = Quote.objects.create(
            tenant=self.tenant,
            client=self.client,
            date=datetime.date.today(),
            status=QuoteStatusChoices.ACCEPTED,
        )
        QuoteLine.objects.create(
            quote=quote,
            variant=self.variant,
            description="Basket Pro 42",
            quantity=Decimal("10.00"),
            unit_price=Decimal("2000.00"),
            cartons=1,
            order=0,
        )
        quote.compute_totals()
        quote.save()

        dn = quote.convert_to_delivery_note()
        assert dn.invoice is None

        inv = quote.convert_to_invoice()
        dn.refresh_from_db()
        assert dn.invoice == inv

    def test_expire_outdated_quotes(self):
        yesterday = timezone.localdate() - datetime.timedelta(days=1)
        tomorrow = timezone.localdate() + datetime.timedelta(days=1)

        # Outdated draft
        q1 = Quote.objects.create(
            tenant=self.tenant,
            client=self.client,
            date=yesterday,
            valid_until=yesterday,
            status=QuoteStatusChoices.DRAFT,
        )
        # Outdated sent
        q2 = Quote.objects.create(
            tenant=self.tenant,
            client=self.client,
            date=yesterday,
            valid_until=yesterday,
            status=QuoteStatusChoices.SENT,
        )
        # Outdated accepted -> must NOT expire
        q3 = Quote.objects.create(
            tenant=self.tenant,
            client=self.client,
            date=yesterday,
            valid_until=yesterday,
            status=QuoteStatusChoices.ACCEPTED,
        )
        # Future draft -> must NOT expire
        q4 = Quote.objects.create(
            tenant=self.tenant,
            client=self.client,
            date=timezone.localdate(),
            valid_until=tomorrow,
            status=QuoteStatusChoices.DRAFT,
        )

        expired_count = expire_outdated_quotes()
        assert expired_count == 2

        q1.refresh_from_db()
        q2.refresh_from_db()
        q3.refresh_from_db()
        q4.refresh_from_db()

        assert q1.status == QuoteStatusChoices.EXPIRED
        assert q2.status == QuoteStatusChoices.EXPIRED
        assert q3.status == QuoteStatusChoices.ACCEPTED
        assert q4.status == QuoteStatusChoices.DRAFT

    def test_quote_permissions(self):
        cashier_client = _make_client(self.cashier)

        # Cashier cannot create
        resp = cashier_client.post("/api/v1/invoicing/quotes/", {}, format="json")
        assert resp.status_code == 403

        # Create as manager
        quote = Quote.objects.create(
            tenant=self.tenant,
            client=self.client,
            date=datetime.date.today(),
            status=QuoteStatusChoices.DRAFT,
        )

        # Cashier cannot list or view
        assert cashier_client.get("/api/v1/invoicing/quotes/").status_code == 403
        resp = cashier_client.get(f"/api/v1/invoicing/quotes/{quote.id}/")
        assert resp.status_code == 403

        # Cashier cannot send/accept/cancel/convert
        assert cashier_client.post(f"/api/v1/invoicing/quotes/{quote.id}/send/").status_code == 403
        assert cashier_client.post(f"/api/v1/invoicing/quotes/{quote.id}/accept/").status_code == 403
        assert cashier_client.post(f"/api/v1/invoicing/quotes/{quote.id}/cancel/").status_code == 403
        assert cashier_client.post(f"/api/v1/invoicing/quotes/{quote.id}/convert-to-invoice/").status_code == 403
        assert cashier_client.post(f"/api/v1/invoicing/quotes/{quote.id}/convert-to-delivery-note/").status_code == 403
