from django.contrib import admin
from unfold.admin import ModelAdmin, TabularInline
from .models import Cheque, Client, ClientLedger


class ClientLedgerInline(TabularInline):
    model = ClientLedger
    extra = 0
    readonly_fields = ["created_at", "balance_after"]
    ordering = ["-created_at"]
    max_num = 20


@admin.register(Client)
class ClientAdmin(ModelAdmin):
    list_display = ["name", "phone", "wilaya", "cached_balance", "credit_limit", "is_active", "tenant"]
    list_filter = ["is_active", "wilaya", "tenant"]
    search_fields = ["name", "phone", "nif", "rc"]
    readonly_fields = ["cached_balance", "created_at"]
    inlines = [ClientLedgerInline]


@admin.register(Cheque)
class ChequeAdmin(ModelAdmin):
    list_display = ["number", "client", "amount", "due_date", "status", "direction"]
    list_filter = ["status", "direction"]
    search_fields = ["number", "client__name"]
    readonly_fields = ["created_at"]
