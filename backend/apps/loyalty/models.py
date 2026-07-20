import uuid
"""
Loyalty system models.

LoyaltyProgram  — one per tenant, holds earning/redemption configuration.
LoyaltyAccount  — one per (client, tenant) — tracks points balance and tier.
LoyaltyTransaction — immutable event log (earn / redeem / adjust / expire).
"""
from decimal import Decimal

from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.core.models import TenantScopedModel


class TierChoices(models.TextChoices):
    BRONZE = "bronze", _("Bronze")
    SILVER = "silver", _("Argent")
    GOLD = "gold", _("Or")


# Descending order — used in recompute_tier (highest match wins).
TIER_THRESHOLDS = [
    (TierChoices.GOLD, 15_000),
    (TierChoices.SILVER, 5_000),
    (TierChoices.BRONZE, 0),
]

# Ascending order (excluding Bronze) — used for "next tier" progress UI.
TIER_PROGRESSION = [
    (TierChoices.SILVER, 5_000),
    (TierChoices.GOLD, 15_000),
]

TIER_MULTIPLIERS: dict[str, Decimal] = {
    TierChoices.BRONZE: Decimal("1.0"),
    TierChoices.SILVER: Decimal("1.2"),
    TierChoices.GOLD: Decimal("1.5"),
}


class LoyaltyProgram(TenantScopedModel):
    """Programme de fidélité — one per tenant."""

    points_per_100dzd = models.PositiveIntegerField(
        _("Points per 100 DZD"),
        default=1,
        help_text="Base points earned per 100 DZD spent (before tier multiplier).",
    )
    # 100 pts redeemable for (100 / redemption_value * 100) DZD.
    # Default: 100 pts = 100 DZD.
    redemption_value = models.PositiveIntegerField(
        _("Points needed for 100 DZD"),
        default=100,
        help_text="Points required to get 100 DZD off.",
    )
    min_redemption_points = models.PositiveIntegerField(
        _("Minimum redeemable points"),
        default=500,
    )
    silver_threshold = models.PositiveIntegerField(
        _("Silver tier threshold (lifetime pts)"),
        default=5_000,
    )
    gold_threshold = models.PositiveIntegerField(
        _("Gold tier threshold (lifetime pts)"),
        default=15_000,
    )
    silver_multiplier = models.DecimalField(
        _("Silver tier earn multiplier"),
        max_digits=4, decimal_places=2, default=Decimal("1.20"),
    )
    gold_multiplier = models.DecimalField(
        _("Gold tier earn multiplier"),
        max_digits=4, decimal_places=2, default=Decimal("1.50"),
    )
    expiry_months = models.PositiveIntegerField(
        _("Point expiry (months)"),
        null=True,
        blank=True,
        help_text="Set to null to never expire points.",
    )
    is_active = models.BooleanField(_("Active"), default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Loyalty Program")
        verbose_name_plural = _("Loyalty Programs")

    def __str__(self) -> str:
        return f"Programme fidélité — {self.tenant}"

    def tier_thresholds(self) -> list[tuple[str, int]]:
        """Descending [(tier, min_lifetime_pts)] — highest match wins in recompute_tier."""
        return [
            (TierChoices.GOLD, self.gold_threshold),
            (TierChoices.SILVER, self.silver_threshold),
            (TierChoices.BRONZE, 0),
        ]

    def tier_multiplier(self, tier: str) -> Decimal:
        if tier == TierChoices.GOLD:
            return Decimal(self.gold_multiplier)
        if tier == TierChoices.SILVER:
            return Decimal(self.silver_multiplier)
        return Decimal("1.0")

    def points_for_amount(self, amount: Decimal, tier: str = TierChoices.BRONZE) -> int:
        """Compute points to earn for a given sale amount, applying the tier multiplier."""
        base = int(amount / 100) * self.points_per_100dzd
        return int(Decimal(base) * self.tier_multiplier(tier))

    def dzd_for_points(self, points: int) -> Decimal:
        """Convert a point amount into its DZD redemption value."""
        return Decimal(points) / Decimal(self.redemption_value) * Decimal("100")


class LoyaltyAccount(TenantScopedModel):
    """One loyalty account per (tenant, client) pair."""

    client = models.ForeignKey(
        "clients.Client",
        on_delete=models.CASCADE,
        related_name="loyalty_accounts",
        verbose_name=_("Client"),
    )
    points_balance = models.IntegerField(_("Points balance"), default=0)
    total_earned = models.IntegerField(_("Lifetime points earned"), default=0)
    tier = models.CharField(
        _("Tier"),
        max_length=10,
        choices=TierChoices.choices,
        default=TierChoices.BRONZE,
    )
    enrolled_at = models.DateTimeField(_("Enrolled at"), auto_now_add=True)

    class Meta:
        verbose_name = _("Loyalty Account")
        verbose_name_plural = _("Loyalty Accounts")
        unique_together = [("tenant", "client")]

    def __str__(self) -> str:
        return f"{self.client} — {self.points_balance} pts ({self.get_tier_display()})"

    def recompute_tier(self, program: "LoyaltyProgram | None" = None) -> bool:
        """Update tier based on lifetime total_earned. Returns True if tier changed."""
        if program is None:
            program = LoyaltyProgram.objects.filter(tenant_id=self.tenant_id, is_active=True).first()
        thresholds = program.tier_thresholds() if program else TIER_THRESHOLDS
        for tier, threshold in thresholds:
            if self.total_earned >= threshold:
                if self.tier != tier:
                    self.tier = tier
                    return True
                return False
        return False


class TransactionTypeChoices(models.TextChoices):
    EARN = "earn", _("Gain")
    REDEEM = "redeem", _("Rachat")
    ADJUST = "adjust", _("Ajustement")
    EXPIRE = "expire", _("Expiration")


class LoyaltyTransaction(models.Model):
    """Immutable event log for all loyalty point movements."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    account = models.ForeignKey(
        LoyaltyAccount,
        on_delete=models.CASCADE,
        related_name="transactions",
        verbose_name=_("Account"),
    )
    points = models.IntegerField(
        _("Points"),
        help_text="Positive = earned; negative = redeemed / expired.",
    )
    transaction_type = models.CharField(
        _("Type"), max_length=10, choices=TransactionTypeChoices.choices
    )
    reference_type = models.CharField(_("Reference type"), max_length=50, blank=True)
    reference_id = models.CharField(_("Reference ID"), max_length=50, blank=True)
    description = models.CharField(_("Description"), max_length=300, blank=True)
    balance_after = models.IntegerField(_("Balance after"))
    expires_at = models.DateTimeField(_("Expires at"), null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("Loyalty Transaction")
        verbose_name_plural = _("Loyalty Transactions")
        ordering = ["-created_at"]

    def __str__(self) -> str:
        sign = "+" if self.points >= 0 else ""
        return f"{sign}{self.points} pts — {self.account.client}"
