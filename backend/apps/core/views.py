"""Core API views: profile, users, branches, tenant settings."""
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode

from apps.core.models import AuditLog, Branch, RoleChoices, StoreSettings, Tenant, User, Wilaya, Commune
from apps.core.mixins import TenantScopedViewSetMixin
from apps.core.permissions import ALL_ROLES, MANAGER_OR_OWNER, OWNER_ONLY, RolePermission
from apps.core.throttling import ManagerPinRateThrottle
from apps.core.serializers import (
    AuditLogSerializer,
    BranchSerializer,
    MeSerializer,
    StoreSettingsSerializer,
    TenantSerializer,
    UserCreateSerializer,
    UserSerializer,
    WilayaSerializer,
    CommuneSerializer,
)

class WilayaViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Wilaya.objects.all()
    serializer_class = WilayaSerializer
    authentication_classes = []
    permission_classes = [AllowAny]
    pagination_class = None

    def get_queryset(self):
        qs = Wilaya.objects.all()
        if not qs.exists():
            from apps.core.utils.location import ensure_wilayas_loaded
            ensure_wilayas_loaded()
            qs = Wilaya.objects.all()
        return qs

class CommuneViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Commune.objects.all()
    serializer_class = CommuneSerializer
    authentication_classes = []
    permission_classes = [AllowAny]
    filterset_fields = ["wilaya"]
    pagination_class = None


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
    ordering = ["-date_joined"]

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
        actor = self.request.user
        is_owner_or_super = actor.role == RoleChoices.OWNER or actor.is_superuser
        if serializer.validated_data.get("role") == RoleChoices.OWNER and not is_owner_or_super:
            raise PermissionDenied("Seul le propriétaire peut créer un compte propriétaire.")
        from apps.core.plan_permissions import check_quota
        check_quota(self.request, "users", User.objects.filter(tenant=self.request.tenant).count())
        # Capture the plain-text password before the serializer hashes it
        temp_password = self.request.data.get("password", "")
        user = serializer.save(tenant=self.request.tenant)
        if temp_password and user.email:
            from apps.core.utils.task_runner import run_task
            from apps.core.tasks import send_welcome_email
            tenant_name = getattr(self.request.tenant, "name", "ShoeDZ")
            run_task(send_welcome_email, user.pk, temp_password, tenant_name)

    def perform_update(self, serializer):
        self.require_manager()
        actor = self.request.user
        target = serializer.instance
        is_owner_or_super = actor.role == RoleChoices.OWNER or actor.is_superuser

        # Non-owners cannot modify an owner account
        if target.role == RoleChoices.OWNER and not is_owner_or_super:
            raise PermissionDenied("Seul le propriétaire peut modifier le compte du propriétaire.")

        # Non-owners cannot assign the owner role to anyone (including themselves)
        new_role = serializer.validated_data.get("role")
        if new_role == RoleChoices.OWNER and not is_owner_or_super:
            raise PermissionDenied("Seul le propriétaire peut attribuer le rôle de propriétaire.")

        # Non-owners cannot change their own role
        if target.pk == actor.pk and "role" in serializer.validated_data and serializer.validated_data["role"] != target.role and not is_owner_or_super:
            raise PermissionDenied("Vous ne pouvez pas modifier votre propre rôle.")

        serializer.save()

    def perform_destroy(self, instance):
        self.require_owner()
        instance.delete()

    @action(
        detail=False,
        methods=["post"],
        url_path="verify-manager-pin",
        throttle_classes=[ManagerPinRateThrottle],
    )
    def verify_manager_pin(self, request):
        """
        Verify manager PIN code for authorizing POS actions (returns, excess discounts, voids).
        """
        pin = request.data.get("pin")
        if not pin:
            return Response({"error": "PIN requis."}, status=status.HTTP_400_BAD_REQUEST)

        from apps.sales.serializers import verify_manager_pin_helper
        matching_manager = verify_manager_pin_helper(request.tenant, pin, user=request.user)

        if not matching_manager:
            return Response({"error": "Code PIN manager incorrect."}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            "valid": True,
            "manager_id": str(matching_manager.id),
            "manager_name": matching_manager.get_full_name() or matching_manager.email,
            "role": matching_manager.role,
        })

    @action(detail=True, methods=["post"], url_path="set-pin")
    def set_pin(self, request, pk=None):
        """
        Set or update a user's 4-6 digit numeric PIN.
        Can be done by the user themselves or by a manager/owner.
        """
        target_user = self.get_object()
        actor = request.user
        is_owner_or_super = actor.role == RoleChoices.OWNER or actor.is_superuser

        if actor.role not in (RoleChoices.OWNER, RoleChoices.MANAGER) and actor.id != target_user.id:
            return Response({"error": "Action non autorisée."}, status=status.HTTP_403_FORBIDDEN)

        # Non-owners cannot modify an owner's PIN (unless the owner is modifying their own PIN)
        if target_user.role == RoleChoices.OWNER and not is_owner_or_super and actor.id != target_user.id:
            return Response({"error": "Action non autorisée."}, status=status.HTTP_403_FORBIDDEN)

        pin = request.data.get("pin", "")
        if not pin:
            target_user.pin_code = None
            target_user.save(update_fields=["pin_code"])
            return Response({"detail": "Code PIN supprimé."})

        try:
            target_user.set_pin(pin)
            target_user.save(update_fields=["pin_code"])
            return Response({"detail": "Code PIN configuré avec succès."})
        except ValueError as err:
            return Response({"error": str(err)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request, pk=None):
        """
        Allows an Owner or Manager to set a new password for a staff member/cashier.
        """
        self.require_manager()
        target_user = self.get_object()
        actor = request.user
        is_owner_or_super = actor.role == RoleChoices.OWNER or actor.is_superuser

        # Non-owners cannot reset an owner's password
        if target_user.role == RoleChoices.OWNER and not is_owner_or_super:
            raise PermissionDenied("Seul le propriétaire peut réinitialiser le mot de passe du propriétaire.")

        new_password = request.data.get("new_password", "").strip()
        if len(new_password) < 8:
            return Response(
                {"error": "Le mot de passe doit contenir au moins 8 caractères."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        target_user.set_password(new_password)
        target_user.save(update_fields=["password"])
        return Response({"detail": "Mot de passe réinitialisé avec succès."})


class BranchViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """Branch management."""
    queryset = Branch.objects.all()
    serializer_class = BranchSerializer
    permission_classes = [IsAuthenticated, RolePermission]
    role_permissions = {
        "list": ALL_ROLES,
        "retrieve": ALL_ROLES,
        "create": MANAGER_OR_OWNER,
        "update": MANAGER_OR_OWNER,
        "partial_update": MANAGER_OR_OWNER,
        "destroy": OWNER_ONLY,
        "default": MANAGER_OR_OWNER,
    }
    ordering = ["name"]

    def get_queryset(self):
        if self.request.user.is_superuser:
            return Branch.objects.all()
        tenant = getattr(self.request, "tenant", None)
        if tenant and not Branch.objects.filter(tenant=tenant).exists():
            Branch.objects.create(
                tenant=tenant,
                name="Siège Principal",
                address=tenant.address or "",
                wilaya=tenant.wilaya or "",
                phone=tenant.phone or "",
                is_headquarters=True,
                is_active=True,
            )
        return Branch.objects.filter(tenant=tenant) if tenant else Branch.objects.none()

    def perform_create(self, serializer):
        self.require_manager()
        from apps.core.plan_permissions import check_quota
        check_quota(self.request, "branches", Branch.objects.filter(tenant=self.request.tenant).count())
        serializer.save(tenant=self.request.tenant)

    def perform_update(self, serializer):
        self.require_manager()
        serializer.save()

    def perform_destroy(self, instance):
        self.require_owner()
        instance.delete()


class AuditLogViewSet(TenantScopedViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """Read-only audit trail — owner only."""
    queryset = AuditLog.objects.all()
    serializer_class = AuditLogSerializer
    ordering = ["-timestamp"]
    filterset_fields = ["action", "model_name", "user"]

    def get_queryset(self):
        self.require_owner()
        qs = AuditLog.objects.filter(tenant=self.request.tenant).select_related("user")
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(timestamp__date__gte=date_from)
        if date_to:
            qs = qs.filter(timestamp__date__lte=date_to)
        return qs

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


class TenantSettingsView(TenantScopedViewSetMixin, viewsets.GenericViewSet):
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


class StoreSettingsView(TenantScopedViewSetMixin, viewsets.GenericViewSet):
    """Store settings (Owner only)."""
    serializer_class = StoreSettingsSerializer
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=["get"])
    def current(self, request):
        settings_obj, _ = StoreSettings.objects.get_or_create(tenant=request.tenant)
        return Response(StoreSettingsSerializer(settings_obj).data)

    @action(detail=False, methods=["patch"])
    def update_settings(self, request):
        from apps.core.models import RoleChoices
        from rest_framework.exceptions import PermissionDenied
        if request.user.role != RoleChoices.OWNER:
            raise PermissionDenied("Only the owner can change store settings.")
        settings_obj, _ = StoreSettings.objects.get_or_create(tenant=request.tenant)
        serializer = StoreSettingsSerializer(settings_obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class PasswordResetRequestView(APIView):
    """Request a password-reset email. No authentication required."""
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        raw_identifier = (
            request.data.get("identifier")
            or request.data.get("email")
            or request.data.get("phone")
            or ""
        ).strip()
        _RESPONSE = Response(
            {"detail": "Si ce compte existe et dispose d'une adresse email, un lien de réinitialisation a été envoyé."}
        )
        if not raw_identifier:
            return _RESPONSE

        user = None
        if "@" in raw_identifier:
            try:
                user = User.objects.get(email__iexact=raw_identifier)
            except User.DoesNotExist:
                return _RESPONSE
        else:
            from django.db.models import Q
            from apps.core.utils.phone import normalize_algerian_phone
            normalized = normalize_algerian_phone(raw_identifier)
            if normalized:
                user = User.objects.filter(
                    Q(phone=normalized) | Q(phone=raw_identifier)
                ).first()
            if not user:
                return _RESPONSE

        if not user.email:
            return Response(
                {
                    "error": "Compte sans adresse email associée. Contactez le gérant de votre boutique pour réinitialiser votre mot de passe.",
                    "code": "no_email",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        token = PasswordResetTokenGenerator().make_token(user)
        uid = urlsafe_base64_encode(force_bytes(user.pk))

        from apps.core.tasks import send_password_reset_email
        from apps.core.utils.task_runner import run_task
        run_task(send_password_reset_email, user.pk, uid, token)

        return Response(
            {
                "detail": "Un lien de réinitialisation a été envoyé à l'adresse email associée à ce compte.",
                "has_email": True,
            }
        )


class PasswordResetConfirmView(APIView):
    """Confirm password reset with uid + token. No authentication required."""
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        uid = request.data.get("uid", "")
        token = request.data.get("token", "")
        new_password = request.data.get("new_password", "")
        confirm_password = request.data.get("confirm_password", "")

        if len(new_password) < 8:
            return Response(
                {"error": "Le mot de passe doit contenir au moins 8 caractères."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if new_password != confirm_password:
            return Response(
                {"error": "Les mots de passe ne correspondent pas."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            user_pk = force_str(urlsafe_base64_decode(uid))
            user = User.objects.get(pk=user_pk)
        except (User.DoesNotExist, Exception):
            return Response(
                {"error": "Lien invalide."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not PasswordResetTokenGenerator().check_token(user, token):
            return Response(
                {"error": "Ce lien est expiré ou invalide."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(new_password)
        user.save()
        return Response({"detail": "Mot de passe réinitialisé avec succès."})


from django.apps import apps
from django.db import transaction
from django.conf import settings

class SyncReceiverView(APIView):
    """
    Endpoint for receiving offline synchronization events from local nodes.
    Uses Last-Write-Wins (LWW) conflict resolution based on updated_at.

    NOTE: Route disabled in apps/core/urls.py pending cloud-backup design (Task 3.2).
    Also guarded below to strictly reject when NODE_API_KEY is unset or key does not match.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        # 1. Simple shared secret authentication
        expected_key = getattr(settings, "NODE_API_KEY", "")
        provided_key = request.headers.get("Authorization", "").replace("Bearer ", "")
        
        if not expected_key or provided_key != expected_key:
            return Response({"error": "Unauthorized node"}, status=status.HTTP_401_UNAUTHORIZED)
            
        events = request.data.get("events", [])
        processed = 0
        
        with transaction.atomic():
            for event in events:
                model_name = event.get("model_name")
                object_id = event.get("object_id")
                action = event.get("action")
                payload = event.get("payload", {})
                
                if not all([model_name, object_id, action]):
                    continue
                    
                try:
                    app_label, model_name_str = model_name.split(".")
                    ModelClass = apps.get_model(app_label, model_name_str)
                except Exception:
                    continue  # Skip unknown models
                    
                if action == "DELETE":
                    ModelClass.objects.filter(pk=object_id).delete()
                    processed += 1
                else:
                    # CREATE or UPDATE
                    try:
                        instance = ModelClass.objects.get(pk=object_id)
                        
                        # Last-Write-Wins check
                        if "updated_at" in payload and hasattr(instance, "updated_at"):
                            incoming_date = payload["updated_at"]
                            if instance.updated_at and str(instance.updated_at.isoformat()) >= str(incoming_date):
                                continue  # Cloud has newer data, ignore
                                
                    except ModelClass.DoesNotExist:
                        instance = ModelClass()
                        
                    # Apply payload
                    for key, value in payload.items():
                        try:
                            field = ModelClass._meta.get_field(key)
                            if field.is_relation and field.many_to_one:
                                setattr(instance, f"{key}_id", value)
                            else:
                                setattr(instance, key, value)
                        except Exception:
                            # Skip unknown fields
                            pass
                            
                    instance.save()
                    processed += 1
                    
        return Response({"status": "ok", "processed": processed})

import tempfile
import zipfile
import shutil
import os
import logging
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.translation import gettext as _
from rest_framework import serializers as drf_serializers
from apps.core.services.legacy_dbf import LegacyDBFImporter
from rest_framework.parsers import MultiPartParser

logger = logging.getLogger(__name__)


def _parse_strict_bool(raw_value, default=False) -> bool:
    if raw_value is None or raw_value == "":
        return default
    return bool(drf_serializers.BooleanField().to_internal_value(raw_value))


class LegacyDBFImportView(APIView):
    """
    Import DBF files via a ZIP upload. (Managers and Owners only).
    Supports dry_run=true (in form data, options JSON, or query params) to preview counts,
    totals, and warnings inside a transaction that is rolled back before returning.
    """
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]

    def post(self, request):
        from apps.core.models import RoleChoices
        if request.user.role not in [RoleChoices.OWNER, RoleChoices.MANAGER]:
            return Response({"error": _("Accès non autorisé.")}, status=status.HTTP_403_FORBIDDEN)
            
        request.tenant = getattr(request.user, "tenant", None)
        if not request.tenant:
            return Response({"error": _("Aucun magasin associé à cet utilisateur.")}, status=status.HTTP_400_BAD_REQUEST)
            
        zip_file = request.FILES.get("zip_file")
        if not zip_file:
            return Response({"error": _("Aucun fichier ZIP fourni dans le champ 'zip_file'.")}, status=status.HTTP_400_BAD_REQUEST)
            
        branch_id = request.data.get("branch_id")
        if branch_id:
            try:
                branch = Branch.objects.get(id=branch_id, tenant=request.tenant)
            except (ValueError, DjangoValidationError, Branch.DoesNotExist):
                return Response({"error": _("Identifiant de succursale invalide.")}, status=status.HTTP_400_BAD_REQUEST)
        else:
            branch = Branch.objects.filter(tenant=request.tenant).first()
            
        temp_dir = tempfile.mkdtemp()
        
        import json
        options = {}
        options_data = request.data.get("options")
        if options_data:
            if isinstance(options_data, dict):
                options = dict(options_data)
            else:
                try:
                    options = json.loads(options_data)
                except Exception:
                    pass

        raw_dry_run = request.data.get("dry_run")
        if raw_dry_run is None:
            raw_dry_run = request.query_params.get("dry_run")
        if raw_dry_run is None and isinstance(options, dict):
            raw_dry_run = options.get("dry_run")

        try:
            dry_run = _parse_strict_bool(raw_dry_run, default=False)
        except (drf_serializers.ValidationError, ValueError, TypeError):
            return Response(
                {"error": _("Valeur invalide pour le paramètre 'dry_run'.")},
                status=status.HTTP_400_BAD_REQUEST,
            )
                
        try:
            # Save uploaded zip
            zip_path = os.path.join(temp_dir, "upload.zip")
            with open(zip_path, "wb+") as dest:
                for chunk in zip_file.chunks():
                    dest.write(chunk)
                    
            # Extract
            with zipfile.ZipFile(zip_path, "r") as zip_ref:
                zip_ref.extractall(temp_dir)
                
            importer = LegacyDBFImporter(
                path=temp_dir,
                tenant=request.tenant,
                branch=branch,
                logger=None,
                options=options,
                dry_run=dry_run,
            )
            stats = importer.execute_import(dry_run=dry_run)
            
            return Response({
                "message": _("Simulation terminée") if dry_run else _("Importation terminée"),
                "dry_run": dry_run,
                "stats": stats,
            })
        except zipfile.BadZipFile:
            return Response(
                {"error": _("Le fichier fourni n'est pas une archive ZIP valide.")},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception:
            logger.exception("Legacy DBF import failed")
            return Response(
                {"error": _("Une erreur est survenue lors de l'importation des fichiers DBF.")},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        finally:
            shutil.rmtree(temp_dir)


class SystemTimeView(APIView):
    """
    GET /api/v1/core/time/
    Returns verified time, clock skew, network sync source, and anomaly diagnostics.
    Query ?resync=true forces fresh network check.
    """
    permission_classes = [AllowAny]

    def get(self, request):
        from apps.core.services.time_service import sync_time
        force_resync = request.query_params.get("resync", "").lower() in ("1", "true", "yes")
        status_data = sync_time(force=force_resync)
        return Response(status_data)


class QuickSearchView(APIView):
    """
    GET /api/v1/core/quick-search/?q=...
    Multi-entity quick search across Products, Clients, Suppliers, and Invoices.
    Offline-first, scoped to request.tenant, returns compact results for command palette.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        query = request.query_params.get("q", "").strip()
        if len(query) < 2:
            return Response({"products": [], "clients": [], "suppliers": [], "invoices": []})

        tenant = getattr(request, "tenant", None) or getattr(request.user, "tenant", None)
        if not tenant:
            return Response({"products": [], "clients": [], "suppliers": [], "invoices": []})

        role = getattr(request.user, "role", "cashier")

        from uuid import UUID

        from django.db.models import Prefetch, Q

        from apps.core.plan_permissions import PLAN_RANK
        from apps.inventory.models import Product, ProductLocation, Variant
        from apps.clients.models import Client
        from apps.suppliers.models import Supplier
        from apps.invoicing.models import Invoice

        branch_id = request.query_params.get("branch_id")
        try:
            branch_id = UUID(branch_id) if branch_id else None
        except (TypeError, ValueError, AttributeError):
            branch_id = None

        active_branch = None
        if branch_id:
            active_branch = Branch.objects.filter(
                tenant=tenant,
                pk=branch_id,
                is_active=True,
            ).only("pk").first()

        location_qs = ProductLocation.objects.filter(tenant=tenant)
        if active_branch:
            location_qs = location_qs.filter(branch=active_branch)
        else:
            location_qs = location_qs.none()

        active_variant_qs = Variant.objects.filter(tenant=tenant, is_active=True)

        # 1. Products
        prod_qs = (
            Product.objects.filter(tenant=tenant, is_active=True)
            .filter(
                Q(name__icontains=query)
                | Q(reference__icontains=query)
                | Q(brand__icontains=query)
                | Q(
                    variants__barcode__icontains=query,
                    variants__is_active=True,
                    variants__tenant=tenant,
                )
            )
            .distinct()
            .prefetch_related(
                Prefetch(
                    "branch_locations",
                    queryset=location_qs,
                    to_attr="quick_search_locations",
                ),
                Prefetch(
                    "variants",
                    queryset=active_variant_qs,
                    to_attr="quick_search_variants",
                ),
            )[:6]
        )
        products = []
        for p in prod_qs:
            locations = p.quick_search_locations
            loc = locations[0] if locations else None
            loc_str = loc.location if loc else ""
            if loc_str and getattr(p, "size_range", ""):
                full_loc = f"{loc_str} ({p.size_range})"
            elif loc_str:
                full_loc = loc_str
            elif getattr(p, "size_range", ""):
                full_loc = f"({p.size_range})"
            else:
                full_loc = ""

            total_stock = sum(v.stock_qty for v in p.quick_search_variants)
            products.append({
                "id": p.id,
                "name": p.name,
                "reference": p.reference or "",
                "brand": p.brand or "",
                "sale_price": str(p.sale_price),
                "location": full_loc,
                "stock_qty": total_stock,
            })

        # 2. Clients
        client_qs = (
            Client.objects.filter(tenant=tenant, is_active=True)
            .filter(
                Q(name__icontains=query)
                | Q(phone__icontains=query)
                | Q(nif__icontains=query)
                | Q(rc__icontains=query)
            )[:6]
        )
        clients = [
            {
                "id": str(c.id),
                "name": c.name,
                "phone": c.phone or "",
                "wilaya": c.wilaya or "",
                "price_tier": c.price_tier,
                "outstanding_balance": str(c.cached_balance),
            }
            for c in client_qs
        ]

        # 3. Suppliers (Owner and Manager only)
        suppliers = []
        if role in ("owner", "manager"):
            sup_qs = (
                Supplier.objects.filter(tenant=tenant, is_active=True)
                .filter(Q(name__icontains=query) | Q(phone__icontains=query))[:5]
            )
            suppliers = [
                {
                    "id": s.id,
                    "name": s.name,
                    "phone": s.phone or "",
                    "outstanding_balance": str(s.outstanding_balance),
                }
                for s in sup_qs
            ]

        # 4. Invoices
        invoices = []
        plan = getattr(tenant, "plan", "free") or "free"
        if PLAN_RANK.get(plan, 0) >= PLAN_RANK["pro_wholesale"]:
            invoice_qs = (
                Invoice.objects.filter(tenant=tenant)
                .filter(
                    Q(number__icontains=query)
                    | Q(client__name__icontains=query)
                )
                .select_related("client")[:6]
            )
            invoices = [
                {
                    "id": str(inv.id),
                    "number": inv.number,
                    "client_name": inv.client.name if inv.client else "",
                    "total_ttc": str(inv.total_ttc),
                    "status": inv.status,
                    "date": str(inv.date),
                }
                for inv in invoice_qs
            ]

        return Response({
            "products": products,
            "clients": clients,
            "suppliers": suppliers,
            "invoices": invoices,
        })

