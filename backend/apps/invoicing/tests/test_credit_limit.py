"""
Tests for credit limit enforcement on invoice creation.
"""
import datetime
from decimal import Decimal

import pytest
from rest_framework.test import APIClient


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
    def setup(self, db):
        from apps.core.models import PlanChoices, RoleChoices, Tenant, User
        from apps.clients.models import Client

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
