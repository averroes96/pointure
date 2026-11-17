"""
Courier read connectors (docs/plans/delivery-v1-plan.md P1.5).

Import connector modules here so their @register runs when this package is used.
"""
from .base import (  # noqa: F401
    Balance,
    Capability,
    ConnectorAuthError,
    ConnectorError,
    ConnectorForbidden,
    ConnectorNotFound,
    ConnectorNotSupported,
    ConnectorRateLimited,
    ConnectorUnavailable,
    CourierReadConnector,
    ParcelPage,
    ParcelSnapshot,
    Payout,
    PayoutLine,
    TrackingEvent,
)
from .registry import get_connector, register  # noqa: F401
from .vocabulary import TERMINAL_STATUSES, CashStatus, ShipmentStatus  # noqa: F401

# Connector modules: importing them runs their @register.
from . import maystro  # noqa: F401,E402
from . import yalidine  # noqa: F401,E402
