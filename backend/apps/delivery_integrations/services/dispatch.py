"""
Sending a delivery order to its courier through dzship (docs/plans/delivery-v1-plan.md P2.4).

The view runs, in order:
  1. `prepare()`: every local check, and the dzship payload, before anything changes;
  2. a conditional UPDATE that claims the draft (draft → confirmed), so a double click
     cannot send twice;
  3. the dzship call, outside any transaction, with our order id as `reference`;
  4. `record_dispatch()`: one short transaction with one `delivery_out` movement per line
     and the order set to `dispatched`. No sale: it is created at delivery (DL2.1, P2.5).
"""
from collections import Counter
from dataclasses import dataclass

from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework.exceptions import ValidationError

from apps.closing.services.lock import assert_period_open
from apps.core.models import StoreSettings
from apps.core.utils.phone import is_valid_algerian_phone, normalize_algerian_phone
from apps.inventory.models import MovementReasonChoices, StockMovement

from ..models import CustomerOrder, CustomerOrderStatusChoices, DeliveryTypeChoices, check_cod
from . import catalogue, communes, geo

PRODUCT_LIST_MAX = 500


def credentials_complete(config):
    """The account has every credential its courier needs (none for the sandbox)."""
    saved = config.credentials or {}
    entry = catalogue.get_courier(config.courier)
    if entry is None:                           # catalogue not fetched yet
        return bool(saved) or config.courier == "sandbox"
    return all(saved.get(name) for name in entry["required_credentials"])


@dataclass
class DispatchPlan:
    lines: list
    order_data: dict
    from_wilaya: int | None


def _fail(field, message):
    raise ValidationError({field: [message]})


def _courier_commune(order, ship_code):
    index, _meta = communes.load_index()       # starts a background refresh when missing
    if not index.by_wilaya:
        _fail("commune", _("La liste des communes du transporteur se charge. Réessayez dans un instant."))
    typed = (order.commune or "").strip()
    for row in index.communes(ship_code):      # already the courier spelling (picked in the form)
        if row["name_fr"] == typed:
            return row["name_fr"]
    match = index.match(ship_code, typed, typed) if typed else None
    if match is None:
        _fail("commune", _("Commune inconnue du transporteur : choisissez-la dans la liste."))
    return match["name_fr"]


def _product_list(lines):
    parts = []
    for line in lines:
        name = line.variant.product.name
        if line.variant.size_eu:
            name += f" {line.variant.size_eu}"
        parts.append(f"{name} x{line.quantity}")
    return " / ".join(parts)[:PRODUCT_LIST_MAX]


def prepare(order, config, tenant):
    """
    Every check that does not need the courier, then the dzship order payload.
    Raises ValidationError (field-keyed) and changes nothing.
    """
    if order.status != CustomerOrderStatusChoices.DRAFT:
        _fail("status", _("Cette commande n'est plus un brouillon."))
    if not config.is_active:
        _fail("provider_config", _("Ce transporteur est désactivé."))
    if not credentials_complete(config):
        _fail("provider_config", _(
            "Les identifiants de ce transporteur sont incomplets. Complétez-les dans "
            "Paramètres → Paramètres de Livraison."
        ))

    if not (order.customer_name or "").strip():
        _fail("customer_name", _("Ce champ est obligatoire."))
    phone = normalize_algerian_phone(order.customer_phone)
    if not is_valid_algerian_phone(phone):
        _fail("customer_phone", _("Numéro de téléphone algérien invalide."))
    phone2 = normalize_algerian_phone(order.customer_phone2) if order.customer_phone2 else ""
    if phone2 and not is_valid_algerian_phone(phone2):
        _fail("customer_phone2", _("Numéro de téléphone algérien invalide."))

    try:
        ship_code = communes.ship_wilaya((order.wilaya or "").strip())
    except ValueError:
        _fail("wilaya", _("Choisissez la wilaya du client."))
    commune_name = _courier_commune(order, ship_code)

    stopdesk = order.delivery_type == DeliveryTypeChoices.STOPDESK
    if stopdesk and not order.stop_desk_id:
        _fail("stop_desk_id", _("Choisissez le bureau du transporteur."))

    lines = list(order.lines.select_related("variant__product"))
    if not lines:
        _fail("lines", _("Ajoutez au moins un article."))
    if any(line.variant.tenant_id != tenant.pk for line in lines):
        _fail("lines", _("Un des articles sélectionnés est introuvable."))

    store_settings = StoreSettings.objects.filter(tenant=tenant).first()
    if not (store_settings and store_settings.allow_negative_stock):
        needed = Counter()
        variants = {}
        for line in lines:
            needed[line.variant_id] += line.quantity
            variants[line.variant_id] = line.variant
        short = [str(variants[v]) for v, qty in needed.items() if variants[v].stock_qty < qty]
        if short:
            _fail("lines", _("Stock insuffisant : %(items)s") % {"items": ", ".join(short)})

    cod = order.cod_to_collect()
    error = check_cod(cod, order.expected_cod())
    if error:
        _fail("cod_amount", error)

    # StockMovement.save() refuses a closed period: refuse before shipping anything.
    assert_period_open(tenant, timezone.localdate())

    recipient = {
        "fullName": order.customer_name.strip()[:200],
        "phone": phone,
        "wilayaCode": ship_code,
        "communeName": commune_name,
        "addressLine": (order.address or "").strip()[:255] or commune_name,
    }
    if phone2:
        recipient["phoneAlt"] = phone2
    order_data = {
        # Our id: the sync links the parcel back to this order (P1.9), and it finds the
        # parcel on the courier side if dzship's answer is lost.
        "reference": str(order.pk),
        "recipient": recipient,
        "deliveryType": order.delivery_type,
        "productList": _product_list(lines),
        "codAmount": int(cod),
        "freeShipping": bool(order.free_shipping),
        "hasOpenPackage": bool(order.open_package),
    }
    if stopdesk:
        order_data["stopDeskId"] = order.stop_desk_id
    if (order.note_to_driver or "").strip():
        order_data["notes"] = order.note_to_driver.strip()[:255]
    return DispatchPlan(lines=lines, order_data=order_data, from_wilaya=geo.origin_wilaya(config))


def claim(order, tenant):
    """draft → confirmed in one conditional UPDATE. False when another request got there first."""
    return bool(CustomerOrder.objects.filter(
        pk=order.pk, tenant=tenant, status=CustomerOrderStatusChoices.DRAFT,
    ).update(status=CustomerOrderStatusChoices.CONFIRMED, updated_at=timezone.now()))


def release(order, tenant):
    """confirmed → draft after the courier did not take the parcel."""
    CustomerOrder.objects.filter(
        pk=order.pk, tenant=tenant, status=CustomerOrderStatusChoices.CONFIRMED,
    ).update(status=CustomerOrderStatusChoices.DRAFT, updated_at=timezone.now())


def record_dispatch(order, plan, config, tracking_number, user):
    """
    The courier took the parcel: stock leaves (one `delivery_out` per line) and the order
    becomes `dispatched`, in one short transaction. Runs once: only a `confirmed` order
    (claimed by this request) is recorded.
    """
    with transaction.atomic():
        locked = CustomerOrder.objects.select_for_update().get(pk=order.pk)
        if locked.status != CustomerOrderStatusChoices.CONFIRMED or locked.dispatched_at is not None:
            return locked
        for line in plan.lines:
            StockMovement.objects.create(
                tenant=locked.tenant,
                variant=line.variant,
                quantity_delta=-line.quantity,
                reason=MovementReasonChoices.DELIVERY_OUT,
                reference_id=str(locked.pk),
                reference_type="CustomerOrder",
                notes=f"{config.courier} {tracking_number or ''}".strip(),
                user=user,
            )
        locked.status = CustomerOrderStatusChoices.DISPATCHED
        locked.provider = config.courier
        locked.tracking_number = tracking_number
        locked.dispatched_by = user
        locked.dispatched_at = timezone.now()
        locked.save()
    return locked


def keep_accepted(order, tenant, config, tracking_number):
    """Recording failed after the courier took the parcel: never back to draft (no resend)."""
    CustomerOrder.objects.filter(pk=order.pk, tenant=tenant).update(
        provider=config.courier, tracking_number=tracking_number, updated_at=timezone.now(),
    )
