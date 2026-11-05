from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.clients.models import Client
from apps.core.models import AuditLog, PlanChoices, RoleChoices, Tenant, User
from apps.core.signals import set_current_user


@pytest.fixture(autouse=True)
def _reset_current_user():
    yield
    set_current_user(None)


@pytest.fixture
def setup(db):
    tenant = Tenant.objects.create(name="Audit Shop", plan=PlanChoices.PRO_WHOLESALE)
    owner = User.objects.create_user(
        email="owner-audit@test.com", password="testpass123",
        tenant=tenant, role=RoleChoices.OWNER,
    )
    client_obj = Client.objects.create(
        tenant=tenant, name="Audit Client", phone="0552223399",
        credit_limit=Decimal("10000.00"),
    )
    return tenant, owner, client_obj


def test_credit_limit_change_creates_audit_row_with_before_and_after(setup):
    tenant, owner, client_obj = setup
    api = APIClient()
    api.force_authenticate(user=owner)

    res = api.patch(
        f"/api/v1/clients/{client_obj.pk}/", {"credit_limit": "25000.00"}, format="json"
    )
    assert res.status_code == 200

    log = AuditLog.objects.filter(
        tenant=tenant, model_name="Client", object_id=str(client_obj.pk), action="update"
    ).latest("timestamp")
    assert log.user == owner
    assert log.diff["credit_limit"]["from"] == "10000.00"
    assert log.diff["credit_limit"]["to"] == "25000.00"


def test_newly_audited_models_and_authorizer_are_recorded(setup):
    from apps.sales.models import CashMovement, CashSession

    tenant, owner, _ = setup
    manager = User.objects.create_user(
        email="mgr-audit@test.com", password="testpass123",
        tenant=tenant, role=RoleChoices.MANAGER,
    )
    session = CashSession.objects.create(tenant=tenant, cashier=owner, opening_float=Decimal("0"))
    assert AuditLog.objects.filter(tenant=tenant, model_name="CashSession").exists()

    CashMovement.objects.create(
        session=session, type="out", amount=Decimal("100"), category="Dépense", created_by=owner
    )
    assert AuditLog.objects.filter(tenant=tenant, model_name="CashMovement").exists()

    from apps.sales.models import Return, Sale

    sale = Sale.objects.create(tenant=tenant, cashier=owner, total_amount=Decimal("100"), status="completed")
    Return.objects.create(
        tenant=tenant, original_sale=sale, processed_by=owner, authorized_by=manager,
        reason="x", refund_amount=Decimal("100"), refund_method="cash",
    )
    log = AuditLog.objects.filter(tenant=tenant, model_name="Return", action="create").latest("timestamp")
    assert log.diff["_authorized_by"]["id"] == str(manager.pk)

