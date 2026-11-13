"""
apps/clients/services/risk.py

Client risk scoring and classification engine.
Calculates client risk grade (A, B, C, D) based on:
1. Bounced cheques in the last 12 months.
2. Debt ageing buckets (0-30, 31-60, 61-90, 90+ days).
3. Average payment delay in settling formal invoices (InvoicePayment).
"""

from collections import defaultdict
from datetime import timedelta
from decimal import Decimal
from typing import Dict, List, Optional, Any

from django.db.models import Count, Max, Q, Sum
from django.utils import timezone

GRADE_A = "A"
GRADE_B = "B"
GRADE_C = "C"
GRADE_D = "D"

BOUNCED_CHEQUES_WINDOW_DAYS = 365
OVERDUE_DAYS_D = 90
OVERDUE_DAYS_C = 60
OVERDUE_DAYS_B = 30
AVG_DAYS_C = 60
AVG_DAYS_B = 30


def determine_grade(bounced_count: int, buckets: Dict[str, Decimal], avg_days: Optional[float]) -> str:
    """
    Determine risk grade based on bounded thresholds:
    - D: any bounced cheque in 12 months, or overdue debt older than 90 days.
    - C: overdue debt older than 60 days, or avg settlement delay > 60 days.
    - B: avg settlement delay > 30 days, or overdue debt older than 30 days.
    - A: otherwise (healthy account).
    """
    days_90_plus = buckets.get("days_90_plus", Decimal("0.00"))
    days_60 = buckets.get("days_60", Decimal("0.00"))
    days_30 = buckets.get("days_30", Decimal("0.00"))

    if bounced_count > 0 or days_90_plus > Decimal("0.00"):
        return GRADE_D
    if days_60 > Decimal("0.00") or (avg_days is not None and avg_days > AVG_DAYS_C):
        return GRADE_C
    if days_30 > Decimal("0.00") or (avg_days is not None and avg_days > AVG_DAYS_B):
        return GRADE_B
    return GRADE_A


def bulk_client_risk(clients: List[Any], today=None) -> Dict[Any, Dict[str, Any]]:
    """
    Compute risk profile for a list of clients in bulk without N+1 queries.
    Returns:
        dict mapping client_id -> {
            "grade": "A" | "B" | "C" | "D",
            "avg_days_to_pay": float | None,
            "overdue_amount": Decimal,
            "bounced_cheques_12m": int,
            "last_payment_date": date | None,
            "buckets": dict,
        }
    """
    from apps.clients.models import Cheque, ChequeDirectionChoices, ChequeStatusChoices, Client, ClientLedger, LedgerEntryTypeChoices
    from apps.invoicing.models import Invoice, InvoicePayment, InvoiceStatusChoices
    from apps.sales.models import Sale

    if not clients:
        return {}

    today = today or timezone.localdate()
    client_ids = [c.id if hasattr(c, "id") else c for c in clients]
    client_obj_map = {c.id: c for c in clients if hasattr(c, "id")}

    # Read latest cached_balance from DB to ensure in-memory freshness
    cached_bal_map = {
        row["id"]: row["cached_balance"]
        for row in Client.objects.filter(id__in=client_ids).values("id", "cached_balance")
    }

    # 1. Bounced cheques in last 12 months (receivable from clients)
    cutoff_12m = today - timedelta(days=BOUNCED_CHEQUES_WINDOW_DAYS)
    bounced_qs = (
        Cheque.objects.filter(
            client_id__in=client_ids,
            direction=ChequeDirectionChoices.RECEIVABLE,
            status=ChequeStatusChoices.BOUNCED,
            due_date__gte=cutoff_12m,
        )
        .values("client_id")
        .annotate(cnt=Count("id"))
    )
    bounced_map = {row["client_id"]: row["cnt"] for row in bounced_qs}

    # 2. Last payment date (from ClientLedger credits and InvoicePayment)
    ledger_last = (
        ClientLedger.objects.filter(
            client_id__in=client_ids,
            entry_type=LedgerEntryTypeChoices.CREDIT,
        )
        .values("client_id")
        .annotate(last_d=Max("date"))
    )
    last_pay_map = {row["client_id"]: row["last_d"] for row in ledger_last}

    inv_pay_last = (
        InvoicePayment.objects.filter(
            invoice__client_id__in=client_ids,
        )
        .values("invoice__client_id")
        .annotate(last_d=Max("date"))
    )
    for row in inv_pay_last:
        cid = row["invoice__client_id"]
        d = row["last_d"]
        if cid not in last_pay_map or (d and d > last_pay_map[cid]):
            last_pay_map[cid] = d

    # 3. Settled invoices & avg_days_to_pay
    paid_invoices = (
        Invoice.objects.filter(
            client_id__in=client_ids,
            status=InvoiceStatusChoices.PAID,
        )
        .values("id", "client_id", "date")
    )
    paid_inv_ids = [inv["id"] for inv in paid_invoices]
    inv_client_map = {inv["id"]: (inv["client_id"], inv["date"]) for inv in paid_invoices}

    client_days = defaultdict(list)
    if paid_inv_ids:
        latest_payments = (
            InvoicePayment.objects.filter(invoice_id__in=paid_inv_ids)
            .values("invoice_id")
            .annotate(settle_date=Max("date"))
        )
        for p in latest_payments:
            inv_info = inv_client_map.get(p["invoice_id"])
            if inv_info and inv_info[1] and p["settle_date"]:
                inv_date = inv_info[1]
                settle_date = p["settle_date"]
                days = max(0, (settle_date - inv_date).days)
                client_days[inv_info[0]].append(days)

    # 4. Ageing buckets for open debt
    client_buckets = defaultdict(lambda: {
        "current": Decimal("0.00"),
        "days_30": Decimal("0.00"),
        "days_60": Decimal("0.00"),
        "days_90_plus": Decimal("0.00"),
    })
    accounted_debts = defaultdict(lambda: Decimal("0.00"))

    # 4.1 Unpaid invoices
    unpaid_invoices = (
        Invoice.objects.filter(
            client_id__in=client_ids,
            status__in=[InvoiceStatusChoices.SENT, InvoiceStatusChoices.PARTIAL, InvoiceStatusChoices.OVERDUE],
        )
        .prefetch_related("payments")
    )
    for inv in unpaid_invoices:
        paid = sum((p.amount for p in inv.payments.all()), Decimal("0.00"))
        remaining = inv.total_ttc - paid
        if remaining <= Decimal("0.00"):
            continue
        due_date = inv.due_date or inv.date or today
        age_days = (today - due_date).days
        cid = inv.client_id
        if age_days <= 30:
            client_buckets[cid]["current"] += remaining
        elif age_days <= 60:
            client_buckets[cid]["days_30"] += remaining
        elif age_days <= 90:
            client_buckets[cid]["days_60"] += remaining
        else:
            client_buckets[cid]["days_90_plus"] += remaining
        accounted_debts[cid] += remaining

    # 4.2 Unpaid sales (partially_paid)
    unpaid_sales = (
        Sale.objects.filter(
            client_id__in=client_ids,
            status="partially_paid",
        )
        .prefetch_related("payments")
    )
    for sale in unpaid_sales:
        paid = sum((p.amount for p in sale.payments.all()), Decimal("0.00"))
        remaining = sale.total_amount - paid
        if remaining <= Decimal("0.00"):
            continue
        sale_date = sale.created_at.date()
        age_days = (today - sale_date).days
        cid = sale.client_id
        if age_days <= 30:
            client_buckets[cid]["current"] += remaining
        elif age_days <= 60:
            client_buckets[cid]["days_30"] += remaining
        elif age_days <= 90:
            client_buckets[cid]["days_60"] += remaining
        else:
            client_buckets[cid]["days_90_plus"] += remaining
        accounted_debts[cid] += remaining

    # 4.3 Unallocated ledger debit balance
    debit_entries = (
        ClientLedger.objects.filter(
            client_id__in=client_ids,
            entry_type=LedgerEntryTypeChoices.DEBIT,
        )
        .values("client_id")
        .annotate(last_d=Max("date"))
    )
    last_debit_map = {row["client_id"]: row["last_d"] for row in debit_entries}

    results = {}
    for cid in client_ids:
        client = client_obj_map.get(cid)
        cached_bal = cached_bal_map.get(cid, Decimal("0.00"))

        buckets = client_buckets[cid]
        accounted = accounted_debts[cid]

        if cached_bal > Decimal("0.00"):
            unallocated = cached_bal - accounted
            if unallocated > Decimal("0.00"):
                last_d = last_debit_map.get(cid) or today
                age_days = (today - last_d).days
                if age_days <= 30:
                    buckets["current"] += unallocated
                elif age_days <= 60:
                    buckets["days_30"] += unallocated
                elif age_days <= 90:
                    buckets["days_60"] += unallocated
                else:
                    buckets["days_90_plus"] += unallocated

            total_debt = sum(buckets.values())
            if cached_bal < total_debt and total_debt > Decimal("0.00"):
                ratio = cached_bal / total_debt
                buckets["current"] = (buckets["current"] * ratio).quantize(Decimal("0.01"))
                buckets["days_30"] = (buckets["days_30"] * ratio).quantize(Decimal("0.01"))
                buckets["days_60"] = (buckets["days_60"] * ratio).quantize(Decimal("0.01"))
                buckets["days_90_plus"] = (buckets["days_90_plus"] * ratio).quantize(Decimal("0.01"))
        else:
            # Client has zero or negative debt: no active open debt
            buckets["current"] = Decimal("0.00")
            buckets["days_30"] = Decimal("0.00")
            buckets["days_60"] = Decimal("0.00")
            buckets["days_90_plus"] = Decimal("0.00")

        # Overdue amount = debt older than 30 days
        overdue_amount = buckets["days_30"] + buckets["days_60"] + buckets["days_90_plus"]

        days_list = client_days.get(cid, [])
        avg_days = round(sum(days_list) / len(days_list), 1) if days_list else None
        bounced_count = bounced_map.get(cid, 0)

        grade = determine_grade(bounced_count, buckets, avg_days)

        results[cid] = {
            "grade": grade,
            "avg_days_to_pay": avg_days,
            "overdue_amount": overdue_amount.quantize(Decimal("0.01")),
            "bounced_cheques_12m": bounced_count,
            "last_payment_date": last_pay_map.get(cid),
            "buckets": {k: v.quantize(Decimal("0.01")) for k, v in buckets.items()},
        }

    return results


def client_risk(client: Any, today=None) -> Dict[str, Any]:
    """
    Compute risk profile for a single client.
    """
    res = bulk_client_risk([client], today=today)
    cid = client.id if hasattr(client, "id") else client
    return res.get(cid, {
        "grade": GRADE_A,
        "avg_days_to_pay": None,
        "overdue_amount": Decimal("0.00"),
        "bounced_cheques_12m": 0,
        "last_payment_date": None,
        "buckets": {
            "current": Decimal("0.00"),
            "days_30": Decimal("0.00"),
            "days_60": Decimal("0.00"),
            "days_90_plus": Decimal("0.00"),
        },
    })
