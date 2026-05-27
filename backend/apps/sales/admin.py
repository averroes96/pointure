from django.contrib import admin
from .models import Payment, Return, ReturnItem, Sale, SaleItem


class SaleItemInline(admin.TabularInline):
    model = SaleItem
    extra = 0
    readonly_fields = ["subtotal"]


class PaymentInline(admin.TabularInline):
    model = Payment
    extra = 0
    readonly_fields = ["recorded_at"]


@admin.register(Sale)
class SaleAdmin(admin.ModelAdmin):
    list_display = ["receipt_number", "tenant", "branch", "cashier", "total_amount", "status", "created_at"]
    list_filter = ["status", "branch", "tenant"]
    search_fields = ["receipt_number", "cashier__email"]
    inlines = [SaleItemInline, PaymentInline]
    readonly_fields = ["created_at", "receipt_number"]
