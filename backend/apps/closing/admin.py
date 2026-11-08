"""Admin registrations for closing models."""
from django.contrib import admin
from .models import FiscalYear, StockSnapshotLine, BalanceSnapshotLine


class StockSnapshotLineInline(admin.TabularInline):
    model = StockSnapshotLine
    extra = 0
    readonly_fields = ["variant", "branch", "quantity", "unit_cost", "cost_value", "unit_price", "retail_value"]


class BalanceSnapshotLineInline(admin.TabularInline):
    model = BalanceSnapshotLine
    extra = 0
    readonly_fields = ["kind", "party_id", "party_name", "balance"]


@admin.register(FiscalYear)
class FiscalYearAdmin(admin.ModelAdmin):
    list_display = ["year", "tenant", "start_date", "end_date", "status", "closed_at", "closed_by"]
    list_filter = ["status", "year", "tenant"]
    inlines = [StockSnapshotLineInline, BalanceSnapshotLineInline]

