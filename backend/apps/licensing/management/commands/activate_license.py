"""
Management command: activate_license

Usage:
    python manage.py activate_license SHDZ-XXXX-XXXX-XXXX

Calls the license server, stores the result in the local LicenseState cache,
and prints a summary.  Run this once after initial installation or after
purchasing a new license key.
"""
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from datetime import timedelta

from apps.licensing import client
from apps.licensing.machine_id import get_machine_id
from apps.licensing.models import LicenseState
from django.conf import settings


class Command(BaseCommand):
    help = "Activate a ShoeDZ license key on this machine."

    def add_arguments(self, parser):
        parser.add_argument(
            "license_key",
            type=str,
            help='License key in SHDZ-XXXX-XXXX-XXXX format.',
        )

    def handle(self, *args, **options):
        key = options["license_key"].strip().upper()

        self.stdout.write(f"Machine ID : {get_machine_id()}")
        self.stdout.write(f"License key: {key}")
        self.stdout.write("Contacting license server…")

        result = client.activate(key)

        if result.get("error") == "network_error":
            raise CommandError(
                "Could not reach the license server. "
                "Check your internet connection and try again."
            )

        if not result.get("valid"):
            error = result.get("error", "unknown")
            messages = {
                "invalid_key": "The license key is not recognised.",
                "suspended": "This license has been suspended. Contact support.",
                "expired": "This license has expired. Please renew.",
                "machine_limit_exceeded": (
                    "Maximum number of machines reached for this license. "
                    "Deactivate another machine or upgrade your plan."
                ),
            }
            raise CommandError(messages.get(error, f"Activation failed: {error}"))

        # Persist to local cache
        grace_days = getattr(settings, "LICENSE_GRACE_DAYS", 7)
        state = LicenseState.get()
        state.license_key = key
        state.machine_id = get_machine_id()
        state.plan = result.get("plan", "")
        state.client_name = result.get("client_name", "")
        state.valid = True
        state.last_check = timezone.now()
        state.grace_until = timezone.now() + timedelta(days=grace_days)

        expires_raw = result.get("expires_at")
        if expires_raw:
            from django.utils.dateparse import parse_datetime
            state.expires_at = parse_datetime(expires_raw)

        state.save()

        self.stdout.write(self.style.SUCCESS("✓ License activated successfully!"))
        self.stdout.write(f"  Client : {state.client_name}")
        self.stdout.write(f"  Plan   : {state.plan}")
        expires_label = state.expires_at.strftime("%Y-%m-%d") if state.expires_at else "perpetual"
        self.stdout.write(f"  Expires: {expires_label}")
