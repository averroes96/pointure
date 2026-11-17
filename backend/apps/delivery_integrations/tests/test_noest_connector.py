"""
NOEST read connector and the "known parcels" sync for couriers without a list
(docs/plans/delivery-v1-plan.md P3.13). Built from third-party notes on NOEST's partner
docs (unverified); synthetic data shaped like the documented answers, all HTTP mocked.
"""
import json
import logging
from datetime import datetime
from decimal import Decimal
from unittest import mock
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import PlanChoices, RoleChoices, StoreSettings, Tenant, User
from apps.delivery_integrations.models import CustomerOrder, CustomerOrderLine, ProviderConfig, Shipment
from apps.delivery_integrations.services import catalogue, sync
from apps.delivery_integrations.services.couriers import (
    CashStatus,
    ConnectorAuthError,
    ConnectorError,
    ConnectorNotFound,
    ConnectorRateLimited,
    ShipmentStatus,
    get_connector,
)
from apps.delivery_integrations.services.couriers import noest
from apps.delivery_integrations.services.couriers.noest import NoestConnector, map_event, summarise

REQUEST = "apps.delivery_integrations.services.couriers.base.requests.request"
ALGIERS = ZoneInfo("Africa/Algiers")
CREDS = {"apiToken": "noest-SECRET-token-0001", "guid": "GUID-SECRET-0001"}
INFO = "https://app.noest-dz.com/api/public/get/trackings/info"

# dz-delivery's fixture (docs/fixtures/noest/statuses.json): every mapped key and label.
FIXTURE_MAPPED = [
    "upload", "customer_validation", "validation_collect_colis", "validation_reception_admin", "validation_reception",
    "fdr_activated", "sent_to_redispatch", "nouvel_tentative_asked_by_customer", "mise_a_jour", "colis_suspendu",
    "return_redispatched_to_livraison", "pickedup", "valid_return_pickup", "livre", "livred", "verssement_admin_cust",
    "verssement_admin_cust_canceled", "verssement_hub_cust_canceled", "validation_reception_cash_by_partener",
    "echange_valide", "echange_valid_by_hub", "pickup_picked_recu", "colis_pickup_transmit_to_partner",
    "return_asked_by_customer", "return_asked_by_hub", "retour_dispatched_to_partenaires",
    "return_dispatched_to_partenaire", "colis_retour_transmit_to_partner", "annulation_dispatch_retour",
    "cancel_return_dispatched_to_partenaire", "livraison_echoue_recu", "return_validated_by_partener",
    "return_dispatched_to_warehouse", "ask_to_delete_by_admin", "ask_to_delete_by_hub", "Uploaded to system",
    "Validated", "Package Picked Up", "Reception validated", "Picked up by driver", "Out for delivery",
    "Sent for redispatch", "New attempt requested by seller", "Delivery attempt", "Suspended",
    "Return put back for delivery", "Delivered", "Amount transmitted to partner", "Amount received by partner",
    "Exchange validated", "Exchange validated by hub", "Return requested by partner", "Return in transit",
    "Return dispatched to partner", "Return package transmitted to partner", "Return received by partner",
    "Return validated by partner", "Return dispatched to warehouse", "Deletion requested",
]


def ev(key="", label="", date="2026-11-16 10:00:00"):
    return {"event_key": key, "event": label, "date": date}


def entry(*events, montant="4900"):
    return {"OrderInfo": {"tracking": "NOE-1", "client": "Client Test", "phone": "0551234567", "commune": "Bab Azzouar",
                          "wilaya_id": 16, "montant": montant, "reference": "REF-12345"},
            "activity": list(events), "deliveryAttempts": 0}


def _resp(payload=None, status_code=200, headers=None):
    r = mock.Mock(status_code=status_code, headers=headers or {})
    r.json.return_value = payload if payload is not None else {}
    return r


@pytest.fixture(autouse=True)
def setup(settings, tmp_path, monkeypatch):
    settings.DATA_DIR = tmp_path
    monkeypatch.setattr(noest, "MIN_INTERVAL", 0)
    catalogue.snapshot_path().write_text(json.dumps({
        "fetched_at": timezone.now().isoformat(),
        "couriers": [catalogue.clean_entry({
            "key": "noest", "name": "NOEST", "platform": "noest", "requiredCredentials": ["apiToken", "guid"],
            "capabilities": {}, "endpoint": "https://app.noest-dz.com/api/public",
        })],
    }), encoding="utf-8")
    sync._running.clear(); sync._rerun.clear(); sync._blocked_until.clear()


def _conn(creds=CREDS):
    return get_connector(ProviderConfig(courier="noest", credentials=creds))


# ─── Construction and the connection test ─────────────────────────────────────

def test_connector_and_auth():
    conn = _conn({"apiToken": f"Bearer {CREDS['apiToken']}", "guid": CREDS["guid"]})
    assert isinstance(conn, NoestConnector)
    assert (conn.base_url, conn.verified) == ("https://app.noest-dz.com/api/public", False)
    assert conn.auth_headers() == {"Authorization": f"Bearer {CREDS['apiToken']}"}
    assert "list" not in conn.capabilities                    # NOEST has no parcel list


def test_test_checks_token_and_guid_with_an_impossible_tracking():
    with mock.patch(REQUEST, return_value=_resp({"message": "Trackings non trouvés"}, 404)) as req:
        _conn().test_credentials()                            # "not found" = both credentials accepted
    args, kwargs = req.call_args
    assert args == ("POST", INFO)
    assert kwargs["json"] == {"user_guid": CREDS["guid"], "trackings": [noest.PROBE_TRACKING]}


@pytest.mark.parametrize("http", [
    _resp({"success": False, "message": "Partenaire introuvable"}, 404),     # bad GUID
    _resp({"error": "Unauthenticated."}, 401),                                # bad token
])
def test_refused_credentials(http):
    with mock.patch(REQUEST, return_value=http), pytest.raises(ConnectorAuthError):
        _conn().test_credentials()


def test_missing_credentials_make_no_call():
    with mock.patch(REQUEST) as req, pytest.raises(ConnectorError):
        _conn({"apiToken": "x"}).test_credentials()
    req.assert_not_called()


def test_429_carries_retry_after():
    with mock.patch(REQUEST, return_value=_resp(status_code=429, headers={"Retry-After": "15"})), \
            pytest.raises(ConnectorRateLimited) as exc:
        _conn().parcel_states(["NOE-1"])
    assert exc.value.retry_after == 15


# ─── Mapping ──────────────────────────────────────────────────────────────────

def test_every_fixture_name_is_mapped_and_remarks_are_skipped():
    unmapped = [n for n in FIXTURE_MAPPED
                if map_event({"event_key": n} if n.islower() or "_" in n else {"event": n})[0] == ShipmentStatus.UNKNOWN]
    assert unmapped == []
    assert map_event({"event_key": "edit_price"}) is None
    assert map_event({"event_key": "EDITED_INFORMATIONS"}) is None
    assert map_event({"event": "Validé"})[0] == ShipmentStatus.UNKNOWN          # French labels are not mapped
    assert map_event({"event_key": "something_new"}) == (ShipmentStatus.UNKNOWN, None, "something_new")


@pytest.mark.parametrize("row,expected", [
    ({"event_key": "fdr_activated"}, ShipmentStatus.OUT_FOR_DELIVERY),
    ({"event_key": "nouvel_tentative_asked_by_customer"}, ShipmentStatus.DELIVERY_ATTEMPTED),
    ({"event_key": "colis_suspendu"}, ShipmentStatus.ON_HOLD),
    ({"event_key": "livred"}, ShipmentStatus.DELIVERED),
    ({"event_key": "return_asked_by_hub"}, ShipmentStatus.RETURN_IN_TRANSIT),
    ({"event_key": "return_validated_by_partener"}, ShipmentStatus.RETURNED),
    ({"event_key": "ask_to_delete_by_hub"}, ShipmentStatus.CANCELLED),
    ({"event_key": "", "event": "Out for delivery"}, ShipmentStatus.OUT_FOR_DELIVERY),   # label when no key
    ({"event_key": "", "event": "return received by partner"}, ShipmentStatus.RETURNED),
])
def test_event_mapping(row, expected):
    assert map_event(row)[0] == expected


@pytest.mark.parametrize("events,cod,expected", [
    ([], True, (ShipmentStatus.CREATED, CashStatus.AWAITING_DELIVERY)),
    ([ev("upload"), ev("fdr_activated", date="2026-11-16 11:00:00")], True,
     (ShipmentStatus.OUT_FOR_DELIVERY, CashStatus.AWAITING_DELIVERY)),
    ([ev("livred")], True, (ShipmentStatus.DELIVERED, CashStatus.HELD_BY_COURIER)),
    ([ev("livred"), ev("verssement_admin_cust", date="2026-11-17 09:00:00")], True,
     (ShipmentStatus.DELIVERED, CashStatus.PAID)),
    ([ev("livred"), ev("verssement_admin_cust", date="2026-11-17 09:00:00"),
      ev("verssement_admin_cust_canceled", date="2026-11-17 12:00:00")], True,
     (ShipmentStatus.DELIVERED, CashStatus.HELD_BY_COURIER)),                     # a cancelled payment
    ([ev("livred"), ev("edit_price", date="2026-11-18 09:00:00")], True,
     (ShipmentStatus.DELIVERED, CashStatus.HELD_BY_COURIER)),                     # a remark changes nothing
    ([ev("livred")], False, (ShipmentStatus.DELIVERED, CashStatus.NOT_APPLICABLE)),
    ([ev("return_validated_by_partener")], True, (ShipmentStatus.RETURNED, CashStatus.NOT_APPLICABLE)),
])
def test_summary_from_the_history(events, cod, expected):
    status_, _raw, cash, _when = summarise({"activity": events}, cod)
    assert (status_, cash) == expected


def test_summary_sorts_by_date_and_accepts_keyed_activity():
    activity = {"0": ev("livred", date="2026-11-16 15:00:00"), "1": ev("fdr_activated", date="2026-11-16 09:00:00"),
                "2": ev("upload", date="not a date")}
    status_, raw, _cash, when = summarise({"activity": activity}, True)
    assert (status_, raw, when) == (ShipmentStatus.DELIVERED, "livred", datetime(2026, 11, 16, 15, 0, tzinfo=ALGIERS))


# ─── Reads ────────────────────────────────────────────────────────────────────

def test_parcel_states_in_batches_and_unknown_trackings_left_out(monkeypatch):
    monkeypatch.setattr(noest, "BATCH", 2)
    answers = {"NOE-1": entry(ev("livred")), "NOE-2": entry(ev("return_validated_by_partener")),
               "NOE-4": entry(ev("fdr_activated"), montant="0")}

    def answer(method, url, params=None, json=None, **kwargs):
        known = {t: answers[t] for t in json["trackings"] if t in answers}
        return _resp(known) if known else _resp({"message": "Trackings non trouvés"}, 404)

    with mock.patch(REQUEST, side_effect=answer) as req:
        found = _conn().parcel_states(["NOE-1", "NOE-2", "NOE-3", "NOE-1", "NOE-4", "NOE-5"])

    assert [c.kwargs["json"]["trackings"] for c in req.call_args_list] == [["NOE-1", "NOE-2"], ["NOE-3", "NOE-4"], ["NOE-5"]]
    assert all(c.kwargs["json"]["user_guid"] == CREDS["guid"] for c in req.call_args_list)
    assert {t: (s.status, s.cash_status) for t, s in found.items()} == {
        "NOE-1": (ShipmentStatus.DELIVERED, CashStatus.HELD_BY_COURIER),
        "NOE-2": (ShipmentStatus.RETURNED, CashStatus.NOT_APPLICABLE),
        "NOE-4": (ShipmentStatus.OUT_FOR_DELIVERY, CashStatus.NOT_APPLICABLE),      # nothing to collect
    }
    assert found["NOE-1"].status_at == datetime(2026, 11, 16, 10, 0, tzinfo=ALGIERS)


def test_a_bad_guid_during_states_is_an_auth_error():
    with mock.patch(REQUEST, return_value=_resp({"message": "Partenaire introuvable"}, 404)), \
            pytest.raises(ConnectorAuthError):
        _conn().parcel_states(["NOE-1"])


def test_get_parcel_and_history():
    answer = {"NOE-1": entry(ev("upload", "Uploaded to system", "2026-11-15 08:00:00"),
                             ev("edit_price", "Price edited", "2026-11-15 09:00:00"),
                             ev("livred", "Delivered", "2026-11-16 10:00:00"))}
    with mock.patch(REQUEST, return_value=_resp(answer)):
        snap = _conn().get_parcel("NOE-1")
        events = _conn().history("NOE-1")
    assert (snap.tracking, snap.status, snap.cash_status, snap.cod_amount) == (
        "NOE-1", ShipmentStatus.DELIVERED, CashStatus.HELD_BY_COURIER, Decimal("4900.00"))
    assert (snap.recipient_name, snap.commune, snap.reference, snap.delivery_fee) == (
        "Client Test", "Bab Azzouar", "REF-12345", None)
    assert [(e.status, e.raw_status, e.note) for e in events] == [
        (ShipmentStatus.CREATED, "upload", "Uploaded to system"),
        (ShipmentStatus.DELIVERED, "livred", "Delivered"),
    ]

    with mock.patch(REQUEST, return_value=_resp({"message": "Trackings non trouvés"}, 404)):
        with pytest.raises(ConnectorNotFound):
            _conn().get_parcel("NOE-9")
        assert _conn().history("NOE-9") == ()


@pytest.mark.parametrize("ref", ["NOE 1", "a" * 65, "x\"}"])
def test_unsafe_trackings_are_refused_before_any_call(ref):
    with mock.patch(REQUEST) as req, pytest.raises(ConnectorError):
        _conn().parcel_states([ref])
    req.assert_not_called()


def test_empty_trackings_are_ignored_without_a_call():
    with mock.patch(REQUEST) as req:
        assert _conn().parcel_states(["", None]) == {}
    req.assert_not_called()


def test_calls_are_spaced(monkeypatch):
    monkeypatch.setattr(noest, "MIN_INTERVAL", 1.1)
    clock = iter([1.0, 1.4, 2.5])
    monkeypatch.setattr(noest.time, "monotonic", lambda: next(clock))
    with mock.patch.object(noest.time, "sleep") as sleep, mock.patch(REQUEST, return_value=_resp({})):
        conn = _conn()
        conn.parcel_states(["NOE-1"])
        conn.parcel_states(["NOE-2"])
    assert sleep.call_args.args[0] == pytest.approx(0.7)


# ─── The "known parcels" sync ─────────────────────────────────────────────────

@pytest.fixture
def store(db):
    from apps.inventory.models import MovementReasonChoices, Product, StockMovement, Variant
    tenant = Tenant.objects.create(name="Noest Store", plan=PlanChoices.PRO_RETAIL)
    StoreSettings.objects.create(tenant=tenant, enable_delivery_integrations=True)
    owner = User.objects.create_user(email="owner-noest@test.com", password="password123",
                                     role=RoleChoices.OWNER, tenant=tenant)
    config = ProviderConfig.objects.create(tenant=tenant, courier="noest", credentials=CREDS)
    product = Product.objects.create(tenant=tenant, name="Basket", reference="B-1", sale_price=Decimal("4500"))
    variant = Variant.objects.create(tenant=tenant, product=product, size_eu=42)
    StockMovement.objects.create(tenant=tenant, variant=variant, quantity_delta=5, reason=MovementReasonChoices.INITIAL)
    return tenant, owner, config, variant


def _sent(tenant, owner, variant, tracking, status_="dispatched", provider="noest"):
    from apps.inventory.models import MovementReasonChoices, StockMovement
    order = CustomerOrder.objects.create(
        tenant=tenant, customer_name="Client", customer_phone="0551234567", wilaya="16", commune="Bab Ezzouar",
        shipping_fee=Decimal("400"), status=status_, provider=provider, tracking_number=tracking,
        dispatched_by=owner, dispatched_at=timezone.now())
    CustomerOrderLine.objects.create(order=order, variant=variant, quantity=1, unit_price=Decimal("4500"))
    if status_ != "draft":                              # what the dispatch wrote (P2.4)
        StockMovement.objects.create(tenant=tenant, variant=variant, quantity_delta=-1,
                                     reason=MovementReasonChoices.DELIVERY_OUT, reference_id=str(order.pk),
                                     reference_type="CustomerOrder")
    return order


def test_sync_creates_shipments_from_sent_orders_and_follows_them(store):
    from apps.sales.models import Sale
    tenant, owner, config, variant = store
    sold = _sent(tenant, owner, variant, "NOE-SOLD")
    back = _sent(tenant, owner, variant, "NOE-BACK")
    _sent(tenant, owner, variant, "NOE-OTHER", provider="maystro")             # another courier: ignored
    _sent(tenant, owner, variant, "", status_="draft")                           # not sent: ignored
    answers = {"NOE-SOLD": entry(ev("livred", date="2026-11-16 15:00:00")),
               "NOE-BACK": entry(ev("return_validated_by_partener", date="2026-11-16 12:00:00"))}

    def answer(method, url, params=None, json=None, **kwargs):
        assert url == INFO, url                                                  # no list call, ever
        return _resp({t: answers[t] for t in json["trackings"] if t in answers})

    with mock.patch(REQUEST, side_effect=answer):
        result = sync.sync_courier(config)

    assert (result.error, result.created) == ("", 2)
    assert result.lifecycle == {"sale": 1, "stock_back": 1}
    ships = {s.tracking_number: s for s in Shipment.objects.unscoped().filter(tenant=tenant)}
    assert set(ships) == {"NOE-SOLD", "NOE-BACK"}
    assert (ships["NOE-SOLD"].customer_order_id, ships["NOE-SOLD"].cod_amount, ships["NOE-SOLD"].status) == (
        sold.pk, Decimal("4900.00"), ShipmentStatus.DELIVERED)
    sold.refresh_from_db(); back.refresh_from_db()
    assert Sale.objects.get(pk=sold.sale_id).created_at == datetime(2026, 11, 16, 15, 0, tzinfo=ALGIERS)
    assert (back.status, back.stock_returned_at is not None) == ("returned", True)
    variant.refresh_from_db()
    assert variant.stock_qty == 3                       # 5 − 3 sent (one to another courier) + 1 back

    # The next run creates nothing new and asks only about what is still open.
    asked = []
    with mock.patch(REQUEST, side_effect=lambda m, url, params=None, json=None, **k: (
            asked.append(json["trackings"]), _resp({}))[1]):
        again = sync.sync_courier(config)
    assert again.created == 0
    assert asked == [["NOE-SOLD"]]                      # delivered, money not settled; the return is final


def test_the_test_action_and_no_key_scope_error(store):
    tenant, owner, config, variant = store
    client = APIClient()
    client.force_authenticate(user=owner)
    with mock.patch(REQUEST, return_value=_resp({"message": "Trackings non trouvés"}, 404)):
        res = client.post(f"/api/v1/deliveries/provider-configs/{config.pk}/test/")
        result = sync.sync_courier(config)
    assert res.status_code == status.HTTP_200_OK
    assert res.json() == {"result": "ok", "capabilities": ["get", "history", "parcel_states", "test"],
                          "limited": False, "verified": False}      # follows known parcels: not "limited"
    assert result.error == ""                           # following known parcels is a full mode, not "key scope"


def test_logs_never_contain_the_token_or_guid(caplog):
    base_logger = logging.getLogger("apps.delivery_integrations.services.couriers.base")
    base_logger.addHandler(caplog.handler)
    try:
        with mock.patch(REQUEST, return_value=_resp({"message": "Partenaire introuvable"}, 404)), \
                pytest.raises(ConnectorAuthError):
            _conn().test_credentials()
    finally:
        base_logger.removeHandler(caplog.handler)
    assert "HTTP 404" in caplog.text
    assert CREDS["apiToken"] not in caplog.text and CREDS["guid"] not in caplog.text
