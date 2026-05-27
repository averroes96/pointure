from django.contrib import admin
from .models import CreditNote, DeliveryNote, Invoice, InvoiceCounter, InvoiceLine, InvoicePayment


class InvoiceLineInline(admin.TabularInline):
    model = InvoiceLine
    extra = 0
    readonly_fields = ["line_total"]


class InvoicePaymentInline(admin.TabularInline):
    model = InvoicePayment
    extra = 0
    readonly_fields = ["created_at"]


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ["number", "client", "date", "due_date", "total_ttc", "status", "tenant"]
    list_filter = ["status", "apply_tva", "tenant"]
    search_fields = ["number", "client__name"]
    readonly_fields = ["total_ht", "tva_amount", "total_ttc", "created_at", "updated_at"]
    inlines = [InvoiceLineInline, InvoicePaymentInline]


@admin.register(InvoiceCounter)
class InvoiceCounterAdmin(admin.ModelAdmin):
    list_display = ["tenant", "prefix", "year", "last_sequence"]
    readonly_fields = ["last_sequence"]
