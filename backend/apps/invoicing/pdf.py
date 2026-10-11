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
    Render a Django template to PDF bytes.
    In desktop mode, uses Chromium printToPDF bridge. Otherwise uses WeasyPrint.
    """
    # Activate language for this render
    with translation.override(language):
        context["lang"] = language
        context["dir"] = "rtl" if language == "ar" else "ltr"
        html_string = render_to_string(template_name, context)

    from django.conf import settings
    if getattr(settings, "DESKTOP_MODE", False):
        from apps.core.desktop.pdf_client import render_html_to_pdf
        return render_html_to_pdf(html_string)

    try:
        from weasyprint import HTML
    except ImportError:
        logger.warning("WeasyPrint not installed — returning empty PDF placeholder.")
        return b"%PDF-1.0 placeholder"

    html = HTML(string=html_string, base_url=".")
    pdf_bytes = html.write_pdf()
    return pdf_bytes


def group_lines_by_product(lines):
    groups = {}
    for line in lines:
        if getattr(line, "variant", None) and line.variant.product:
            key = f"prod_{line.variant.product.pk}"
            name = line.variant.product.name
        else:
            key = f"desc_{line.description}"
            name = line.description
            
        if key not in groups:
            groups[key] = {
                "name": name,
                "quantity": 0,
                "unit_price": getattr(line, "unit_price", getattr(line, "agreed_unit_price", 0)),
                "total_price": 0,
                "cartons": 0,
            }
        
        qty = getattr(line, "quantity", getattr(line, "quantity_ordered", 0))
        groups[key]["quantity"] += qty
        groups[key]["total_price"] += line.line_total
        
        c = getattr(line, "cartons", 0)
        ppc = getattr(line, "pairs_per_carton", 0)
        if c > groups[key]["cartons"]:
            groups[key]["cartons"] = c
        if ppc > getattr(groups[key], "pairs_per_carton", 0) or "pairs_per_carton" not in groups[key]:
            groups[key]["pairs_per_carton"] = ppc
            
    return list(groups.values())


def render_invoice_pdf(invoice, language: str = "fr") -> bytes:
    lines = list(invoice.lines.select_related("variant__product"))
    context = {
        "invoice": invoice,
        "grouped_lines": group_lines_by_product(lines),
        "tenant": invoice.tenant,
        "client": invoice.client,
        "branch": invoice.branch,
    }
    return render_to_pdf("pdf/invoice.html", context, language)


def render_delivery_note_pdf(delivery_note, language: str = "fr") -> bytes:
    lines = list(delivery_note.invoice.lines.select_related("variant__product")) if delivery_note.invoice else []
    context = {
        "dn": delivery_note,
        "invoice": delivery_note.invoice,
        "tenant": delivery_note.invoice.tenant if delivery_note.invoice else delivery_note.tenant,
        "grouped_lines": group_lines_by_product(lines),
    }
    return render_to_pdf("pdf/delivery_note.html", context, language)


def render_credit_note_pdf(credit_note, language: str = "fr") -> bytes:
    context = {
        "cn": credit_note,
        "invoice": credit_note.original_invoice,
        "tenant": credit_note.tenant,
    }
    return render_to_pdf("pdf/credit_note.html", context, language)


def render_purchase_order_pdf(purchase_order, language: str = "fr") -> bytes:
    lines = list(purchase_order.lines.select_related("variant__product"))
    context = {
        "po": purchase_order,
        "tenant": purchase_order.tenant,
        "supplier": purchase_order.supplier,
        "grouped_lines": group_lines_by_product(lines),
    }
    return render_to_pdf("pdf/purchase_order.html", context, language)


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
        "grouped_po_lines": group_lines_by_product(po_lines),
        "amount_paid": amount_paid,
        "balance_due": supplier_invoice.total_amount - amount_paid,
    }
    return render_to_pdf("pdf/supplier_invoice.html", context, language)


def render_return_claim_pdf(claim, language: str = "fr") -> bytes:
    items = list(claim.items.select_related("variant__product"))
    total_pairs = sum(item.quantity for item in items)
    context = {
        "claim": claim,
        "tenant": claim.tenant,
        "supplier": claim.supplier,
        "items": items,
        "total_pairs": total_pairs,
    }
    return render_to_pdf("pdf/return_claim.html", context, language)

