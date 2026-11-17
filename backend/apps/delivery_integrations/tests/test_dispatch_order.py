"""
Dispatch of a delivery order through dzship (docs/plans/delivery-v1-plan.md P2.4).

  - Everything is checked locally before the courier is called; nothing changes on a refusal.
  - The courier call runs outside any transaction, with our order id as `reference`.
  - Stock leaves once (one `delivery_out` per line); no sale is created (DL2.1).
  - Errors never leak exception text; the courier's own refusal reason is passed on.
Also keeps the K4/K5 checks (§3) and the dzship client checks. Synthetic data only.
"""
import json
import logging
from datetime import date
from decimal import Decimal
from unittest import mock

import pytest
import requests
from django.db import connection
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.closing.models import FiscalYear, FiscalYearStatusChoices
from apps.core.models import PlanChoices, RoleChoices, StoreSettings, Tenant, User
from apps.delivery_integrations.models import (
    CustomerOrder, CustomerOrderLine, CustomerOrderStatusChoices, ProviderConfig,
)
from apps.delivery_integrations.services import catalogue, communes, dispatch, geo
from apps.delivery_integrations.services.dzship_client import DzshipClient, DzshipError
from apps.inventory.models import MovementReasonChoices, Product, StockMovement, Variant
from apps.sales.models import Sale

CREATE_ORDER = "apps.delivery_integrations.services.dzship_client.DzshipClient.create_order"
REQUEST_SYNC = "apps.delivery_integrations.views.sync.request_sync"

CATALOGUE = [
    {"key": "maystro", "name": "Maystro", "platform": "maystro", "requiredCredentials": ["apiKey"],
     "capabilities": {}, "endpoint": "https://backend.example-courier.dz/api"},
    {"key": "sandbox", "name": "Sandbox", "platform": "sandbox", "requiredCredentials": [], "capabilities": {}},
]
COURIER_COMMUNES = [
    {"wilaya_code": 16, "name_fr": "Bab Ezzouar", "name_ar": "باب الزوار", "ship_as": None},
    {"wilaya_code": 16, "name_fr": "Mohamed Belouzdad", "name_ar": "محمد بلوزداد", "ship_as": None},
    {"wilaya_code": 12, "name_fr": "Bir El Ater", "name_ar": "بئر العاتر", "ship_as": None},
]


@pytest.fixture(autouse=True)
def snapshots(settings, tmp_path):
    settings.DATA_DIR = tmp_path
    communes._index_cache.update(fetched_at=None, index=None)
    catalogue.snapshot_path().write_text(json.dumps({
        "fetched_at": timezone.now().isoformat(),
        "couriers": [catalogue.clean_entry(e) for e in CATALOGUE],
    }), encoding="utf-8")
    geo.communes_store.path().write_text(json.dumps({
        "fetched_at": timezone.now().isoformat(), "rows": COURIER_COMMUNES,
    }), encoding="utf-8")
    yield
    communes._index_cache.update(fetched_at=None, index=None)


@pytest.fixture
def store(db):
    tenant = Tenant.objects.create(name="Dispatch Store", plan=PlanChoices.PRO_RETAIL, wilaya="16")
    owner = User.objects.create_user(email="owner-dispatch@test.com", password="password123",
                                     role=RoleChoices.OWNER, tenant=tenant)
    StoreSettings.objects.create(tenant=tenant, enable_delivery_integrations=True)
    config = ProviderConfig.objects.create(tenant=tenant, courier="maystro", credentials={"apiKey": "secret-key"})
    product = Product.objects.create(tenant=tenant, name="Basket Air", reference="BA-1", sale_price=Decimal("4500.00"))
    v42 = Variant.objects.create(tenant=tenant, product=product, size_eu=42)
    v43 = Variant.objects.create(tenant=tenant, product=product, size_eu=43)
    for v in (v42, v43):
        StockMovement.objects.create(tenant=tenant, variant=v, quantity_delta=10, reason=MovementReasonChoices.INITIAL)
    order = CustomerOrder.objects.create(
        tenant=tenant, customer_name="Amine Test", customer_phone="0551234567",
        wilaya="16", commune="Bab Ezzouar", address="12 rue des Tests", shipping_fee=Decimal("600"),
    )
    CustomerOrderLine.objects.create(order=order, variant=v42, quantity=2, unit_price=Decimal("4500"),
                                     discount_amount=Decimal("500"), position=0)
    CustomerOrderLine.objects.create(order=order, variant=v43, quantity=1, unit_price=Decimal("4500"), position=1)
    client = APIClient()
    client.force_authenticate(user=owner)
    return {"tenant": tenant, "owner": owner, "config": config, "v42": v42, "v43": v43,
            "order": order, "client": client}


def _dispatch(s, config=None):
    return s["client"].post(
        f"/api/v1/deliveries/customer-orders/{s['order'].pk}/dispatch_order/",
        {"provider_config": str((config or s["config"]).pk)}, format="json",
    )


def _out_movements(s):
    return StockMovement.objects.filter(tenant=s["tenant"], reason=MovementReasonChoices.DELIVERY_OUT)


def _assert_untouched(s):
    s["order"].refresh_from_db()
    assert s["order"].status == CustomerOrderStatusChoices.DRAFT
    assert (s["order"].tracking_number, s["order"].dispatched_at, s["order"].dispatched_by) == (None, None, None)
    assert _out_movements(s).count() == 0
    assert Sale.objects.filter(tenant=s["tenant"]).count() == 0


# ─── Happy path ───────────────────────────────────────────────────────────────

def test_dispatch_sends_the_saved_order_moves_stock_once_and_creates_no_sale(
        store, django_capture_on_commit_callbacks):
    s = store
    with mock.patch(CREATE_ORDER, return_value={"trackingNumber": "MAY-1", "status": "created"}) as create, \
            mock.patch(REQUEST_SYNC) as request_sync, \
            django_capture_on_commit_callbacks(execute=True):
        res = _dispatch(s)

    assert res.status_code == status.HTTP_200_OK, res.content
    assert res.json()["trackingNumber"] == "MAY-1"
    assert res.json()["order"]["status"] == "dispatched"

    args, kwargs = create.call_args
    assert args[:2] == ("maystro", {"apiKey": "secret-key"})
    assert kwargs == {"base_url": "", "from_wilaya": 16}
    assert args[2] == {
        "reference": str(s["order"].pk),
        "recipient": {"fullName": "Amine Test", "phone": "0551234567", "wilayaCode": 16,
                      "communeName": "Bab Ezzouar", "addressLine": "12 rue des Tests"},
        "deliveryType": "home",
        "productList": "Basket Air 42 x2 / Basket Air 43 x1",
        "codAmount": 13600,
        "freeShipping": False,
        "hasOpenPackage": False,
    }

    order = s["order"]
    order.refresh_from_db()
    assert order.status == CustomerOrderStatusChoices.DISPATCHED
    assert (order.provider, order.tracking_number, order.dispatched_by) == ("maystro", "MAY-1", s["owner"])
    assert order.dispatched_at is not None and order.sale_id is None
    assert Sale.objects.filter(tenant=s["tenant"]).count() == 0

    movements = sorted(_out_movements(s).values_list("variant_id", "quantity_delta", "reference_type", "reference_id"))
    assert movements == sorted([
        (s["v42"].pk, -2, "CustomerOrder", str(order.pk)),
        (s["v43"].pk, -1, "CustomerOrder", str(order.pk)),
    ])
    s["v42"].refresh_from_db()
    s["v43"].refresh_from_db()
    assert (s["v42"].stock_qty, s["v43"].stock_qty) == (8, 9)
    request_sync.assert_called_once_with(s["config"].pk, "dispatch")


def test_stop_desk_order_with_options_and_a_new_wilaya(store):
    s = store
    order = s["order"]
    order.wilaya, order.commune, order.address = "62", "Bir El-Ater", ""
    order.delivery_type, order.stop_desk_id, order.stop_desk_name = "stopdesk", "D-77", "Bureau Bir El Ater"
    order.customer_phone2 = "0661234567"
    order.free_shipping, order.open_package, order.note_to_driver = True, True, "  Appeler avant  "
    order.cod_amount = Decimal("10000")
    order.save()
    s["tenant"].wilaya = "68"            # Bou Saâda ships from M'Sila (28)
    s["tenant"].save()

    with mock.patch(CREATE_ORDER, return_value={"trackingNumber": "MAY-2"}) as create, mock.patch(REQUEST_SYNC):
        res = _dispatch(s)

    assert res.status_code == status.HTTP_200_OK, res.content
    sent = create.call_args.args[2]
    assert sent["recipient"] == {"fullName": "Amine Test", "phone": "0551234567", "phoneAlt": "0661234567",
                                 "wilayaCode": 12, "communeName": "Bir El Ater", "addressLine": "Bir El Ater"}
    assert (sent["deliveryType"], sent["stopDeskId"], sent["codAmount"]) == ("stopdesk", "D-77", 10000)
    assert (sent["freeShipping"], sent["hasOpenPackage"], sent["notes"]) == (True, True, "Appeler avant")
    assert create.call_args.kwargs["from_wilaya"] == 28


def test_sandbox_account_without_credentials_can_dispatch(store):
    s = store
    sandbox = ProviderConfig.objects.create(tenant=s["tenant"], courier="sandbox", credentials={})
    with mock.patch(CREATE_ORDER, return_value={"trackingNumber": "SBX-1"}) as create, mock.patch(REQUEST_SYNC):
        res = _dispatch(s, sandbox)
    assert res.status_code == status.HTTP_200_OK, res.content
    assert create.call_args.args[:2] == ("sandbox", {})


@pytest.mark.django_db(transaction=True)
def test_courier_is_called_outside_a_transaction(snapshots):
    tenant = Tenant.objects.create(name="Tx Store", plan=PlanChoices.PRO_RETAIL)
    owner = User.objects.create_user(email="tx@test.com", password="password123", role=RoleChoices.OWNER, tenant=tenant)
    StoreSettings.objects.create(tenant=tenant, enable_delivery_integrations=True, allow_negative_stock=True)
    config = ProviderConfig.objects.create(tenant=tenant, courier="sandbox", credentials={})
    product = Product.objects.create(tenant=tenant, name="P", reference="P-1", sale_price=Decimal("100"))
    variant = Variant.objects.create(tenant=tenant, product=product, size_eu=40)
    order = CustomerOrder.objects.create(tenant=tenant, customer_name="C", customer_phone="0551234567",
                                         wilaya="16", commune="Bab Ezzouar")
    CustomerOrderLine.objects.create(order=order, variant=variant, quantity=1, unit_price=Decimal("100"))
    client = APIClient()
    client.force_authenticate(user=owner)
    seen = {}

    def fake_create(*args, **kwargs):
        seen["in_atomic"] = connection.in_atomic_block
        return {"trackingNumber": "TX-1"}

    with mock.patch(CREATE_ORDER, side_effect=fake_create), mock.patch(REQUEST_SYNC) as request_sync:
        res = client.post(f"/api/v1/deliveries/customer-orders/{order.pk}/dispatch_order/",
                          {"provider_config": str(config.pk)}, format="json")

    assert res.status_code == status.HTTP_200_OK, res.content
    assert seen["in_atomic"] is False
    request_sync.assert_called_once_with(config.pk, "dispatch")


# ─── Checks before the courier is called ──────────────────────────────────────

def _no_lines(s):
    s["order"].lines.all().delete()


def _short_stock(s):
    StockMovement.objects.create(tenant=s["tenant"], variant=s["v42"], quantity_delta=-9,
                                 reason=MovementReasonChoices.ADJUSTMENT)


def _stopdesk_without_desk(s):
    CustomerOrder.objects.filter(pk=s["order"].pk).update(delivery_type="stopdesk", stop_desk_id="")


def _unknown_commune(s):
    CustomerOrder.objects.filter(pk=s["order"].pk).update(commune="Douera")


def _commune_in_another_wilaya(s):
    CustomerOrder.objects.filter(pk=s["order"].pk).update(commune="Bir El Ater")


def _no_commune_list(s):
    geo.communes_store.path().unlink()
    communes._index_cache.update(fetched_at=None, index=None)


def _bad_wilaya(s):
    CustomerOrder.objects.filter(pk=s["order"].pk).update(wilaya="")


def _bad_phone(s):
    CustomerOrder.objects.filter(pk=s["order"].pk).update(customer_phone="12345")


def _bad_phone2(s):
    CustomerOrder.objects.filter(pk=s["order"].pk).update(customer_phone2="0991234567")


def _no_name(s):
    CustomerOrder.objects.filter(pk=s["order"].pk).update(customer_name="  ")


def _cod_too_high(s):
    CustomerOrder.objects.filter(pk=s["order"].pk).update(cod_amount=Decimal("13601"))


def _inactive_account(s):
    ProviderConfig.objects.filter(pk=s["config"].pk).update(is_active=False)


def _incomplete_credentials(s):
    ProviderConfig.objects.filter(pk=s["config"].pk).update(credentials={"apiKey": ""})


def _closed_period(s):
    year = timezone.localdate().year
    FiscalYear.objects.create(tenant=s["tenant"], year=year, start_date=date(year, 1, 1),
                              end_date=date(year, 12, 31), status=FiscalYearStatusChoices.CLOSED,
                              closed_at=timezone.now(), closed_by=s["owner"])


def _already_claimed(s):
    CustomerOrder.objects.filter(pk=s["order"].pk).update(status=CustomerOrderStatusChoices.CONFIRMED)


@pytest.mark.parametrize("break_it,field", [
    (_no_lines, "lines"),
    (_short_stock, "lines"),
    (_stopdesk_without_desk, "stop_desk_id"),
    (_unknown_commune, "commune"),
    (_commune_in_another_wilaya, "commune"),
    (_no_commune_list, "commune"),
    (_bad_wilaya, "wilaya"),
    (_bad_phone, "customer_phone"),
    (_bad_phone2, "customer_phone2"),
    (_no_name, "customer_name"),
    (_cod_too_high, "cod_amount"),
    (_inactive_account, "provider_config"),
    (_incomplete_credentials, "provider_config"),
    (_already_claimed, "status"),
])
def test_local_checks_refuse_before_calling_the_courier(store, break_it, field):
    s = store
    break_it(s)
    with mock.patch(CREATE_ORDER) as create, \
            mock.patch.object(geo.communes_store, "start_background_refresh") as refresh:
        res = _dispatch(s)

    assert res.status_code == status.HTTP_400_BAD_REQUEST, res.content
    assert list(res.json()["error"]["details"].keys()) == [field]
    create.assert_not_called()
    assert refresh.called is (break_it is _no_commune_list)
    s["order"].refresh_from_db()
    expected = CustomerOrderStatusChoices.CONFIRMED if break_it is _already_claimed else CustomerOrderStatusChoices.DRAFT
    assert s["order"].status == expected
    assert _out_movements(s).count() == 0


def test_closed_period_is_refused_before_calling_the_courier(store):
    s = store
    _closed_period(s)
    with mock.patch(CREATE_ORDER) as create:
        res = _dispatch(s)
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert res.json()["error"]["code"] == "period_closed"
    create.assert_not_called()
    _assert_untouched(s)


def test_negative_stock_allowed_by_the_store_setting(store):
    s = store
    _short_stock(s)
    StoreSettings.objects.filter(tenant=s["tenant"]).update(allow_negative_stock=True)
    with mock.patch(CREATE_ORDER, return_value={"trackingNumber": "MAY-N"}), mock.patch(REQUEST_SYNC):
        res = _dispatch(s)
    assert res.status_code == status.HTTP_200_OK, res.content
    s["v42"].refresh_from_db()
    assert s["v42"].stock_qty == -1


def test_account_of_another_store_is_refused(store):
    s = store
    other = Tenant.objects.create(name="Other", plan=PlanChoices.PRO_RETAIL)
    foreign = ProviderConfig.objects.create(tenant=other, courier="maystro", credentials={"apiKey": "x"})
    with mock.patch(CREATE_ORDER) as create:
        res = _dispatch(s, foreign)
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert list(res.json()["error"]["details"].keys()) == ["provider_config"]
    create.assert_not_called()
    _assert_untouched(s)


def test_order_of_another_store_is_404(store):
    s = store
    other = Tenant.objects.create(name="Other", plan=PlanChoices.PRO_RETAIL)
    foreign = CustomerOrder.objects.create(tenant=other, customer_name="X", customer_phone="0551234567")
    with mock.patch(CREATE_ORDER) as create:
        res = s["client"].post(f"/api/v1/deliveries/customer-orders/{foreign.pk}/dispatch_order/",
                               {"provider_config": str(s["config"].pk)}, format="json")
    assert res.status_code == status.HTTP_404_NOT_FOUND
    create.assert_not_called()


# ─── Courier errors ───────────────────────────────────────────────────────────

def test_courier_refusal_passes_on_its_reason_without_logging_it(store, caplog):
    s = store
    reason = "Une commande pour Amine Test 0551234567 existe déjà (24 h)"
    views_logger = logging.getLogger("apps.delivery_integrations")
    views_logger.addHandler(caplog.handler)          # "apps" does not propagate (desktop LOGGING)
    try:
        with mock.patch("apps.delivery_integrations.services.dzship_client.requests.post",
                        return_value=_http_error(422, {"error": {"code": "COURIER_ERROR", "message": reason}})):
            res = _dispatch(s)
    finally:
        views_logger.removeHandler(caplog.handler)

    assert res.status_code == status.HTTP_502_BAD_GATEWAY
    error = res.json()["error"]
    assert error["code"] == "courier_refused"
    assert error["details"]["courier_message"] == reason
    assert "COURIER_ERROR" not in error["message"]
    assert "0551234567" not in caplog.text and "Amine" not in caplog.text
    assert "dzship create_order refused (courier=maystro, http=422, code=COURIER_ERROR)" in caplog.text
    _assert_untouched(s)


def test_courier_timeout_says_check_the_courier_app_and_keeps_draft(store):
    s = store
    with mock.patch(CREATE_ORDER, side_effect=DzshipError("TIMEOUT", None)):
        res = _dispatch(s)
    assert res.status_code == status.HTTP_502_BAD_GATEWAY
    assert res.json()["error"]["code"] == "courier_unreachable"
    _assert_untouched(s)


def test_unexpected_error_text_is_never_returned(store):
    s = store
    with mock.patch(CREATE_ORDER, side_effect=RuntimeError("secret internal detail")):
        res = _dispatch(s)
    assert res.status_code == status.HTTP_502_BAD_GATEWAY
    assert res.json()["error"]["code"] == "courier_refused"
    assert "secret internal detail" not in res.content.decode()
    _assert_untouched(s)


def test_recording_failure_after_acceptance_never_returns_to_draft(store):
    s = store
    with mock.patch(CREATE_ORDER, return_value={"trackingNumber": "MAY-F"}), mock.patch(REQUEST_SYNC) as request_sync, \
            mock.patch("apps.delivery_integrations.services.dispatch.StockMovement.objects.create",
                       side_effect=RuntimeError("disk full")):
        res = _dispatch(s)

    assert res.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert res.json()["error"]["code"] == "recorded_failed"
    assert "MAY-F" in res.json()["error"]["message"] and "disk full" not in res.content.decode()
    s["order"].refresh_from_db()
    assert s["order"].status == CustomerOrderStatusChoices.CONFIRMED      # never resent
    assert (s["order"].tracking_number, s["order"].provider) == ("MAY-F", "maystro")
    assert _out_movements(s).count() == 0                                   # rolled back together
    request_sync.assert_not_called()


# ─── Double dispatch ──────────────────────────────────────────────────────────

def test_second_dispatch_is_refused_and_stock_leaves_once(store):
    s = store
    with mock.patch(CREATE_ORDER, return_value={"trackingNumber": "MAY-D"}) as create, mock.patch(REQUEST_SYNC):
        first = _dispatch(s)
        second = _dispatch(s)
    assert first.status_code == status.HTTP_200_OK
    assert second.status_code == status.HTTP_400_BAD_REQUEST
    assert create.call_count == 1
    assert _out_movements(s).count() == 2


def test_record_dispatch_runs_once(store):
    s = store
    plan = dispatch.prepare(s["order"], s["config"], s["tenant"])
    assert dispatch.claim(s["order"], s["tenant"]) is True
    assert dispatch.claim(s["order"], s["tenant"]) is False
    dispatch.record_dispatch(s["order"], plan, s["config"], "MAY-O", s["owner"])
    again = dispatch.record_dispatch(s["order"], plan, s["config"], "MAY-O2", s["owner"])
    assert again.tracking_number == "MAY-O"
    assert _out_movements(s).count() == 2


# ─── K4 / K5 (kept from phase 1) ──────────────────────────────────────────────

def test_unsigned_webhook_receiver_is_disabled_and_changes_nothing(store):
    s = store
    CustomerOrder.objects.filter(pk=s["order"].pk).update(
        status=CustomerOrderStatusChoices.DISPATCHED, tracking_number="MAY-9")
    res = APIClient().post("/api/v1/deliveries/webhook/", {"trackingNumber": "MAY-9", "status": "returned"},
                           format="json")
    assert res.status_code == status.HTTP_404_NOT_FOUND
    s["order"].refresh_from_db()
    assert s["order"].status == CustomerOrderStatusChoices.DISPATCHED


def test_external_ingestion_error_does_not_leak_exception_text(store):
    s = store
    s["tenant"].api_key = "ingest-key"
    s["tenant"].save(update_fields=["api_key"])
    with mock.patch("apps.delivery_integrations.views.CustomerOrder.objects.create",
                    side_effect=RuntimeError("secret internal detail")):
        res = APIClient().post("/api/v1/deliveries/external-orders/", {"customer_name": "A", "phone": "0551234567"},
                               format="json", HTTP_X_API_KEY="ingest-key")
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert "secret internal detail" not in res.content.decode()


# ─── dzship client ────────────────────────────────────────────────────────────

def _http_error(status_code, body):
    res = mock.Mock(status_code=status_code)
    res.json.return_value = body
    res.raise_for_status.side_effect = requests.HTTPError(response=res)
    return res


@pytest.mark.parametrize("body,code,message", [
    ({"error": {"code": "COURIER_ERROR", "message": "  Doublon\n 24 h  "}}, "COURIER_ERROR", "Doublon 24 h"),
    ({"error": {"code": "X", "message": "m" * 400}}, "X", "m" * 300),
    ({"error": {"code": "X", "message": {"nested": 1}}}, "X", ""),
    ({"error": "flat string"}, "HTTP_ERROR", ""),
    (["not", "a", "dict"], "HTTP_ERROR", ""),
])
def test_dzship_error_message_is_read_defensively(body, code, message):
    with mock.patch("apps.delivery_integrations.services.dzship_client.requests.post",
                    return_value=_http_error(422, body)), pytest.raises(DzshipError) as exc:
        DzshipClient.create_order("maystro", {"apiKey": "k"}, {})
    assert (exc.value.code, exc.value.courier_message) == (code, message)


def test_dzship_client_sends_timeout_and_reference():
    response = mock.Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"trackingNumber": "MAY-3"}
    with mock.patch("apps.delivery_integrations.services.dzship_client.requests.post",
                    return_value=response) as post:
        data = DzshipClient.create_order(
            "maystro", {"apiToken": "k"}, {"reference": "ref-1", "codAmount": 100}
        )

    assert data == {"trackingNumber": "MAY-3"}
    kwargs = post.call_args.kwargs
    assert kwargs["timeout"] == DzshipClient.TIMEOUT_SECONDS
    assert kwargs["json"]["order"]["reference"] == "ref-1"
    assert "options" not in kwargs["json"]


@pytest.mark.parametrize("courier,credentials", [
    # K8: credentials go to dzship unchanged, under the catalogue's names.
    ("zrexpress", {"token": "t", "key": "k"}),
    ("noest", {"apiToken": "t", "guid": "g"}),
    ("maystro", {"apiKey": "k"}),
])
def test_dzship_client_sends_credentials_unchanged(courier, credentials):
    response = mock.Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"trackingNumber": "X"}
    with mock.patch("apps.delivery_integrations.services.dzship_client.requests.post",
                    return_value=response) as post:
        DzshipClient.create_order(courier, credentials, {})
    body = post.call_args.kwargs["json"]
    assert body["courier"] == courier
    assert body["credentials"] == credentials


def test_dzship_client_sends_base_url_for_generic_ecotrack():
    response = mock.Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"trackingNumber": "X"}
    with mock.patch("apps.delivery_integrations.services.dzship_client.requests.post",
                    return_value=response) as post:
        DzshipClient.create_order("ecotrack", {"token": "t"}, {}, base_url="https://shop.ecotrack.dz")
    assert post.call_args.kwargs["json"]["options"] == {"baseUrl": "https://shop.ecotrack.dz"}


def test_dzship_client_maps_timeout_and_error_envelope():
    with mock.patch("apps.delivery_integrations.services.dzship_client.requests.post",
                    side_effect=requests.Timeout()):
        with pytest.raises(DzshipError) as exc:
            DzshipClient.create_order("maystro", {"apiToken": "k"}, {})
    assert exc.value.code == "TIMEOUT"

    error_response = mock.Mock(status_code=400)
    error_response.json.return_value = {"error": {"code": "VALIDATION_ERROR", "message": "x"}}
    http_error = requests.HTTPError(response=error_response)
    failing = mock.Mock()
    failing.raise_for_status.side_effect = http_error
    with mock.patch("apps.delivery_integrations.services.dzship_client.requests.post",
                    return_value=failing):
        with pytest.raises(DzshipError) as exc:
            DzshipClient.create_order("maystro", {"apiToken": "k"}, {})
    assert exc.value.code == "VALIDATION_ERROR"
    assert exc.value.status_code == 400


