"""
Tests for Task 7.7:
- Client account statement ("relevé de compte")
- Opening balance at from_date + period debits - period credits == closing balance
- PDF and XLSX rendering
- Bulk statements ZIP endpoint
"""
import datetime
import io
import zipfile
from decimal import Decimal

import openpyxl
import pytest
from rest_framework.test import APIClient

from apps.clients.models import Client, ClientLedger
from apps.clients.services.statement import get_client_statement_data
from apps.core.models import PlanChoices, RoleChoices, Tenant, User


def _make_api_client(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user=user)
    return c


@pytest.mark.django_db
class TestClientStatement:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.create(
            name="Statement Boutique", plan=PlanChoices.PRO_WHOLESALE
        )
        self.manager = User.objects.create_user(
            email="manager@statement.dz",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cashier@statement.dz",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )
        self.client_obj = Client.objects.create(
            tenant=self.tenant,
            name="Sarl Chaussures Dz",
            phone="0555112233",
            wilaya="16",
        )

    def test_statement_calculation_and_invariants(self):
        """Opening + movements = closing balance."""
        # 2026-01-15: Debit 40,000 (Invoice 1)
        ClientLedger.objects.create(
            client=self.client_obj,
            entry_type="debit",
            amount=Decimal("40000.00"),
            description="Facture FA-2026-0001",
            date=datetime.date(2026, 1, 15),
        )
        # 2026-01-20: Credit 15,000 (Payment 1)
        ClientLedger.objects.create(
            client=self.client_obj,
            entry_type="credit",
            amount=Decimal("15000.00"),
            description="Règlement chèque",
            date=datetime.date(2026, 1, 20),
        )
        # 2026-02-10: Debit 25,000 (Invoice 2)
        ClientLedger.objects.create(
            client=self.client_obj,
            entry_type="debit",
            amount=Decimal("25000.00"),
            description="Facture FA-2026-0002",
            date=datetime.date(2026, 2, 10),
        )
        # 2026-02-18: Credit 10,000 (Payment 2)
        ClientLedger.objects.create(
            client=self.client_obj,
            entry_type="credit",
            amount=Decimal("10000.00"),
            description="Règlement espèces",
            date=datetime.date(2026, 2, 18),
        )

        # Query statement for February 2026
        data = get_client_statement_data(
            self.client_obj,
            from_date="2026-02-01",
            to_date="2026-02-28",
        )

        assert data["opening_balance"] == Decimal("25000.00")  # 40,000 - 15,000
        assert data["period_debits"] == Decimal("25000.00")
        assert data["period_credits"] == Decimal("10000.00")
        assert data["closing_balance"] == Decimal("40000.00")  # 25,000 + 25,000 - 10,000
        assert (
            data["opening_balance"] + data["period_debits"] - data["period_credits"]
            == data["closing_balance"]
        )
        assert len(data["entries"]) == 2
        assert data["entries"][0]["running_balance"] == Decimal("50000.00")
        assert data["entries"][1]["running_balance"] == Decimal("40000.00")

    def test_client_statement_api_json(self):
        ClientLedger.objects.create(
            client=self.client_obj,
            entry_type="debit",
            amount=Decimal("5000.00"),
            description="Vente comptoir",
            date=datetime.date(2026, 2, 1),
        )

        api = _make_api_client(self.manager)
        url = f"/api/v1/clients/{self.client_obj.id}/statement/?from=2026-02-01&to=2026-02-28"
        resp = api.get(url)

        assert resp.status_code == 200
        payload = resp.json()
        assert payload["client_name"] == "Sarl Chaussures Dz"
        assert payload["opening_balance"] == "0.00"
        assert payload["period_debits"] == "5000.00"
        assert payload["period_credits"] == "0.00"
        assert payload["closing_balance"] == "5000.00"
        assert len(payload["entries"]) == 1

    def test_client_statement_api_pdf(self, monkeypatch):
        fake_pdf = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\ntrailer\nstartxref\n%%EOF"
        monkeypatch.setattr("apps.clients.services.statement.render_to_pdf", lambda *args, **kwargs: fake_pdf)

        ClientLedger.objects.create(
            client=self.client_obj,
            entry_type="debit",
            amount=Decimal("12000.00"),
            description="Facture FA-001",
            date=datetime.date(2026, 2, 1),
        )

        api = _make_api_client(self.manager)
        url = f"/api/v1/clients/{self.client_obj.id}/statement/?format=pdf"
        resp = api.get(url)

        assert resp.status_code == 200
        assert resp["Content-Type"] == "application/pdf"
        assert resp.content.startswith(b"%PDF")

    def test_client_statement_api_xlsx(self):
        ClientLedger.objects.create(
            client=self.client_obj,
            entry_type="debit",
            amount=Decimal("18000.00"),
            description="Facture FA-002",
            date=datetime.date(2026, 2, 5),
        )

        api = _make_api_client(self.manager)
        url = f"/api/v1/clients/{self.client_obj.id}/statement/?format=xlsx"
        resp = api.get(url)

        assert resp.status_code == 200
        assert "spreadsheetml" in resp["Content-Type"]

        # Validate with openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(resp.content))
        ws = wb.active
        assert ws.title == "Relevé de compte"
        # Check that client name and amounts appear
        found_name = False
        for row in ws.iter_rows(values_only=True):
            if "Sarl Chaussures Dz" in [str(c) for c in row]:
                found_name = True
                break
        assert found_name

    def test_bulk_statements_zip_manager(self, monkeypatch):
        fake_pdf = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\ntrailer\nstartxref\n%%EOF"
        monkeypatch.setattr("apps.clients.services.statement.render_to_pdf", lambda *args, **kwargs: fake_pdf)

        # Create debt on client_obj
        ClientLedger.objects.create(
            client=self.client_obj,
            entry_type="debit",
            amount=Decimal("30000.00"),
            description="Facture FA-003",
            date=datetime.date(2026, 2, 1),
        )
        self.client_obj.refresh_from_db()
        assert self.client_obj.cached_balance == Decimal("30000.00")

        api = _make_api_client(self.manager)
        url = "/api/v1/clients/statements-zip/"
        resp = api.get(url)

        assert resp.status_code == 200
        assert resp["Content-Type"] == "application/zip"

        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            files = zf.namelist()
            assert len(files) >= 1
            assert any(str(self.client_obj.id) in f for f in files)

    def test_bulk_statements_zip_cashier_denied(self):
        api = _make_api_client(self.cashier)
        url = "/api/v1/clients/statements-zip/"
        resp = api.get(url)
        assert resp.status_code == 403

    def test_client_statement_permissions(self):
        cashier_api = _make_api_client(self.cashier)
        manager_api = _make_api_client(self.manager)
        url = f"/api/v1/clients/{self.client_obj.id}/statement/"

        resp = cashier_api.get(url)
        assert resp.status_code == 403

        resp = manager_api.get(url)
        assert resp.status_code == 200

    def test_client_statement_with_open_invoices(self):
        from apps.invoicing.models import Invoice, InvoiceLine

        inv = Invoice.objects.create(
            tenant=self.tenant,
            client=self.client_obj,
            number="FA-2026-0099",
            date=datetime.date(2026, 1, 10),
            due_date=datetime.date(2026, 1, 30),
            status="sent",
        )
        InvoiceLine.objects.create(
            invoice=inv,
            description="Chaussures cuir",
            quantity=Decimal("10"),
            unit_price=Decimal("5000.00"),
        )
        inv.compute_totals()
        inv.save(update_fields=["total_ht", "total_ttc"])

        data = get_client_statement_data(self.client_obj, to_date="2026-02-15")
        assert len(data["open_invoices"]) == 1
        assert data["open_invoices"][0]["number"] == "FA-2026-0099"
        assert data["open_invoices"][0]["days_old"] == 36
        assert data["open_invoices"][0]["bucket"] == "31-60j"
        assert data["open_invoices"][0]["is_overdue"] is True
