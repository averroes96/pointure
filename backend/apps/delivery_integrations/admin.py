from django.contrib import admin
from unfold.admin import ModelAdmin, TabularInline

from .models import Shipment, ShipmentEvent


class ShipmentEventInline(TabularInline):
    model = ShipmentEvent
    extra = 0
    can_delete = False
    fields = ["occurred_at", "status", "raw_status", "note"]
    readonly_fields = fields

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Shipment)
class ShipmentAdmin(ModelAdmin):
    """Read-only: shipments are a mirror of the courier's data (delivery-v1-plan P1.8)."""
    list_display = ["tracking_number", "courier", "tenant", "status", "cash_status", "cod_amount", "courier_updated_at"]
    list_filter = ["courier", "status", "cash_status", "tenant"]
    search_fields = ["tracking_number", "external_id", "reference"]
    inlines = [ShipmentEventInline]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
