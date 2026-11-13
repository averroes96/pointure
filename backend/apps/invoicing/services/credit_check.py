"""
backend/apps/invoicing/services/credit_check.py

Centralized credit limit and blocked client enforcement.
Ensures that any document or transaction adding credit/debt respects:
  1. is_blocked: Blocked clients cannot take on new credit/invoices/delivery notes.
  2. credit_limit: Cannot exceed credit_limit unless explicitly forced by a manager/owner.
"""
from decimal import Decimal
from typing import Optional, Union

from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.translation import gettext as _
from rest_framework.exceptions import ValidationError as DRFValidationError

from apps.core.models import RoleChoices


def assert_client_can_take_credit(
    client,
    new_amount: Union[Decimal, int, float, str] = Decimal("0.00"),
    user=None,
    force: bool = False,
    is_drf: bool = True,
):
    """
    Validates that a client is not blocked and has sufficient credit limit.

    Args:
        client: Client model instance (or None).
        new_amount: Amount of new debt/credit to be added to the client's balance.
        user: Current User instance attempting the action (for role checks).
        force: Boolean flag indicating if manager force override was requested.
        is_drf: If True, raises rest_framework.exceptions.ValidationError.
                If False, raises django.core.exceptions.ValidationError.
    """
    if client is None:
        return

    # 1. Blocked client check
    if getattr(client, "is_blocked", False):
        msg = _("Ce client est bloqué. Impossible d'émettre un document à crédit.")
        if is_drf:
            raise DRFValidationError({
                "client_id": msg,
                "error": "client_blocked",
            })
        raise DjangoValidationError(msg)

    # 2. Credit limit check
    credit_limit = getattr(client, "credit_limit", None)
    if credit_limit and credit_limit > Decimal("0.00"):
        amount = Decimal(str(new_amount or "0.00"))
        current_balance = getattr(client, "cached_balance", Decimal("0.00")) or Decimal("0.00")
        would_be_balance = current_balance + amount

        if would_be_balance > credit_limit:
            user_role = getattr(user, "role", None)
            is_manager_or_owner = user_role in (RoleChoices.MANAGER, RoleChoices.OWNER)

            if not (force and is_manager_or_owner):
                if is_drf:
                    raise DRFValidationError({
                        "error": "credit_limit_exceeded",
                        "credit_limit": str(credit_limit),
                        "current_balance": str(current_balance),
                        "invoice_total": str(amount.quantize(Decimal("0.01"))),
                        "would_be_balance": str(would_be_balance.quantize(Decimal("0.01"))),
                        "message": _("Plafond de crédit dépassé pour ce client."),
                    })
                raise DjangoValidationError(
                    f"Plafond de crédit dépassé ({would_be_balance:.2f} > {credit_limit:.2f} DA)."
                )

