from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import License, MachineActivation
from .serializers import ActivateRequestSerializer, HeartbeatRequestSerializer


def _license_success_payload(license_obj):
    """Build the success response body shared by activate and heartbeat."""
    return {
        "valid": True,
        "plan": license_obj.plan,
        "expires_at": (
            license_obj.expires_at.isoformat() if license_obj.expires_at else None
        ),
        "client_name": license_obj.client_name,
    }


class ActivateView(APIView):
    """
    POST /api/activate/

    Validates the license key, checks machine limits, then registers (or
    re-registers) the machine and returns the license details.
    """

    authentication_classes = []
    permission_classes = []

    def post(self, request):
        serializer = ActivateRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {"valid": False, "error": "bad_request", "details": serializer.errors},
                status=status.HTTP_400_BAD_REQUEST,
            )

        data = serializer.validated_data
        license_key = data["license_key"]
        machine_id = data["machine_id"]
        hostname = data["hostname"]
        app_version = data["app_version"]

        # 1. Lookup
        try:
            lic = License.objects.get(key=license_key)
        except License.DoesNotExist:
            return Response(
                {"valid": False, "error": "invalid_key"},
                status=status.HTTP_200_OK,
            )

        # 2. Status checks
        if lic.status == "suspended":
            return Response(
                {"valid": False, "error": "suspended"},
                status=status.HTTP_200_OK,
            )

        if lic.is_expired():
            return Response(
                {"valid": False, "error": "expired"},
                status=status.HTTP_200_OK,
            )

        # 3. Machine activation
        existing = lic.activations.filter(machine_id=machine_id).first()

        if existing is None:
            # New machine — check slot availability
            active_count = lic.activations.filter(is_active=True).count()
            if active_count >= lic.max_machines:
                return Response(
                    {"valid": False, "error": "machine_limit_exceeded"},
                    status=status.HTTP_200_OK,
                )
            MachineActivation.objects.create(
                license=lic,
                machine_id=machine_id,
                hostname=hostname,
                app_version=app_version,
                is_active=True,
            )
        else:
            # Existing machine — re-activate and refresh details
            existing.hostname = hostname or existing.hostname
            existing.app_version = app_version or existing.app_version
            existing.is_active = True
            existing.save()

        return Response(_license_success_payload(lic), status=status.HTTP_200_OK)


class HeartbeatView(APIView):
    """
    POST /api/heartbeat/

    Updates last_heartbeat for an already-activated machine and returns
    the current license status.  If the machine is not found the client
    should re-activate.
    """

    authentication_classes = []
    permission_classes = []

    def post(self, request):
        serializer = HeartbeatRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {"valid": False, "error": "bad_request", "details": serializer.errors},
                status=status.HTTP_400_BAD_REQUEST,
            )

        data = serializer.validated_data
        license_key = data["license_key"]
        machine_id = data["machine_id"]
        app_version = data["app_version"]

        # 1. Lookup license
        try:
            lic = License.objects.get(key=license_key)
        except License.DoesNotExist:
            return Response(
                {"valid": False, "error": "invalid_key"},
                status=status.HTTP_200_OK,
            )

        # 2. Status checks
        if lic.status == "suspended":
            return Response(
                {"valid": False, "error": "suspended"},
                status=status.HTTP_200_OK,
            )

        if lic.is_expired():
            return Response(
                {"valid": False, "error": "expired"},
                status=status.HTTP_200_OK,
            )

        # 3. Update heartbeat — machine must already be registered
        try:
            activation = lic.activations.get(machine_id=machine_id)
        except MachineActivation.DoesNotExist:
            # Machine not registered; tell client to re-activate
            return Response(
                {"valid": False, "error": "not_activated"},
                status=status.HTTP_200_OK,
            )

        if app_version:
            activation.app_version = app_version
        # last_heartbeat is auto_now so we just save
        activation.save()

        return Response(_license_success_payload(lic), status=status.HTTP_200_OK)


class VersionView(APIView):
    """
    GET /api/version/

    Returns the current and minimum required app version.
    """

    authentication_classes = []
    permission_classes = []

    def get(self, request):
        version = getattr(settings, "CURRENT_APP_VERSION", "1.0.0")
        return Response(
            {
                "latest": version,
                "minimum": version,
                "changelog_url": "https://github.com/averroes96/pointure/releases",
            },
            status=status.HTTP_200_OK,
        )
