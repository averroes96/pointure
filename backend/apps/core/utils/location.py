"""
Location data helpers: wilayas & communes loader.
Ensures Algerian wilayas and communes are loaded into the database,
especially for Windows Desktop / SQLite standalone distribution.
"""
import json
import logging
import os
from django.conf import settings
from apps.core.models import Commune, Wilaya, WILAYA_CHOICES

logger = logging.getLogger(__name__)


def find_fixtures_dir():
    """Locate the fixtures directory across different deployment layouts."""
    possible_paths = [
        # Standard relative to core app
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "fixtures")),
        # Standard relative to settings.BASE_DIR
        os.path.join(str(settings.BASE_DIR), "apps", "core", "fixtures") if hasattr(settings, "BASE_DIR") else "",
        # Nested repo structure
        os.path.join(str(settings.BASE_DIR), "backend", "apps", "core", "fixtures") if hasattr(settings, "BASE_DIR") else "",
    ]

    for p in possible_paths:
        if p and os.path.isdir(p) and os.path.exists(os.path.join(p, "wilayas.json")):
            return p
    return None


def ensure_wilayas_loaded():
    """
    Ensure all Algerian wilayas (and communes if available) exist in the database.
    If the Wilaya table is empty, loads from JSON fixtures, or falls back to WILAYA_CHOICES.
    """
    try:
        if Wilaya.objects.exists():
            return

        logger.info("[Location] Wilayas table is empty. Loading Algerian location data...")
        fixtures_dir = find_fixtures_dir()

        if fixtures_dir:
            wilayas_path = os.path.join(fixtures_dir, "wilayas.json")
            communes_path = os.path.join(fixtures_dir, "communes.json")

            if os.path.exists(wilayas_path):
                with open(wilayas_path, "r", encoding="utf-8-sig") as f:
                    wilayas_data = json.load(f)
                    wilaya_objs = []
                    for item in wilayas_data:
                        code = str(item.get("id")).zfill(2)
                        wilaya_objs.append(
                            Wilaya(
                                id=int(item.get("id")),
                                code=code,
                                name=item.get("name", ""),
                                ar_name=item.get("ar_name", ""),
                            )
                        )
                    Wilaya.objects.bulk_create(wilaya_objs, ignore_conflicts=True)
                    logger.info("[Location] Loaded %d wilayas from fixture.", len(wilaya_objs))

            if os.path.exists(communes_path):
                with open(communes_path, "r", encoding="utf-8-sig") as f:
                    communes_data = json.load(f)
                    commune_objs = []
                    for item in communes_data:
                        commune_objs.append(
                            Commune(
                                id=int(item.get("id")),
                                wilaya_id=int(item.get("wilaya_id")),
                                post_code=item.get("post_code", "") or "",
                                name=item.get("name", ""),
                                ar_name=item.get("ar_name", ""),
                            )
                        )
                    Commune.objects.bulk_create(commune_objs, ignore_conflicts=True)
                    logger.info("[Location] Loaded %d communes from fixture.", len(commune_objs))
        else:
            # Fallback to hardcoded WILAYA_CHOICES (guarantees at least 58 wilayas)
            logger.warning("[Location] Fixtures not found. Seeding from WILAYA_CHOICES fallback...")
            wilaya_objs = [
                Wilaya(id=int(code), code=code, name=name, ar_name="")
                for code, name in WILAYA_CHOICES
            ]
            Wilaya.objects.bulk_create(wilaya_objs, ignore_conflicts=True)
            logger.info("[Location] Seeded %d wilayas from fallback.", len(wilaya_objs))

    except Exception as e:
        logger.exception("[Location] Failed to ensure wilayas loaded: %s", e)

