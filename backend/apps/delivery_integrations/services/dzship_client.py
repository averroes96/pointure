import logging

import requests

logger = logging.getLogger(__name__)


class DzshipError(Exception):
    """
    The dzship gateway or the courier did not create the parcel.

    `code` is dzship's error code when it sent one (e.g. "VALIDATION_ERROR",
    "COURIER_ERROR", "rate_limited"), or "TIMEOUT" / "NETWORK_ERROR" /
    "INVALID_RESPONSE" when no usable answer came back. For TIMEOUT and
    NETWORK_ERROR the parcel may or may not exist on the courier side.
    """

    UNCERTAIN_CODES = frozenset({"TIMEOUT", "NETWORK_ERROR"})

    def __init__(self, code, status_code=None):
        super().__init__(code)
        self.code = code
        self.status_code = status_code

    @property
    def outcome_uncertain(self):
        return self.code in self.UNCERTAIN_CODES


class DzshipClient:
    BASE_URL = "https://freeship.dzbuild.com/v1"
    # Courier creation can be slow; dzship itself allows the courier up to 30 s.
    TIMEOUT_SECONDS = 30

    @classmethod
    def create_order(cls, courier, credentials, order_data):
        """
        Calls the dzship unified API to create a delivery order.

        :param courier: 'yalidine', 'zr_express', 'maystro', etc.
        :param credentials: dict with 'apiId' and 'apiToken' (mapped below to what the courier expects)
        :param order_data: dict with recipient details, product list and an optional `reference`.
        :return: dict with trackingNumber and status
        :raises DzshipError: when no parcel was confirmed.

        Never call this inside transaction.atomic(): it is a network call.
        """
        url = f"{cls.BASE_URL}/orders"

        # Map our internal apiId/apiToken to what the specific courier expects via dzship
        mapped_credentials = {}
        if courier == "maystro":
            mapped_credentials = {"apiKey": credentials.get("apiToken")}
        elif courier == "zr_express":
            mapped_credentials = {"client": credentials.get("apiId"), "token": credentials.get("apiToken")}
        elif courier == "noest":
            mapped_credentials = {"token": credentials.get("apiToken")}
        else:
            # Default (Yalidine, etc.)
            mapped_credentials = {
                "apiId": credentials.get("apiId"),
                "apiToken": credentials.get("apiToken")
            }

        payload = {
            "courier": courier,
            "credentials": mapped_credentials,
            "order": order_data
        }

        try:
            response = requests.post(
                url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=cls.TIMEOUT_SECONDS,
            )
            response.raise_for_status()
        except requests.Timeout:
            logger.warning("dzship create_order timed out (courier=%s)", courier)
            raise DzshipError("TIMEOUT")
        except requests.HTTPError as e:
            status_code = getattr(e.response, "status_code", None)
            code = cls._error_code(e.response)
            # The body may echo customer data: log only the courier and the codes.
            logger.warning(
                "dzship create_order refused (courier=%s, http=%s, code=%s)", courier, status_code, code
            )
            raise DzshipError(code, status_code)
        except requests.RequestException:
            logger.warning("dzship create_order network error (courier=%s)", courier, exc_info=True)
            raise DzshipError("NETWORK_ERROR")

        try:
            return response.json()
        except ValueError:
            logger.warning("dzship create_order returned a non-JSON body (courier=%s)", courier)
            raise DzshipError("INVALID_RESPONSE", getattr(response, "status_code", None))

    @staticmethod
    def _error_code(response):
        """Read dzship's error envelope {"error": {"code": ...}} without trusting its shape."""
        try:
            error = (response.json() or {}).get("error") or {}
            code = error.get("code")
            return str(code) if code else "HTTP_ERROR"
        except (ValueError, AttributeError):
            return "HTTP_ERROR"
