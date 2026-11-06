"""
Tests for preventing the persistence/caching of placeholder PDFs and auto-regenerating them.
"""
import datetime
from decimal import Decimal
import pytest
from django.core.files.base import ContentFile
from rest_framework.test import APIClient

from apps.core.desktop.pdf_client import PLACEHOLDER_PDF_BYTES, is_placeholder_pdf
from apps.core.models import PlanChoices, RoleChoices, Tenant, User
from apps.clients.models import Client
from apps.invoicing.models import DeliveryNote, Invoice, InvoiceStatusChoices


def _today():
    return str(datetime.date.today())


def _due():
    return str(datetime.date.today() + datetime.timedelta(days=30))


def _make_client(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user=user)
    return c


def _get_resp_bytes(resp) -> bytes:
    if hasattr(resp, "streaming_content"):
        return b"".join(resp.streaming_content)
    return resp.content


@pytest.mark.django_db
class TestPlaceholderPDFPrevention:
    """Ensure placeholder PDFs are never persisted to invoice.pdf_file and are regenerated."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.create(name="PDF Test Tenant", plan=PlanChoices.PRO_WHOLESALE)
        self.manager = User.objects.create_user(
            email="pdf_mgr@test.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.client = Client.objects.create(
            tenant=self.tenant,
            name="PDF Client",
            phone="0550000099",
        )
        self.invoice = Invoice.objects.create(
            tenant=self.tenant,
            client=self.client,
            date=_today(),
            due_date=_due(),
            series_prefix="FA",
            status=InvoiceStatusChoices.SENT,
            created_by=self.manager,
        )

    def test_placeholder_detector(self):
        """Test is_placeholder_pdf correctly identifies placeholders vs valid PDFs."""
        assert is_placeholder_pdf(b"") is True
        assert is_placeholder_pdf(None) is True
        assert is_placeholder_pdf(PLACEHOLDER_PDF_BYTES) is True
        assert is_placeholder_pdf(b"%PDF-1.0 placeholder") is True
        assert is_placeholder_pdf(b"%PDF-1.4\n% Desktop PDF placeholder\n") is True

        valid_pdf = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\ntrailer\nstartxref\n%%EOF"
        assert is_placeholder_pdf(valid_pdf) is False

    def test_placeholder_generation_does_not_persist_to_invoice_pdf_file(self, monkeypatch):
        """When PDF rendering returns a placeholder, it should stream but NOT save to invoice.pdf_file."""
        monkeypatch.setattr(
            "apps.invoicing.pdf.render_invoice_pdf",
            lambda invoice, language="fr": PLACEHOLDER_PDF_BYTES,
        )

        c = _make_client(self.manager)
        resp = c.get(f"/api/v1/invoicing/invoices/{self.invoice.pk}/pdf/")

        assert resp.status_code == 200
        assert _get_resp_bytes(resp) == PLACEHOLDER_PDF_BYTES

        self.invoice.refresh_from_db()
        assert not bool(self.invoice.pdf_file), "Placeholder PDF must not be persisted to invoice.pdf_file"

    def test_cached_placeholder_is_cleared_and_regenerated(self, monkeypatch):
        """If invoice.pdf_file already has a placeholder, it should be cleared and regenerated."""
        # Manually save placeholder into pdf_file
        self.invoice.pdf_file.save("invoices/pdf/test.pdf", ContentFile(PLACEHOLDER_PDF_BYTES), save=True)
        assert bool(self.invoice.pdf_file) is True

        # Now bridge is back online, rendering valid PDF
        real_pdf_bytes = b"%PDF-1.4 real valid content"
        monkeypatch.setattr(
            "apps.invoicing.pdf.render_invoice_pdf",
            lambda invoice, language="fr": real_pdf_bytes,
        )

        c = _make_client(self.manager)
        resp = c.get(f"/api/v1/invoicing/invoices/{self.invoice.pk}/pdf/")

        assert resp.status_code == 200
        assert _get_resp_bytes(resp) == real_pdf_bytes

        self.invoice.refresh_from_db()
        assert bool(self.invoice.pdf_file) is True
        self.invoice.pdf_file.open("rb")
        assert self.invoice.pdf_file.read() == real_pdf_bytes

    def test_dn_placeholder_generation_does_not_persist_to_dn_pdf_file(self, monkeypatch):
        """When delivery note PDF rendering returns a placeholder, it should NOT save to dn.pdf_file."""
        dn = DeliveryNote.objects.create(
            tenant=self.tenant,
            number="BL-2026-0001",
            date=datetime.date.today(),
        )
        monkeypatch.setattr(
            "apps.invoicing.pdf.render_delivery_note_pdf",
            lambda delivery_note, language="fr": PLACEHOLDER_PDF_BYTES,
        )

        c = _make_client(self.manager)
        resp = c.get(f"/api/v1/invoicing/delivery-notes/{dn.pk}/pdf/")

        assert resp.status_code == 200
        assert _get_resp_bytes(resp) == PLACEHOLDER_PDF_BYTES

        dn.refresh_from_db()
        assert not bool(dn.pdf_file), "Placeholder PDF must not be persisted to dn.pdf_file"

    def test_dn_cached_placeholder_is_cleared_and_regenerated(self, monkeypatch):
        """If dn.pdf_file already has a placeholder, it should be cleared and regenerated."""
        dn = DeliveryNote.objects.create(
            tenant=self.tenant,
            number="BL-2026-0002",
            date=datetime.date.today(),
        )
        dn.pdf_file.save("delivery_notes/pdf/test.pdf", ContentFile(PLACEHOLDER_PDF_BYTES), save=True)
        assert bool(dn.pdf_file) is True

        real_pdf_bytes = b"%PDF-1.4 real valid dn content"
        monkeypatch.setattr(
            "apps.invoicing.pdf.render_delivery_note_pdf",
            lambda delivery_note, language="fr": real_pdf_bytes,
        )

        c = _make_client(self.manager)
        resp = c.get(f"/api/v1/invoicing/delivery-notes/{dn.pk}/pdf/")

        assert resp.status_code == 200
        assert _get_resp_bytes(resp) == real_pdf_bytes

        dn.refresh_from_db()
        assert bool(dn.pdf_file) is True
        dn.pdf_file.open("rb")
        assert dn.pdf_file.read() == real_pdf_bytes
