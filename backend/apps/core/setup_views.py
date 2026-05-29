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
        phone = (data.get("phone") or "").strip()
        admin_email = (data.get("admin_email") or "").strip().lower()
        admin_password = data.get("admin_password", "")
        confirm_password = data.get("confirm_password", "")
        license_key = (data.get("license_key") or "").strip()

        errors = {}
        if not business_name:
            errors["business_name"] = "Obligatoire."
        if not admin_email or "@" not in admin_email:
            errors["admin_email"] = "Email invalide."
        if len(admin_password) < 8:
            errors["admin_password"] = "Au moins 8 caractères."
        if admin_password != confirm_password:
            errors["confirm_password"] = "Les mots de passe ne correspondent pas."
        if errors:
            return Response(errors, status=400)

        with transaction.atomic():
            tenant = Tenant.objects.create(
                name=business_name,
                wilaya=wilaya,
                phone=phone,
                plan="pro_retail",
                is_active=True,
            )
            user = User(
                email=admin_email,
                first_name="Admin",
                tenant=tenant,
                role="owner",
                is_active=True,
            )
            user.set_password(admin_password)
            user.save()

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

        return Response(
            {
                "detail": "Installation terminée. Vous pouvez maintenant vous connecter.",
                "email": admin_email,
            },
            status=http_status.HTTP_201_CREATED,
        )
