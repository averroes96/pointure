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
        from apps.core.desktop.pdf_client import is_placeholder_pdf
        if not is_placeholder_pdf(pdf_content):
            filename = f"invoices/pdf/invoice-{invoice.number or invoice.pk}.pdf"
            from django.core.files.base import ContentFile
            invoice.pdf_file.save(filename, ContentFile(pdf_content), save=False)
            Invoice.objects.filter(pk=invoice.pk).update(pdf_file=invoice.pdf_file.name)
            logger.info(f"PDF generated for invoice {invoice.pk}: {filename}")
            return {"status": "success", "invoice_id": invoice_id, "filename": filename}
        else:
            logger.warning(f"PDF generation resulted in placeholder for invoice {invoice.pk}, not saving to pdf_file.")
            return {"status": "placeholder", "invoice_id": invoice_id}

    except Exception as exc:
        logger.error(f"PDF generation failed for invoice {invoice_id}: {exc}")
        from django.conf import settings
        if getattr(settings, "DESKTOP_MODE", False) or getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False):
            return {"status": "error", "invoice_id": invoice_id, "error": str(exc)}
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
        from apps.core.desktop.pdf_client import is_placeholder_pdf
        if not is_placeholder_pdf(pdf_content):
            filename = f"delivery_notes/pdf/bl-{dn.number}.pdf"
            from django.core.files.base import ContentFile
            dn.pdf_file.save(filename, ContentFile(pdf_content), save=False)
            DeliveryNote.objects.filter(pk=dn.pk).update(pdf_file=dn.pdf_file.name)
            return {"status": "success", "delivery_note_id": delivery_note_id}
        else:
            logger.warning(f"Delivery note PDF resulted in placeholder for {delivery_note_id}, not saving.")
            return {"status": "placeholder", "delivery_note_id": delivery_note_id}

    except Exception as exc:
        logger.error(f"Delivery note PDF failed {delivery_note_id}: {exc}")
        from django.conf import settings
        if getattr(settings, "DESKTOP_MODE", False) or getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False):
            return {"status": "error", "delivery_note_id": delivery_note_id, "error": str(exc)}
        raise self.retry(exc=exc, countdown=60)


@shared_task(bind=True, queue="pdf")
def generate_quote_pdf(self, quote_id):
    """Render a quote/proforma to PDF."""
    try:
        from apps.invoicing.models import Quote
        from apps.invoicing.pdf import render_quote_pdf

        quote = Quote.objects.select_related(
            "client", "branch", "tenant", "created_by"
        ).prefetch_related("lines__variant__product").get(pk=quote_id)

        pdf_content = render_quote_pdf(quote)
        from apps.core.desktop.pdf_client import is_placeholder_pdf
        if not is_placeholder_pdf(pdf_content):
            filename = f"quotes/pdf/quote-{quote.number or quote.pk}.pdf"
            from django.core.files.base import ContentFile
            quote.pdf_file.save(filename, ContentFile(pdf_content), save=False)
            Quote.objects.filter(pk=quote.pk).update(pdf_file=quote.pdf_file.name)
            logger.info(f"PDF generated for quote {quote.pk}: {filename}")
            return {"status": "success", "quote_id": str(quote_id), "filename": filename}
        else:
            logger.warning(f"Quote PDF resulted in placeholder for {quote_id}, not saving.")
            return {"status": "placeholder", "quote_id": str(quote_id)}

    except Exception as exc:
        logger.error(f"Quote PDF failed {quote_id}: {exc}")
        from django.conf import settings
        if getattr(settings, "DESKTOP_MODE", False) or getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False):
            return {"status": "error", "quote_id": str(quote_id), "error": str(exc)}
        raise self.retry(exc=exc, countdown=60)


@shared_task
def expire_outdated_quotes():
    """Mark quotes whose valid_until date has passed as expired."""
    from django.utils import timezone
    from apps.invoicing.models import Quote, QuoteStatusChoices
    today = timezone.localdate()
    updated_count = Quote.objects.filter(
        status__in=[QuoteStatusChoices.DRAFT, QuoteStatusChoices.SENT],
        valid_until__lt=today,
    ).update(status=QuoteStatusChoices.EXPIRED)
    if updated_count:
        logger.info(f"Marked {updated_count} outdated quotes as expired.")
    return updated_count

