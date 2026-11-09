"""
Unit tests for Task 7.11: Company identity (NIS) and tax regime settings (IFU vs Réel).
"""
import datetime
from decimal import Decimal
import pytest
from rest_framework.test import APIClient
from apps.core.models import Tenant, StoreSettings, User, RoleChoices, PlanChoices
from apps.invoicing.models import Invoice, InvoiceLine, Quote, DeliveryNote
from apps.invoicing.pdf import render_invoice_pdf, render_quote_pdf, render_delivery_note_pdf


def _today():
    return str(datetime.date.today())


def _due():
    return str(datetime.date.today() + datetime.timedelta(days=30))


@pytest.mark.django_db
class TestTaxRegimeAndCompanyIdentity:
    @pytest.fixture(autouse=True)
    def setup(self, db, monkeypatch):
        # AGENTS.md §5: mock external services (PDF bridge / WeasyPrint)
        # We test that the templates render context properly without native cairo/pango
        self.tenant = Tenant.objects.create(
            name="Pointure Alger",
            plan=PlanChoices.PRO_WHOLESALE,
            nif="001616097123456",
            rc="16/00-1234567B16",
            ai="16012345678",
            nis="001616090001234",
        )
        self.owner = User.objects.create_user(
            email="owner@pointure.dz",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.OWNER,
        )
        self.settings, _ = StoreSettings.objects.get_or_create(
            tenant=self.tenant,
            defaults={
                "tax_regime": "reel",
                "invoice_legal_mentions": "Mention légale test",
            },
        )

        self.client_auth = APIClient()
        self.client_auth.force_authenticate(user=self.owner)

    def test_tenant_nis_in_settings_api(self):
        """GET /api/v1/core/tenant/settings/ returns NIS and PATCH updates it."""
        res = self.client_auth.get("/api/v1/core/tenant/settings/")
        assert res.status_code == 200
        assert res.data["nis"] == "001616090001234"

        patch_res = self.client_auth.patch(
            "/api/v1/core/tenant/update_settings/",
            {"nis": "999888777666555"},
            format="json",
        )
        assert patch_res.status_code == 200
        assert patch_res.data["nis"] == "999888777666555"

        self.tenant.refresh_from_db()
        assert self.tenant.nis == "999888777666555"

    def test_store_settings_tax_regime_and_mentions_api(self):
        """GET /api/v1/core/store-settings/current/ returns tax_regime and mentions."""
        res = self.client_auth.get("/api/v1/core/store-settings/current/")
        assert res.status_code == 200
        assert res.data["tax_regime"] == "reel"
        assert res.data["invoice_legal_mentions"] == "Mention légale test"

        patch_res = self.client_auth.patch(
            "/api/v1/core/store-settings/update_settings/",
            {
                "tax_regime": "ifu",
                "invoice_legal_mentions": "Exonéré de TVA selon Art. 282 quater du CIDTA (Régime IFU)",
            },
            format="json",
        )
        assert patch_res.status_code == 200
        assert patch_res.data["tax_regime"] == "ifu"
        assert "Exonéré de TVA" in patch_res.data["invoice_legal_mentions"]

        self.settings.refresh_from_db()
        assert self.settings.tax_regime == "ifu"
        assert "Exonéré de TVA" in self.settings.invoice_legal_mentions

    def test_ifu_defaults_apply_tva_to_false(self):
        """With tax_regime == 'ifu', creating an invoice defaults apply_tva=False."""
        self.settings.tax_regime = "ifu"
        self.settings.save()

        payload = {
            "date": _today(),
            "due_date": _due(),
            "series_prefix": "FA",
            "lines": [
                {
                    "description": "Bottine Cuir Homme T42",
                    "quantity": 5,
                    "unit_price": "4500.00",
                }
            ],
        }

        res = self.client_auth.post("/api/v1/invoicing/invoices/", payload, format="json")
        assert res.status_code == 201
        assert res.data["apply_tva"] is False

        invoice = Invoice.objects.get(pk=res.data["id"])
        assert invoice.apply_tva is False
        assert invoice.tva_amount == Decimal("0.00")
        assert invoice.total_ttc == invoice.total_ht

    def test_reel_defaults_apply_tva_to_true(self):
        """With tax_regime == 'reel', creating an invoice defaults apply_tva=True."""
        self.settings.tax_regime = "reel"
        self.settings.save()

        payload = {
            "date": _today(),
            "due_date": _due(),
            "series_prefix": "FA",
            "lines": [
                {
                    "description": "Escarpin Femme T38",
                    "quantity": 2,
                    "unit_price": "3000.00",
                }
            ],
        }

        res = self.client_auth.post("/api/v1/invoicing/invoices/", payload, format="json")
        assert res.status_code == 201
        assert res.data["apply_tva"] is True

        invoice = Invoice.objects.get(pk=res.data["id"])
        assert invoice.apply_tva is True
        assert invoice.tva_amount > Decimal("0.00")

    def test_explicit_apply_tva_overrides_regime(self):
        """Caller can explicitly set apply_tva=True even when regime is IFU."""
        self.settings.tax_regime = "ifu"
        self.settings.save()

        payload = {
            "date": _today(),
            "due_date": _due(),
            "series_prefix": "FA",
            "apply_tva": True,
            "lines": [
                {
                    "description": "Sandale Cuir T40",
                    "quantity": 1,
                    "unit_price": "2000.00",
                }
            ],
        }

        res = self.client_auth.post("/api/v1/invoicing/invoices/", payload, format="json")
        assert res.status_code == 201
        assert res.data["apply_tva"] is True

    def test_pdf_rendering_context_includes_nis_and_legal_mentions(self, monkeypatch):
        """Invoice PDF template renders NIS in header/footer and mentions for IFU."""
        captured_contexts = []

        def mock_render_to_pdf(template_name, context, language="fr"):
            captured_contexts.append((template_name, context))
            from django.template.loader import render_to_string
            rendered_html = render_to_string(template_name, context)
            return rendered_html.encode("utf-8")

        monkeypatch.setattr("apps.invoicing.pdf.render_to_pdf", mock_render_to_pdf)

        self.settings.tax_regime = "ifu"
        self.settings.invoice_legal_mentions = "Article 282 quater CIDTA - Régime IFU"
        self.settings.save()

        invoice = Invoice.objects.create(
            tenant=self.tenant,
            date=datetime.date.today(),
            due_date=datetime.date.today() + datetime.timedelta(days=30),
            apply_tva=False,
            created_by=self.owner,
            is_formal=True,
        )
        InvoiceLine.objects.create(
            invoice=invoice,
            description="Chaussure Test",
            quantity=2,
            unit_price=Decimal("1500.00"),
        )
        invoice.compute_totals()
        invoice.save()

        pdf_bytes = render_invoice_pdf(invoice)
        html_str = pdf_bytes.decode("utf-8")

        # Verify context
        tpl, ctx = captured_contexts[0]
        assert tpl == "pdf/invoice.html"
        assert ctx["tenant"].nis == "001616090001234"
        assert ctx["store_settings"].tax_regime == "ifu"
        assert ctx["store_settings"].invoice_legal_mentions == "Article 282 quater CIDTA - Régime IFU"

        # Verify HTML rendered content
        assert "NIS: 001616090001234" in html_str
        assert "Article 282 quater CIDTA - Régime IFU" in html_str
        # Verify TVA row is hidden because tax_regime == 'ifu'
        assert "TVA (" not in html_str

    def test_quote_and_delivery_note_pdf_rendering(self, monkeypatch):
        """Quote and Delivery Note PDF templates include NIS in header."""
        captured = []

        def mock_render(template_name, context, language="fr"):
            captured.append((template_name, context))
            from django.template.loader import render_to_string
            return render_to_string(template_name, context).encode("utf-8")

        monkeypatch.setattr("apps.invoicing.pdf.render_to_pdf", mock_render)

        quote = Quote.objects.create(
            tenant=self.tenant,
            date=datetime.date.today(),
            valid_until=datetime.date.today() + datetime.timedelta(days=15),
            apply_tva=False,
            created_by=self.owner,
        )
        q_bytes = render_quote_pdf(quote)
        assert "NIS: 001616090001234" in q_bytes.decode("utf-8")

        dn = DeliveryNote.objects.create(
            tenant=self.tenant,
            number="BL-2026-0001",
            date=datetime.date.today(),
        )
        dn_bytes = render_delivery_note_pdf(dn)
        assert "NIS: 001616090001234" in dn_bytes.decode("utf-8")
