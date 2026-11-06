"""Views and ViewSets for Fiscal Year Closing (Tasks 6.1 - 6.5)."""
import io
import logging

from django.http import HttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.negotiation import DefaultContentNegotiation
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.closing.models import FiscalYear
from apps.closing.serializers import FiscalYearSerializer
from apps.closing.services.export_pack import (
    generate_fiscal_year_export_workbook,
    render_fiscal_year_summary_pdf,
)
from apps.core.permissions import IsManagerOrOwner
from apps.core.views import TenantScopedViewSetMixin

logger = logging.getLogger(__name__)


class IgnoreFormatContentNegotiation(DefaultContentNegotiation):
    """
    Allow custom binary downloads (?format=pdf, ?format=xlsx) without
    DRF's DefaultContentNegotiation trying to find a non-existent JSON renderer format.
    """
    def select_renderer(self, request, renderers, format_suffix=None):
        return renderers[0], renderers[0].media_type


class FiscalYearViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """
    Management closing viewset for fiscal years.
    Restricted to store owners and managers.
    Provides accountant export pack (.xlsx) and printable PDF summary.
    """
    queryset = FiscalYear.objects.all()
    serializer_class = FiscalYearSerializer
    permission_classes = [IsAuthenticated, IsManagerOrOwner]
    content_negotiation_class = IgnoreFormatContentNegotiation

    @action(detail=True, methods=["get"], url_path="export")
    def export(self, request, pk=None):
        """
        Export accountant pack: returns .xlsx workbook by default,
        or PDF summary if ?format=pdf is passed.
        """
        fiscal_year = self.get_object()
        fmt = request.query_params.get("format", "xlsx").lower()
        language = request.query_params.get("lang") or getattr(request, "LANGUAGE_CODE", "fr")
        if language not in ("fr", "ar", "en"):
            language = "fr"

        if fmt == "pdf":
            try:
                pdf_bytes = render_fiscal_year_summary_pdf(fiscal_year, language=language)
            except Exception as e:
                logger.exception("Failed to render fiscal year summary PDF: %s", e)
                return Response(
                    {"error": {"code": "pdf_render_failed", "message": str(e)}},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )
            response = HttpResponse(pdf_bytes, content_type="application/pdf")
            response["Content-Disposition"] = f'attachment; filename="synthese_exercice_{fiscal_year.year}.pdf"'
            return response

        # Default to Excel (.xlsx)
        try:
            wb = generate_fiscal_year_export_workbook(fiscal_year, language=language)
            bio = io.BytesIO()
            wb.save(bio)
            bio.seek(0)
            xlsx_bytes = bio.getvalue()
        except Exception as e:
            logger.exception("Failed to generate fiscal year export workbook: %s", e)
            return Response(
                {"error": {"code": "export_failed", "message": str(e)}},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        response = HttpResponse(
            xlsx_bytes,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="export_exercice_{fiscal_year.year}.xlsx"'
        return response

    @action(detail=True, methods=["get"], url_path="summary-pdf")
    def summary_pdf(self, request, pk=None):
        """
        Return printable 1-page PDF summary for the fiscal year.
        """
        fiscal_year = self.get_object()
        language = request.query_params.get("lang") or getattr(request, "LANGUAGE_CODE", "fr")
        if language not in ("fr", "ar", "en"):
            language = "fr"

        try:
            pdf_bytes = render_fiscal_year_summary_pdf(fiscal_year, language=language)
        except Exception as e:
            logger.exception("Failed to render fiscal year summary PDF: %s", e)
            return Response(
                {"error": {"code": "pdf_render_failed", "message": str(e)}},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'inline; filename="synthese_exercice_{fiscal_year.year}.pdf"'
        return response

