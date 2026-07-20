import uuid
"""
Local license cache model.

Stores the last known good license state so the app can operate for up to
LICENSE_GRACE_DAYS days without reaching the license server (e.g. network
outage).
"""
from django.db import models
from django.utils import timezone


class LicenseState(models.Model):
    """Singleton-like table — only one row is ever created (id=1)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    machine_id = models.CharField(max_length=64, blank=True)
    license_key = models.CharField(max_length=64, blank=True)
    plan = models.CharField(max_length=50, blank=True)
    valid = models.BooleanField(default=False)
    expires_at = models.DateTimeField(null=True, blank=True)

    # When we last successfully reached the license server
    last_check = models.DateTimeField(null=True, blank=True)

    # Until when the app should stay running in offline grace mode
    grace_until = models.DateTimeField(null=True, blank=True)

    client_name = models.CharField(max_length=200, blank=True)

    class Meta:
        verbose_name = "License State"
        verbose_name_plural = "License State"

    def __str__(self):
        return f"License: {self.license_key or 'none'} | {self.plan or 'no plan'}"

    @classmethod
    def get(cls) -> "LicenseState":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def is_within_grace(self) -> bool:
        """True if we are in an offline grace period that has not yet expired."""
        if self.grace_until is None:
            return False
        return timezone.now() < self.grace_until

    def is_currently_valid(self) -> bool:
        """
        True if:
        - last server check said valid=True, AND
        - license hasn't expired (or is perpetual), AND
        - either last check was recent OR we are within the offline grace window.
        """
        from django.conf import settings

        grace_days = getattr(settings, "LICENSE_GRACE_DAYS", 7)

        if not self.valid:
            return self.is_within_grace()

        if self.expires_at and timezone.now() >= self.expires_at:
            return False

        if self.last_check:
            age = timezone.now() - self.last_check
            if age.days <= grace_days:
                return True

        return self.is_within_grace()
