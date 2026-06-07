"""Loyalty system API views."""
import logging

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.mixins import TenantScopedViewSetMixin
from apps.core.plan_permissions import PlanRequired
from .models import (
    LoyaltyAccount,
    LoyaltyProgram,
    LoyaltyTransaction,
    TransactionTypeChoices,
)
from .serializers import (
    LoyaltyAccountSerializer,
    LoyaltyAccountSummarySerializer,
    LoyaltyProgramSerializer,
)

logger = logging.getLogger(__name__)

_LOYALTY_PLAN = "pro_retail"


class LoyaltyProgramViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """
    CRUD for a tenant's loyalty programme configuration.
    Each tenant should have at most one program; the UI enforces this.
    Owner-only for write operations. Requires plan >= pro_retail.
    """

    queryset = LoyaltyProgram.objects.all()
    serializer_class = LoyaltyProgramSerializer
    permission_classes = [IsAuthenticated, PlanRequired(_LOYALTY_PLAN)]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def perform_create(self, serializer):
        self.require_owner()
        serializer.save(tenant=self.request.tenant)

    def perform_update(self, serializer):
        self.require_owner()
        serializer.save()

    def perform_destroy(self, instance):
        self.require_owner()
        instance.delete()


class LoyaltyAccountViewSet(TenantScopedViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """
    Read-only list/retrieve for loyalty accounts.
    Requires plan >= pro_retail.
    Provides a 'by-client' shortcut (auto-creates account if missing) and
    a manual 'adjust' action.
    """

    queryset = LoyaltyAccount.objects.select_related("client").prefetch_related("transactions")
    serializer_class = LoyaltyAccountSerializer
    permission_classes = [IsAuthenticated, PlanRequired(_LOYALTY_PLAN)]
    filterset_fields = ["client", "tier"]
    search_fields = ["client__name", "client__phone"]
    ordering_fields = ["points_balance", "total_earned", "enrolled_at"]
    ordering = ["-total_earned"]

    @action(detail=False, methods=["get"], url_path="by-client")
    def by_client(self, request):
        """
        GET /loyalty/accounts/by-client/?client_id=<id>

        Used by the POS and client detail page.
        - If an account already exists: return it.
        - If no account exists but the tenant has an active programme: create
          one (Bronze, 0 pts) and return it.
        - If no programme is configured: return 404.
        """
        client_id = request.query_params.get("client_id")
        if not client_id:
            return Response(
                {"detail": "client_id est requis."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        account = (
            LoyaltyAccount.objects.filter(tenant=request.tenant, client_id=client_id)
            .select_related("client")
            .first()
        )

        if not account:
            # Auto-create if an active programme exists for this tenant
            program = LoyaltyProgram.objects.filter(
                tenant=request.tenant, is_active=True
            ).first()
            if not program:
                return Response(
                    {"detail": "Aucun programme de fidélité actif pour ce commerce."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            from apps.clients.models import Client
            try:
                client = Client.objects.get(pk=client_id, tenant=request.tenant)
            except Client.DoesNotExist:
                return Response(
                    {"detail": "Client introuvable."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            account, _ = LoyaltyAccount.objects.get_or_create(
                tenant=request.tenant,
                client=client,
                defaults={"tier": "bronze"},
            )

        return Response(LoyaltyAccountSummarySerializer(account).data)

    @action(detail=True, methods=["post"], url_path="adjust")
    def adjust(self, request, pk=None):
        """
        POST /loyalty/accounts/<id>/adjust/
        Body: { "points": <int>, "description": "..." }
        Manually add or deduct points (manager+).
        """
        self.require_manager()
        account = self.get_object()

        points = request.data.get("points")
        if points is None:
            return Response({"detail": "points est requis."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            points = int(points)
        except (TypeError, ValueError):
            return Response({"detail": "points doit être un entier."}, status=status.HTTP_400_BAD_REQUEST)
        if points == 0:
            return Response({"detail": "points ne peut pas être zéro."}, status=status.HTTP_400_BAD_REQUEST)

        description = request.data.get("description", "Ajustement manuel")

        account.points_balance += points
        if points > 0:
            account.total_earned += points
            account.recompute_tier()
        if account.points_balance < 0:
            account.points_balance = 0
        account.save()

        LoyaltyTransaction.objects.create(
            account=account,
            points=points,
            transaction_type=TransactionTypeChoices.ADJUST,
            description=description,
            balance_after=account.points_balance,
        )

        return Response(LoyaltyAccountSerializer(account).data)
