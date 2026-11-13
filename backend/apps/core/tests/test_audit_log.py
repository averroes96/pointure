import datetime
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.clients.models import Client
from apps.core.models import AuditLog, PlanChoices, RoleChoices, StoreSettings, Tenant, User
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


def test_store_settings_audit_serializes_digest_time(setup):
    tenant, _owner, _client = setup
    settings = StoreSettings.objects.create(
        tenant=tenant, telegram_digest_time=datetime.time(21, 30),
    )

    log = AuditLog.objects.filter(
        tenant=tenant, model_name="StoreSettings", object_id=str(settings.pk), action="create"
    ).get()
    assert log.diff["telegram_digest_time"]["to"] == "21:30:00"


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


def test_store_settings_update_records_time_and_decimal(setup):
    tenant, _owner, _client = setup
    settings = StoreSettings.objects.create(
        tenant=tenant,
        telegram_digest_time=datetime.time(21, 0),
        alert_cash_gap_amount=Decimal("1000.00"),
    )
    settings.telegram_digest_time = datetime.time(22, 15)
    settings.alert_cash_gap_amount = Decimal("2500.50")
    settings.save()

    log = AuditLog.objects.filter(
        tenant=tenant, model_name="StoreSettings", object_id=str(settings.pk), action="update"
    ).latest("timestamp")
    assert log.diff["telegram_digest_time"]["from"] == "21:00:00"
    assert log.diff["telegram_digest_time"]["to"] == "22:15:00"
    assert log.diff["alert_cash_gap_amount"]["from"] == "1000.00"
    assert log.diff["alert_cash_gap_amount"]["to"] == "2500.50"


def test_product_audit_keeps_json_breakdown_and_decimal_price(setup):
    from apps.inventory.models import CategoryChoices, Product

    tenant, _owner, _client = setup
    product = Product.objects.create(
        tenant=tenant,
        name="Carton audit",
        category=CategoryChoices.SNEAKERS,
        purchase_price=Decimal("1500.00"),
        carton_breakdown={"42": 6, "43": 6},
    )
    product.purchase_price = Decimal("1800.50")
    product.carton_breakdown = {"42": 4, "43": 8}
    product.save()

    log = AuditLog.objects.filter(
        tenant=tenant, model_name="Product", object_id=str(product.pk), action="update"
    ).latest("timestamp")
    assert log.diff["purchase_price"]["from"] == "1500.00"
    assert log.diff["purchase_price"]["to"] == "1800.50"
    assert log.diff["carton_breakdown"]["to"] == {"42": 4, "43": 8}


def test_audit_payload_serializes_nested_time_decimal_and_odd_types():
    from apps.core.signals import _freeze_for_json

    frozen = _freeze_for_json({
        "when": datetime.time(21, 30),
        "amount": Decimal("10.50"),
        "meta": {"wait": datetime.timedelta(minutes=90)},
        "tags": {"beta", "stable"},
        "blob": b"ok",
    })
    assert frozen["when"] == "21:30:00"
    assert frozen["amount"] == "10.50"
    assert frozen["meta"]["wait"] == "P0DT01H30M00S"
    assert sorted(frozen["tags"]) == ["beta", "stable"]
    assert frozen["blob"] == "ok"


def test_audit_and_outbox_failures_do_not_abort_the_save(setup, monkeypatch):
    from apps.core.models import SyncOutbox

    tenant, _owner, client_obj = setup

    def boom(*args, **kwargs):
        raise TypeError("audit storage failed")

    monkeypatch.setattr(AuditLog.objects, "create", boom)
    monkeypatch.setattr(SyncOutbox.objects, "create", boom)
    client_obj.name = "Still saved"
    client_obj.save()
    client_obj.refresh_from_db()
    assert client_obj.name == "Still saved"


def test_signals_skip_historical_models_during_migrations(setup):
    """
    Ensure saving historical models (created by Django migrations under '__fake__')
    never triggers audit logs or raises ForeignKey assignment errors on AuditLog.tenant.
    """
    import importlib
    from django.apps import apps as global_apps
    from django.db.migrations.state import ProjectState
    from apps.sales.models import CashSession, Payment, Sale

    tenant, owner, _ = setup
    session = CashSession.objects.create(tenant=tenant, cashier=owner, opening_float=Decimal("0"))
    sale = Sale.objects.create(tenant=tenant, cashier=owner, session=session, total_amount=Decimal("1500"))
    payment = Payment.objects.create(sale=sale, amount=Decimal("1500"), method="cash")

    project_state = ProjectState.from_apps(global_apps)
    FakePayment = project_state.apps.get_model("sales", "Payment")
    assert getattr(FakePayment, "__module__", "") == "__fake__"

    fake_p = FakePayment.objects.get(id=payment.id)
    fake_p.session_id = session.id
    # Saving fake_p directly must not crash with ValueError on AuditLog.tenant
    fake_p.save(update_fields=["session_id"])

    # Run the backfill migration function directly
    migration_mod = importlib.import_module("apps.sales.migrations.0008_payment_session")
    migration_mod.backfill_payment_session(project_state.apps, None)

    payment.refresh_from_db()
    assert payment.session_id == session.id
    # No AuditLog entries should be written for historical models
    assert not AuditLog.objects.filter(tenant=tenant, model_name="Payment").exists()



