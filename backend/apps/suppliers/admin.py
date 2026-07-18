from django.contrib import admin
from unfold.admin import ModelAdmin, TabularInline
from .models import PurchaseOrder, POLine, Supplier, SupplierInvoice, SupplierPayment


@admin.register(Supplier)
class SupplierAdmin(ModelAdmin):
    list_display = ["name", "contact_name", "phone", "email", "outstanding_balance", "is_active"]
    list_filter = ["is_active", "origin_country"]
    search_fields = ["name", "contact_name", "email", "phone"]
    readonly_fields = ["outstanding_balance", "created_at"]


class POLineInline(TabularInline):
    model = POLine
    extra = 0
    readonly_fields = ["line_total"]


@admin.register(PurchaseOrder)
class PurchaseOrderAdmin(ModelAdmin):
    list_display = ["reference", "supplier", "status", "total_amount", "expected_date", "created_at"]
    list_filter = ["status", "supplier"]
    search_fields = ["reference", "supplier__name"]
    readonly_fields = ["created_at"]
    inlines = [POLineInline]


@admin.register(SupplierInvoice)
class SupplierInvoiceAdmin(ModelAdmin):
    list_display = ["invoice_number", "supplier", "date", "due_date", "total_amount"]
    list_filter = ["date", "supplier"]
    search_fields = ["invoice_number", "supplier__name"]
    readonly_fields = ["created_at"]


@admin.register(SupplierPayment)
class SupplierPaymentAdmin(ModelAdmin):
    list_display = ["date", "supplier", "amount", "method", "recorded_by"]
    list_filter = ["method", "date", "supplier"]
    search_fields = ["supplier__name", "cheque_number"]
    readonly_fields = ["created_at"]
