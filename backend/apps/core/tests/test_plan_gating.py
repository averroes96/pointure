"""
Tests for plan-based feature gating.
Verify that PlanRequired permission class correctly blocks under-plan tenants.
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


def _invoice_payload():
    return {
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
                "description": "Test Shoe",
                "variant": None,
                "quantity": "1",
                "unit_price": "5000.00",
                "discount_pct": "0",
            }
        ],
    }


@pytest.mark.django_db
class TestPlanGating:
    """Plan-based access control."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.core.models import PlanChoices, RoleChoices, Tenant, User

        self.free_tenant = Tenant.objects.create(name="Free Shop", plan=PlanChoices.FREE)
        self.pro_tenant = Tenant.objects.create(name="Pro Wholesale Shop", plan=PlanChoices.PRO_WHOLESALE)

        self.free_manager = User.objects.create_user(
            email="mgr@free.com",
            password="testpass123",
            tenant=self.free_tenant,
            role=RoleChoices.MANAGER,
        )
        self.pro_manager = User.objects.create_user(
            email="mgr@pro.com",
            password="testpass123",
            tenant=self.pro_tenant,
            role=RoleChoices.MANAGER,
        )

    def test_free_tenant_cannot_create_invoice(self):
        """Free plan tenant receives 403 when POSTing to /invoicing/invoices/."""
        c = _make_client(self.free_manager)
        resp = c.post("/api/v1/invoicing/invoices/", _invoice_payload(), format="json")
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}: {resp.data}"

    def test_pro_wholesale_can_create_invoice(self):
        """Pro Wholesale plan tenant can create invoices → 201."""
        c = _make_client(self.pro_manager)
        resp = c.post("/api/v1/invoicing/invoices/", _invoice_payload(), format="json")
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.data}"

    def test_free_tenant_cannot_access_delivery_notes(self):
        """Free plan tenant receives 403 on GET /invoicing/delivery-notes/."""
        c = _make_client(self.free_manager)
        resp = c.get("/api/v1/invoicing/delivery-notes/")
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}: {resp.data}"

    def test_plan_upgrade_required_error_code(self):
        """Response for plan-gated endpoint includes error code and required_plan."""
        c = _make_client(self.free_manager)
        resp = c.post("/api/v1/invoicing/invoices/", _invoice_payload(), format="json")
        assert resp.status_code == 403
        # Custom exception handler wraps as {"error": {"code": ..., "details": {plan info}}}
        # Fall back to string search which works regardless of nesting depth
        body = str(resp.data)
        assert "plan_upgrade_required" in body, f"Expected plan_upgrade_required in: {body}"
        assert "pro_wholesale" in body, f"Expected required_plan in: {body}"
