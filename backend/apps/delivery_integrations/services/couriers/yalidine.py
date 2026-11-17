"""
Yalidine-family read connector: Yalidine, Yalitec, Guepex, Easy & Speed, Economiqua,
We Can Services; one API, the host comes from the dzship catalogue
(docs/plans/delivery-v1-plan.md, Phase 3, P3.1).

**Unverified.** Built from the public copy of the Guepex/Yalidine API docs and an
open-source client, without a real merchant account. Until the P3.4 probe:
  - `store_amount` is left empty (does `price` include the fee when `freeshipping` is 0?
    how does the COD tax apply?);
  - `ready` and `receivable` both read as "ready to be paid";
  - "Colis abandonné" reads as lost.

Credentials (catalogue names): `apiId` → `X-API-ID`, `apiToken` → `X-API-TOKEN`.

Quotas (5/s, 50/min, 1,000/h, 10,000/day; repeated overruns disable the account for
growing periods): calls are spaced, and the run stops as "rate limited" when a quota
header (`x-*-quota-left`) gets low, instead of waiting for a 429.
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

PAGE_SIZE = 100
MIN_INTERVAL = 0.3          # seconds between calls: well inside 5/s

# Stop the run when a quota gets this low; wait that long before the next run.
QUOTA_FLOORS = (
    ("x-second-quota-left", 1, 2),
    ("x-minute-quota-left", 5, 60),
    ("x-hour-quota-left", 50, 3600),
    ("x-day-quota-left", 300, 6 * 3600),
)

_S = ShipmentStatus
_RAW_STATUSES = {
    _S.CREATED: ("Pas encore expédié", "A vérifier", "En préparation"),
    _S.PENDING_PICKUP: ("Pas encore ramassé", "Prêt à expédier", "En passation"),
    _S.PICKED_UP: ("Ramassé",),
    _S.IN_TRANSIT: ("Débloqué", "Transfert", "Expédié", "En localisation", "Vers Wilaya", "En transit",
                    "Alerte résolue"),
    _S.AT_HUB: ("Centre", "Reçu à Wilaya"),
    _S.OUT_FOR_DELIVERY: ("Prêt pour livreur", "Sorti en livraison"),
    _S.DELIVERY_ATTEMPTED: ("Tentative échouée",),
    _S.ON_HOLD: ("Bloqué", "En attente", "En attente du client", "En alerte"),
    _S.DELIVERED: ("Livré",),
    _S.RETURN_IN_TRANSIT: ("Echèc livraison", "Retour vers centre", "Retourné au centre", "Retour transfert",
                           "Retour groupé", "Retour à retirer", "Retour non retiré", "Retour vers vendeur",
                           "Echange échoué"),
    _S.RETURNED: ("Retourné au vendeur",),
    _S.CANCELLED: ("Annulé",),
    _S.LOST: ("Colis abandonné",),
}

# No cash will come for parcels in these states.
NO_CASH = frozenset({_S.RETURN_IN_TRANSIT, _S.RETURNED, _S.CANCELLED, _S.LOST})


def _key(label):
    """Accent-, case- and spacing-insensitive key ("Echèc  livraison" == "echec livraison")."""
    text = unicodedata.normalize("NFKD", str(label or "")).encode("ascii", "ignore").decode()
    return " ".join(text.casefold().split())


STATUS_MAP = {_key(raw): status for status, labels in _RAW_STATUSES.items() for raw in labels}


def map_status(raw):
    """Yalidine's French label → (canonical status, the label as sent)."""
    label = str(raw or "").strip()[:100]
    return STATUS_MAP.get(_key(label), ShipmentStatus.UNKNOWN), label


def has_cod(row):
    """A parcel collects cash unless `has_recouvrement` says no or the price is 0."""
    flag = row.get("has_recouvrement")
    if flag is not None and str(flag).strip().lower() in ("0", "false"):
        return False
    price = to_decimal(row.get("price"))
    return price is None or price > 0


def cash_status_for(status, payment_status, cod):
    """Per-parcel cash stage from the parcel itself (the docs give `payment_status` per parcel)."""
    if not cod or status in NO_CASH:
        return CashStatus.NOT_APPLICABLE
    if status != ShipmentStatus.DELIVERED:
        return CashStatus.AWAITING_DELIVERY
    payment = _key(payment_status)
    if payment == "payed":
        return CashStatus.PAID
    if payment in ("ready", "receivable"):
        return CashStatus.READY
    return CashStatus.HELD_BY_COURIER


@register
class YalidineConnector(CourierReadConnector):
    platform = "yalidine"
    capabilities = frozenset({Capability.TEST, Capability.LIST, Capability.GET, Capability.HISTORY})
    verified = False

    def __init__(self, courier_key, credentials, base_url):
        super().__init__(courier_key, credentials, base_url)
        self.api_id = str(self.credentials.get("apiId") or "").strip()
        self.api_token = str(self.credentials.get("apiToken") or "").strip()
        self._last_call = None
        self._wait = None           # seconds to wait once a quota got low

    def auth_headers(self):
        return {"X-API-ID": self.api_id, "X-API-TOKEN": self.api_token}

    # ── quota guard ───────────────────────────────────────────────────────────
    def _before_request(self):
        if self._wait is not None:
            raise ConnectorRateLimited(retry_after=self._wait)
        if self._last_call is not None:
            gap = MIN_INTERVAL - (time.monotonic() - self._last_call)
            if gap > 0:
                time.sleep(gap)
        self._last_call = time.monotonic()

    def _after_response(self, response):
        headers = getattr(response, "headers", None) or {}
        for header, floor, wait in QUOTA_FLOORS:
            try:
                left = int(str(headers.get(header)).strip())
            except (TypeError, ValueError):
                continue
            if left <= floor:
                self._wait = max(self._wait or 0, wait)

    # ── operations ────────────────────────────────────────────────────────────
    def test_credentials(self):
        if not self.api_id or not self.api_token:
            raise ConnectorError("missing_credentials")
        self._request("GET", "/v1/wilayas/", params={"page_size": 1})

    def list_parcels(self, cursor=None):
        page = _page_number(cursor)
        data = _dict(self._request("GET", "/v1/parcels/", params={
            "order_by": "date_last_status", "page": page, "page_size": PAGE_SIZE,
        }))
        items = tuple(self._snapshot(row) for row in _rows(data) if row.get("tracking"))
        return ParcelPage(items=items, next_cursor=str(page + 1) if data.get("has_more") else None)

    def get_parcel(self, ref):
        data = _dict(self._request("GET", f"/v1/parcels/{_safe_ref(ref)}"))
        # The docs show list-shaped answers ({"data": [...]}); accept a bare parcel too.
        rows = _rows(data) if "data" in data else [data]
        rows = [r for r in rows if r.get("tracking")]
        if not rows:
            raise ConnectorError("invalid_response")
        return self._snapshot(rows[0])

    def history(self, ref):
        data = _dict(self._request("GET", f"/v1/histories/{_safe_ref(ref)}", params={"page_size": 100}))
        events = []
        for row in _rows(data):
            occurred = to_datetime(row.get("date_status"))
            if occurred is None:
                continue
            status, raw = map_status(row.get("status"))
            place = " · ".join(str(row.get(k)) for k in ("center_name", "commune_name") if row.get(k))
            reason = row.get("reason") if isinstance(row.get("reason"), str) else ""
            note = " — ".join(part for part in (reason.strip(), place) if part)
            events.append(TrackingEvent(status=status, raw_status=raw, occurred_at=occurred, note=note[:255]))
        events.sort(key=lambda e: e.occurred_at)
        return tuple(events)

    def _snapshot(self, row):
        status, raw = map_status(row.get("last_status"))
        cod = has_cod(row)
        when = to_datetime(row.get("date_last_status"))
        name = " ".join(str(row.get(k) or "").strip() for k in ("firstname", "familyname")).strip()
        payment = str(row.get("payment_status") or "")
        return ParcelSnapshot(
            external_id=str(row["tracking"])[:64],          # Yalidine has no other parcel id
            tracking=str(row["tracking"])[:64],
            status=status,
            raw_status=raw,
            status_at=when,
            updated_at=when,
            reference=str(row.get("order_id") or "")[:100],
            recipient_name=name[:200],
            recipient_phone=str(row.get("contact_phone") or "")[:20],
            wilaya_code=str(row.get("to_wilaya_id") or "")[:10],
            commune=str(row.get("to_commune_name") or "")[:100],
            cod_amount=to_decimal(row.get("price")) if cod else to_decimal(0),
            delivery_fee=to_decimal(row.get("delivery_fee")),
            store_amount=None,                              # unverified (see module docstring)
            cash_status=cash_status_for(status, payment, cod),
            cash_raw=payment[:100],
        )


# ─── helpers ──────────────────────────────────────────────────────────────────

def _dict(value):
    return value if isinstance(value, dict) else {}


def _rows(data):
    rows = data.get("data")
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


def _page_number(cursor):
    try:
        page = int(cursor) if cursor else 1
    except (TypeError, ValueError):
        page = 1
    return max(1, min(page, 10_000))


def _safe_ref(ref):
    """Tracking numbers go into the URL path ("yal-123456"): id-like characters only."""
    ref = str(ref or "").strip()
    if not ref or len(ref) > 64 or not all(c.isalnum() or c in "-_" for c in ref):
        raise ConnectorError("invalid_reference")
    return ref
