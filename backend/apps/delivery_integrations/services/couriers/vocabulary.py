"""
Courier-neutral vocabularies (docs/plans/delivery-v1-plan.md DL.6, DL.7).

Every read connector maps its courier's raw statuses onto these values and keeps
the raw value alongside (`raw_status`, `cash_raw`), so nothing is lost.
"""
from django.db import models
from django.utils.translation import gettext_lazy as _


class ShipmentStatus(models.TextChoices):
    """Parcel status: dzship's canonical set (docs/statuses.md in the dzship repository)."""
    CREATED = "created", _("Enregistré")
    PENDING_PICKUP = "pending_pickup", _("En attente de ramassage")
    PICKED_UP = "picked_up", _("Ramassé")
    IN_TRANSIT = "in_transit", _("En transit")
    AT_HUB = "at_hub", _("Au centre de tri")
    OUT_FOR_DELIVERY = "out_for_delivery", _("En cours de livraison")
    DELIVERY_ATTEMPTED = "delivery_attempted", _("Tentative de livraison")
    DELIVERED = "delivered", _("Livré")
    ON_HOLD = "on_hold", _("En attente")
    RETURN_IN_TRANSIT = "return_in_transit", _("Retour en cours")
    RETURNED = "returned", _("Retourné")
    CANCELLED = "cancelled", _("Annulé")
    LOST = "lost", _("Perdu")
    UNKNOWN = "unknown", _("Statut inconnu")


TERMINAL_STATUSES = frozenset({
    ShipmentStatus.DELIVERED,
    ShipmentStatus.RETURNED,
    ShipmentStatus.CANCELLED,
    ShipmentStatus.LOST,
})


class CashStatus(models.TextChoices):
    """Where the COD money of a parcel is (DL.7)."""
    NOT_APPLICABLE = "not_applicable", _("Sans objet")          # no COD, cancelled, returned
    AWAITING_DELIVERY = "awaiting_delivery", _("En attente de livraison")
    HELD_BY_COURIER = "held_by_courier", _("Chez le transporteur")  # delivered, not paid to the store
    READY = "ready", _("Prêt à être versé")                     # only when the courier says so
    PAID = "paid", _("Versé")
