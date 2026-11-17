"""
Commune matching: Pointure communes → the courier spelling (docs/plans/delivery-v1-plan.md P2.2).
Synthetic communes and a synthetic dzship snapshot; no network.
"""
import json
from unittest import mock

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import Commune, PlanChoices, RoleChoices, StoreSettings, Tenant, User, Wilaya
from apps.delivery_integrations.services import communes, geo
from apps.delivery_integrations.services.communes import (
    CourierCommuneIndex, normalise_ar, normalise_fr, ship_wilaya,
)

URL = "/api/v1/deliveries/communes/"
UNMATCHED_URL = "/api/v1/deliveries/communes/unmatched/"


def _row(code, fr, ar=""):
    return {"wilaya_code": code, "name_fr": fr, "name_ar": ar, "ship_as": None}


COURIER_ROWS = [
    _row(16, "Bab Ezzouar", "باب الزوار"),
    _row(16, "Mohamed Belouzdad", "محمد بلوزداد"),
    _row(16, "Ain Benian", "عين بنيان"),
    _row(12, "Bir El Ater", "بئر العاتر"),
    _row(14, "Nadorah", "الناظورة"),
    _row(14, "Mellakou", "ملاكو"),
]


@pytest.fixture(autouse=True)
def isolated(settings, tmp_path):
    settings.DATA_DIR = tmp_path
    communes._index_cache.update(fetched_at=None, index=None)
    yield
    communes._index_cache.update(fetched_at=None, index=None)


def _write_snapshot(rows=COURIER_ROWS):
    geo.communes_store.path().write_text(json.dumps({
        "fetched_at": timezone.now().isoformat(), "rows": rows,
    }), encoding="utf-8")


# ─── Normalisation ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("a,b", [
    ("Bab Ezzouar", "Bab-Ezzouar"),
    ("Bab Ezzouar", "BAB EZOUAR"),             # doubled letters
    ("Aïn Témouchent", "Ain Temouchent"),      # accents
    ("Ain El Turk", "Ain Turk"),               # article
    ("Ksar El-Boukhari", "Ksar Boukhari"),
    ("M'Sila", "Msila"),                       # apostrophe
    ("Sidi Bel Abbès", "sidi bel abbes"),
])
def test_french_variants_share_a_key(a, b):
    assert normalise_fr(a) == normalise_fr(b) != ""


@pytest.mark.parametrize("a,b", [
    ("Bordj Bou Arreridj", "Bordj Bounaama"),
    ("Nador", "Nadorah"),
    ("Djendel", "Djendel Saadi Mohamed"),
])
def test_different_communes_keep_different_keys(a, b):
    assert normalise_fr(a) != normalise_fr(b)


@pytest.mark.parametrize("a,b", [
    ("عــيــن مـــاضــي", "عين ماضي"),          # tatweel
    ("ﺳﻮق اﻻﺛﻨﻴﻦ", "سوق الاثنين"),              # presentation forms
    ("بٔير الذھب", "بير الذهب"),                # hamza above, heh doachashmee
    ("سيدي عبد الغنى", "سيدي عبد الغني"),       # alef maksura
    ("أولاد إبراهيم", "اولاد ابراهيم"),
    ("تاڨديت", "تاقديت"),
])
def test_arabic_variants_share_a_key(a, b):
    assert normalise_ar(a) == normalise_ar(b) != ""


def test_latin_text_has_no_arabic_key_and_arabic_has_no_french_key():
    assert normalise_ar("Bab Ezzouar") == ""
    assert normalise_fr("باب الزوار") == ""


# ─── Wilayas ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("code,expected", [(1, 1), ("16", 16), (58, 58), (59, 3), (62, 12), (66, 17), (69, 32)])
def test_ship_wilaya_maps_new_wilayas_to_their_parent(code, expected):
    assert ship_wilaya(code) == expected


@pytest.mark.parametrize("bad", [0, 70, "x", None])
def test_ship_wilaya_rejects_unknown_codes(bad):
    with pytest.raises(ValueError):
        ship_wilaya(bad)


def test_every_new_wilaya_has_a_parent():
    assert sorted(communes.PARENT_WILAYA) == list(range(59, 70))
    assert all(1 <= p <= 58 for p in communes.PARENT_WILAYA.values())


# ─── Index ────────────────────────────────────────────────────────────────────

def test_match_by_french_then_arabic():
    index = CourierCommuneIndex(COURIER_ROWS)
    assert index.match(16, "Bab-Ezzouar")["name_fr"] == "Bab Ezzouar"
    assert index.match(16, "Belouizdad", "محمد بلوزداد")["name_fr"] == "Mohamed Belouzdad"
    assert index.match(62, "Bir El-Ater")["name_fr"] == "Bir El Ater"        # 62 ships as 12
    assert index.match(16, "Douera", "دويرة") is None
    assert index.match(31, "Bab Ezzouar") is None                            # other wilaya: not guessed


def test_french_and_arabic_disagreeing_is_unmatched():
    index = CourierCommuneIndex(COURIER_ROWS)
    assert index.match(14, "Nadorah", "ملاكو") is None
    assert index.match(14, "Nadorah", "الناظورة")["name_fr"] == "Nadorah"


def test_ambiguous_keys_are_never_matched():
    index = CourierCommuneIndex([_row(5, "Ain Touta", "عين التوتة"), _row(5, "Ain-Touta", "عين توتة")])
    assert index.match(5, "Ain Touta") is None
    assert index.match(5, "", "عين التوتة")["name_fr"] == "Ain Touta"


def test_index_is_rebuilt_only_when_the_snapshot_changes():
    _write_snapshot()
    first, _ = communes.load_index()
    again, _ = communes.load_index()
    assert again is first
    geo.communes_store.path().write_text(json.dumps({
        "fetched_at": (timezone.now() + timezone.timedelta(seconds=1)).isoformat(), "rows": COURIER_ROWS[:1],
    }), encoding="utf-8")
    rebuilt, _ = communes.load_index()
    assert rebuilt is not first
    assert list(rebuilt.by_wilaya) == [16]


# ─── Endpoints ────────────────────────────────────────────────────────────────

@pytest.fixture
def store(db):
    tenant = Tenant.objects.create(name="Commune Store", plan=PlanChoices.PRO_RETAIL)
    StoreSettings.objects.create(tenant=tenant, enable_delivery_integrations=True)
    users = {
        role: User.objects.create_user(email=f"{role}-com@test.com", password="password123",
                                       role=role, tenant=tenant)
        for role in (RoleChoices.OWNER, RoleChoices.MANAGER, RoleChoices.CASHIER)
    }
    # Replace the reference data (loaded by core migration 0004) with synthetic rows.
    Commune.objects.all().delete()
    Wilaya.objects.all().delete()
    alger = Wilaya.objects.create(id=16, code="16", name="Alger", ar_name="الجزائر")
    bir = Wilaya.objects.create(id=62, code="62", name="Bir El Ater", ar_name="بئر العاتر")
    Wilaya.objects.create(id=14, code="14", name="Tiaret", ar_name="تيارت")
    Commune.objects.create(id=1, wilaya=alger, post_code="16001", name="Bab-Ezzouar", ar_name="باب الزوار")
    Commune.objects.create(id=2, wilaya=alger, post_code="16002", name="Belouizdad", ar_name="محمد بلوزداد")
    Commune.objects.create(id=3, wilaya=alger, post_code="16003", name="Douera", ar_name="دويرة")
    Commune.objects.create(id=4, wilaya=bir, post_code="62001", name="Bir El Ater", ar_name="بئر العاتر")
    Commune.objects.create(id=5, wilaya=bir, post_code="62002", name="Negrine", ar_name="نقرين")
    return tenant, users


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.parametrize("role", [RoleChoices.OWNER, RoleChoices.MANAGER])
def test_commune_list_for_a_wilaya(store, role):
    tenant, users = store
    _write_snapshot()
    res = _client(users[role]).get(URL, {"wilaya": "16"})

    assert res.status_code == status.HTTP_200_OK, res.content
    body = res.json()
    assert body["wilaya"] == 16 and body["ship_wilaya"] == 16 and body["available"] is True
    assert body["stale"] is False and body["fetched_at"] is not None
    assert body["communes"] == [
        {"id": 1, "name": "Bab-Ezzouar", "ar_name": "باب الزوار",
         "courier": {"name_fr": "Bab Ezzouar", "name_ar": "باب الزوار"}, "matched": True},
        {"id": 2, "name": "Belouizdad", "ar_name": "محمد بلوزداد",
         "courier": {"name_fr": "Mohamed Belouzdad", "name_ar": "محمد بلوزداد"}, "matched": True},
        {"id": 3, "name": "Douera", "ar_name": "دويرة", "courier": None, "matched": False},
    ]
    assert body["courier_communes"] == [
        {"name_fr": "Ain Benian", "name_ar": "عين بنيان"},
        {"name_fr": "Bab Ezzouar", "name_ar": "باب الزوار"},
        {"name_fr": "Mohamed Belouzdad", "name_ar": "محمد بلوزداد"},
    ]
    assert body["match"] is None


def test_new_wilaya_uses_its_parent_courier_list(store):
    tenant, users = store
    _write_snapshot()
    body = _client(users[RoleChoices.OWNER]).get(URL, {"wilaya": "62"}).json()
    assert body["ship_wilaya"] == 12
    assert [(c["id"], c["matched"]) for c in body["communes"]] == [(4, True), (5, False)]
    assert body["courier_communes"] == [{"name_fr": "Bir El Ater", "name_ar": "بئر العاتر"}]


@pytest.mark.parametrize("name,expected", [
    ("bab ezouar", {"name_fr": "Bab Ezzouar", "name_ar": "باب الزوار"}),
    ("باب الزوار", {"name_fr": "Bab Ezzouar", "name_ar": "باب الزوار"}),
    ("Kouba", None),
])
def test_match_for_a_typed_name(store, name, expected):
    tenant, users = store
    _write_snapshot()
    res = _client(users[RoleChoices.OWNER]).get(URL, {"wilaya": "16", "name": name})
    assert res.json()["match"] == expected


def test_unmatched_report_lists_only_unmatched_communes(store):
    tenant, users = store
    _write_snapshot()
    res = _client(users[RoleChoices.OWNER]).get(UNMATCHED_URL)

    assert res.status_code == status.HTTP_200_OK, res.content
    body = res.json()
    assert body["available"] is True
    assert body["count"] == 2
    assert body["communes"] == [
        {"id": 3, "name": "Douera", "ar_name": "دويرة", "wilaya": 16, "ship_wilaya": 16},
        {"id": 5, "name": "Negrine", "ar_name": "نقرين", "wilaya": 62, "ship_wilaya": 12},
    ]


def test_without_a_courier_list_nothing_is_matched_and_a_refresh_starts(store):
    tenant, users = store
    client = _client(users[RoleChoices.OWNER])
    with mock.patch.object(geo.communes_store, "start_background_refresh") as bg:
        listed = client.get(URL, {"wilaya": "16"}).json()
        report = client.get(UNMATCHED_URL).json()
    assert bg.call_count == 2
    assert listed["available"] is False and listed["stale"] is True
    assert [c["matched"] for c in listed["communes"]] == [False, False, False]
    assert listed["courier_communes"] == []
    assert report == {"available": False, "count": 0, "communes": [], "fetched_at": None,
                      "stale": True, "refreshing": False}


@pytest.mark.parametrize("url,params", [(URL, {"wilaya": "16"}), (UNMATCHED_URL, {})])
def test_cashier_is_refused(store, url, params):
    tenant, users = store
    res = _client(users[RoleChoices.CASHIER]).get(url, params)
    assert res.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.parametrize("url,params", [(URL, {"wilaya": "16"}), (UNMATCHED_URL, {})])
def test_feature_off_is_404(store, url, params):
    tenant, users = store
    StoreSettings.objects.filter(tenant=tenant).update(enable_delivery_integrations=False)
    res = _client(users[RoleChoices.OWNER]).get(url, params)
    assert res.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.parametrize("params", [{}, {"wilaya": "0"}, {"wilaya": "70"}, {"wilaya": "abc"},
                                    {"wilaya": "16", "name": "x" * 101}])
def test_invalid_query_is_400(store, params):
    tenant, users = store
    res = _client(users[RoleChoices.OWNER]).get(URL, params)
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert list(res.json()["error"]["details"].keys()) == ["name" if "name" in params else "wilaya"]
