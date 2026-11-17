"""
NOEST read connector (catalogue key `noest`, `https://app.noest-dz.com/api/public`)
(docs/plans/delivery-v1-plan.md P3.13).

**Unverified.** NOEST's API reference is a partner PDF (v2.3); this is built from the
dz-delivery SDK notes taken from it (live-checked on reads and error bodies only) and
their status fixture. Until the P3.16 probe:
  - which return event means the goods are back with the store;
  - that "Amount transmitted to partner" means paid to the store;
  - the batch size `get/trackings/info` accepts;
  - `delivery_fee` stays empty (it is in the fees table, not in tracking answers).

**No list endpoint**: Pointure follows the parcels it knows (sent from Pointure, or added by
tracking, P3.14) through `parcel_states`. Status and money come from the event history.

Auth: `Authorization: Bearer <apiToken>`, and the partner `guid` as `user_guid` in every POST
body. An unknown tracking and an unknown GUID both answer HTTP 404; the message tells them
apart ("Trackings non trouvés" vs "Partenaire introuvable"). About 60 requests a minute.
"""
import time

from .base import (
    Capability,
    ConnectorAuthError,
    ConnectorError,
    ConnectorNotFound,
    ConnectorRateLimited,
    CourierReadConnector,
    ParcelSnapshot,
    ParcelState,
    TrackingEvent,
    to_datetime,
    to_decimal,
)
from .registry import register
from .vocabulary import CashStatus, ShipmentStatus

BATCH = 50                   # trackings per get/trackings/info call (unverified)
MIN_INTERVAL = 1.1           # seconds between calls: under 60 a minute
REMAINING_FLOOR = 3
REMAINING_WAIT = 60
PROBE_TRACKING = "POINTURE-CONNECTION-TEST"

_S, _C = ShipmentStatus, CashStatus
HELD, PAID = "held", "paid"

# Event key or English label → (status, money signal or None).
_EVENTS = {
    # keys
    "upload": (_S.CREATED, None),
    "customer_validation": (_S.PENDING_PICKUP, None),
    "pickedup": (_S.PICKED_UP, None),
    "validation_collect_colis": (_S.PICKED_UP, None),
    "validation_reception_admin": (_S.AT_HUB, None),
    "validation_reception": (_S.AT_HUB, None),
    "sent_to_redispatch": (_S.IN_TRANSIT, None),
    "return_redispatched_to_livraison": (_S.IN_TRANSIT, None),
    "mise_a_jour": (_S.IN_TRANSIT, None),
    "fdr_activated": (_S.OUT_FOR_DELIVERY, None),
    "nouvel_tentative_asked_by_customer": (_S.DELIVERY_ATTEMPTED, None),
    "colis_suspendu": (_S.ON_HOLD, None),
    "livre": (_S.DELIVERED, HELD),
    "livred": (_S.DELIVERED, HELD),
    "echange_valide": (_S.DELIVERED, HELD),
    "echange_valid_by_hub": (_S.DELIVERED, HELD),
    "pickup_picked_recu": (_S.DELIVERED, HELD),
    "colis_pickup_transmit_to_partner": (_S.DELIVERED, HELD),
    "verssement_admin_cust": (_S.DELIVERED, PAID),
    "validation_reception_cash_by_partener": (_S.DELIVERED, PAID),
    "verssement_admin_cust_canceled": (_S.DELIVERED, HELD),
    "verssement_hub_cust_canceled": (_S.DELIVERED, HELD),
    "return_asked_by_customer": (_S.RETURN_IN_TRANSIT, None),
    "return_asked_by_hub": (_S.RETURN_IN_TRANSIT, None),
    "return_dispatched_to_partenaire": (_S.RETURN_IN_TRANSIT, None),
    "retour_dispatched_to_partenaires": (_S.RETURN_IN_TRANSIT, None),
    "return_dispatched_to_warehouse": (_S.RETURN_IN_TRANSIT, None),
    "annulation_dispatch_retour": (_S.RETURN_IN_TRANSIT, None),
    "cancel_return_dispatched_to_partenaire": (_S.RETURN_IN_TRANSIT, None),
    "livraison_echoue_recu": (_S.RETURN_IN_TRANSIT, None),
    "valid_return_pickup": (_S.RETURN_IN_TRANSIT, None),
    "return_validated_by_partener": (_S.RETURNED, None),
    "colis_retour_transmit_to_partner": (_S.RETURNED, None),
    "ask_to_delete_by_admin": (_S.CANCELLED, None),
    "ask_to_delete_by_hub": (_S.CANCELLED, None),
    # English labels, used when a row has no key
    "Uploaded to system": (_S.CREATED, None),
    "Validated": (_S.PENDING_PICKUP, None),
    "Package Picked Up": (_S.PICKED_UP, None),
    "Reception validated": (_S.AT_HUB, None),
    "Sent for redispatch": (_S.IN_TRANSIT, None),
    "Return put back for delivery": (_S.IN_TRANSIT, None),
    "Picked up by driver": (_S.OUT_FOR_DELIVERY, None),
    "Out for delivery": (_S.OUT_FOR_DELIVERY, None),
    "New attempt requested by seller": (_S.DELIVERY_ATTEMPTED, None),
    "Delivery attempt": (_S.DELIVERY_ATTEMPTED, None),
    "Suspended": (_S.ON_HOLD, None),
    "Delivered": (_S.DELIVERED, HELD),
    "Exchange validated": (_S.DELIVERED, HELD),
    "Exchange validated by hub": (_S.DELIVERED, HELD),
    "Amount transmitted to partner": (_S.DELIVERED, PAID),
    "Amount received by partner": (_S.DELIVERED, PAID),
    "Return requested by partner": (_S.RETURN_IN_TRANSIT, None),
    "Return in transit": (_S.RETURN_IN_TRANSIT, None),
    "Return dispatched to partner": (_S.RETURN_IN_TRANSIT, None),
    "Return dispatched to warehouse": (_S.RETURN_IN_TRANSIT, None),
    "Return package transmitted to partner": (_S.RETURNED, None),
    "Return received by partner": (_S.RETURNED, None),
    "Return validated by partner": (_S.RETURNED, None),
    "Deletion requested": (_S.CANCELLED, None),
}
# Notes on an order (edits, surcharges): they do not move it.
REMARKS = frozenset({"edited_informations", "edit_price", "edit_wilaya", "extra_fee"})
NO_CASH = frozenset({_S.RETURN_IN_TRANSIT, _S.RETURNED, _S.CANCELLED, _S.LOST})


def _key(value):
    return " ".join(str(value or "").strip().lower().split())


EVENT_MAP = {_key(name): value for name, value in _EVENTS.items()}


def map_event(row):
    """One activity row → (status, money signal, raw label), or None for a remark."""
    key, label = str(row.get("event_key") or "").strip(), str(row.get("event") or "").strip()
    if _key(key) in REMARKS:
        return None
    raw = (key or label)[:100]
    status, money = EVENT_MAP.get(_key(key)) or EVENT_MAP.get(_key(label)) or (ShipmentStatus.UNKNOWN, None)
    return status, money, raw


def read_activity(entry):
    """Dated, mapped events of one tracking answer, oldest first: [(when, status, money, raw, row)]."""
    activity = entry.get("activity")
    rows = list(activity.values()) if isinstance(activity, dict) else activity if isinstance(activity, list) else []
    events = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        mapped = map_event(row)
        when = to_datetime(row.get("date") if isinstance(row.get("date"), str) else None)
        if mapped is None or when is None:
            continue
        events.append((when, index, *mapped, row))
    events.sort(key=lambda e: (e[0], e[1]))
    return [(when, status, money, raw, row) for when, _i, status, money, raw, row in events]


def summarise(entry, cod):
    """Current (status, raw, cash, status_at) from the history: last mapped event; money from money events."""
    events = read_activity(entry)
    if not events:
        return ShipmentStatus.CREATED, "", (CashStatus.AWAITING_DELIVERY if cod else CashStatus.NOT_APPLICABLE), None
    when, status, _money, raw, _row = events[-1]
    # The last money event wins: a cancelled payment ("…_canceled") brings the cash back to held.
    money = next((m for _when, _status, m, _raw, _row in reversed(events) if m), None)
    if not cod or status in NO_CASH:
        cash = CashStatus.NOT_APPLICABLE
    elif status != ShipmentStatus.DELIVERED:
        cash = CashStatus.AWAITING_DELIVERY
    else:
        cash = CashStatus.PAID if money == PAID else CashStatus.HELD_BY_COURIER
    return status, raw, cash, when


@register
class NoestConnector(CourierReadConnector):
    platform = "noest"
    capabilities = frozenset({Capability.TEST, Capability.GET, Capability.HISTORY, Capability.PARCEL_STATES})
    verified = False

    def __init__(self, courier_key, credentials, base_url):
        super().__init__(courier_key, credentials, base_url)
        token = str(self.credentials.get("apiToken") or "").strip()
        self.token = token[7:].strip() if token.lower().startswith("bearer ") else token
        self.guid = str(self.credentials.get("guid") or "").strip()
        self._last_call = None
        self._wait = None
        self._last_404 = ""

    def auth_headers(self):
        return {"Authorization": f"Bearer {self.token}"}

    # ── rate guard and 404 meaning ────────────────────────────────────────────
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
            if int(str(headers.get("x-ratelimit-remaining")).strip()) <= REMAINING_FLOOR:
                self._wait = REMAINING_WAIT
        except (TypeError, ValueError):
            pass
        self._last_404 = ""
        if getattr(response, "status_code", None) == 404:
            try:
                body = response.json()
            except ValueError:
                body = {}
            message = body.get("message") if isinstance(body, dict) else ""
            self._last_404 = str(message or "").lower()

    def _trackings_info(self, trackings):
        """POST get/trackings/info → {tracking: entry}; {} when none is known; refused GUID → auth error."""
        try:
            data = self._request("POST", "/get/trackings/info", json={"user_guid": self.guid, "trackings": trackings})
        except ConnectorNotFound:
            if "partenaire" in self._last_404:
                raise ConnectorAuthError(status_code=404)
            return {}
        return data if isinstance(data, dict) else {}

    # ── operations ────────────────────────────────────────────────────────────
    def test_credentials(self):
        """Token and GUID both checked: an impossible tracking must come back as "not found"."""
        if not self.token or not self.guid:
            raise ConnectorError("missing_credentials")
        self._trackings_info([PROBE_TRACKING])

    def parcel_states(self, trackings):
        refs = [_safe_ref(t) for t in dict.fromkeys(trackings) if t]
        found = {}
        for start in range(0, len(refs), BATCH):
            batch = refs[start:start + BATCH]
            data = self._trackings_info(batch)
            for ref in batch:
                entry = data.get(ref)
                if not isinstance(entry, dict):
                    continue
                cod = _cod(entry)
                status, raw, cash, when = summarise(entry, cod is None or cod > 0)
                found[ref] = ParcelState(status=status, raw_status=raw, cash_status=cash, status_at=when)
        return found

    def get_parcel(self, ref):
        ref = _safe_ref(ref)
        entry = self._trackings_info([ref]).get(ref)
        if not isinstance(entry, dict):
            raise ConnectorNotFound()
        return _snapshot(ref, entry)

    def parcel_snapshots(self, trackings):
        """Full snapshots, BATCH per call, for parcels added by tracking (P3.14). Unknown ones left out."""
        refs = [_safe_ref(t) for t in dict.fromkeys(trackings) if t]
        found = {}
        for start in range(0, len(refs), BATCH):
            batch = refs[start:start + BATCH]
            data = self._trackings_info(batch)
            for ref in batch:
                if isinstance(data.get(ref), dict):
                    found[ref] = _snapshot(ref, data[ref])
        return found

    def history(self, ref):
        ref = _safe_ref(ref)
        entry = self._trackings_info([ref]).get(ref)
        if not isinstance(entry, dict):
            return ()
        return tuple(
            TrackingEvent(status=status, raw_status=raw, occurred_at=when,
                          note=str(row.get("event") if row.get("event_key") else "")[:255])
            for when, status, _money, raw, row in read_activity(entry)
        )


# ─── helpers ──────────────────────────────────────────────────────────────────

def _snapshot(ref, entry):
    info = entry.get("OrderInfo") if isinstance(entry.get("OrderInfo"), dict) else {}
    cod = _cod(entry)
    status, raw, cash, when = summarise(entry, cod is None or cod > 0)
    return ParcelSnapshot(
        external_id=ref, tracking=ref, status=status, raw_status=raw, status_at=when, updated_at=when,
        reference=str(info.get("reference") or "")[:100],
        recipient_name=str(info.get("client") or "")[:200],
        recipient_phone=str(info.get("phone") or "")[:20],
        wilaya_code=str(info.get("wilaya_id") or "")[:10],
        commune=str(info.get("commune") or "")[:100],
        cod_amount=cod, delivery_fee=None, store_amount=None, cash_status=cash, cash_raw="",
    )


def _cod(entry):
    info = entry.get("OrderInfo") if isinstance(entry.get("OrderInfo"), dict) else {}
    return to_decimal(info.get("montant"))


def _safe_ref(ref):
    """Tracking numbers go into a JSON body; still, id-like characters only."""
    ref = str(ref or "").strip()
    if not ref or len(ref) > 64 or not all(c.isalnum() or c in "-_" for c in ref):
        raise ConnectorError("invalid_reference")
    return ref
