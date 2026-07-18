from django.contrib import admin
from django.utils.html import format_html
from unfold.admin import ModelAdmin, TabularInline

from .models import LoyaltyAccount, LoyaltyProgram, LoyaltyTransaction, TierChoices

TIER_COLOURS = {
    TierChoices.BRONZE: ("#92400e", "#fef3c7"),
    TierChoices.SILVER: ("#374151", "#f3f4f6"),
    TierChoices.GOLD: ("#78350f", "#fde68a"),
}


def _tier_badge(tier: str, label: str) -> str:
    fg, bg = TIER_COLOURS.get(tier, ("#374151", "#f3f4f6"))
    return format_html(
        '<span style="background:{};color:{};padding:2px 8px;border-radius:9999px;'
        'font-size:11px;font-weight:600">{}</span>',
        bg, fg, label,
    )


@admin.register(LoyaltyProgram)
class LoyaltyProgramAdmin(ModelAdmin):
    list_display = ["tenant", "points_per_100dzd", "redemption_value", "min_redemption_points", "expiry_months", "is_active"]
    list_filter = ["is_active"]
    search_fields = ["tenant__name"]


class LoyaltyTransactionInline(TabularInline):
    model = LoyaltyTransaction
    extra = 0
    readonly_fields = ["points", "transaction_type", "description", "balance_after", "reference_type", "reference_id", "created_at"]
    can_delete = False
    max_num = 0

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(LoyaltyAccount)
class LoyaltyAccountAdmin(ModelAdmin):
    list_display = ["client", "tenant", "_tier_badge", "points_balance", "total_earned", "enrolled_at"]
    list_filter = ["tier", "tenant"]
    search_fields = ["client__name", "client__phone"]
    readonly_fields = ["enrolled_at", "total_earned"]
    inlines = [LoyaltyTransactionInline]

    @admin.display(description="Tier")
    def _tier_badge(self, obj):
        return _tier_badge(obj.tier, obj.get_tier_display())


@admin.register(LoyaltyTransaction)
class LoyaltyTransactionAdmin(ModelAdmin):
    list_display = ["account", "points", "transaction_type", "description", "balance_after", "created_at"]
    list_filter = ["transaction_type"]
    search_fields = ["account__client__name", "description"]
    readonly_fields = ["created_at"]
