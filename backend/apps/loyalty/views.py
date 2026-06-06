"""Loyalty system API views."""
import logging

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.mixins import TenantScopedViewSetMixin
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
    LoyaltyTransactionSerializer,
)

logger = logging.getLogger(__name__)


class LoyaltyProgramViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """
    CRUD for a tenant's loyalty programme configuration.
    Each tenant should have at most one program; the UI enforces this.
    Owner-only for write operations.
    """

    queryset = LoyaltyProgram.objects.all()
    serializer_class = LoyaltyProgramSerializer
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
    Managers and owners can look up any account.
    Provides a 'by-client' shortcut and a manual 'adjust' action.
    """

    queryset = LoyaltyAccount.objects.select_related("client").prefetch_related("transactions")
    serializer_class = LoyaltyAccountSerializer
    filterset_fields = ["client", "tier"]
    search_fields = ["client__name", "client__phone"]
    ordering_fields = ["points_balance", "total_earned", "enrolled_at"]
    ordering = ["-total_earned"]

    @action(detail=False, methods=["get"], url_path="by-client")
    def by_client(self, request):
        """
        GET /loyalty/accounts/by-client/?client_id=<id>
        Used by the POS to fetch a client's account without knowing the account PK.
        Returns the summary serializer (no transaction history) for speed.
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
            return Response(
                {"detail": "Aucun compte fidélité trouvé."},
                status=status.HTTP_404_NOT_FOUND,
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
        # Prevent negative balance
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
