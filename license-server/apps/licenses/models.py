import secrets

from django.db import models
from django.utils import timezone


def generate_license_key():
    """Generate a license key in SHDZ-XXXX-XXXX-XXXX format."""
    parts = [secrets.token_hex(2).upper() for _ in range(3)]
    return f"SHDZ-{parts[0]}-{parts[1]}-{parts[2]}"


class License(models.Model):
    PLAN_CHOICES = [
        ("free", "Free"),
        ("pro_retail", "Pro Retail"),
        ("pro_wholesale", "Pro Wholesale"),
        ("enterprise", "Enterprise"),
    ]
    STATUS_CHOICES = [
        ("active", "Active"),
        ("suspended", "Suspended"),
        ("expired", "Expired"),
    ]

    key = models.CharField(
        max_length=64,
        unique=True,
        default=generate_license_key,
        help_text="License key shown to client, e.g. SHDZ-XXXX-XXXX-XXXX",
    )
    email = models.EmailField()
    client_name = models.CharField(max_length=200)
    plan = models.CharField(max_length=20, choices=PLAN_CHOICES, default="pro_retail")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="active")
    expires_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Leave blank for a perpetual license (never expires).",
    )
    max_machines = models.IntegerField(
        default=1,
        help_text="Maximum number of machines that can activate this license simultaneously.",
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "License"
        verbose_name_plural = "Licenses"

    def __str__(self):
        return f"{self.key} — {self.client_name}"

    def is_expired(self):
        if self.expires_at is None:
            return False
        return self.expires_at < timezone.now()

    def active_machine_count(self):
        return self.activations.filter(is_active=True).count()


class MachineActivation(models.Model):
    license = models.ForeignKey(
        License,
        related_name="activations",
        on_delete=models.CASCADE,
    )
    machine_id = models.CharField(
        max_length=64,
        help_text="UUID generated and stored on the client machine.",
    )
    hostname = models.CharField(max_length=200, blank=True)
    app_version = models.CharField(max_length=20, blank=True)
    first_activated = models.DateTimeField(auto_now_add=True)
    last_heartbeat = models.DateTimeField(auto_now=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = ("license", "machine_id")
        ordering = ["-last_heartbeat"]
        verbose_name = "Machine Activation"
        verbose_name_plural = "Machine Activations"

    def __str__(self):
        return f"{self.machine_id} ({self.hostname or 'unknown host'})"
