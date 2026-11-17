"""
dzship (DZBuild's free gateway, https://freeship.dzbuild.com) for the writes that
involve geography: creating parcels, stop desks, fee quotes
(docs/plans/delivery-v1-plan.md §1, P2.1).

Every call: explicit timeout, typed DzshipError, never called inside a transaction,
and logs carry only the courier and error codes (bodies may echo customer data).
"""
import logging
from decimal import Decimal, InvalidOperation

import requests

logger = logging.getLogger(__name__)


class DzshipError(Exception):
    """
    The dzship gateway or the courier did not answer usefully.

    `code` is dzship's error code when it sent one (e.g. "VALIDATION_ERROR",
    "COURIER_ERROR", "NOT_SUPPORTED", "rate_limited"), or "TIMEOUT" / "NETWORK_ERROR" /
    "INVALID_RESPONSE" when no usable answer came back. For TIMEOUT and NETWORK_ERROR
    on a create, the parcel may or may not exist on the courier side.
    """

    UNCERTAIN_CODES = frozenset({"TIMEOUT", "NETWORK_ERROR"})

    def __init__(self, code, status_code=None):
        super().__init__(code)
        self.code = code
        self.status_code = status_code

    @property
    def outcome_uncertain(self):
        return self.code in self.UNCERTAIN_CODES

    @property
    def not_supported(self):
        return self.code == "NOT_SUPPORTED" or self.status_code == 422


DELIVERY_TYPES = ("home", "stopdesk")


class DzshipClient:
    BASE_URL = "https://freeship.dzbuild.com/v1"
    # Courier creation can be slow; dzship itself allows the courier up to 30 s.
    TIMEOUT_SECONDS = 30
    # Reads the user waits for on a form.
    READ_TIMEOUT_SECONDS = 15

    # ── shared ────────────────────────────────────────────────────────────────
    @classmethod
    def _post(cls, path, payload, *, op, courier, timeout):
        try:
            response = requests.post(
                f"{cls.BASE_URL}/{path}",
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=timeout,
            )
            response.raise_for_status()
        except requests.Timeout:
            logger.warning("dzship %s timed out (courier=%s)", op, courier)
            raise DzshipError("TIMEOUT")
        except requests.HTTPError as e:
            status_code = getattr(e.response, "status_code", None)
            code = cls._error_code(e.response)
            logger.warning("dzship %s refused (courier=%s, http=%s, code=%s)", op, courier, status_code, code)
            raise DzshipError(code, status_code)
        except requests.RequestException:
            logger.warning("dzship %s network error (courier=%s)", op, courier, exc_info=True)
            raise DzshipError("NETWORK_ERROR")
        try:
            return response.json()
        except ValueError:
            logger.warning("dzship %s returned a non-JSON body (courier=%s)", op, courier)
            raise DzshipError("INVALID_RESPONSE", getattr(response, "status_code", None))

    @staticmethod
    def _base_payload(courier, credentials, base_url="", from_wilaya=None):
        payload = {"courier": courier}
        if credentials:                    # the sandbox courier takes none
            payload["credentials"] = dict(credentials)
        options = {}
        if base_url:
            options["baseUrl"] = base_url
        if from_wilaya:
            options["fromWilaya"] = int(from_wilaya)
        if options:
            payload["options"] = options
        return payload

    @staticmethod
    def _error_code(response):
        """Read dzship's error envelope {"error": {"code": ...}} without trusting its shape."""
        try:
            error = (response.json() or {}).get("error") or {}
            code = error.get("code")
            return str(code) if code else "HTTP_ERROR"
        except (ValueError, AttributeError):
            return "HTTP_ERROR"

    # ── create ────────────────────────────────────────────────────────────────
    @classmethod
    def create_order(cls, courier, credentials, order_data, base_url="", from_wilaya=None):
        """
        Create a parcel on the store's courier account.

        :param courier: a dzship catalogue key ('maystro', 'yalidine', 'dhd', ...).
        :param credentials: the ProviderConfig credentials, already named as the catalogue's
            `requiredCredentials` (e.g. {"apiKey": ...}); sent unchanged.
        :param order_data: dict with recipient details, product list and an optional `reference`.
        :param base_url: only for the generic 'ecotrack' key (options.baseUrl).
        :param from_wilaya: origin wilaya code (required by the Yalidine family).
        :return: dict with trackingNumber and status
        :raises DzshipError: when no parcel was confirmed.
        """
        payload = cls._base_payload(courier, credentials, base_url, from_wilaya)
        payload.setdefault("credentials", dict(credentials or {}))
        payload["order"] = order_data
        return cls._post("orders", payload, op="create_order", courier=courier, timeout=cls.TIMEOUT_SECONDS)

    # ── stop desks ────────────────────────────────────────────────────────────
    @classmethod
    def desks(cls, courier, credentials, wilaya_code, base_url=""):
        """
        Stop desks the courier runs in one wilaya, normalised to
        [{"id", "name", "wilaya_code", "commune_name", "address"}]. Malformed rows are skipped.
        Raises DzshipError (`not_supported` when the courier has no desk list).
        """
        code = _wilaya(wilaya_code)
        payload = cls._base_payload(courier, credentials, base_url)
        payload["wilayaCode"] = code
        rows = cls._post("desks", payload, op="desks", courier=courier, timeout=cls.READ_TIMEOUT_SECONDS)
        desks = []
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, dict):
                continue
            desk_id, name = row.get("id"), row.get("name")
            if desk_id in (None, "") or not isinstance(name, str) or not name.strip():
                continue
            desks.append({
                "id": str(desk_id)[:64],
                "name": name.strip()[:200],
                "wilaya_code": row.get("wilayaCode") if isinstance(row.get("wilayaCode"), int) else code,
                "commune_name": str(row.get("communeName") or "")[:100],
                "address": str(row.get("address") or "")[:255],
            })
        return desks

    # ── fee quote ─────────────────────────────────────────────────────────────
    @classmethod
    def rates(cls, courier, credentials, *, to_wilaya, delivery_type, to_commune="", from_wilaya=None,
              cod_amount=None, base_url=""):
        """
        Delivery and return fees for one route, normalised to
        {"delivery_fee", "return_fee", "cod_fee", "total"} (Decimal or None), "currency",
        "delivery_type", "estimated_days". Raises DzshipError.
        """
        if delivery_type not in DELIVERY_TYPES:
            raise ValueError("delivery_type must be 'home' or 'stopdesk'")
        query = {"toWilaya": _wilaya(to_wilaya), "deliveryType": delivery_type}
        if to_commune:
            query["toCommune"] = str(to_commune)[:100]
        if from_wilaya:
            query["fromWilaya"] = _wilaya(from_wilaya)
        if cod_amount is not None:
            query["codAmount"] = int(Decimal(cod_amount))
        payload = cls._base_payload(courier, credentials, base_url, from_wilaya)
        payload["query"] = query
        data = cls._post("rates", payload, op="rates", courier=courier, timeout=cls.READ_TIMEOUT_SECONDS)
        if not isinstance(data, dict) or _money(data.get("deliveryFee")) is None:
            raise DzshipError("INVALID_RESPONSE")
        days = data.get("estimatedDays")
        return {
            "delivery_fee": _money(data.get("deliveryFee")),
            "return_fee": _money(data.get("returnFee")),
            "cod_fee": _money(data.get("codFee")),
            "total": _money(data.get("total")),
            "currency": str(data.get("currency") or "DZD")[:3],
            "delivery_type": data.get("deliveryType") if data.get("deliveryType") in DELIVERY_TYPES else delivery_type,
            "estimated_days": days if isinstance(days, (int, float)) and not isinstance(days, bool) else None,
        }


def _wilaya(value):
    """Couriers accept the 58 historical wilaya codes only (dzship docs)."""
    try:
        code = int(value)
    except (TypeError, ValueError):
        raise ValueError("wilaya code must be a number")
    if not 1 <= code <= 58:
        raise ValueError("wilaya code must be between 1 and 58")
    return code


def _money(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return None
