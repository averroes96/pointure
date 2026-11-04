"""
Read-only audit command to detect clients affected by the pre-v1.6 double-credit bug
in ClientViewSet.record_payment (where a view-level reference_type="Payment" credit
was written alongside InvoicePayment credits for the same payment).

This command NEVER modifies data.
"""
from collections import defaultdict
from decimal import Decimal

from django.core.management.base import BaseCommand

from apps.clients.models import Client, ClientLedger


class Command(BaseCommand):
    help = (
        "Read-only audit of ClientLedger for overlapping 'Payment' and 'InvoicePayment' "
        "credit entries on the same client and date."
    )

    def handle(self, *args, **options):
        self.stdout.write("=== Audit Client Ledger (Read-Only) ===")

        credits = (
            ClientLedger.objects.filter(
                entry_type="credit",
                reference_type__in=["Payment", "InvoicePayment"],
            )
            .select_related("client", "client__tenant")
            .order_by("client_id", "date", "created_at")
        )

        by_client_date = defaultdict(lambda: {"payment": [], "invoice_payment": []})
        clients_by_id = {}

        for entry in credits:
            clients_by_id[entry.client_id] = entry.client
            key = (entry.client_id, entry.date)
            if entry.reference_type == "Payment":
                by_client_date[key]["payment"].append(entry)
            elif entry.reference_type == "InvoicePayment":
                by_client_date[key]["invoice_payment"].append(entry)

        affected_clients = set()
        overlap_count = 0
        total_suspected_duplicate = Decimal("0.00")

        for (client_id, entry_date), buckets in by_client_date.items():
            payment_entries = buckets["payment"]
            inv_payment_entries = buckets["invoice_payment"]
            if not payment_entries or not inv_payment_entries:
                continue

            sum_payment = sum((e.amount for e in payment_entries), Decimal("0.00"))
            sum_inv_payment = sum((e.amount for e in inv_payment_entries), Decimal("0.00"))
            suspected_dup = min(sum_payment, sum_inv_payment)
            if suspected_dup <= Decimal("0.00"):
                continue

            client = clients_by_id[client_id]
            affected_clients.add(client_id)
            overlap_count += 1
            total_suspected_duplicate += suspected_dup

            self.stdout.write(
                f"\n[OVERLAP] Client #{client.pk} '{client.name}' "
                f"(Tenant: {client.tenant.name}, Cached Balance: {client.cached_balance} DZD) "
                f"on {entry_date}:"
            )
            for p in payment_entries:
                self.stdout.write(
                    f"  - Payment credit        id={p.pk} amount={p.amount} DZD desc='{p.description}'"
                )
            for ip in inv_payment_entries:
                self.stdout.write(
                    f"  - InvoicePayment credit id={ip.pk} amount={ip.amount} DZD "
                    f"ref={ip.reference_id} desc='{ip.description}'"
                )
            self.stdout.write(
                f"  => Suspected duplicate credit on {entry_date}: {suspected_dup} DZD"
            )

        self.stdout.write("\n--- Summary ---")
        self.stdout.write(f"Affected clients: {len(affected_clients)}")
        self.stdout.write(f"Overlapping client-date groups: {overlap_count}")
        self.stdout.write(f"Total suspected duplicate credit: {total_suspected_duplicate} DZD")
        self.stdout.write("No data was modified.")

