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


def test_authorizer_recorded_via_dynamic_attribute(setup):
    tenant, owner, client_obj = setup
    manager = User.objects.create_user(
        email="mgr-dyn@test.com", password="testpass123",
        tenant=tenant, role=RoleChoices.MANAGER,
    )
    client_obj.credit_limit = Decimal("50000.00")
    client_obj._authorized_by = manager
    client_obj.save()

    log = AuditLog.objects.filter(
        tenant=tenant, model_name="Client", object_id=str(client_obj.pk), action="update"
    ).latest("timestamp")
    assert log.diff["_authorized_by"]["id"] == str(manager.pk)
    assert log.diff["_authorized_by"]["name"] == (manager.get_full_name() or manager.email)


def test_audit_log_endpoint_filtering_and_permissions(setup):
    tenant, owner, client_obj = setup
    cashier = User.objects.create_user(
        email="cashier-audit@test.com", password="testpass123",
        tenant=tenant, role=RoleChoices.CASHIER,
    )
    api = APIClient()

    # Cashier cannot access audit logs (403)
    api.force_authenticate(user=cashier)
    res_cashier = api.get("/api/v1/core/audit-logs/")
    assert res_cashier.status_code == 403

    # Owner can access and filter
    api.force_authenticate(user=owner)
    res_all = api.get("/api/v1/core/audit-logs/")
    assert res_all.status_code == 200

    # Filter by model_name
    res_client = api.get("/api/v1/core/audit-logs/?model_name=Client")
    assert res_client.status_code == 200
    for entry in res_client.data["results"]:
        assert entry["model_name"] == "Client"

    # Filter by action
    res_create = api.get("/api/v1/core/audit-logs/?action=create")
    assert res_create.status_code == 200
    for entry in res_create.data["results"]:
        assert entry["action"] == "create"

    # Filter by date
    from django.utils import timezone
    today = timezone.localdate().isoformat()
    res_today = api.get(f"/api/v1/core/audit-logs/?date_from={today}&date_to={today}")
    assert res_today.status_code == 200


def test_additional_models_audit_logging(setup):
    from apps.promotions.models import Promotion
    from apps.inventory.models import Product, Variant, StockTransfer, CategoryChoices
    from apps.core.models import Branch

    tenant, owner, _ = setup
    branch_a = Branch.objects.create(tenant=tenant, name="Branch 1")
    branch_b = Branch.objects.create(tenant=tenant, name="Branch 2")

    product = Product.objects.create(
        tenant=tenant, name="Audit Sneaker", category=CategoryChoices.SNEAKERS, sale_price=Decimal("1000")
    )
    variant = Variant.objects.create(tenant=tenant, product=product, size_eu=42)

    promo = Promotion.objects.create(
        tenant=tenant,
        name="Summer Sale",
        discount_pct=Decimal("15"),
        start_date="2026-06-01",
        end_date="2026-06-30",
    )
    assert AuditLog.objects.filter(tenant=tenant, model_name="Promotion", object_id=str(promo.pk)).exists()

    transfer = StockTransfer.objects.create(
        tenant=tenant,
        from_branch=branch_a,
        to_branch=branch_b,
        variant=variant,
        quantity=5,
        created_by=owner,
    )
    assert AuditLog.objects.filter(tenant=tenant, model_name="StockTransfer", object_id=str(transfer.pk)).exists()


