from rest_framework import serializers

from .models import (
    LoyaltyAccount,
    LoyaltyProgram,
    LoyaltyTransaction,
    TierChoices,
    TIER_PROGRESSION,
)


class LoyaltyProgramSerializer(serializers.ModelSerializer):
    dzd_per_100_points = serializers.SerializerMethodField()

    class Meta:
        model = LoyaltyProgram
        fields = [
            "id",
            "points_per_100dzd",
            "redemption_value",
            "dzd_per_100_points",
            "min_redemption_points",
            "silver_threshold",
            "gold_threshold",
            "silver_multiplier",
            "gold_multiplier",
            "expiry_months",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_dzd_per_100_points(self, obj) -> str:
        """Human-readable: '100 pts = X DZD'."""
        val = obj.dzd_for_points(100)
        return f"{val:.0f} DZD"


class LoyaltyTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = LoyaltyTransaction
        fields = [
            "id",
            "points",
            "transaction_type",
            "reference_type",
            "reference_id",
            "description",
            "balance_after",
            "expires_at",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class LoyaltyAccountSerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source="client.name", read_only=True)
    client_phone = serializers.CharField(source="client.phone", read_only=True)
    tier_display = serializers.CharField(source="get_tier_display", read_only=True)
    transactions = LoyaltyTransactionSerializer(many=True, read_only=True)
    next_tier = serializers.SerializerMethodField()
    points_to_next_tier = serializers.SerializerMethodField()

    class Meta:
        model = LoyaltyAccount
        fields = [
            "id",
            "client",
            "client_name",
            "client_phone",
            "points_balance",
            "total_earned",
            "tier",
            "tier_display",
            "next_tier",
            "points_to_next_tier",
            "enrolled_at",
            "transactions",
        ]
        read_only_fields = ["id", "enrolled_at"]

    def _progression(self, obj):
        """Return ascending [(tier, threshold)] using program config when available."""
        program = LoyaltyProgram.objects.filter(tenant_id=obj.tenant_id, is_active=True).first()
        if program:
            return [(TierChoices.SILVER, program.silver_threshold), (TierChoices.GOLD, program.gold_threshold)]
        return TIER_PROGRESSION

    def get_next_tier(self, obj) -> str | None:
        for tier, threshold in self._progression(obj):
            if obj.total_earned < threshold:
                return tier
        return None

    def get_points_to_next_tier(self, obj) -> int | None:
        for _, threshold in self._progression(obj):
            if obj.total_earned < threshold:
                return threshold - obj.total_earned
        return None


class LoyaltyAccountSummarySerializer(serializers.ModelSerializer):
    """Lightweight — used in POS client lookup (no transaction history)."""
    client_name = serializers.CharField(source="client.name", read_only=True)
    tier_display = serializers.CharField(source="get_tier_display", read_only=True)
    next_tier = serializers.SerializerMethodField()
    points_to_next_tier = serializers.SerializerMethodField()

    class Meta:
        model = LoyaltyAccount
        fields = [
            "id",
            "client",
            "client_name",
            "points_balance",
            "total_earned",
            "tier",
            "tier_display",
            "next_tier",
            "points_to_next_tier",
            "enrolled_at",
        ]
        read_only_fields = ["id", "enrolled_at"]

    def _progression(self, obj):
        program = LoyaltyProgram.objects.filter(tenant_id=obj.tenant_id, is_active=True).first()
        if program:
            return [(TierChoices.SILVER, program.silver_threshold), (TierChoices.GOLD, program.gold_threshold)]
        return TIER_PROGRESSION

    def get_next_tier(self, obj) -> str | None:
        for tier, threshold in self._progression(obj):
            if obj.total_earned < threshold:
                return tier
        return None

    def get_points_to_next_tier(self, obj) -> int | None:
        for _, threshold in self._progression(obj):
            if obj.total_earned < threshold:
                return threshold - obj.total_earned
        return None
