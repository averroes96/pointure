"""Core API views: profile, users, branches, tenant settings."""
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.models import AuditLog, Branch, Tenant, User
from apps.core.mixins import TenantScopedViewSetMixin
from apps.core.serializers import (
    AuditLogSerializer,
    BranchSerializer,
    MeSerializer,
    TenantSerializer,
    UserCreateSerializer,
    UserSerializer,
)


class MeView(viewsets.GenericViewSet):
    """Current user profile endpoint."""
    permission_classes = [IsAuthenticated]
    serializer_class = MeSerializer

    @action(detail=False, methods=["get"])
    def profile(self, request):
        serializer = self.get_serializer(request.user)
        return Response(serializer.data)

    @action(detail=False, methods=["patch"])
    def update_profile(self, request):
        serializer = self.get_serializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    @action(detail=False, methods=["post"], url_path="change-password")
    def change_password(self, request):
        """Change own password. Body: {old_password, new_password, confirm_password}"""
        old_password = request.data.get("old_password", "")
        new_password = request.data.get("new_password", "")
        confirm = request.data.get("confirm_password", "")

        if not request.user.check_password(old_password):
            return Response(
                {"old_password": "Mot de passe actuel incorrect."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(new_password) < 8:
            return Response(
                {"new_password": "Le mot de passe doit contenir au moins 8 caractères."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if new_password != confirm:
            return Response(
                {"confirm_password": "Les mots de passe ne correspondent pas."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        request.user.set_password(new_password)
        request.user.save(update_fields=["password"])
        return Response({"detail": "Mot de passe modifié avec succès."})


class UserViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """User management (Owner and Manager only)."""
    queryset = User.objects.all()
    serializer_class = UserSerializer

    def get_serializer_class(self):
        if self.action == "create":
            return UserCreateSerializer
        return UserSerializer

    def get_queryset(self):
        if self.request.user.is_superuser:
            return User.objects.all()
        return User.objects.filter(tenant=self.request.tenant)

    def perform_create(self, serializer):
        self.require_manager()
        serializer.save(tenant=self.request.tenant)

    def perform_update(self, serializer):
        self.require_manager()
        serializer.save()

    def perform_destroy(self, instance):
        self.require_owner()
        instance.delete()


class BranchViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """Branch management."""
    queryset = Branch.objects.all()
    serializer_class = BranchSerializer

    def get_queryset(self):
        if self.request.user.is_superuser:
            return Branch.objects.all()
        return Branch.objects.filter(tenant=self.request.tenant)

    def perform_create(self, serializer):
        self.require_manager()
        serializer.save(tenant=self.request.tenant)


class AuditLogViewSet(TenantScopedViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """Read-only audit trail — owner only."""
    queryset = AuditLog.objects.all()
    serializer_class = AuditLogSerializer
    ordering = ["-timestamp"]
    filterset_fields = ["action", "model_name", "user"]

    def get_queryset(self):
        self.require_owner()
        return AuditLog.objects.filter(tenant=self.request.tenant).select_related("user")

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Count of audit events by model and action for the last 30 days."""
        from django.utils import timezone
        from django.db.models import Count
        self.require_owner()
        since = timezone.now() - timezone.timedelta(days=30)
        data = (
            AuditLog.objects.filter(tenant=request.tenant, timestamp__gte=since)
            .values("model_name", "action")
            .annotate(count=Count("id"))
            .order_by("-count")
        )
        return Response(list(data))


class TenantSettingsView(viewsets.GenericViewSet):
    """Tenant settings (Owner only)."""
    serializer_class = TenantSerializer
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=["get"], url_path="settings", url_name="settings")
    def get_settings(self, request):
        # Method renamed from `settings` to avoid shadowing DRF's APIView.settings
        # class attribute (api_settings), which causes AttributeError on every request.
        self.require_owner()
        serializer = self.get_serializer(request.tenant)
        return Response(serializer.data)

    @action(detail=False, methods=["patch"])
    def update_settings(self, request):
        self.require_owner()
        serializer = self.get_serializer(request.tenant, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def require_owner(self):
        from apps.core.models import RoleChoices
        from rest_framework.exceptions import PermissionDenied
        if self.request.user.role != RoleChoices.OWNER:
            raise PermissionDenied("Only the owner can change tenant settings.")

