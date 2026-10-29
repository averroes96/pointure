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
    ordering = ["-created_at"]
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

    def get_serializer_class(self):
        if self.action == "list":
            return LoyaltyAccountSummarySerializer
        return LoyaltyAccountSerializer

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

    @action(detail=False, methods=["get"], url_path="stats")
    def stats(self, request):
        """
        GET /loyalty/accounts/stats/
        Returns aggregate KPIs for the loyalty program dashboard.
        """
        from django.db.models import Count, Q, Sum
        from decimal import Decimal

        qs = LoyaltyAccount.objects.filter(tenant=request.tenant)
        aggs = qs.aggregate(
            total_members=Count("id"),
            total_balance=Sum("points_balance"),
            total_earned=Sum("total_earned"),
            bronze_count=Count("id", filter=Q(tier="bronze")),
            silver_count=Count("id", filter=Q(tier="silver")),
            gold_count=Count("id", filter=Q(tier="gold")),
        )
        redeemed_agg = LoyaltyTransaction.objects.filter(
            account__tenant=request.tenant,
            transaction_type=TransactionTypeChoices.REDEEM,
        ).aggregate(total_redeemed=Sum("points"))

        program = LoyaltyProgram.objects.filter(tenant=request.tenant).first()
        total_balance = aggs["total_balance"] or 0
        total_redeemed = abs(redeemed_agg["total_redeemed"] or 0)
        balance_dzd = (
            program.dzd_for_points(total_balance)
            if program
            else Decimal(total_balance)
        )
        redeemed_dzd = (
            program.dzd_for_points(total_redeemed)
            if program
            else Decimal(total_redeemed)
        )

        return Response({
            "total_members": aggs["total_members"] or 0,
            "total_points_balance": total_balance,
            "total_points_dzd_value": str(balance_dzd.quantize(Decimal("0.01"))),
            "total_points_earned": aggs["total_earned"] or 0,
            "total_points_redeemed": total_redeemed,
            "total_redeemed_dzd_value": str(redeemed_dzd.quantize(Decimal("0.01"))),
            "tier_counts": {
                "bronze": aggs["bronze_count"] or 0,
                "silver": aggs["silver_count"] or 0,
                "gold": aggs["gold_count"] or 0,
            },
        })

    @action(detail=False, methods=["post"], url_path="enroll")
    def enroll(self, request):
        """
        POST /loyalty/accounts/enroll/
        Body: { "client_id": <id>, "welcome_points": 0 } OR { "enroll_all": true }
        Enrolls one client (or all existing un-enrolled clients) into the loyalty program.
        """
        from apps.clients.models import Client

        # Ensure a LoyaltyProgram exists for this tenant (auto-create default if none)
        program, _ = LoyaltyProgram.objects.get_or_create(
            tenant=request.tenant,
            defaults={"is_active": True},
        )

        if request.data.get("enroll_all"):
            existing_client_ids = LoyaltyAccount.objects.filter(
                tenant=request.tenant
            ).values_list("client_id", flat=True)
            clients_to_enroll = Client.objects.filter(
                tenant=request.tenant, is_active=True
            ).exclude(id__in=existing_client_ids)
            created_accounts = [
                LoyaltyAccount(tenant=request.tenant, client=c, tier="bronze")
                for c in clients_to_enroll
            ]
            if created_accounts:
                LoyaltyAccount.objects.bulk_create(created_accounts, ignore_conflicts=True)
            return Response({"enrolled_count": len(created_accounts)})

        client_id = request.data.get("client_id")
        if not client_id:
            return Response({"detail": "client_id est requis."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            client = Client.objects.get(pk=client_id, tenant=request.tenant)
        except Client.DoesNotExist:
            return Response({"detail": "Client introuvable."}, status=status.HTTP_404_NOT_FOUND)

        welcome_points = 0
        try:
            welcome_points = max(0, int(request.data.get("welcome_points", 0) or 0))
        except (TypeError, ValueError):
            welcome_points = 0

        account, created = LoyaltyAccount.objects.get_or_create(
            tenant=request.tenant,
            client=client,
            defaults={
                "tier": "bronze",
                "points_balance": welcome_points,
                "total_earned": welcome_points,
            },
        )
        if created and welcome_points > 0:
            account.recompute_tier(program)
            account.save()
            LoyaltyTransaction.objects.create(
                account=account,
                points=welcome_points,
                transaction_type=TransactionTypeChoices.ADJUST,
                description="Bonus de bienvenue fidélité",
                balance_after=account.points_balance,
            )

        return Response(
            LoyaltyAccountSerializer(account).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

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
