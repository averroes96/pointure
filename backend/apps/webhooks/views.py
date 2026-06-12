import uuid

from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.mixins import TenantScopedViewSetMixin
from apps.core.plan_permissions import PlanRequired

from .models import WEBHOOK_EVENT_CHOICES, WebhookDelivery, WebhookEndpoint
from .serializers import WebhookDeliverySerializer, WebhookEndpointSerializer
from .tasks import _deliver


class WebhookEndpointViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = WebhookEndpoint.objects.all()
    serializer_class = WebhookEndpointSerializer
    permission_classes = [IsAuthenticated, PlanRequired("pro_retail")]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        if self.request.user.is_superuser:
            return WebhookEndpoint.objects.all()
        return WebhookEndpoint.objects.filter(tenant=self.request.tenant)

    def perform_create(self, serializer):
        serializer.save(tenant=self.request.tenant)

    @action(detail=False, methods=["get"])
    def event_types(self, request):
        """Return supported event types for the UI's checkbox list."""
        return Response([{"value": v, "label": l} for v, l in WEBHOOK_EVENT_CHOICES])

    @action(detail=True, methods=["post"])
    def test(self, request, pk=None):
        """Send a synthetic test ping to this endpoint."""
        endpoint = self.get_object()
        delivery = WebhookDelivery.objects.create(
            endpoint=endpoint,
            tenant=endpoint.tenant,
            event_type="test",
            payload={
                "id": str(uuid.uuid4()),
                "event": "test",
                "timestamp": timezone.now().isoformat(),
                "data": {"message": "Ceci est un événement de test ShoeDZ."},
            },
            status="pending",
            next_attempt_at=timezone.now(),
        )
        _deliver(delivery)
        delivery.refresh_from_db()
        return Response(WebhookDeliverySerializer(delivery).data)

    @action(detail=True, methods=["get"])
    def deliveries(self, request, pk=None):
        """Return the last 100 delivery attempts for this endpoint."""
        endpoint = self.get_object()
        qs = endpoint.deliveries.order_by("-created_at")
        status_filter = request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        return Response(WebhookDeliverySerializer(qs[:100], many=True).data)


class WebhookDeliveryRetryView(APIView):
    permission_classes = [IsAuthenticated, PlanRequired("pro_retail")]

    def _get_delivery(self, pk, request):
        try:
            delivery = WebhookDelivery.objects.select_related("endpoint").get(pk=pk)
        except WebhookDelivery.DoesNotExist:
            return None
        if not request.user.is_superuser and delivery.tenant != request.tenant:
            raise PermissionDenied()
        return delivery

    def post(self, request, pk):
        delivery = self._get_delivery(pk, request)
        if delivery is None:
            return Response({"error": "Introuvable."}, status=status.HTTP_404_NOT_FOUND)

        if delivery.status not in ("failed", "abandoned"):
            return Response(
                {"error": "Seules les livraisons échouées ou abandonnées peuvent être réessayées."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        delivery.status = "pending"
        delivery.next_attempt_at = timezone.now()
        delivery.save(update_fields=["status", "next_attempt_at"])
        _deliver(delivery)
        delivery.refresh_from_db()
        return Response(WebhookDeliverySerializer(delivery).data)
