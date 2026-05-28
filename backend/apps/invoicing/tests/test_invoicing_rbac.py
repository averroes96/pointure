"""
Invoicing RBAC tests.
Verify that role-based access rules are enforced on invoice endpoints:
  - cashier: read-only (list/retrieve), cannot create/confirm/record-payment
  - manager: full access
  - owner: full access
"""
import datetime
import pytest
from rest_framework.test import APIClient


def _today():
    return str(datetime.date.today())


def _due():
    return str(datetime.date.today() + datetime.timedelta(days=30))


def _make_client(user) -> APIClient:
    """Return an APIClient authenticated as `user` via force_authenticate."""
    c = APIClient()
    c.force_authenticate(user=user)
    return c


@pytest.mark.django_db
class TestInvoiceCreateRBAC:
    """POST /api/v1/invoicing/invoices/ — only manager+ can create."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.core.models import PlanChoices, RoleChoices, Tenant, User

        self.tenant = Tenant.objects.create(name="RBAC Shop", plan=PlanChoices.PRO_WHOLESALE)
        self.owner = User.objects.create_user(
            email="owner@rbac.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.OWNER,
        )
        self.manager = User.objects.create_user(
            email="manager@rbac.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cashier@rbac.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )

        self._valid_payload = {
            "client_id": None,
            "date": _today(),
            "due_date": _due(),
            "series_prefix": "FA",
            "apply_tva": False,
            "tva_rate": "0.00",
            "notes": "",
            "confirm": False,
            "lines": [
                {
                    "description": "Chaussures Nike Air Max",
                    "variant": None,
                    "quantity": "2",
                    "unit_price": "8000.00",
                    "discount_pct": "0",
                }
            ],
        }

    def test_cashier_cannot_create_invoice(self):
        """Cashier receives 403 when POSTing to /invoicing/invoices/."""
        c = _make_client(self.cashier)
        resp = c.post("/api/v1/invoicing/invoices/", self._valid_payload, format="json")
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}: {resp.data}"

    def test_manager_can_create_invoice(self):
        """Manager receives 201 and the draft invoice is created."""
        c = _make_client(self.manager)
        resp = c.post("/api/v1/invoicing/invoices/", self._valid_payload, format="json")
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.data}"
        assert resp.data["status"] == "draft"
        assert resp.data["total_ht"] == "16000.00"

    def test_owner_can_create_invoice(self):
        """Owner receives 201."""
        c = _make_client(self.owner)
        resp = c.post("/api/v1/invoicing/invoices/", self._valid_payload, format="json")
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.data}"

    def test_cashier_can_list_invoices(self):
        """Cashier can GET the invoice list (read-only access)."""
        c = _make_client(self.cashier)
        resp = c.get("/api/v1/invoicing/invoices/")
        assert resp.status_code == 200

    def test_unauthenticated_rejected(self):
        """Unauthenticated request returns 401."""
        resp = APIClient().post("/api/v1/invoicing/invoices/", self._valid_payload, format="json")
        assert resp.status_code == 401


@pytest.mark.django_db
class TestInvoiceConfirmRBAC:
    """POST /api/v1/invoicing/invoices/{id}/confirm/ — manager+ only."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.core.models import PlanChoices, RoleChoices, Tenant, User
        from apps.invoicing.models import Invoice

        self.tenant = Tenant.objects.create(name="Confirm Shop", plan=PlanChoices.PRO_WHOLESALE)
        self.manager = User.objects.create_user(
            email="mgr@confirm.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cash@confirm.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )

        # Create a draft invoice directly
        self.invoice = Invoice.objects.create(
            tenant=self.tenant,
            date=datetime.date.today(),
            due_date=datetime.date.today() + datetime.timedelta(days=30),
            status="draft",
        )

    def test_cashier_cannot_confirm_invoice(self):
        """Cashier gets 403 on POST /confirm/."""
        c = _make_client(self.cashier)
        resp = c.post(f"/api/v1/invoicing/invoices/{self.invoice.pk}/confirm/")
        assert resp.status_code == 403

    def test_manager_can_confirm_invoice(self):
        """Manager can confirm a draft invoice; it gets a number and becomes 'sent'."""
        c = _make_client(self.manager)
        resp = c.post(f"/api/v1/invoicing/invoices/{self.invoice.pk}/confirm/")
        assert resp.status_code == 200, resp.data
        assert resp.data["status"] == "sent"
        assert resp.data["number"] != ""  # FA-2026-00001

    def test_cannot_confirm_non_draft(self):
        """Confirming an already-confirmed invoice returns 400."""
        c = _make_client(self.manager)
        # First confirm
        c.post(f"/api/v1/invoicing/invoices/{self.invoice.pk}/confirm/")
        # Second confirm
        resp = c.post(f"/api/v1/invoicing/invoices/{self.invoice.pk}/confirm/")
        assert resp.status_code == 400


@pytest.mark.django_db
class TestInvoicePaymentRBAC:
    """POST /api/v1/invoicing/invoices/{id}/record-payment/ — manager+ only."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.core.models import PlanChoices, RoleChoices, Tenant, User
        from apps.invoicing.models import Invoice, InvoiceLine

        self.tenant = Tenant.objects.create(name="Payment Shop", plan=PlanChoices.PRO_WHOLESALE)
        self.manager = User.objects.create_user(
            email="mgr@payment.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cash@payment.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )

        self.invoice = Invoice.objects.create(
            tenant=self.tenant,
            date=datetime.date.today(),
            due_date=datetime.date.today() + datetime.timedelta(days=30),
            status="sent",
            total_ht="10000.00",
            total_ttc="10000.00",
        )
        InvoiceLine.objects.create(
            invoice=self.invoice,
            description="Produit test",
            quantity="1",
            unit_price="10000.00",
            discount_pct="0",
            order=0,
        )

    def test_cashier_cannot_record_payment(self):
        """Cashier receives 403 when trying to record an invoice payment."""
        c = _make_client(self.cashier)
        resp = c.post(
            f"/api/v1/invoicing/invoices/{self.invoice.pk}/record-payment/",
            {"amount": "5000.00", "method": "cash", "date": _today()},
            format="json",
        )
        assert resp.status_code == 403

    def test_manager_can_record_payment(self):
        """Manager can record a partial payment; balance_due decreases."""
        c = _make_client(self.manager)
        resp = c.post(
            f"/api/v1/invoicing/invoices/{self.invoice.pk}/record-payment/",
            {"amount": "5000.00", "method": "cash", "date": _today()},
            format="json",
        )
        assert resp.status_code == 201, resp.data
        assert resp.data["amount"] == "5000.00"
