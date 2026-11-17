"""
Read-connector contract (docs/plans/delivery-v1-plan.md §1, P1.5).

A read connector talks to ONE courier platform's own API with the store's saved
credentials, and returns courier-neutral data (ParcelSnapshot, Payout, Balance).
Writes that involve geography (create, desks, fees) go through dzship instead.

Rules every connector follows (AGENTS.md §3, §4.7, §4.11):
- every HTTP call has an explicit timeout and goes through `_request`;
- connectors are never called inside transaction.atomic();
- logs never contain credentials or customer data (names, phones, addresses);
- an operation the courier does not offer raises ConnectorNotSupported.
"""
import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Optional
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import requests
from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from .vocabulary import CashStatus, ShipmentStatus

logger = logging.getLogger(__name__)


# ─── Errors ───────────────────────────────────────────────────────────────────

class ConnectorError(Exception):
    """The courier answered, but not with something usable."""

    code = "connector_error"

    def __init__(self, message="", status_code=None):
        super().__init__(message or self.code)
        self.status_code = status_code


class ConnectorAuthError(ConnectorError):
    """The credentials were refused (HTTP 401)."""
    code = "auth_refused"


class ConnectorForbidden(ConnectorError):
    """The credentials are valid but may not use this endpoint (HTTP 403)."""
    code = "forbidden"


class ConnectorNotFound(ConnectorError):
    code = "not_found"


class ConnectorRateLimited(ConnectorError):
    code = "rate_limited"

    def __init__(self, retry_after=60, status_code=429):
        super().__init__(self.code, status_code)
        self.retry_after = retry_after


class ConnectorUnavailable(ConnectorError):
    """No usable answer: timeout, network error or server error. Retry later."""
    code = "unavailable"


class ConnectorNotSupported(ConnectorError):
    """This courier (or its connector) does not offer the operation."""
    code = "not_supported"

    def __init__(self, reason="not_supported"):
        super().__init__(reason)
        self.reason = reason


# ─── Data shapes ──────────────────────────────────────────────────────────────

class Capability:
    TEST = "test"
    LIST = "list"
    GET = "get"
    HISTORY = "history"
    BALANCE = "balance"
    PAYOUTS = "payouts"


@dataclass(frozen=True)
class TrackingEvent:
    status: str            # ShipmentStatus value
    raw_status: str
    occurred_at: datetime
    note: str = ""


@dataclass(frozen=True)
class ParcelSnapshot:
    external_id: str                      # the courier's own id for the parcel
    tracking: str
    status: str = ShipmentStatus.UNKNOWN
    raw_status: str = ""
    status_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None  # courier's last-change time (sync cursor)
    reference: str = ""                   # our order id, when the parcel was created with one
    recipient_name: str = ""
    recipient_phone: str = ""
    wilaya_code: str = ""
    commune: str = ""
    cod_amount: Optional[Decimal] = None   # what the customer pays at the door
    delivery_fee: Optional[Decimal] = None
    store_amount: Optional[Decimal] = None # what the courier owes the store for this parcel
    cash_status: str = CashStatus.AWAITING_DELIVERY
    cash_raw: str = ""
    events: tuple = ()                    # tuple[TrackingEvent, ...], oldest first


@dataclass(frozen=True)
class ParcelPage:
    items: tuple                          # tuple[ParcelSnapshot, ...]
    next_cursor: Optional[str] = None     # None on the last page


@dataclass(frozen=True)
class PayoutLine:
    tracking: str
    amount: Optional[Decimal] = None       # paid to the store for this parcel
    delivery_fee: Optional[Decimal] = None


@dataclass(frozen=True)
class Payout:
    external_id: str
    paid_on: Optional[date] = None
    amount: Optional[Decimal] = None
    order_count: Optional[int] = None
    lines: tuple = ()                     # tuple[PayoutLine, ...]; empty until fetched


@dataclass(frozen=True)
class Balance:
    held: Optional[Decimal] = None         # money the courier holds for the store
    payable: Optional[Decimal] = None      # part of it ready to be paid
    counts: dict = field(default_factory=dict)  # e.g. {"awaiting_collection": 3}


# ─── Parsing helpers (shared by connectors) ───────────────────────────────────

CENT = Decimal("0.01")


def to_decimal(value) -> Optional[Decimal]:
    """Courier amount → Decimal DZD with 2 places, or None when missing or invalid."""
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        return Decimal(str(value)).quantize(CENT)
    except (InvalidOperation, ValueError):
        return None


def to_datetime(value) -> Optional[datetime]:
    """ISO date-time → aware datetime. A naive value is read as store time (Africa/Algiers)."""
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = parse_datetime(value.strip().replace(" ", "T", 1))
    except ValueError:
        return None
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        parsed = parsed.replace(tzinfo=ZoneInfo(settings.TIME_ZONE))
    return parsed


def to_date(value) -> Optional[date]:
    if not value or not isinstance(value, str):
        return None
    try:
        return parse_date(value.strip()[:10])
    except ValueError:
        return None


# ─── Base connector ───────────────────────────────────────────────────────────

class CourierReadConnector:
    """
    Base class for read connectors. Subclasses set `platform`, `capabilities`,
    implement `auth_headers()` and the operations they support.

    `BASE_URL_OVERRIDE` replaces the catalogue endpoint when the courier's read API
    lives elsewhere (e.g. Maystro's newer backend, P1.6).
    """

    platform: str = ""
    capabilities: frozenset = frozenset()
    BASE_URL_OVERRIDE: str = ""
    TIMEOUT_SECONDS = 20
    # False while the connector is built from documentation only, before a probe on a
    # real merchant account confirmed the field meanings (shown on "Test connection").
    verified: bool = True

    def __init__(self, courier_key: str, credentials: dict, base_url: str):
        self.courier_key = courier_key
        self.credentials = dict(credentials or {})
        self.base_url = base_url.rstrip("/")

    # ── to implement ──────────────────────────────────────────────────────────
    def auth_headers(self) -> dict:
        raise NotImplementedError

    def test_credentials(self) -> None:
        """Return None when the credentials work; raise a ConnectorError otherwise."""
        raise ConnectorNotSupported()

    def list_parcels(self, cursor: Optional[str] = None) -> ParcelPage:
        """Newest changes first. `cursor` is the value from the previous page."""
        raise ConnectorNotSupported()

    def get_parcel(self, ref: str) -> ParcelSnapshot:
        raise ConnectorNotSupported()

    def history(self, ref: str) -> tuple:
        """tuple[TrackingEvent, ...], oldest first."""
        raise ConnectorNotSupported()

    def balance(self) -> Balance:
        raise ConnectorNotSupported()

    def list_payouts(self, cursor: Optional[str] = None) -> tuple:
        """(tuple[Payout, ...] without lines, next_cursor or None)."""
        raise ConnectorNotSupported()

    def payout_lines(self, payout_id: str) -> tuple:
        """tuple[PayoutLine, ...] for one payout."""
        raise ConnectorNotSupported()

    def pending_payout_lines(self) -> tuple:
        """tuple[PayoutLine, ...] of the payout the courier is preparing (the "ready" stage)."""
        raise ConnectorNotSupported()

    # ── hooks (e.g. a courier's own quota rules) ──────────────────────────────
    def _before_request(self) -> None:
        """Called before every HTTP call; may raise ConnectorRateLimited."""

    def _after_response(self, response) -> None:
        """Called with every HTTP response (any status), before errors are mapped."""

    # ── shared ────────────────────────────────────────────────────────────────
    def supports(self, capability: str) -> bool:
        return capability in self.capabilities

    def _url(self, path: str) -> str:
        if "://" in path:
            # An absolute "next page" link returned by the courier. Follow it only on the
            # courier's own host: the store's credentials go with every request.
            if urlparse(path).hostname != urlparse(self.base_url).hostname:
                raise ConnectorError("foreign_url")
            return path
        return f"{self.base_url}/{path.lstrip('/')}"

    def _request(self, method: str, path: str, params=None):
        """
        One HTTP call with timeout and error mapping. Returns parsed JSON.
        Never logs credentials, query values or response bodies.
        """
        url = self._url(path)
        if urlparse(url).scheme != "https":
            raise ConnectorError("insecure_url")
        self._before_request()
        try:
            response = requests.request(
                method,
                url,
                params=params,
                headers={"Accept": "application/json", **self.auth_headers()},
                timeout=self.TIMEOUT_SECONDS,
            )
        except requests.Timeout:
            logger.warning("Courier %s: timeout on %s %s", self.courier_key, method, urlparse(url).path)
            raise ConnectorUnavailable("timeout")
        except requests.RequestException:
            logger.warning("Courier %s: network error on %s %s", self.courier_key, method, urlparse(url).path)
            raise ConnectorUnavailable("network_error")

        self._after_response(response)
        status = response.status_code
        if status >= 400:
            logger.warning("Courier %s: HTTP %s on %s %s", self.courier_key, status, method, urlparse(url).path)
        if status == 401:
            raise ConnectorAuthError(status_code=status)
        if status == 403:
            raise ConnectorForbidden(status_code=status)
        if status == 404:
            raise ConnectorNotFound(status_code=status)
        if status == 429:
            raise ConnectorRateLimited(retry_after=_retry_after(response.headers.get("Retry-After")))
        if status >= 500:
            raise ConnectorUnavailable("server_error", status_code=status)
        if status >= 400:
            raise ConnectorError("http_error", status_code=status)
        try:
            return response.json()
        except ValueError:
            raise ConnectorError("invalid_response", status_code=status)


def _retry_after(value, default=60, ceiling=3600) -> int:
    try:
        seconds = int(str(value).strip())
    except (TypeError, ValueError):
        return default
    return max(1, min(seconds, ceiling))
