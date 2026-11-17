"""
Pointure communes → the courier spelling dzship expects (docs/plans/delivery-v1-plan.md P2.2).

Couriers work with the 58 historical wilayas; Pointure has 69 (the 2025 split, codes
59–69). A commune is matched inside its shipping wilaya by a normalised French name
(case, accents, punctuation, "El/Al"-style articles, doubled letters), then by a
normalised Arabic name. Nothing is guessed: a name that matches nothing, or that
matches two different courier communes, stays unmatched and is listed for the owner;
the form then lets the user pick the courier spelling.

Measured on 2026-11-17 against dzship's list (1,541 communes): 1,531 of Pointure's
1,609 distinct communes match; the rest are missing from dzship's list or filed
under another wilaya in Pointure's fixture.
"""
import re
import unicodedata

from . import geo

# New wilaya (2025) → the historical wilaya couriers still ship it under.
PARENT_WILAYA = {
    59: 3,    # Aflou ← Laghouat
    60: 5,    # Barika ← Batna
    61: 7,    # El Kantara ← Biskra
    62: 12,   # Bir El Ater ← Tébessa
    63: 13,   # El Aricha ← Tlemcen
    64: 14,   # Ksar Chellala ← Tiaret
    65: 17,   # Aïn Oussera ← Djelfa
    66: 17,   # Messaad ← Djelfa
    67: 26,   # Ksar El Boukhari ← Médéa
    68: 28,   # Bou Saâda ← M'Sila
    69: 32,   # El Abiodh Sidi Cheikh ← El Bayadh
}

_ARTICLES = frozenset({"el", "al", "e", "l", "d", "ed", "es", "et", "ez", "er", "en"})
_ARABIC_LETTERS = str.maketrans({
    "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ة": "ه", "ھ": "ه",
    "ڨ": "ق", "ڤ": "ف", "ؤ": "و", "ئ": "ي", "ٔ": None, "ـ": None,
})


def ship_wilaya(code):
    """The 1–58 wilaya a courier ships a Pointure wilaya (1–69) under. ValueError otherwise."""
    try:
        code = int(code)
    except (TypeError, ValueError):
        raise ValueError("wilaya code must be a number")
    if not 1 <= code <= 69:
        raise ValueError("wilaya code must be between 1 and 69")
    return PARENT_WILAYA.get(code, code)


def normalise_fr(name):
    """'Bab-Ezzouar', "Ain El Turk", 'Aïn Turk' → comparable keys ('babezouar', 'ainturk')."""
    text = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    words = re.sub(r"[^a-z0-9]+", " ", text).split()
    key = "".join(w for w in words if w not in _ARTICLES)
    return re.sub(r"(.)\1+", r"\1", key)


def normalise_ar(name):
    """Arabic key: presentation forms, diacritics, tatweel and letter variants folded."""
    text = unicodedata.normalize("NFKC", name or "")
    text = re.sub(r"[ً-ْٰ]", "", text).translate(_ARABIC_LETTERS)
    return re.sub(r"[^ء-ي]", "", text)


class CourierCommuneIndex:
    """Courier communes by wilaya with normalised keys; keys shared by two communes are dropped."""

    def __init__(self, rows):
        self.by_wilaya = {}
        fr, ar = {}, {}
        for row in rows:
            code = row["wilaya_code"]
            self.by_wilaya.setdefault(code, []).append(row)
            for keys, key in ((fr, normalise_fr(row["name_fr"])), (ar, normalise_ar(row["name_ar"]))):
                if not key:
                    continue
                slot = (code, key)
                if slot in keys and keys[slot] is not row:
                    keys[slot] = None          # ambiguous: never matched on this key
                else:
                    keys[slot] = row
        self._fr, self._ar = fr, ar

    def communes(self, wilaya_code):
        return sorted(self.by_wilaya.get(ship_wilaya(wilaya_code), []), key=lambda r: r["name_fr"])

    def match(self, wilaya_code, name_fr, name_ar=""):
        """The courier commune for one name, or None (no match, ambiguous, or FR and AR disagree)."""
        code = ship_wilaya(wilaya_code)
        by_fr = self._fr.get((code, normalise_fr(name_fr))) if normalise_fr(name_fr) else None
        by_ar = self._ar.get((code, normalise_ar(name_ar))) if normalise_ar(name_ar) else None
        if by_fr and by_ar and by_fr is not by_ar:
            return None
        return by_fr or by_ar


_index_cache = {"fetched_at": None, "index": None}


def load_index():
    """(index, snapshot meta) from the saved dzship list; the index is rebuilt only when the file changes."""
    snapshot = geo.get_communes()
    meta = {k: snapshot[k] for k in ("fetched_at", "stale", "refreshing")}
    if snapshot["fetched_at"] is None or _index_cache["fetched_at"] != snapshot["fetched_at"]:
        _index_cache.update(fetched_at=snapshot["fetched_at"], index=CourierCommuneIndex(snapshot["rows"]))
    return _index_cache["index"], meta


def courier_name(row):
    return {"name_fr": row["name_fr"], "name_ar": row["name_ar"]} if row else None
