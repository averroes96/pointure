"""
WeasyPrint PDF rendering for invoices, delivery notes, and credit notes.
All templates support both LTR (French) and RTL (Arabic) via the `dir` context var.

Dependency note:
  weasyprint==62.3 requires pydyf==0.8.0.  pydyf 0.9+ removed Stream.transform()
  which WeasyPrint 62.3 still calls, causing AttributeError at render time.
  requirements.txt pins pydyf==0.8.0 to prevent auto-upgrade.
"""
import logging

from django.template.loader import render_to_string
from django.utils import translation

logger = logging.getLogger(__name__)


def render_to_pdf(template_name: str, context: dict, language: str = "fr") -> bytes:
    """
    Render a Django template to PDF bytes using WeasyPrint.
    Activates the given language for template rendering.
    """
    try:
        from weasyprint import HTML
    except ImportError:
        logger.warning("WeasyPrint not installed — returning empty PDF placeholder.")
        return b"%PDF-1.0 placeholder"

    # Activate language for this render
    with translation.override(language):
        context["lang"] = language
        context["dir"] = "rtl" if language == "ar" else "ltr"
        html_string = render_to_string(template_name, context)

    # base_url="." lets WeasyPrint resolve any relative URLs in the template
    # (e.g. static file paths).  No custom FontConfiguration is needed here
    # because we are not loading external font files — the container uses
    # whatever system fonts are available (DejaVu / Liberation / Helvetica).
    # Previously we had @font-face rules for Noto Naskh Arabic / Noto Sans
    # with src: local(...) but those fonts are NOT installed in the slim
    # Docker image, which produced "Font-face cannot be loaded" warnings on
    # every request.
    html = HTML(string=html_string, base_url=".")
    pdf_bytes = html.write_pdf()
    return pdf_bytes


def render_invoice_pdf(invoice, language: str = "fr") -> bytes:
    context = {
        "invoice": invoice,
        "lines": list(invoice.lines.select_related("variant__product")),
        "tenant": invoice.tenant,
        "client": invoice.client,
        "branch": invoice.branch,
    }
    return render_to_pdf("pdf/invoice.html", context, language)


def render_delivery_note_pdf(delivery_note, language: str = "fr") -> bytes:
    context = {
        "dn": delivery_note,
        "invoice": delivery_note.invoice,
        "tenant": delivery_note.invoice.tenant,
        "lines": list(delivery_note.invoice.lines.select_related("variant__product")),
    }
    return render_to_pdf("pdf/delivery_note.html", context, language)


def render_credit_note_pdf(credit_note, language: str = "fr") -> bytes:
    context = {
        "cn": credit_note,
        "invoice": credit_note.original_invoice,
        "tenant": credit_note.tenant,
    }
    return render_to_pdf("pdf/credit_note.html", context, language)


def render_supplier_invoice_pdf(supplier_invoice, language: str = "fr") -> bytes:
    from decimal import Decimal
    from django.db.models import Sum
    from django.db.models.functions import Coalesce

    amount_paid = supplier_invoice.payments.aggregate(
        t=Coalesce(Sum("amount"), Decimal("0"))
    )["t"]

    po_lines = []
    if supplier_invoice.purchase_order_id:
        po_lines = list(
            supplier_invoice.purchase_order.lines.select_related("variant__product")
        )

    context = {
        "invoice": supplier_invoice,
        "tenant": supplier_invoice.tenant,
        "supplier": supplier_invoice.supplier,
        "purchase_order": supplier_invoice.purchase_order,
        "po_lines": po_lines,
        "amount_paid": amount_paid,
        "balance_due": supplier_invoice.total_amount - amount_paid,
    }
    return render_to_pdf("pdf/supplier_invoice.html", context, language)
