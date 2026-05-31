from django.contrib import admin
from django.utils.html import format_html

from .models import DeviceToken


@admin.register(DeviceToken)
class DeviceTokenAdmin(admin.ModelAdmin):
    list_display = ("_token_short", "_platform", "user", "_tenant", "updated_at")
    list_filter = ("platform", "tenant")
    search_fields = ("user__email", "tenant__name", "token")
    readonly_fields = ("token", "platform", "user", "tenant", "created_at", "updated_at")
    ordering = ("-updated_at",)

    def has_add_permission(self, request):
        return False

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("user", "tenant")

    @admin.display(description="Token")
    def _token_short(self, obj):
        return format_html(
            '<span style="font-family:monospace;font-size:12px;color:#6b7280">…{}</span>',
            obj.token[-16:],
        )

    @admin.display(description="Plateforme")
    def _platform(self, obj):
        icon = "🤖" if obj.platform == "android" else "🍎"
        return f"{icon} {obj.platform.capitalize()}"

    @admin.display(description="Tenant")
    def _tenant(self, obj):
        return obj.tenant.name if obj.tenant else "—"
