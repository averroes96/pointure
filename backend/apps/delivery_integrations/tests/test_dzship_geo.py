"""
dzship geography: stop desks, fee quotes, the commune snapshot and their endpoints
(docs/plans/delivery-v1-plan.md P2.1). HTTP is mocked; data is synthetic.
"""
import json
from datetime import timedelta
from decimal import Decimal
from unittest import mock

import pytest
import requests
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import PlanChoices, RoleChoices, StoreSettings, Tenant, User
from apps.delivery_integrations.models import ProviderConfig
from apps.delivery_integrations.services import catalogue, geo
from apps.delivery_integrations.services.dzship_client import DzshipClient, DzshipError

POST = "apps.delivery_integrations.services.dzship_client.requests.post"
GET = "apps.delivery_integrations.services.geo.requests.get"

ENTRIES = [
    {"key": "maystro", "name": "Maystro", "platform": "maystro", "requiredCredentials": ["apiKey"],
     "capabilities": {}, "endpoint": "https://backend.example-courier.dz/api"},
    {"key": "sandbox", "name": "Sandbox", "platform": "sandbox", "requiredCredentials": [],
     "capabilities": {}},
]

DESK_ROWS = [
    {"id": 101, "name": " Bureau Centre ", "wilayaCode": 16, "communeName": "Alger Centre", "address": "1 rue A"},
    {"id": "", "name": "No id"},                 # dropped
    {"id": 102, "name": ""},                    # dropped
    "junk",                                     # dropped
    {"id": "bz-7", "name": "Bureau Est"},       # wilaya defaults to the asked one
]

RATE_BODY = {"deliveryFee": 600, "returnFee": "250.5", "codFee": None, "total": 600,
             "currency": "DZD", "deliveryType": "stopdesk", "estimatedDays": 2}


def _response(status_code=200, body=None, json_error=False):
    res = mock.Mock(status_code=status_code)
    if json_error:
        res.json.side_effect = ValueError("not json")
    else:
        res.json.return_value = body
    if status_code >= 400:
        res.raise_for_status.side_effect = requests.HTTPError(response=res)
    else:
        res.raise_for_status.return_value = None
    return res


@pytest.fixture(autouse=True)
def isolated(settings, tmp_path):
    settings.DATA_DIR = tmp_path
    cache.clear()
    catalogue.snapshot_path().write_text(json.dumps({
        "fetched_at": timezone.now().isoformat(),
        "couriers": [catalogue.clean_entry(e) for e in ENTRIES],
    }), encoding="utf-8")
    yield
    cache.clear()


# ─── Client: desks ────────────────────────────────────────────────────────────

def test_desks_normalises_rows_and_sends_the_documented_payload():
    with mock.patch(POST, return_value=_response(body=DESK_ROWS)) as post:
        desks = DzshipClient.desks("maystro", {"apiKey": "k"}, "16")

    assert desks == [
        {"id": "101", "name": "Bureau Centre", "wilaya_code": 16, "commune_name": "Alger Centre", "address": "1 rue A"},
        {"id": "bz-7", "name": "Bureau Est", "wilaya_code": 16, "commune_name": "", "address": ""},
    ]
    args, kwargs = post.call_args
    assert args[0] == "https://freeship.dzbuild.com/v1/desks"
    assert kwargs["json"] == {"courier": "maystro", "credentials": {"apiKey": "k"}, "wilayaCode": 16}
    assert kwargs["timeout"] == DzshipClient.READ_TIMEOUT_SECONDS


def test_sandbox_payload_has_no_credentials_and_options_carry_base_url():
    with mock.patch(POST, return_value=_response(body=[])) as post:
        DzshipClient.desks("sandbox", {}, 5)
        DzshipClient.desks("ecotrack", {"token": "t"}, 5, base_url="https://x.ecotrack.dz")

    assert post.call_args_list[0].kwargs["json"] == {"courier": "sandbox", "wilayaCode": 5}
    assert post.call_args_list[1].kwargs["json"] == {
        "courier": "ecotrack", "credentials": {"token": "t"},
        "options": {"baseUrl": "https://x.ecotrack.dz"}, "wilayaCode": 5,
    }


@pytest.mark.parametrize("bad", [0, 59, "abc", None])
def test_desks_rejects_bad_wilaya_without_calling(bad):
    with mock.patch(POST) as post, pytest.raises(ValueError):
        DzshipClient.desks("sandbox", {}, bad)
    post.assert_not_called()


@pytest.mark.parametrize("http,body,code,not_supported,uncertain", [
    (422, {"error": {"code": "NOT_SUPPORTED"}}, "NOT_SUPPORTED", True, False),
    (400, {"error": {"code": "VALIDATION_ERROR"}}, "VALIDATION_ERROR", False, False),
    (502, None, "HTTP_ERROR", False, False),
])
def test_desks_http_errors_are_typed(http, body, code, not_supported, uncertain):
    with mock.patch(POST, return_value=_response(http, body)), pytest.raises(DzshipError) as exc:
        DzshipClient.desks("maystro", {"apiKey": "k"}, 16)
    assert exc.value.code == code
    assert exc.value.status_code == http
    assert exc.value.not_supported is not_supported
    assert exc.value.outcome_uncertain is uncertain


@pytest.mark.parametrize("side_effect,code", [
    (requests.Timeout(), "TIMEOUT"),
    (requests.ConnectionError(), "NETWORK_ERROR"),
])
def test_network_failures_are_typed(side_effect, code):
    with mock.patch(POST, side_effect=side_effect), pytest.raises(DzshipError) as exc:
        DzshipClient.desks("maystro", {"apiKey": "k"}, 16)
    assert exc.value.code == code
    assert exc.value.outcome_uncertain is True


def test_non_json_body_is_invalid_response():
    with mock.patch(POST, return_value=_response(json_error=True)), pytest.raises(DzshipError) as exc:
        DzshipClient.desks("maystro", {"apiKey": "k"}, 16)
    assert exc.value.code == "INVALID_RESPONSE"


# ─── Client: rates ────────────────────────────────────────────────────────────

def test_rates_returns_decimals_and_sends_query_and_origin():
    with mock.patch(POST, return_value=_response(body=RATE_BODY)) as post:
        quote = DzshipClient.rates("maystro", {"apiKey": "k"}, to_wilaya=31, delivery_type="stopdesk",
                                   to_commune="Oran", from_wilaya=16, cod_amount=Decimal("4500.75"))

    assert quote == {
        "delivery_fee": Decimal("600.00"), "return_fee": Decimal("250.50"), "cod_fee": None,
        "total": Decimal("600.00"), "currency": "DZD", "delivery_type": "stopdesk", "estimated_days": 2,
    }
    args, kwargs = post.call_args
    assert args[0] == "https://freeship.dzbuild.com/v1/rates"
    assert kwargs["json"] == {
        "courier": "maystro", "credentials": {"apiKey": "k"}, "options": {"fromWilaya": 16},
        "query": {"toWilaya": 31, "deliveryType": "stopdesk", "toCommune": "Oran",
                  "fromWilaya": 16, "codAmount": 4500},
    }


def test_rates_without_delivery_fee_is_invalid_response():
    with mock.patch(POST, return_value=_response(body={"currency": "DZD"})), pytest.raises(DzshipError) as exc:
        DzshipClient.rates("sandbox", {}, to_wilaya=16, delivery_type="home")
    assert exc.value.code == "INVALID_RESPONSE"


def test_rates_rejects_unknown_delivery_type_without_calling():
    with mock.patch(POST) as post, pytest.raises(ValueError):
        DzshipClient.rates("sandbox", {}, to_wilaya=16, delivery_type="express")
    post.assert_not_called()


def test_create_order_still_sends_credentials_even_when_empty():
    with mock.patch(POST, return_value=_response(body={"trackingNumber": "T1", "status": "created"})) as post:
        result = DzshipClient.create_order("sandbox", {}, {"reference": "R1"})
    assert result == {"trackingNumber": "T1", "status": "created"}
    assert post.call_args.kwargs["json"] == {"courier": "sandbox", "credentials": {}, "order": {"reference": "R1"}}
    assert post.call_args.kwargs["timeout"] == DzshipClient.TIMEOUT_SECONDS


# ─── Commune snapshot ─────────────────────────────────────────────────────────

COMMUNE_ROWS = [
    {"wilayaCode": 16, "nameFr": "Bab Ezzouar", "nameAr": "باب الزوار", "shipAs": None},
    {"wilayaCode": 16, "nameFr": "Bab Ezzouar", "nameAr": "dup"},           # duplicate dropped
    {"wilayaCode": 62, "nameFr": "Djanet", "nameAr": "جانت", "shipAs": 33},  # new wilaya ships as 33
    {"wilayaCode": 70, "nameFr": "Nowhere"},                                  # dropped
    {"wilayaCode": 31, "nameFr": ""},                                         # dropped
    {"wilayaCode": True, "nameFr": "Bool"},                                   # dropped
]


def test_commune_refresh_cleans_dedupes_and_saves():
    with mock.patch(GET, return_value=_response(body=COMMUNE_ROWS)) as get:
        assert geo.communes_store.refresh() is True
    assert get.call_args.kwargs["timeout"] == geo.COMMUNES_TIMEOUT

    saved = geo.communes_store.load()
    assert saved["rows"] == [
        {"wilaya_code": 16, "name_fr": "Bab Ezzouar", "name_ar": "باب الزوار", "ship_as": None},
        {"wilaya_code": 62, "name_fr": "Djanet", "name_ar": "جانت", "ship_as": 33},
    ]
    with mock.patch.object(geo.communes_store, "start_background_refresh") as bg:
        result = geo.get_communes(wilaya_code="62")
    bg.assert_not_called()                     # fresh snapshot: no refresh
    assert result["rows"] == [{"wilaya_code": 62, "name_fr": "Djanet", "name_ar": "جانت", "ship_as": 33}]
    assert result["stale"] is False


@pytest.mark.parametrize("failure", [
    {"side_effect": requests.Timeout()},
    {"return_value": None},                    # filled below: an empty list
])
def test_failed_or_empty_refresh_keeps_previous_snapshot(failure):
    with mock.patch(GET, return_value=_response(body=COMMUNE_ROWS)):
        geo.communes_store.refresh()
    if "return_value" in failure:
        failure = {"return_value": _response(body=[])}

    with mock.patch(GET, **failure):
        assert geo.communes_store.refresh() is False
    assert len(geo.communes_store.load()["rows"]) == 2


def test_missing_or_stale_snapshot_answers_at_once_and_refreshes_in_background():
    with mock.patch.object(geo.communes_store, "start_background_refresh") as bg:
        empty = geo.get_communes()
    bg.assert_called_once()
    assert empty["rows"] == [] and empty["stale"] is True and empty["fetched_at"] is None

    old = (timezone.now() - timedelta(days=8)).isoformat()
    geo.communes_store.path().write_text(json.dumps({"fetched_at": old, "rows": COMMUNE_ROWS[:1]}),
                                         encoding="utf-8")
    with mock.patch.object(geo.communes_store, "start_background_refresh") as bg:
        stale = geo.get_communes()
    bg.assert_called_once()
    assert stale["stale"] is True
    assert stale["rows"] == [{"wilaya_code": 16, "name_fr": "Bab Ezzouar", "name_ar": "باب الزوار", "ship_as": None}]


def test_unreadable_snapshot_is_treated_as_missing():
    geo.communes_store.path().write_text("{not json", encoding="utf-8")
    assert geo.communes_store.load() is None


# ─── Store fixtures and endpoints ─────────────────────────────────────────────

@pytest.fixture
def store(db):
    tenant = Tenant.objects.create(name="Geo Store", plan=PlanChoices.PRO_RETAIL, wilaya="16")
    StoreSettings.objects.create(tenant=tenant, enable_delivery_integrations=True)
    users = {
        role: User.objects.create_user(email=f"{role}-geo@test.com", password="password123",
                                       role=role, tenant=tenant)
        for role in (RoleChoices.OWNER, RoleChoices.MANAGER, RoleChoices.CASHIER)
    }
    config = ProviderConfig.objects.create(tenant=tenant, courier="maystro", credentials={"apiKey": "k"})
    return tenant, users, config


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _url(config, name):
    return f"/api/v1/deliveries/provider-configs/{config.pk}/{name}/"


def test_quote_for_uses_store_wilaya_and_is_cached(store):
    tenant, users, config = store
    with mock.patch(POST, return_value=_response(body=RATE_BODY)) as post:
        first = geo.quote_for(config, to_wilaya=31, delivery_type="home")
        second = geo.quote_for(config, to_wilaya=31, delivery_type="home")
        geo.quote_for(config, to_wilaya=31, delivery_type="stopdesk")
    assert first == second
    assert post.call_count == 2                # second call was a cache hit
    assert post.call_args_list[0].kwargs["json"]["query"]["fromWilaya"] == 16


def test_desks_for_is_cached_per_courier_and_wilaya(store):
    tenant, users, config = store
    with mock.patch(POST, return_value=_response(body=DESK_ROWS)) as post:
        geo.desks_for(config, 16)
        geo.desks_for(config, 16)
        geo.desks_for(config, 9)
    assert post.call_count == 2


@pytest.mark.parametrize("role", [RoleChoices.OWNER, RoleChoices.MANAGER])
def test_desks_endpoint_for_managers_and_owners(store, role):
    tenant, users, config = store
    with mock.patch(POST, return_value=_response(body=DESK_ROWS)):
        res = _client(users[role]).get(_url(config, "desks"), {"wilaya": "16"})
    assert res.status_code == status.HTTP_200_OK, res.content
    assert res.json() == {"desks": [
        {"id": "101", "name": "Bureau Centre", "wilaya_code": 16, "commune_name": "Alger Centre", "address": "1 rue A"},
        {"id": "bz-7", "name": "Bureau Est", "wilaya_code": 16, "commune_name": "", "address": ""},
    ]}


def test_rates_endpoint_returns_money_as_strings(store):
    tenant, users, config = store
    with mock.patch(POST, return_value=_response(body=RATE_BODY)):
        res = _client(users[RoleChoices.OWNER]).get(
            _url(config, "rates"), {"to_wilaya": "31", "delivery_type": "stopdesk", "cod_amount": "4500"})
    assert res.status_code == status.HTTP_200_OK, res.content
    assert res.json() == {"delivery_fee": "600.00", "return_fee": "250.50", "cod_fee": None, "total": "600.00",
                          "currency": "DZD", "delivery_type": "stopdesk", "estimated_days": 2}


@pytest.mark.parametrize("name,params", [("desks", {"wilaya": "16"}),
                                          ("rates", {"to_wilaya": "16", "delivery_type": "home"})])
def test_cashier_is_refused_and_dzship_never_called(store, name, params):
    tenant, users, config = store
    with mock.patch(POST) as post:
        res = _client(users[RoleChoices.CASHIER]).get(_url(config, name), params)
    assert res.status_code == status.HTTP_403_FORBIDDEN
    post.assert_not_called()


def test_feature_off_is_404(store):
    tenant, users, config = store
    StoreSettings.objects.filter(tenant=tenant).update(enable_delivery_integrations=False)
    with mock.patch(POST) as post:
        res = _client(users[RoleChoices.OWNER]).get(_url(config, "desks"), {"wilaya": "16"})
    assert res.status_code == status.HTTP_404_NOT_FOUND
    post.assert_not_called()


@pytest.mark.parametrize("name,params,field", [
    ("desks", {"wilaya": "59"}, "wilaya"),
    ("desks", {}, "wilaya"),
    ("rates", {"to_wilaya": "16", "delivery_type": "express"}, "delivery_type"),
    ("rates", {"to_wilaya": "0", "delivery_type": "home"}, "to_wilaya"),
    ("rates", {"to_wilaya": "16", "delivery_type": "home", "cod_amount": "-1"}, "cod_amount"),
])
def test_invalid_query_is_400(store, name, params, field):
    tenant, users, config = store
    with mock.patch(POST) as post:
        res = _client(users[RoleChoices.OWNER]).get(_url(config, name), params)
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert list(res.json()["error"]["details"].keys()) == [field]
    post.assert_not_called()


def test_inactive_or_incomplete_account_is_400_without_calling(store):
    tenant, users, config = store
    client = _client(users[RoleChoices.OWNER])
    with mock.patch(POST) as post:
        config.credentials = {}
        config.save()
        incomplete = client.get(_url(config, "desks"), {"wilaya": "16"})
        config.credentials = {"apiKey": "k"}
        config.is_active = False
        config.save()
        inactive = client.get(_url(config, "desks"), {"wilaya": "16"})
    assert incomplete.status_code == status.HTTP_400_BAD_REQUEST
    assert inactive.status_code == status.HTTP_400_BAD_REQUEST
    post.assert_not_called()


def test_sandbox_account_without_credentials_is_usable(store):
    tenant, users, config = store
    sandbox = ProviderConfig.objects.create(tenant=tenant, courier="sandbox", credentials={})
    with mock.patch(POST, return_value=_response(body=[])) as post:
        res = _client(users[RoleChoices.OWNER]).get(_url(sandbox, "desks"), {"wilaya": "16"})
    assert res.status_code == status.HTTP_200_OK
    assert res.json() == {"desks": []}
    assert post.call_args.kwargs["json"] == {"courier": "sandbox", "wilayaCode": 16}


@pytest.mark.parametrize("dzship,http,code", [
    (_response(422, {"error": {"code": "NOT_SUPPORTED"}}), 400, "not_supported"),
    (_response(400, {"error": {"code": "VALIDATION_ERROR", "message": "Client Secret 0551234567"}}),
     502, "courier_unavailable"),
])
def test_dzship_errors_map_to_clean_api_errors(store, dzship, http, code):
    tenant, users, config = store
    with mock.patch(POST, return_value=dzship):
        res = _client(users[RoleChoices.OWNER]).get(_url(config, "desks"), {"wilaya": "16"})
    assert res.status_code == http
    assert res.json()["error"]["code"] == code
    assert "0551234567" not in res.content.decode()


def test_dzship_timeout_maps_to_502(store):
    tenant, users, config = store
    with mock.patch(POST, side_effect=requests.Timeout()):
        res = _client(users[RoleChoices.OWNER]).get(
            _url(config, "rates"), {"to_wilaya": "16", "delivery_type": "home"})
    assert res.status_code == status.HTTP_502_BAD_GATEWAY
    assert res.json()["error"]["code"] == "courier_unavailable"


def test_other_tenant_account_is_404(store):
    tenant, users, config = store
    other = Tenant.objects.create(name="Other", plan=PlanChoices.PRO_RETAIL)
    foreign = ProviderConfig.objects.create(tenant=other, courier="maystro", credentials={"apiKey": "x"})
    with mock.patch(POST) as post:
        res = _client(users[RoleChoices.OWNER]).get(_url(foreign, "desks"), {"wilaya": "16"})
    assert res.status_code == status.HTTP_404_NOT_FOUND
    post.assert_not_called()
