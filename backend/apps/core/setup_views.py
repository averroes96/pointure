"""
First-run setup wizard views.

These endpoints are intentionally unauthenticated — they are only active in
local/self-hosted mode and only when no tenant has been created yet.
"""
from django.conf import settings
from django.db import transaction
from rest_framework import status as http_status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.models import Tenant, User


class SetupStatusView(APIView):
    authentication_classes = []
    permission_classes = []
    throttle_classes = []  # health-check; never rate-limit

    def get(self, request):
        # Only relevant in local mode; in cloud mode setup is always "done"
        if getattr(settings, "DEPLOYMENT_MODE", "cloud") != "local":
            return Response({"needed": False})
        needed = not Tenant.objects.filter(is_active=True).exists()
        return Response({"needed": needed})


class SetupView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        if getattr(settings, "DEPLOYMENT_MODE", "cloud") != "local":
            return Response(
                {"error": "Setup uniquement disponible en mode local."},
                status=403,
            )

        if Tenant.objects.filter(is_active=True).exists():
            return Response(
                {"error": "L'application est déjà configurée."},
                status=403,
            )

        data = request.data
        business_name = (data.get("business_name") or "").strip()
        wilaya = (data.get("wilaya") or "").strip()
        address = (data.get("address") or "").strip()
        admin_phone = (data.get("admin_phone") or data.get("phone") or "").strip()
        store_phone = (data.get("store_phone") or data.get("phone") or admin_phone).strip()
        admin_email = (data.get("admin_email") or "").strip().lower()
        admin_password = data.get("admin_password", "")
        confirm_password = data.get("confirm_password", "")
        license_key = (data.get("license_key") or "").strip()
        business_mode = (data.get("business_mode") or "mixed").strip().lower()
        if business_mode not in ("retail", "wholesale", "mixed"):
            business_mode = "mixed"

        errors = {}
        if not business_name:
            errors["business_name"] = "Obligatoire."

        from apps.core.utils.phone import (
            is_valid_algerian_phone,
            normalize_algerian_phone,
            format_algerian_phone_display,
        )

        if not admin_phone:
            errors["admin_phone"] = "Numéro de téléphone obligatoire."
        elif not is_valid_algerian_phone(admin_phone):
            errors["admin_phone"] = "Numéro de téléphone algérien invalide (ex: 0555 12 34 56 ou +213 555 12 34 56)."
        else:
            admin_phone = normalize_algerian_phone(admin_phone)
            if User.objects.filter(phone=admin_phone).exists():
                errors["admin_phone"] = "Ce numéro de téléphone est déjà utilisé."

        if admin_email:
            from django.core.validators import validate_email
            from django.core.exceptions import ValidationError
            try:
                validate_email(admin_email)
                if User.objects.filter(email__iexact=admin_email).exists():
                    errors["admin_email"] = "Cette adresse email est déjà utilisée."
            except ValidationError:
                errors["admin_email"] = "Adresse email invalide."
        else:
            admin_email = None

        if len(admin_password) < 8:
            errors["admin_password"] = "Au moins 8 caractères."
        if admin_password != confirm_password:
            errors["confirm_password"] = "Les mots de passe ne correspondent pas."
        if errors:
            return Response(errors, status=400)

        initial_plan = "pro_retail" if business_mode == "retail" else "pro_wholesale"

        with transaction.atomic():
            tenant = Tenant.objects.create(
                name=business_name,
                wilaya=wilaya,
                phone=normalize_algerian_phone(store_phone) if store_phone else "",
                address=address,
                plan=initial_plan,
                is_active=True,
            )
            user = User(
                phone=admin_phone,
                email=admin_email,
                first_name="Admin",
                tenant=tenant,
                role="owner",
                is_active=True,
            )
            user.set_password(admin_password)
            user.save()

            # Create default headquarters branch
            from apps.core.models import Branch, StoreSettings
            Branch.objects.create(
                tenant=tenant,
                name="Siège Principal",
                address=address,
                wilaya=wilaya,
                phone=normalize_algerian_phone(store_phone) if store_phone else "",
                is_headquarters=True,
                is_active=True,
            )

            # Ensure default store settings exist with chosen business mode
            store_settings, _ = StoreSettings.objects.get_or_create(tenant=tenant)
            store_settings.business_mode = business_mode
            store_settings.save(update_fields=["business_mode"])

        # Activate license if provided (best-effort — failure must not block setup)
        if license_key:
            try:
                from datetime import timedelta

                from django.utils import timezone

                from apps.licensing import client as lic_client
                from apps.licensing.models import LicenseState

                result = lic_client.activate(license_key)
                if result.get("valid"):
                    state = LicenseState.get()
                    state.license_key = license_key
                    state.plan = result.get("plan", "")
                    state.client_name = result.get("client_name", "")
                    state.valid = True
                    state.last_check = timezone.now()
                    grace_days = getattr(settings, "LICENSE_GRACE_DAYS", 7)
                    state.grace_until = timezone.now() + timedelta(days=grace_days)
                    state.save()
            except Exception:
                pass

        # Issue JWT tokens for instant auto-login
        from rest_framework_simplejwt.tokens import RefreshToken
        refresh = RefreshToken.for_user(user)
        access_token = str(refresh.access_token)
        refresh_token = str(refresh)

        return Response(
            {
                "detail": "Installation terminée. Vous êtes maintenant connecté.",
                "access": access_token,
                "refresh": refresh_token,
                "business_mode": business_mode,
                "user": {
                    "id": user.id,
                    "phone": admin_phone,
                    "phone_display": format_algerian_phone_display(admin_phone),
                    "email": admin_email or "",
                    "first_name": user.first_name,
                    "role": user.role,
                },
                "phone": admin_phone,
                "phone_display": format_algerian_phone_display(admin_phone),
                "email": admin_email or "",
            },
            status=http_status.HTTP_201_CREATED,
        )
