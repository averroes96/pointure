"""Owner-editable Aïd, rentrée and custom dates."""
from rest_framework import viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from django.utils.translation import gettext as _

from apps.core.mixins import TenantScopedViewSetMixin
from apps.core.permissions import MANAGER_OR_OWNER, OWNER_ONLY, RolePermission
from apps.reports.models import SeasonalEvent
from apps.reports.serializers import SeasonalEventSerializer
from apps.reports.services.seasonal import ensure_seasonal_events


class SeasonalEventViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = SeasonalEventSerializer
    permission_classes = [IsAuthenticated, RolePermission]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    role_permissions = {
        "list": MANAGER_OR_OWNER,
        "retrieve": MANAGER_OR_OWNER,
        "create": OWNER_ONLY,
        "partial_update": OWNER_ONLY,
        "destroy": OWNER_ONLY,
        "default": OWNER_ONLY,
    }
    queryset = SeasonalEvent.objects.all()
    pagination_class = None

    def get_queryset(self):
        ensure_seasonal_events(self.request.tenant)
        return SeasonalEvent.objects.filter(tenant=self.request.tenant).order_by("date")

    def perform_create(self, serializer):
        serializer.save(
            tenant=self.request.tenant,
            kind=SeasonalEvent.Kind.CUSTOM,
            is_estimated=False,
            seed_key="",
        )

    def perform_update(self, serializer):
        confirmed = (
            "date" in serializer.validated_data
            and serializer.validated_data["date"] != serializer.instance.date
        )
        if confirmed:
            serializer.save(is_estimated=False)
        else:
            serializer.save()

    def perform_destroy(self, instance):
        if instance.seed_key:
            raise ValidationError(_("Cette date se modifie, elle ne se supprime pas."))
        instance.delete()
