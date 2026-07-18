from django.contrib import admin
from django.utils.html import format_html
from unfold.admin import ModelAdmin

from .models import LicenseState


@admin.register(LicenseState)
class LicenseStateAdmin(ModelAdmin):
    """Read-only admin view for the local license cache."""

    list_display = (
        "license_key",
        "plan",
        "client_name",
        "validity_badge",
        "last_check",
        "grace_until",
    )
    readonly_fields = (
        "machine_id",
        "license_key",
        "plan",
        "client_name",
        "valid",
        "expires_at",
        "last_check",
        "grace_until",
    )

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @admin.display(description="Status")
    def validity_badge(self, obj):
        if obj.is_currently_valid():
            label, color = "Valid", "green"
        elif obj.is_within_grace():
            label, color = "Grace", "orange"
        else:
            label, color = "Invalid", "red"
        return format_html(
            '<span style="color:{};font-weight:bold">{}</span>', color, label
        )
