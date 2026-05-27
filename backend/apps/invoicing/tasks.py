"""Celery tasks for PDF generation."""
import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, queue="pdf", max_retries=3)
def generate_invoice_pdf(self, invoice_id: int):
    """
    Render an invoice to PDF via WeasyPrint and save to storage.
    Retries up to 3 times on failure.
    """
    try:
        from apps.invoicing.models import Invoice
        from apps.invoicing.pdf import render_invoice_pdf

        invoice = Invoice.objects.select_related(
            "client", "branch", "tenant", "created_by"
        ).prefetch_related("lines__variant__product").get(pk=invoice_id)

        pdf_content = render_invoice_pdf(invoice)

        filename = f"invoices/pdf/invoice-{invoice.number or invoice.pk}.pdf"

        from django.core.files.base import ContentFile
        invoice.pdf_file.save(filename, ContentFile(pdf_content), save=True)

        logger.info(f"PDF generated for invoice {invoice.pk}: {filename}")
        return {"status": "success", "invoice_id": invoice_id, "filename": filename}

    except Exception as exc:
        logger.error(f"PDF generation failed for invoice {invoice_id}: {exc}")
        raise self.retry(exc=exc, countdown=60)


@shared_task(bind=True, queue="pdf")
def generate_delivery_note_pdf(self, delivery_note_id: int):
    """Render a delivery note to PDF."""
    try:
        from apps.invoicing.models import DeliveryNote
        from apps.invoicing.pdf import render_delivery_note_pdf

        dn = DeliveryNote.objects.select_related("invoice__client", "invoice__tenant").get(
            pk=delivery_note_id
        )
        pdf_content = render_delivery_note_pdf(dn)
        filename = f"delivery_notes/pdf/bl-{dn.number}.pdf"

        from django.core.files.base import ContentFile
        dn.pdf_file.save(filename, ContentFile(pdf_content), save=True)

        return {"status": "success", "delivery_note_id": delivery_note_id}

    except Exception as exc:
        logger.error(f"Delivery note PDF failed {delivery_note_id}: {exc}")
        raise self.retry(exc=exc, countdown=60)
