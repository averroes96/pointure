"""
Read-only audit command to detect clients affected by the pre-v1.6 double-credit bug
in ClientViewSet.record_payment (where a view-level reference_type="Payment" credit
was written alongside InvoicePayment credits for the same payment).

This command NEVER modifies data.
"""
import itertools
import re
from collections import defaultdict
from decimal import Decimal

from django.core.management.base import BaseCommand

from apps.clients.models import Client, ClientLedger


def _extract_invoice_number(description: str) -> str:
    """Extract invoice reference like 'FA-2026-00001' from description if present."""
    match = re.search(r"FA-[\w-]+", description or "")
    return match.group(0) if match else ""


def match_duplicate_credits(payment_entries, inv_payment_entries):
    """
    Match 'Payment' entries against 'InvoicePayment' entries for the same client and date
    based on reference number or matching amounts.
    
    Returns:
        matched_payments: list of Payment entries that are suspected duplicates
        matched_inv_payments: list of InvoicePayment entries corresponding to the duplicates
        total_suspected: Decimal total of suspected duplicate credits
    """
    available_inv = list(inv_payment_entries)
    matched_p = []
    matched_ip = []
    total_dup = Decimal("0.00")

    unmatched_p = []

    # Pass 1: Match by reference ID or invoice reference in description
    for p in payment_entries:
        p_ref = (p.reference_id or "").strip()
        p_inv = _extract_invoice_number(p.description)
        matched = False
        for ip in list(available_inv):
            ip_ref = (ip.reference_id or "").strip()
            ip_inv = _extract_invoice_number(ip.description)
            has_ref_match = (p_ref and p_ref == ip_ref) or (p_inv and ip_inv and p_inv == ip_inv)
            if has_ref_match:
                dup_amt = min(p.amount, ip.amount)
                matched_p.append(p)
                matched_ip.append(ip)
                total_dup += dup_amt
                available_inv.remove(ip)
                matched = True
                break
        if not matched:
            unmatched_p.append(p)

    # Pass 2: Match by exact amount
    still_unmatched_p = []
    for p in unmatched_p:
        matched = False
        for ip in list(available_inv):
            if ip.amount == p.amount:
                matched_p.append(p)
                matched_ip.append(ip)
                total_dup += p.amount
                available_inv.remove(ip)
                matched = True
                break
        if not matched:
            still_unmatched_p.append(p)

    # Pass 3: Compound match - single Payment equals sum of a subset of InvoicePayments (e.g. split payment across invoices)
    final_unmatched_p = []
    for p in still_unmatched_p:
        matched_subset = None
        max_k = min(len(available_inv), 6)
        for k in range(2, max_k + 1):
            for subset in itertools.combinations(available_inv, k):
                if sum((e.amount for e in subset), Decimal("0.00")) == p.amount:
                    matched_subset = subset
                    break
            if matched_subset:
                break

        if matched_subset:
            matched_p.append(p)
            for ip in matched_subset:
                matched_ip.append(ip)
                available_inv.remove(ip)
            total_dup += p.amount
        else:
            final_unmatched_p.append(p)

    # Pass 4: Sum match if remaining Payments sum equals remaining InvoicePayments sum
    if final_unmatched_p and available_inv:
        sum_p = sum((e.amount for e in final_unmatched_p), Decimal("0.00"))
        sum_ip = sum((e.amount for e in available_inv), Decimal("0.00"))
        if sum_p == sum_ip and sum_p > Decimal("0.00"):
            matched_p.extend(final_unmatched_p)
            matched_ip.extend(available_inv)
            total_dup += sum_p

    return matched_p, matched_ip, total_dup


class Command(BaseCommand):
    help = (
        "Read-only audit of ClientLedger for overlapping 'Payment' and 'InvoicePayment' "
        "credit entries matched by reference or amount on the same client and date."
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

            matched_p, matched_ip, suspected_dup = match_duplicate_credits(
                payment_entries, inv_payment_entries
            )
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
            for p in matched_p:
                self.stdout.write(
                    f"  - Payment credit        id={p.pk} amount={p.amount} DZD desc='{p.description}'"
                )
            for ip in matched_ip:
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

