"""
Celery tasks for license management (self-hosted mode only).

The heartbeat task is scheduled via Celery Beat every 30 minutes.
It is a no-op in cloud mode (DEPLOYMENT_MODE != "local").
"""
import logging

from celery import shared_task
from django.conf import settings
from django.utils import timezone
from datetime import timedelta

logger = logging.getLogger(__name__)


@shared_task(
    name="licensing.heartbeat",
    bind=True,
    max_retries=0,
    ignore_result=True,
    soft_time_limit=30,
)
def license_heartbeat(self):
    """
    Send a heartbeat to the license server and update the local cache.

    - On success: refresh last_check, extend grace_until
    - On network error: keep existing cache (grace period covers outages)
    - On `not_activated` error: re-activate automatically
    """
    if getattr(settings, "DEPLOYMENT_MODE", "cloud") != "local":
        return

    from . import client
    from .models import LicenseState

    state = LicenseState.get()

    if not state.license_key:
        logger.debug("No license key — skipping heartbeat")
        return

    grace_days = getattr(settings, "LICENSE_GRACE_DAYS", 7)

    result = client.heartbeat(state.license_key)

    if result.get("error") == "not_activated":
        # Machine was deregistered — re-activate
        logger.info("Machine not registered at license server, re-activating…")
        result = client.activate(state.license_key)

    if result.get("error") == "network_error":
        # Could not reach the server — enter / extend grace period
        if state.valid:
            grace_until = timezone.now() + timedelta(days=grace_days)
            state.grace_until = grace_until
            state.save(update_fields=["grace_until"])
            logger.warning(
                "License server unreachable — grace period until %s",
                grace_until.isoformat(),
            )
        else:
            logger.warning("License server unreachable and license is not valid")
        return

    # Server responded — update cache
    state.valid = bool(result.get("valid"))
    state.plan = result.get("plan", state.plan)
    state.client_name = result.get("client_name", state.client_name)

    expires_raw = result.get("expires_at")
    if expires_raw:
        from django.utils.dateparse import parse_datetime

        state.expires_at = parse_datetime(expires_raw)

    if state.valid:
        state.last_check = timezone.now()
        state.grace_until = timezone.now() + timedelta(days=grace_days)
    else:
        error = result.get("error", "unknown")
        logger.error("License invalid: %s", error)

    state.save()
