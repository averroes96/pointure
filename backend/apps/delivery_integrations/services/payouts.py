"""
Courier payouts picked up at the agency (docs/plans/delivery-v1-plan.md P1.12, DL.8).

A manager records the cash received and the parcels it covers. The server computes
what was expected, attaches the parcels in one transaction, and marks them `paid`.
Voiding is a complete reversal. Nothing here touches CashSession, CashMovement, Sale,
ClientLedger or stock (DL.3).
"""
from decimal import Decimal

from django.db import transaction
from django.db.models import Case, CharField, Count, DecimalField, F, Q, Sum, Value, When
from django.db.models.functions import Coalesce
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework.exceptions import ValidationError

from ..models import CourierPayout, CourierPayoutStatus, ProviderConfig, Shipment
from .couriers import CashStatus

CENT = Decimal("0.01")
ZERO = Decimal("0.00")
# Parcels a payout may cover: money with the courier, or paid per the courier but not yet recorded.
ELIGIBLE_CASH = (CashStatus.HELD_BY_COURIER, CashStatus.READY, CashStatus.PAID)


def expected_for(shipment) -> Decimal:
    """What the courier owes the store for one parcel."""
    if shipment.store_amount is not None:
        return shipment.store_amount
    if shipment.cod_amount is not None:
        return shipment.cod_amount - (shipment.delivery_fee or ZERO)
    return ZERO


def expected_expression():
    """Same rule as `expected_for`, as an SQL expression for aggregates."""
    money = DecimalField(max_digits=12, decimal_places=2)
    return Coalesce(
        "store_amount",
        F("cod_amount") - Coalesce("delivery_fee", Value(ZERO, output_field=money), output_field=money),
        Value(ZERO, output_field=money),
        output_field=money,
    )


def record_payout(*, tenant, user, courier, amount_received, picked_up_on=None, courier_reference="",
                  notes="", shipment_ids=(), trackings=(), courier_payout_ref="") -> CourierPayout:
    """
    Create a payout covering the given parcels. All-or-nothing: any unknown,
    ineligible or already-recorded parcel refuses the whole payout with the list.
    """
    config = ProviderConfig.objects.unscoped().filter(tenant=tenant, courier=courier).first()
    if config is None:
        raise ValidationError({"courier": _("Ce transporteur n'est pas configuré.")})

    mine = Shipment.objects.unscoped().filter(tenant=tenant, courier=courier)
    ids = {str(i) for i in shipment_ids}

    wanted = {t.strip() for t in trackings if t and t.strip()}
    if wanted:
        found = dict(mine.filter(tracking_number__in=wanted).values_list("tracking_number", "pk"))
        unknown = sorted(wanted - set(found))
        if unknown:
            raise ValidationError({
                "trackings": _("Numéros de suivi inconnus pour ce transporteur : %(list)s") % {"list": ", ".join(unknown)},
                "unknown_trackings": unknown,
            })
        ids |= {str(pk) for pk in found.values()}

    if courier_payout_ref:
        ids |= {str(pk) for pk in mine.filter(courier_payout_ref=courier_payout_ref).values_list("pk", flat=True)}

    if not ids:
        raise ValidationError({"shipments": _("Choisissez au moins un colis.")})

    with transaction.atomic():
        shipments = list(mine.filter(pk__in=ids))
        if len(shipments) != len(ids):
            raise ValidationError({"shipments": _("Certains colis sont introuvables pour ce transporteur.")})
        refused = sorted(
            s.tracking_number or str(s.pk) for s in shipments
            if s.payout_id is not None or s.cash_status not in ELIGIBLE_CASH
        )
        if refused:
            raise ValidationError({
                "shipments": _(
                    "Ces colis ne peuvent pas être inclus (non livrés, sans montant ou déjà enregistrés) : %(list)s"
                ) % {"list": ", ".join(refused)},
                "refused_trackings": refused,
            })

        expected = sum((expected_for(s) for s in shipments), ZERO).quantize(CENT)
        received = Decimal(amount_received).quantize(CENT)
        payout = CourierPayout.objects.create(
            tenant=tenant,
            provider_config=config,
            courier=courier,
            picked_up_on=picked_up_on or timezone.localdate(),
            amount_received=received,
            expected_amount=expected,
            difference=(received - expected).quantize(CENT),
            courier_reference=courier_reference,
            notes=notes,
            recorded_by=user,
        )
        # Conditional update: a parallel request that attached a parcel first makes the
        # count differ, and this whole payout rolls back (double-click safe on SQLite).
        attached = Shipment.objects.unscoped().filter(
            pk__in=ids, tenant=tenant, payout__isnull=True, cash_status__in=ELIGIBLE_CASH,
        ).update(
            payout=payout,
            payout_previous_cash=F("cash_status"),
            cash_status=CashStatus.PAID,
            updated_at=timezone.now(),
        )
        if attached != len(ids):
            raise ValidationError({"shipments": _("Ces colis viennent d'être modifiés. Réessayez.")})
    return payout


def void_payout(*, payout, user) -> CourierPayout:
    """
    Cancel a recorded payout: every parcel gets its previous cash status back
    (or `paid` when the courier itself reported it paid). Refused if already voided.
    """
    with transaction.atomic():
        changed = CourierPayout.objects.unscoped().filter(
            pk=payout.pk, tenant=payout.tenant, status=CourierPayoutStatus.RECORDED,
        ).update(status=CourierPayoutStatus.VOIDED, voided_at=timezone.now(), voided_by=user, updated_at=timezone.now())
        if not changed:
            raise ValidationError(_("Ce versement est déjà annulé."))
        Shipment.objects.unscoped().filter(tenant=payout.tenant, payout=payout).update(
            cash_status=Case(
                When(~Q(courier_payout_ref=""), then=Value(CashStatus.PAID)),
                When(payout_previous_cash="", then=Value(CashStatus.HELD_BY_COURIER)),
                default=F("payout_previous_cash"),
                output_field=CharField(),
            ),
            payout=None,
            payout_previous_cash="",
            updated_at=timezone.now(),
        )
    payout.refresh_from_db()
    return payout


def to_record(tenant):
    """
    Per courier: what the courier says it paid but no payout records yet (grouped by its
    payout), and what is still held or ready. Feeds the "Record a payout" screen.
    """
    base = Shipment.objects.unscoped().filter(tenant=tenant, payout__isnull=True)
    result = {}

    def bucket(courier):
        return result.setdefault(courier, {"courier": courier, "courier_payouts": [], "held": None, "ready": None})

    for row in (
        base.exclude(courier_payout_ref="")
        .values("courier", "courier_payout_ref", "courier_paid_on")
        .annotate(count=Count("pk"), expected=Sum(expected_expression()))
        .order_by("courier", "-courier_paid_on")
    ):
        bucket(row["courier"])["courier_payouts"].append({
            "courier_payout_ref": row["courier_payout_ref"],
            "paid_on": row["courier_paid_on"],
            "count": row["count"],
            "expected_amount": _money(row["expected"]),
        })
    for cash in (CashStatus.HELD_BY_COURIER, CashStatus.READY):
        for row in (
            base.filter(cash_status=cash, courier_payout_ref="")
            .values("courier")
            .annotate(count=Count("pk"), expected=Sum(expected_expression()))
            .order_by()
        ):
            bucket(row["courier"])["held" if cash == CashStatus.HELD_BY_COURIER else "ready"] = {
                "count": row["count"], "expected_amount": _money(row["expected"]),
            }
    return sorted(result.values(), key=lambda b: b["courier"])


def _money(value):
    return str((value or ZERO).quantize(CENT))
