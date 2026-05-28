"""
License validation on application startup (self-hosted mode only).

Called from LicensingConfig.ready().  We only check the locally cached state
here — no network call — so the server boots fast even without internet.
The Celery Beat heartbeat task keeps the cache fresh.
"""
import logging

from django.conf import settings

logger = logging.getLogger(__name__)

_WARNING_BANNER = """
╔══════════════════════════════════════════════════════════════════╗
║             ⚠  ShoeDZ LICENSE WARNING  ⚠                        ║
║                                                                  ║
║  %s
║                                                                  ║
║  Run: python manage.py activate_license <YOUR-LICENSE-KEY>       ║
╚══════════════════════════════════════════════════════════════════╝
"""


def check_license_on_startup() -> None:
    """Check cached license state.  Warn but never block startup."""
    try:
        from .models import LicenseState

        state = LicenseState.get()

        if not state.license_key:
            msg = "No license key configured.                    "
            logger.warning(_WARNING_BANNER, msg)
            return

        if not state.is_currently_valid():
            if state.is_within_grace():
                from django.utils import timezone

                remaining = state.grace_until - timezone.now()
                days = remaining.days
                msg = f"Running in offline grace mode ({days}d remaining).  "
                logger.warning(_WARNING_BANNER, msg)
            else:
                msg = "License is INVALID or EXPIRED.                   "
                logger.error(_WARNING_BANNER, msg)
        else:
            logger.info(
                "License OK — plan=%s key=%s",
                state.plan,
                state.license_key[:12] + "...",
            )

    except Exception as exc:
        # Never block startup — just warn
        logger.warning("License startup check failed: %s", exc)
