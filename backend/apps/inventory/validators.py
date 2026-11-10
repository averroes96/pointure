from django.core.exceptions import ValidationError
from django.utils.translation import gettext_lazy as _


def validate_carton_breakdown_dict(carton_breakdown, pairs_per_carton=None):
    """
    Validates a carton breakdown dictionary:
    - Must be a dictionary.
    - Keys must represent integer EU shoe sizes between 15 and 60.
    - Values must be positive integers >= 1 (number of pairs).
    - If pairs_per_carton is provided and positive, the sum of values must equal pairs_per_carton.

    Returns the cleaned dictionary with string keys and integer values.
    Raises ValidationError on invalid structure.
    """
    if not carton_breakdown:
        return {}

    if not isinstance(carton_breakdown, dict):
        raise ValidationError(
            {"carton_breakdown": _("Le découpage par carton doit être un objet JSON.")}
        )

    cleaned = {}
    total_pairs = 0

    for raw_size, raw_qty in carton_breakdown.items():
        # Validate shoe size (key)
        try:
            size_int = int(str(raw_size).strip())
        except (ValueError, TypeError):
            raise ValidationError(
                {
                    "carton_breakdown": _(
                        f"La pointure '{raw_size}' est invalide. Les pointures doivent être des nombres entiers."
                    )
                }
            )

        if size_int < 15 or size_int > 60:
            raise ValidationError(
                {
                    "carton_breakdown": _(
                        f"La pointure {size_int} est hors limites (doit être comprise entre 15 et 60)."
                    )
                }
            )

        # Validate quantity of pairs (value)
        try:
            qty_int = int(raw_qty)
        except (ValueError, TypeError):
            raise ValidationError(
                {
                    "carton_breakdown": _(
                        f"La quantité pour la pointure {size_int} doit être un nombre entier valide."
                    )
                }
            )

        if qty_int < 1:
            raise ValidationError(
                {
                    "carton_breakdown": _(
                        f"La quantité pour la pointure {size_int} doit être un entier supérieur ou égal à 1."
                    )
                }
            )

        cleaned[str(size_int)] = qty_int
        total_pairs += qty_int

    if pairs_per_carton is not None:
        try:
            expected_ppc = int(pairs_per_carton)
        except (ValueError, TypeError):
            expected_ppc = 0

        if expected_ppc > 0 and total_pairs > 0 and total_pairs != expected_ppc:
            raise ValidationError(
                {
                    "carton_breakdown": _(
                        f"La somme des paires par pointure ({total_pairs}) doit être égale au nombre de paires par carton ({expected_ppc})."
                    )
                }
            )

    return cleaned

