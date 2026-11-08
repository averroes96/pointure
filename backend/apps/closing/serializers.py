"""Serializers for Fiscal Year Closing (Tasks 6.1 - 6.5)."""
from rest_framework import serializers

from apps.closing.models import FiscalYear, StockSnapshotLine, BalanceSnapshotLine


class FiscalYearSerializer(serializers.ModelSerializer):
    closed_by_name = serializers.SerializerMethodField()
    stocktake_session_name = serializers.SerializerMethodField()

    class Meta:
        model = FiscalYear
        fields = [
            "id",
            "year",
            "start_date",
            "end_date",
            "status",
            "closed_at",
            "closed_by",
            "closed_by_name",
            "reopened_reason",
            "stocktake_session",
            "stocktake_session_name",
            "totals",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "closed_at",
            "closed_by",
            "closed_by_name",
            "stocktake_session_name",
            "totals",
            "created_at",
            "updated_at",
        ]

    def get_closed_by_name(self, obj) -> str:
        if obj.closed_by:
            return obj.closed_by.get_full_name() or obj.closed_by.email or str(obj.closed_by)
        return ""

    def get_stocktake_session_name(self, obj) -> str:
        if obj.stocktake_session:
            return f"Session #{obj.stocktake_session.id} ({obj.stocktake_session.status})"
        return ""

