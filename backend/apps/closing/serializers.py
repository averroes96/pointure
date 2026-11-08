"""Serializers for Fiscal Year Closing (Tasks 6.1 - 6.5)."""
from django.utils.translation import gettext as _
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

    def validate(self, attrs):
        if self.instance and self.instance.is_closed:
            raise serializers.ValidationError(
                _("Impossible de modifier un exercice clôturé."),
                code="year_closed",
            )

        start_date = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end_date = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start_date and end_date and start_date > end_date:
            raise serializers.ValidationError(
                {"end_date": _("La date de fin doit être postérieure ou égale à la date de début.")}
            )

        request = self.context.get("request")
        tenant = getattr(request, "tenant", None) if request else None
        if not tenant and self.instance:
            tenant = self.instance.tenant

        stocktake_session = attrs.get("stocktake_session")
        if stocktake_session and tenant and stocktake_session.tenant_id != tenant.id:
            raise serializers.ValidationError(
                {"stocktake_session": _("Cette session d'inventaire n'appartient pas à votre magasin.")}
            )

        if tenant and start_date and end_date:
            qs = FiscalYear.objects.filter(
                tenant=tenant,
                start_date__lte=end_date,
                end_date__gte=start_date,
            )
            if self.instance and self.instance.pk:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    _("Les dates de cet exercice chevauchent un autre exercice existant.")
                )

        return attrs

    def get_closed_by_name(self, obj) -> str:
        if obj.closed_by:
            return obj.closed_by.get_full_name() or obj.closed_by.email or str(obj.closed_by)
        return ""

    def get_stocktake_session_name(self, obj) -> str:
        if obj.stocktake_session:
            return f"Session #{obj.stocktake_session.id} ({obj.stocktake_session.status})"
        return ""

