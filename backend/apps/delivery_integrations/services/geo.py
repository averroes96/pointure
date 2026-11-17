"""
Geography for parcel creation through dzship (docs/plans/delivery-v1-plan.md P2.1):
the public commune list (snapshot), stop desks and fee quotes for a courier account.

Desks and quotes are network calls the user waits for on a form, so they are cached:
desks per courier and wilaya for a day (desk lists change a few times a year), quotes
per courier account and route for an hour (prices can be specific to the account).
"""
from datetime import timedelta

import requests
from django.core.cache import cache

from .dzship_client import DzshipClient, DzshipError
from .snapshots import SnapshotStore

DESKS_TTL = 24 * 3600
RATES_TTL = 3600
COMMUNES_TIMEOUT = 15


# ─── Public commune list ──────────────────────────────────────────────────────

def clean_commune(row):
    """dzship commune → {"wilaya_code", "name_fr", "name_ar", "ship_as"}; None when unusable."""
    if not isinstance(row, dict):
        return None
    code = row.get("wilayaCode", row.get("wilaya_code"))
    name_fr = row.get("nameFr", row.get("name_fr"))
    name_ar = row.get("nameAr", row.get("name_ar")) or ""
    ship_as = row.get("shipAs", row.get("ship_as"))
    if isinstance(code, bool) or not isinstance(code, int) or not 1 <= code <= 69:
        return None
    if not isinstance(name_fr, str) or not name_fr.strip() or len(name_fr) > 100:
        return None
    if not isinstance(name_ar, str) or len(name_ar) > 100:
        return None
    if ship_as is not None and (isinstance(ship_as, bool) or not isinstance(ship_as, int) or not 1 <= ship_as <= 58):
        return None
    return {"wilaya_code": code, "name_fr": name_fr.strip(), "name_ar": name_ar.strip(), "ship_as": ship_as}


def _fetch_communes():
    response = requests.get(f"{DzshipClient.BASE_URL}/communes", headers={"Accept": "application/json"},
                            timeout=COMMUNES_TIMEOUT)
    response.raise_for_status()
    rows = response.json()
    if not isinstance(rows, list):
        return []
    seen, out = set(), []
    for row in rows:
        commune = clean_commune(row)
        if commune and (commune["wilaya_code"], commune["name_fr"]) not in seen:
            seen.add((commune["wilaya_code"], commune["name_fr"]))
            out.append(commune)
    return out


communes_store = SnapshotStore("dzship_communes.json", timedelta(days=7), _fetch_communes, clean_commune)


def get_communes(wilaya_code=None):
    """Courier spellings of communes (all, or one wilaya). Answers at once from the snapshot."""
    result = communes_store.get()
    if wilaya_code is not None:
        result["rows"] = [c for c in result["rows"] if c["wilaya_code"] == int(wilaya_code)]
    return result


# ─── Desks and quotes for a courier account ───────────────────────────────────

def origin_wilaya(config):
    """The store's wilaya as the parcel origin (1–58; a 2025 wilaya ships as its parent), or None."""
    from .communes import ship_wilaya    # communes imports this module

    code = (getattr(config.tenant, "wilaya", "") or "").strip()
    try:
        return ship_wilaya(code)
    except ValueError:
        return None


def desks_for(config, wilaya_code):
    """Stop desks of the account's courier in one wilaya (cached a day). Raises DzshipError/ValueError."""
    key = f"deliv:desks:{config.courier}:{config.base_url}:{int(wilaya_code)}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    desks = DzshipClient.desks(config.courier, config.credentials, wilaya_code, base_url=config.base_url)
    cache.set(key, desks, DESKS_TTL)
    return desks


def quote_for(config, *, to_wilaya, delivery_type, to_commune="", cod_amount=None):
    """Fee quote for one route with the account's own prices (cached an hour). Raises DzshipError/ValueError."""
    from_wilaya = origin_wilaya(config)
    key = ":".join(str(p) for p in (
        "deliv:rates", config.pk, from_wilaya or "", int(to_wilaya), delivery_type, to_commune or "",
        int(cod_amount) if cod_amount is not None else "",
    ))
    cached = cache.get(key)
    if cached is not None:
        return cached
    quote = DzshipClient.rates(
        config.courier, config.credentials, to_wilaya=to_wilaya, delivery_type=delivery_type,
        to_commune=to_commune, from_wilaya=from_wilaya, cod_amount=cod_amount, base_url=config.base_url,
    )
    cache.set(key, quote, RATES_TTL)
    return quote


__all__ = ["get_communes", "communes_store", "desks_for", "quote_for", "DzshipError"]
