"""
Connector registry: courier platform (from the dzship catalogue) → read connector class.
One connector serves every courier of its platform; the base URL comes from the
store's config (generic Ecotrack), the connector's override, or the catalogue.
"""
from urllib.parse import urlparse

from .. import catalogue
from .base import ConnectorNotSupported, CourierReadConnector

_REGISTRY: dict = {}


def register(cls):
    """Class decorator: `@register` on a CourierReadConnector subclass with `platform` set."""
    if not (isinstance(cls, type) and issubclass(cls, CourierReadConnector) and cls.platform):
        raise TypeError("register() needs a CourierReadConnector subclass with a platform")
    _REGISTRY[cls.platform] = cls
    return cls


def connector_class_for(platform):
    return _REGISTRY.get(platform)


def get_connector(provider_config) -> CourierReadConnector:
    """
    Build the read connector for one of the store's courier accounts.

    Raises ConnectorNotSupported with reason:
      - "unknown_courier": the courier is not in the saved catalogue (not loaded yet, or removed);
      - "no_connector": Pointure has no read connector for this courier's platform yet;
      - "no_base_url": no usable https address for the courier's API.
    """
    entry = catalogue.get_courier(provider_config.courier)
    if entry is None:
        raise ConnectorNotSupported("unknown_courier")
    cls = connector_class_for(entry["platform"])
    if cls is None:
        raise ConnectorNotSupported("no_connector")

    base_url = provider_config.base_url or cls.BASE_URL_OVERRIDE or entry["endpoint"] or ""
    if urlparse(base_url).scheme != "https" or not urlparse(base_url).hostname:
        raise ConnectorNotSupported("no_base_url")
    return cls(provider_config.courier, provider_config.credentials or {}, base_url)
