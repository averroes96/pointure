"""
Ecotrack-platform read connector: one class for the 83 couriers that run the Ecotrack
white-label platform (DHD, Conexlog, MSM Go, World Express, Anderson, Packers…), each
on its own host from the dzship catalogue (docs/plans/delivery-v1-plan.md P3.5).

**Unverified.** Ecotrack publishes no public reference. Built from dzship's guide, the
dz-delivery SDK notes (live checks on one tenant) and the Wocart adapter (written from
Ecotrack's Postman collection); their status keys agree. Until the P3.8 probe:
  - `store_amount` is left empty (the recipient's `montant` includes the delivery fee);
  - list rows carry no status time: a new status is dated when Pointure first sees it.

API: `https://<host>/api/v1/…`, `Authorization: Bearer <token>`, about 50 requests a
minute (Laravel throttle: `X-RateLimit-Remaining`, 429 + `Retry-After`).

Two key vocabularies, mapped by key only (display labels drift per tenant):
  - dashboard buckets (`status` of `get/orders` rows), which also say where the cash is;
  - history activities (`get/tracking/info`).

`get/orders` lists in-process orders only (archived ones are excluded) and is not
ordered by change, so a run reads at most `max_list_pages` pages (P3.6 follows the
parcels that leave the list).
"""
import time

from .base import (
    Capability,
    ConnectorError,
    ConnectorNotFound,
    ConnectorRateLimited,
    CourierReadConnector,
    ParcelPage,
    ParcelSnapshot,
    TrackingEvent,
    to_datetime,
    to_decimal,
)
from .registry import register
from .vocabulary import CashStatus, ShipmentStatus

API_PREFIX = "/api/v1"
MAX_LIST_PAGES = 10          # 40 orders per page → 400 in-process orders per run
MIN_INTERVAL = 1.3           # seconds between calls: under 50 a minute
REMAINING_FLOOR = 3          # stop the run when the throttle says this few are left…
REMAINING_WAIT = 60          # …and wait a minute

_S, _C = ShipmentStatus, CashStatus

# Dashboard bucket key → (status, cash stage once delivered).
BUCKETS = {
    "en_preparation_stock": (_S.CREATED, None),
    "prete_a_expedier": (_S.PENDING_PICKUP, None),
    "en_ramassage": (_S.PENDING_PICKUP, None),
    "vers_hub": (_S.IN_TRANSIT, None),
    "vers_wilaya": (_S.IN_TRANSIT, None),
    "en_hub": (_S.AT_HUB, None),
    "en_preparation": (_S.AT_HUB, None),
    "en_livraison": (_S.OUT_FOR_DELIVERY, None),
    "suspendu": (_S.ON_HOLD, None),
    "livre_non_encaisse": (_S.DELIVERED, _C.HELD_BY_COURIER),
    "encaisse_non_paye": (_S.DELIVERED, _C.HELD_BY_COURIER),
    "paiements_prets": (_S.DELIVERED, _C.READY),
    "paye_et_archive": (_S.DELIVERED, _C.PAID),
    "retour_chez_livreur": (_S.RETURN_IN_TRANSIT, None),
    "retour_transit_entrepot": (_S.RETURN_IN_TRANSIT, None),
    "retour_en_traitement": (_S.RETURN_IN_TRANSIT, None),
    "retour_recu": (_S.RETURNED, None),
    "retour_archive": (_S.RETURNED, None),
    "annule": (_S.CANCELLED, None),
}

# History activity key → status. `notification_on_order` is a note, not a status.
ACTIVITIES = {
    "order_information_received_by_carrier": _S.CREATED,
    "picked": _S.PICKED_UP,
    "accepted_by_carrier": _S.IN_TRANSIT,
    "dispatched_to_driver": _S.OUT_FOR_DELIVERY,
    "attempt_delivery": _S.DELIVERY_ATTEMPTED,
    "livred": _S.DELIVERED,
    "encaissed": _S.DELIVERED,
    "payed": _S.DELIVERED,
    "return_asked": _S.RETURN_IN_TRANSIT,
    "return_in_transit": _S.RETURN_IN_TRANSIT,
    "return_received": _S.RETURNED,
}
NOTE_ACTIVITIES = frozenset({"notification_on_order"})

NO_CASH = frozenset({_S.RETURN_IN_TRANSIT, _S.RETURNED, _S.CANCELLED, _S.LOST})


def _key(value):
    return str(value or "").strip().lower()


def map_bucket(raw):
    """Dashboard bucket key → (status, cash stage or None, the key as sent)."""
    label = str(raw or "").strip()[:100]
    status, cash = BUCKETS.get(_key(label), (ShipmentStatus.UNKNOWN, None))
    return status, cash, label


def map_activity(raw):
    """History activity key → (status, the key as sent). Keys are compared case-insensitively."""
    label = str(raw or "").strip()[:100]
    return ACTIVITIES.get(_key(label), ShipmentStatus.UNKNOWN), label


def cash_status_for(status, delivered_stage, cod):
    if not cod or status in NO_CASH:
        return CashStatus.NOT_APPLICABLE
    if status != ShipmentStatus.DELIVERED:
        return CashStatus.AWAITING_DELIVERY
    return delivered_stage or CashStatus.HELD_BY_COURIER


@register
class EcotrackConnector(CourierReadConnector):
    platform = "ecotrack"
    capabilities = frozenset({Capability.TEST, Capability.LIST, Capability.GET, Capability.HISTORY})
    verified = False
    max_list_pages = MAX_LIST_PAGES

    def __init__(self, courier_key, credentials, base_url):
        base = base_url.rstrip("/")
        if base.lower().endswith(API_PREFIX):              # tolerate ".../api/v1" in a saved URL
            base = base[: -len(API_PREFIX)]
        super().__init__(courier_key, credentials, base)
        token = str(self.credentials.get("token") or "").strip()
        self.token = token[7:].strip() if token.lower().startswith("bearer ") else token
        self._last_call = None
        self._wait = None

    def auth_headers(self):
        return {"Authorization": f"Bearer {self.token}"}

    # ── rate guard ────────────────────────────────────────────────────────────
    def _before_request(self):
        if self._wait is not None:
            raise ConnectorRateLimited(retry_after=self._wait)
        if self._last_call is not None:
            gap = MIN_INTERVAL - (time.monotonic() - self._last_call)
            if gap > 0:
                time.sleep(gap)
        self._last_call = time.monotonic()

    def _after_response(self, response):
        headers = {str(k).lower(): v for k, v in dict(getattr(response, "headers", None) or {}).items()}
        try:
            remaining = int(str(headers.get("x-ratelimit-remaining")).strip())
        except (TypeError, ValueError):
            return
        if remaining <= REMAINING_FLOOR:
            self._wait = REMAINING_WAIT

    def _get(self, path, params=None):
        data = self._request("GET", f"{API_PREFIX}/{path}", params=params)
        if isinstance(data, dict) and data.get("success") is False:     # HTTP 200 business refusal
            raise ConnectorError("refused_by_courier")
        return data

    # ── operations ────────────────────────────────────────────────────────────
    def test_credentials(self):
        if not self.token:
            raise ConnectorError("missing_credentials")
        self._get("get/wilayas")

    def list_parcels(self, cursor=None):
        page = _page_number(cursor)
        data = _dict(self._get("get/orders", params={"page": page}))
        items = tuple(self._snapshot(row) for row in _rows(data) if row.get("tracking"))
        last = data.get("last_page")
        more = isinstance(last, int) and not isinstance(last, bool) and page < last
        return ParcelPage(items=items, next_cursor=str(page + 1) if more else None)

    def get_parcel(self, ref):
        ref = _safe_ref(ref)
        data = _dict(self._get("get/orders", params={"tracking": ref}))
        # The API answers list-style queries: use only the row for this exact tracking.
        row = next((r for r in _rows(data) if str(r.get("tracking") or "") == ref), None)
        if row is None:
            raise ConnectorNotFound()
        return self._snapshot(row)

    def history(self, ref):
        ref = _safe_ref(ref)
        entry = _tracking_entry(self._get("get/tracking/info", params={"tracking": ref}), ref)
        events = []
        for row in entry.get("activity") if isinstance(entry.get("activity"), list) else []:
            if not isinstance(row, dict) or _key(row.get("status")) in NOTE_ACTIVITIES:
                continue
            date, clock = row.get("date"), row.get("time")
            occurred = to_datetime(f"{date} {clock}" if date and clock else date)
            if occurred is None:
                continue
            status, raw = map_activity(row.get("status"))
            note = " — ".join(str(row.get(k)).strip() for k in ("reason", "station") if row.get(k))
            events.append(TrackingEvent(status=status, raw_status=raw, occurred_at=occurred, note=note[:255]))
        events.sort(key=lambda e: e.occurred_at)
        return tuple(events)

    def _snapshot(self, row):
        status, delivered_stage, raw = map_bucket(row.get("status"))
        cod = to_decimal(row.get("montant"))
        has_cod = cod is not None and cod > 0
        return ParcelSnapshot(
            external_id=str(row["tracking"])[:64],          # Ecotrack identifies parcels by tracking
            tracking=str(row["tracking"])[:64],
            status=status,
            raw_status=raw,
            status_at=None,                                 # not in list rows (see module docstring)
            updated_at=None,
            reference=str(row.get("reference") or "")[:100],
            recipient_name=str(row.get("client") or "")[:200],
            recipient_phone=str(row.get("phone") or "")[:20],
            wilaya_code=str(row.get("wilaya_id") or "")[:10],
            commune=str(row.get("commune") or "")[:100],
            cod_amount=cod,
            delivery_fee=to_decimal(row.get("tarif_prestation")),
            store_amount=None,                              # unverified (see module docstring)
            cash_status=cash_status_for(status, delivered_stage, has_cod),
            cash_raw="",
        )


# ─── helpers ──────────────────────────────────────────────────────────────────

def _dict(value):
    return value if isinstance(value, dict) else {}


def _rows(data):
    """`data` as a list, or as an index-keyed object (some tenants answer that way)."""
    rows = data.get("data")
    if isinstance(rows, dict):
        rows = list(rows.values())
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


def _tracking_entry(data, ref):
    """The tracking answer for exactly `ref`: a bare object, or one entry of a list / keyed object."""
    if isinstance(data, dict) and "activity" in data:
        return data
    candidates = []
    if isinstance(data, dict):
        inner = data.get("data", data)
        if isinstance(inner, dict) and isinstance(inner.get(ref), dict):
            return inner[ref]
        candidates = list(inner.values()) if isinstance(inner, dict) else inner if isinstance(inner, list) else []
    elif isinstance(data, list):
        candidates = data
    for entry in candidates:
        if isinstance(entry, dict) and str(entry.get("tracking") or "") == ref:
            return entry
    return {}


def _page_number(cursor):
    try:
        page = int(cursor) if cursor else 1
    except (TypeError, ValueError):
        page = 1
    return max(1, min(page, 10_000))


def _safe_ref(ref):
    """Tracking numbers go into query strings: id-like characters only."""
    ref = str(ref or "").strip()
    if not ref or len(ref) > 64 or not all(c.isalnum() or c in "-_" for c in ref):
        raise ConnectorError("invalid_reference")
    return ref
