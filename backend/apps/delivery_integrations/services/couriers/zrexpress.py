"""
ZR Express new-platform read connector (catalogue key `zrexpressnew`, platform
`zrexpressapp`, `https://api.zrexpress.app`) (docs/plans/delivery-v1-plan.md P3.9).

**Unverified.** Built from ZR Express's official public docs (docs.zrexpress.app,
OpenAPI excerpts) without a real account. Until the P3.12 probe:
  - parcel states are workflow-defined: the mapping covers the documented example
    workflow and the PascalCase names seen in the docs; anything else is `unknown`;
  - `store_amount` is left empty (`amount` is what the customer pays, fee included);
  - naive date-times are read as Algiers time.

Credentials (catalogue names): `apiKey` → `X-Api-Key`, `tenantId` → `X-Tenant`. Keys
expire (7 to 365 days): an expired key reads as "credentials refused".

Searches are POST requests with a JSON body; they only read. `orderBy
lastStateUpdateAt desc` makes the parcel search a "newest changes first" feed.
"""
import time
import unicodedata

from .base import (
    Capability,
    ConnectorError,
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

API = "/api/v1"
PAGE_SIZE = 100
MIN_INTERVAL = 0.5           # seconds between calls (no documented limit)
REMAINING_FLOOR = 3          # stop the run when a throttle header says this few are left…
REMAINING_WAIT = 60          # …and wait a minute

_S = ShipmentStatus
_STATES = {
    _S.CREATED: ("commande_recue", "OrderReceived", "appel_confirmation", "commande_confirmee", "en_traitement"),
    _S.PENDING_PICKUP: ("pret_a_expedier", "ReadyToDispatch"),
    _S.PICKED_UP: ("colis_recuperer",),
    _S.AT_HUB: ("confirme_au_bureau", "AtHub"),
    _S.IN_TRANSIT: ("dispatch", "vers_wilaya", "InTransit"),
    _S.OUT_FOR_DELIVERY: ("en_livraison", "sortie_en_livraison", "OutForDelivery"),
    _S.ON_HOLD: ("en_attente_dechange",),
    _S.DELIVERED: ("livre", "encaisse", "Delivered"),
    _S.RETURN_IN_TRANSIT: ("attente_recuperation_fournisseur",),
    _S.RETURNED: ("recupere_par_fournisseur", "reinjecte_dans_stock", "Returned"),
    _S.CANCELLED: ("annule", "supprimee", "Cancelled"),
}

# A parcel flagged `isReturn` that is not back yet is on its way back to the store.
RETURN_SETTLED = frozenset({_S.RETURNED, _S.CANCELLED})
NO_CASH = frozenset({_S.RETURN_IN_TRANSIT, _S.RETURNED, _S.CANCELLED, _S.LOST})


def _key(name):
    """`pret_a_expedier` == `PretAExpedier` == `Prêt-à-expédier`: case, accents and separators ignored."""
    text = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode().lower()
    return "".join(c for c in text if c.isalnum())


STATE_MAP = {_key(name): status for status, names in _STATES.items() for name in names}


def map_state(name, is_return=False):
    """ZR state name → (canonical status, the name as sent), with the `isReturn` rule."""
    label = str(name or "").strip()[:100]
    status = STATE_MAP.get(_key(label), ShipmentStatus.UNKNOWN)
    if is_return and status not in RETURN_SETTLED:
        status = ShipmentStatus.RETURN_IN_TRANSIT
    return status, label


def cash_status_for(status, cod):
    """Cash stage from the parcel alone; `ready` and `paid` come from payouts (P3.10)."""
    if not cod or status in NO_CASH:
        return CashStatus.NOT_APPLICABLE
    if status == ShipmentStatus.DELIVERED:
        return CashStatus.HELD_BY_COURIER
    return CashStatus.AWAITING_DELIVERY


@register
class ZRExpressConnector(CourierReadConnector):
    platform = "zrexpressapp"
    capabilities = frozenset({Capability.TEST, Capability.LIST, Capability.GET, Capability.HISTORY})
    verified = False

    def __init__(self, courier_key, credentials, base_url):
        super().__init__(courier_key, credentials, base_url)
        self.api_key = str(self.credentials.get("apiKey") or "").strip()
        self.tenant_id = str(self.credentials.get("tenantId") or "").strip()
        self._last_call = None
        self._wait = None

    def auth_headers(self):
        return {"X-Api-Key": self.api_key, "X-Tenant": self.tenant_id}

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

    def _search(self, body):
        return _dict(self._request("POST", f"{API}/parcels/search", json=body))

    # ── operations ────────────────────────────────────────────────────────────
    def test_credentials(self):
        if not self.api_key or not self.tenant_id:
            raise ConnectorError("missing_credentials")
        self._search({"pageNumber": 1, "pageSize": 1})

    def list_parcels(self, cursor=None):
        page = _page_number(cursor)
        data = self._search({"pageNumber": page, "pageSize": PAGE_SIZE, "orderBy": ["lastStateUpdateAt desc"]})
        rows = data.get("items") if isinstance(data.get("items"), list) else []
        items = tuple(self._snapshot(r) for r in rows if isinstance(r, dict) and r.get("id"))
        return ParcelPage(items=items, next_cursor=str(page + 1) if data.get("hasNext") is True else None)

    def get_parcel(self, ref):
        row = _dict(self._request("GET", f"{API}/parcels/{_safe_ref(ref)}"))
        if not row.get("id"):
            raise ConnectorError("invalid_response")
        return self._snapshot(row)

    def history(self, ref):
        rows = self._request("GET", f"{API}/parcels/{_safe_ref(ref)}/state-history")
        rows = rows.get("items") if isinstance(rows, dict) else rows      # tolerate a paged shape
        events = []
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, dict):
                continue
            occurred = to_datetime(row.get("createdAt"))
            state = _dict(row.get("newState"))
            if occurred is None or not state.get("name"):
                continue
            status, raw = map_state(state.get("name"))
            location = _dict(row.get("location"))
            note = " — ".join(str(v).strip() for v in (state.get("description"), location.get("hubName")) if v)
            events.append(TrackingEvent(status=status, raw_status=raw, occurred_at=occurred, note=note[:255]))
        events.sort(key=lambda e: e.occurred_at)
        return tuple(events)

    def _snapshot(self, row):
        state = _dict(row.get("state"))
        status, raw = map_state(state.get("name"), is_return=row.get("isReturn") is True)
        cod = to_decimal(row.get("amount"))
        when = to_datetime(row.get("lastStateUpdateAt"))
        customer = _dict(row.get("customer"))
        address = _dict(row.get("deliveryAddress"))
        wilaya = address.get("cityTerritoryCode")
        return ParcelSnapshot(
            external_id=str(row["id"])[:64],
            tracking=str(row.get("trackingNumber") or "")[:64],
            status=status,
            raw_status=raw,
            status_at=when,
            updated_at=when,
            reference=str(row.get("externalId") or "")[:100],
            recipient_name=str(customer.get("name") or "")[:200],
            recipient_phone=str(_dict(customer.get("phone")).get("number1") or "")[:20],
            wilaya_code=str(wilaya)[:10] if isinstance(wilaya, int) and not isinstance(wilaya, bool) else "",
            commune=str(address.get("district") or address.get("city") or "")[:100],
            cod_amount=cod,
            delivery_fee=to_decimal(row.get("deliveryPrice")),
            store_amount=None,                              # unverified (see module docstring)
            cash_status=cash_status_for(status, cod is not None and cod > 0),
            cash_raw="",
        )


# ─── helpers ──────────────────────────────────────────────────────────────────

def _dict(value):
    return value if isinstance(value, dict) else {}


def _page_number(cursor):
    try:
        page = int(cursor) if cursor else 1
    except (TypeError, ValueError):
        page = 1
    return max(1, min(page, 10_000))


def _safe_ref(ref):
    """Parcel ids (uuid) and tracking numbers (`DZ-AL-20251121-00145`) go into the URL path."""
    ref = str(ref or "").strip()
    if not ref or len(ref) > 64 or not all(c.isalnum() or c in "-_" for c in ref):
        raise ConnectorError("invalid_reference")
    return ref
