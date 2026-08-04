"""
Import API Views for ShoeDZ.
Provides endpoints for downloading localized templates, parsing uploads,
dry-run validation previews, and batch import execution.
"""
import json
from django.http import HttpResponse
from rest_framework import status
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.models import Branch, RoleChoices
from apps.core.services.importer import (
    DataImportEngine,
    auto_map_columns,
    parse_file_data,
)


from rest_framework.renderers import BaseRenderer, JSONRenderer


class BinaryPassthroughRenderer(BaseRenderer):
    media_type = "*/*"
    format = ""

    def render(self, data, accepted_media_type=None, renderer_context=None):
        return data


class BaseImportView(APIView):
    permission_classes = [IsAuthenticated]

    def check_manager_permission(self, request):
        if request.user.role not in [RoleChoices.OWNER, RoleChoices.MANAGER]:
            return Response(
                {"detail": "Seuls les gérants et administrateurs peuvent importer des données."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return None

    def get_tenant(self, request):
        return getattr(request.user, "tenant", None)

    def get_branch(self, request, tenant):
        branch_id = request.data.get("branch_id") or request.query_params.get("branch_id")
        if branch_id:
            try:
                return Branch.objects.get(id=int(branch_id), tenant=tenant)
            except (ValueError, Branch.DoesNotExist):
                pass
        return Branch.objects.filter(tenant=tenant).first()


class ImportTemplateView(BaseImportView):
    """
    GET /api/v1/core/import/template/?entity=products&format=xlsx&lang=fr
    Download pre-filled, styled template with headers and sample data in French, English, or Arabic.
    """
    renderer_classes = [BinaryPassthroughRenderer, JSONRenderer]

    def perform_content_negotiation(self, request, force=False):
        renderers = self.get_renderers()
        return (renderers[0], renderers[0].media_type)

    def get(self, request):
        perm_err = self.check_manager_permission(request)
        if perm_err:
            return perm_err

        entity = request.query_params.get("entity", "products").lower()
        if entity not in ["products", "suppliers", "clients"]:
            entity = "products"

        file_format = request.query_params.get("format", "xlsx").lower()
        lang = request.query_params.get("lang", "fr").lower()

        content_bytes, content_type, filename = DataImportEngine.generate_template(
            entity_type=entity,
            file_format=file_format,
            lang=lang,
        )

        response = HttpResponse(content_bytes, content_type=content_type)
        # Encode filename properly for non-ASCII (Arabic/accents)
        from urllib.parse import quote
        encoded_filename = quote(filename)
        response["Content-Disposition"] = f"attachment; filename=\"{filename}\"; filename*=UTF-8''{encoded_filename}"
        return response


class ImportParseView(BaseImportView):
    """
    POST /api/v1/core/import/parse/
    Multipart upload. Parses file headers and initial rows, and suggests column mappings.
    """
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        perm_err = self.check_manager_permission(request)
        if perm_err:
            return perm_err

        entity = request.data.get("entity", "products").lower()
        if entity not in ["products", "suppliers", "clients"]:
            entity = "products"

        file_obj = request.FILES.get("file")
        if not file_obj:
            return Response({"detail": "Aucun fichier fourni dans le champ 'file'."}, status=status.HTTP_400_BAD_REQUEST)

        raw_bytes = file_obj.read()
        headers, rows, error = parse_file_data(raw_bytes, file_obj.name)
        if error:
            return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)

        auto_mapping = auto_map_columns(headers, entity)

        return Response({
            "filename": file_obj.name,
            "total_rows": len(rows),
            "headers": headers,
            "auto_mapping": auto_mapping,
            "sample_rows": rows[:10],
        })


class ImportPreviewView(BaseImportView):
    """
    POST /api/v1/core/import/preview/
    Accepts file upload OR JSON rows + column mapping.
    Performs full dry-run validation against DB duplicates, shoe sizes, and data schemas.
    """
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request):
        perm_err = self.check_manager_permission(request)
        if perm_err:
            return perm_err

        tenant = self.get_tenant(request)
        if not tenant:
            return Response({"detail": "Aucune entreprise associée."}, status=status.HTTP_400_BAD_REQUEST)

        entity = request.data.get("entity", "products").lower()
        if entity not in ["products", "suppliers", "clients"]:
            entity = "products"

        duplicate_mode = request.data.get("duplicate_mode", "skip").lower()
        branch = self.get_branch(request, tenant)

        # Parse mapping
        raw_mapping = request.data.get("mapping")
        mapping = {}
        if isinstance(raw_mapping, str):
            try:
                mapping = json.loads(raw_mapping)
            except Exception:
                pass
        elif isinstance(raw_mapping, dict):
            mapping = raw_mapping

        file_obj = request.FILES.get("file")
        rows = []
        headers = []

        if file_obj:
            raw_bytes = file_obj.read()
            headers, rows, error = parse_file_data(raw_bytes, file_obj.name)
            if error:
                return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)
        else:
            rows = request.data.get("rows", [])
            headers = request.data.get("headers", [])

        if not rows:
            return Response({"detail": "Aucune donnée à prévisualiser."}, status=status.HTTP_400_BAD_REQUEST)

        # If mapping is empty, auto map
        if not mapping:
            mapping = auto_map_columns(headers, entity)

        engine = DataImportEngine(
            tenant=tenant,
            entity_type=entity,
            user=request.user,
            branch=branch,
            duplicate_mode=duplicate_mode,
        )

        preview_result = engine.validate_and_preview(headers, rows, mapping)
        return Response(preview_result)


class ImportExecuteView(BaseImportView):
    """
    POST /api/v1/core/import/execute/
    Executes the batch import and ledger movements with the chosen column mapping and conflict strategy.
    """
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request):
        perm_err = self.check_manager_permission(request)
        if perm_err:
            return perm_err

        tenant = self.get_tenant(request)
        if not tenant:
            return Response({"detail": "Aucune entreprise associée."}, status=status.HTTP_400_BAD_REQUEST)

        entity = request.data.get("entity", "products").lower()
        if entity not in ["products", "suppliers", "clients"]:
            entity = "products"

        duplicate_mode = request.data.get("duplicate_mode", "skip").lower()
        branch = self.get_branch(request, tenant)

        # Parse mapping
        raw_mapping = request.data.get("mapping")
        mapping = {}
        if isinstance(raw_mapping, str):
            try:
                mapping = json.loads(raw_mapping)
            except Exception:
                pass
        elif isinstance(raw_mapping, dict):
            mapping = raw_mapping

        file_obj = request.FILES.get("file")
        rows = []
        headers = []

        if file_obj:
            raw_bytes = file_obj.read()
            headers, rows, error = parse_file_data(raw_bytes, file_obj.name)
            if error:
                return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)
        else:
            rows = request.data.get("rows", [])
            headers = request.data.get("headers", [])

        if not rows:
            return Response({"detail": "Aucune ligne à importer."}, status=status.HTTP_400_BAD_REQUEST)

        if not mapping:
            mapping = auto_map_columns(headers, entity)

        engine = DataImportEngine(
            tenant=tenant,
            entity_type=entity,
            user=request.user,
            branch=branch,
            duplicate_mode=duplicate_mode,
        )

        result = engine.execute_import(rows, mapping)
        return Response(result)
