from django.contrib import admin
from unfold.admin import ModelAdmin, TabularInline
from .models import Product, StockMovement, StockTransfer, Variant


class VariantInline(TabularInline):
    model = Variant
    extra = 0
    fields = ["size_eu", "colour", "barcode", "stock_qty", "alert_threshold", "is_active"]
    readonly_fields = ["barcode", "stock_qty"]


@admin.register(Product)
class ProductAdmin(ModelAdmin):
    list_display = ["name", "brand", "category", "gender", "sale_price", "total_stock", "tenant"]
    list_filter = ["category", "gender", "season", "is_active", "tenant"]
    search_fields = ["name", "brand", "reference"]
    inlines = [VariantInline]
    readonly_fields = ["created_at", "updated_at"]


@admin.register(Variant)
class VariantAdmin(ModelAdmin):
    list_display = ["product", "size_eu", "colour", "barcode", "stock_qty", "is_active"]
    list_filter = ["is_active"]
    search_fields = ["barcode", "colour", "product__name"]
    readonly_fields = ["barcode", "stock_qty"]


@admin.register(StockMovement)
class StockMovementAdmin(ModelAdmin):
    list_display = ["timestamp", "variant", "quantity_delta", "reason", "branch", "user"]
    list_filter = ["reason", "branch"]
    search_fields = ["variant__product__name", "user__email"]
    readonly_fields = ["timestamp"]

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(StockTransfer)
class StockTransferAdmin(ModelAdmin):
    list_display = ["created_at", "variant", "quantity", "from_branch", "to_branch", "status"]
    list_filter = ["status"]
    readonly_fields = ["created_at", "received_at"]
