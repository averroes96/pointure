"""
Maystro read connector (docs/plans/delivery-v1-plan.md P1.6, P1.7).

Source of truth: Maystro's OpenAPI at https://backend-web-app.maystro-delivery.com/api/schema/
and a structure-only probe of a real store account (2026-11-17). The public GitBook
docs describe the older host and are out of date.

Credentials (catalogue name `apiKey`):
- a 40-character **store token** → `Authorization: Token <token>`: reads everything;
- an **integration key** `ak_…` → `X-API-KEY: <key>`: Maystro only lets it read the
  balance (no order, history or payment permission exists for keys today).

Field meanings (probe, counts only): COD = `total_price`, delivery fee = `price`,
amount owed to the store = `product_price`.
"""
from .base import (
    Balance,
    Capability,
    ConnectorError,
    ConnectorNotSupported,
    CourierReadConnector,
    ParcelPage,
    ParcelSnapshot,
    Payout,
    PayoutLine,
    TrackingEvent,
    to_date,
    to_datetime,
    to_decimal,
)
from .registry import register
from .vocabulary import CashStatus, ShipmentStatus

PAGE_SIZE = 100

# Maystro status code → (Maystro name, canonical status). Names from Status8a7Enum.
STATUS_MAP = {
    4: ("CREATED", ShipmentStatus.CREATED),
    5: ("PICK_UP_REQUESTED", ShipmentStatus.PENDING_PICKUP),
    6: ("IN_PROCESS", ShipmentStatus.PICKED_UP),
    8: ("WAITING_TRANSIT", ShipmentStatus.AT_HUB),
    9: ("IN_TRANSIT_TO_BE_SHIPPED", ShipmentStatus.IN_TRANSIT),
    10: ("IN_TRANSIT_TO_BE_RETURNED", ShipmentStatus.RETURN_IN_TRANSIT),
    11: ("PENDING", ShipmentStatus.CREATED),
    12: ("OUT_OF_STOCK", ShipmentStatus.ON_HOLD),
    15: ("READY_TO_SHIP", ShipmentStatus.AT_HUB),
    22: ("ASSIGNED", ShipmentStatus.IN_TRANSIT),
    31: ("SHIPPED", ShipmentStatus.OUT_FOR_DELIVERY),
    32: ("ALERTED", ShipmentStatus.DELIVERY_ATTEMPTED),
    33: ("READY_FOR_PICKUP", ShipmentStatus.OUT_FOR_DELIVERY),
    41: ("DELIVERED", ShipmentStatus.DELIVERED),
    42: ("POSTPONED", ShipmentStatus.ON_HOLD),
    50: ("ABORTED", ShipmentStatus.CANCELLED),
    51: ("READY_TO_RETURN", ShipmentStatus.RETURN_IN_TRANSIT),
    52: ("TAKEN_BY_STORE", ShipmentStatus.RETURNED),
    # The store reports a return as not received: keep it visible (non-terminal).
    53: ("NOT_RECEIVED", ShipmentStatus.ON_HOLD),
}

# Statuses after which no cash will come for the parcel.
NO_CASH_CODES = frozenset({10, 50, 51, 52, 53})


def map_status(code):
    """Maystro numeric status → (canonical status, raw text like "41 DELIVERED")."""
    try:
        code = int(code)
    except (TypeError, ValueError):
        return ShipmentStatus.UNKNOWN, str(code or "")
    name, status = STATUS_MAP.get(code, ("", ShipmentStatus.UNKNOWN))
    return status, f"{code} {name}".strip()


def cash_status_for(code, cod_amount):
    """Per-order cash stage from the order alone. `paid`/`ready` come from payouts (sync)."""
    try:
        code = int(code)
    except (TypeError, ValueError):
        return CashStatus.AWAITING_DELIVERY
    if cod_amount is not None and cod_amount <= 0:
        return CashStatus.NOT_APPLICABLE
    if code in NO_CASH_CODES:
        return CashStatus.NOT_APPLICABLE
    if code == 41:
        return CashStatus.HELD_BY_COURIER
    return CashStatus.AWAITING_DELIVERY


@register
class MaystroConnector(CourierReadConnector):
    platform = "maystro"
    BASE_URL_OVERRIDE = "https://backend-web-app.maystro-delivery.com/api"

    FULL = frozenset({
        Capability.TEST, Capability.LIST, Capability.GET, Capability.HISTORY,
        Capability.BALANCE, Capability.PAYOUTS,
    })
    KEY_ONLY = frozenset({Capability.TEST, Capability.BALANCE})

    def __init__(self, courier_key, credentials, base_url):
        super().__init__(courier_key, credentials, base_url)
        self.secret = str(self.credentials.get("apiKey") or "").strip()
        self.is_integration_key = self.secret.startswith("ak_")
        self.capabilities = self.KEY_ONLY if self.is_integration_key else self.FULL

    def auth_headers(self):
        if self.is_integration_key:
            return {"X-API-KEY": self.secret}
        return {"Authorization": f"Token {self.secret}"}

    def _require(self, capability):
        if not self.supports(capability):
            raise ConnectorNotSupported("key_scope")

    # ── test / balance ────────────────────────────────────────────────────────
    def test_credentials(self):
        if not self.secret:
            raise ConnectorError("missing_credentials")
        self.balance()

    def balance(self):
        if self.is_integration_key:
            data = self._request("GET", "/stores/hooks/integrations/balance/")
            return Balance(held=to_decimal(_dict(data).get("current_balance")))
        data = _dict(self._request("GET", "/payments/balance/"))
        orders = _dict(data.get("orders"))
        counts = {k: v for k, v in orders.items() if isinstance(v, int) and not isinstance(v, bool)}
        return Balance(
            held=to_decimal(data.get("current_balance")),
            payable=to_decimal(data.get("payable_balance")),
            counts=counts,
        )

    # ── orders ────────────────────────────────────────────────────────────────
    def list_parcels(self, cursor=None):
        self._require(Capability.LIST)
        page = _page_number(cursor)
        data = _dict(self._request(
            "GET", "/orders/", params={"ordering": "-updated_at", "page": page, "page_size": PAGE_SIZE},
        ))
        rows = data.get("results") if isinstance(data.get("results"), list) else []
        items = tuple(self._snapshot(row) for row in rows if isinstance(row, dict) and row.get("id"))
        return ParcelPage(items=items, next_cursor=str(page + 1) if data.get("next") else None)

    def get_parcel(self, ref):
        self._require(Capability.GET)
        row = _dict(self._request("GET", f"/orders/{_safe_ref(ref)}/"))
        if not row.get("id"):
            raise ConnectorError("invalid_response")
        return self._snapshot(row)

    def history(self, ref):
        self._require(Capability.HISTORY)
        rows = self._request("GET", f"/orders/history-order/{_safe_ref(ref)}/")
        events = []
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, dict):
                continue
            occurred = to_datetime(row.get("created_at"))
            if occurred is None:
                continue
            status, raw = map_status(row.get("status"))
            comment = row.get("comment")
            events.append(TrackingEvent(
                status=status, raw_status=raw, occurred_at=occurred,
                note=comment[:255] if isinstance(comment, str) else "",
            ))
        events.sort(key=lambda e: e.occurred_at)  # Maystro sends newest first
        return tuple(events)

    def _snapshot(self, row):
        status, raw = map_status(row.get("status"))
        cod = to_decimal(row.get("total_price"))
        return ParcelSnapshot(
            external_id=str(row["id"]),
            tracking=str(row.get("display_id") or ""),
            status=status,
            raw_status=raw,
            status_at=to_datetime(row.get("updated_at")),
            updated_at=to_datetime(row.get("updated_at")),
            reference=str(row.get("external_id") or ""),
            recipient_name=str(row.get("customer_name") or "")[:200],
            recipient_phone=str(row.get("customer_phone") or "")[:20],
            wilaya_code=str(row.get("wilaya_id") or "")[:10],
            commune=str(row.get("commune_name") or "")[:100],
            cod_amount=cod,
            delivery_fee=to_decimal(row.get("price")),
            store_amount=to_decimal(row.get("product_price")),
            cash_status=cash_status_for(row.get("status"), cod),
            cash_raw="",
        )

    # ── payouts ───────────────────────────────────────────────────────────────
    def list_payouts(self, cursor=None):
        self._require(Capability.PAYOUTS)
        page = _page_number(cursor)
        data = _dict(self._request("GET", "/payments/", params={"page": page, "page_size": PAGE_SIZE}))
        rows = data.get("results") if isinstance(data.get("results"), list) else []
        payouts = tuple(
            Payout(
                external_id=str(row["id"]),
                paid_on=to_date(row.get("payment_date")),
                amount=to_decimal(row.get("amount")),
                order_count=row.get("nb_orders") if isinstance(row.get("nb_orders"), int) else None,
            )
            for row in rows if isinstance(row, dict) and row.get("id")
        )
        return payouts, (str(page + 1) if data.get("next") else None)

    def payout_lines(self, payout_id):
        self._require(Capability.PAYOUTS)
        return _statement_lines(self._request("GET", f"/payments/{_safe_ref(payout_id)}/statement/"))

    def pending_payout_lines(self):
        self._require(Capability.PAYOUTS)
        return _statement_lines(self._request("GET", "/payments/statement/"))


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
    """Order and payment ids go into the URL path: allow only id-like characters."""
    ref = str(ref or "").strip()
    if not ref or len(ref) > 64 or not all(c.isalnum() or c in "-_" for c in ref):
        raise ConnectorError("invalid_reference")
    return ref


def _statement_lines(data):
    """Delivered orders and exchanges of a statement → PayoutLine tuple (extra services excluded)."""
    data = _dict(data)
    lines = []
    for key, has_fee in (("delivered_orders", True), ("exchanges", False)):
        for row in data.get(key) if isinstance(data.get(key), list) else []:
            if not isinstance(row, dict) or not row.get("display_id_order"):
                continue
            lines.append(PayoutLine(
                tracking=str(row["display_id_order"]),
                amount=to_decimal(row.get("amount")),
                delivery_fee=to_decimal(row.get("delivery_price")) if has_fee else None,
            ))
    return tuple(lines)
