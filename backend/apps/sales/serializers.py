"""Sales serializers with atomic sale creation."""
from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from apps.inventory.models import MovementReasonChoices, StockMovement, Variant
from .models import Payment, PaymentMethodChoices, Return, ReturnItem, Sale, SaleItem


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ["id", "amount", "method", "cheque_ref", "notes", "recorded_at"]
        read_only_fields = ["id", "recorded_at"]


class SaleItemSerializer(serializers.ModelSerializer):
    subtotal = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    variant_str = serializers.CharField(source="variant.__str__", read_only=True)

    class Meta:
        model = SaleItem
        fields = ["id", "variant", "variant_str", "quantity", "unit_price", "discount_amount", "subtotal"]
        read_only_fields = ["id", "subtotal"]


class SaleSerializer(serializers.ModelSerializer):
    items = SaleItemSerializer(many=True, read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)
    balance_due = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    amount_paid = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    cashier_name = serializers.CharField(source="cashier.get_full_name", read_only=True)

    class Meta:
        model = Sale
        fields = [
            "id", "branch", "cashier", "cashier_name", "client", "status",
            "total_amount", "discount_amount", "amount_paid", "balance_due",
            "receipt_number", "notes", "items", "payments", "created_at",
        ]
        read_only_fields = ["id", "created_at", "receipt_number"]


# ─── Create sale input ────────────────────────────────────────────────────────

class CreateSaleItemInput(serializers.Serializer):
    variant_id = serializers.IntegerField()
    quantity = serializers.IntegerField(min_value=1)
    unit_price = serializers.DecimalField(max_digits=12, decimal_places=2)
    discount_amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0.00")
    )


class CreatePaymentInput(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    method = serializers.ChoiceField(choices=PaymentMethodChoices.choices)
    notes = serializers.CharField(required=False, allow_blank=True)


class CreateSaleSerializer(serializers.Serializer):
    """
    Input for POST /api/v1/sales/ — creates the complete sale atomically.
    """
    branch_id = serializers.IntegerField(required=False, allow_null=True)
    client_id = serializers.IntegerField(required=False, allow_null=True)
    items = CreateSaleItemInput(many=True, min_length=1)
    payments = CreatePaymentInput(many=True, min_length=1)
    cart_discount = serializers.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    redeem_points = serializers.IntegerField(min_value=0, default=0, required=False)
    notes = serializers.CharField(required=False, allow_blank=True)

    def validate(self, data):
        from apps.clients.models import Client

        # Validate all variants exist and have sufficient stock
        tenant = self.context["request"].tenant
        item_errors = []
        for i, item_data in enumerate(data["items"]):
            try:
                variant = Variant.objects.get(pk=item_data["variant_id"], tenant=tenant)
                item_data["variant"] = variant
                if variant.stock_qty < item_data["quantity"]:
                    item_errors.append(
                        f"Item {i+1}: Insufficient stock for {variant} "
                        f"(available: {variant.stock_qty}, requested: {item_data['quantity']})"
                    )
            except Variant.DoesNotExist:
                item_errors.append(f"Item {i+1}: Variant {item_data['variant_id']} not found.")

        if item_errors:
            raise serializers.ValidationError({"items": item_errors})

        # Validate loyalty point redemption
        redeem_points = data.get("redeem_points", 0)
        if redeem_points > 0:
            client_id = data.get("client_id")
            if not client_id:
                raise serializers.ValidationError(
                    {"redeem_points": "Un client doit être sélectionné pour racheter des points."}
                )
            try:
                from apps.loyalty.models import LoyaltyAccount, LoyaltyProgram
                program = LoyaltyProgram.objects.get(tenant=tenant, is_active=True)
                account = LoyaltyAccount.objects.get(tenant=tenant, client_id=client_id)
                if account.points_balance < redeem_points:
                    raise serializers.ValidationError(
                        {"redeem_points": f"Solde insuffisant ({account.points_balance} pts disponibles)."}
                    )
                if redeem_points < program.min_redemption_points:
                    raise serializers.ValidationError(
                        {"redeem_points": f"Minimum {program.min_redemption_points} points requis pour un rachat."}
                    )
                # Stash for create_sale to avoid re-querying
                data["_loyalty_program"] = program
                data["_loyalty_account"] = account
            except LoyaltyProgram.DoesNotExist:
                raise serializers.ValidationError(
                    {"redeem_points": "Aucun programme de fidélité actif pour ce commerce."}
                )
            except LoyaltyAccount.DoesNotExist:
                raise serializers.ValidationError(
                    {"redeem_points": "Ce client n'a pas encore de compte fidélité."}
                )

        # Validate payment total covers sale total (after redemption discount)
        items_total = sum(
            (item["unit_price"] * item["quantity"]) - item["discount_amount"]
            for item in data["items"]
        ) - data["cart_discount"]

        # Account for redemption discount in payment total check
        if redeem_points > 0 and data.get("_loyalty_program"):
            from apps.loyalty.models import LoyaltyProgram
            redemption_dzd = data["_loyalty_program"].dzd_for_points(redeem_points)
            items_total = items_total - redemption_dzd

        payment_total = sum(p["amount"] for p in data["payments"])

        # Allow underpayment (creates account balance) but not overpayment > 10%
        if payment_total > items_total * Decimal("1.1"):
            raise serializers.ValidationError(
                {"payments": "Payment total significantly exceeds sale total."}
            )

        return data

    @transaction.atomic
    def create_sale(self, validated_data, tenant, cashier):
        """Create the sale, items, payments, and stock movements atomically."""
        from apps.clients.models import Client

        # Pop loyalty data (not model fields)
        redeem_points = validated_data.pop("redeem_points", 0)
        _loyalty_program = validated_data.pop("_loyalty_program", None)
        _loyalty_account = validated_data.pop("_loyalty_account", None)

        # Resolve optional FKs
        branch = None
        if validated_data.get("branch_id"):
            from apps.core.models import Branch
            branch = Branch.objects.get(pk=validated_data["branch_id"], tenant=tenant)

        client = None
        if validated_data.get("client_id"):
            client = Client.objects.get(pk=validated_data["client_id"], tenant=tenant)

        # Compute total — apply loyalty redemption as an additional cart discount
        items_total = sum(
            (item["unit_price"] * item["quantity"]) - item["discount_amount"]
            for item in validated_data["items"]
        )
        cart_discount = validated_data.get("cart_discount", Decimal("0.00"))
        if redeem_points > 0 and _loyalty_program:
            redemption_dzd = _loyalty_program.dzd_for_points(redeem_points)
            cart_discount = cart_discount + redemption_dzd
        total = items_total - cart_discount

        # Generate receipt number
        import datetime
        today = datetime.date.today()
        prefix = f"RC-{today.strftime('%Y%m%d')}"
        last = Sale.objects.filter(tenant=tenant, receipt_number__startswith=prefix).order_by("-receipt_number").first()
        if last and last.receipt_number:
            try:
                seq = int(last.receipt_number.split("-")[-1]) + 1
            except (ValueError, IndexError):
                seq = 1
        else:
            seq = 1
        receipt_number = f"{prefix}-{seq:04d}"

        sale = Sale.objects.create(
            tenant=tenant,
            branch=branch,
            cashier=cashier,
            client=client,
            total_amount=total,
            discount_amount=cart_discount,
            notes=validated_data.get("notes", ""),
            receipt_number=receipt_number,
        )

        # Create items + stock movements
        for item_data in validated_data["items"]:
            variant = item_data["variant"]
            SaleItem.objects.create(
                sale=sale,
                variant=variant,
                quantity=item_data["quantity"],
                unit_price=item_data["unit_price"],
                discount_amount=item_data["discount_amount"],
            )
            StockMovement.objects.create(
                tenant=tenant,
                variant=variant,
                branch=branch,
                quantity_delta=-item_data["quantity"],
                reason=MovementReasonChoices.SALE,
                reference_id=str(sale.pk),
                reference_type="Sale",
                user=cashier,
            )

        # Create payments
        for payment_data in validated_data["payments"]:
            Payment.objects.create(
                sale=sale,
                amount=payment_data["amount"],
                method=payment_data["method"],
                notes=payment_data.get("notes", ""),
            )

        # ── Loyalty: redeem then earn ─────────────────────────────────────────
        loyalty_summary = self._process_loyalty(
            sale=sale,
            tenant=tenant,
            client=client,
            receipt_number=receipt_number,
            redeem_points=redeem_points,
            loyalty_program=_loyalty_program,
            loyalty_account=_loyalty_account,
        )
        sale._loyalty_summary = loyalty_summary

        return sale

    @staticmethod
    def _process_loyalty(sale, tenant, client, receipt_number, redeem_points,
                         loyalty_program, loyalty_account) -> dict:
        """
        Apply point redemption and auto-earn points for the sale.
        Returns {"points_earned": int, "points_redeemed": int}.
        Wrapped in a silent try/except so a loyalty bug never blocks a sale.
        """
        import logging
        from django.utils import timezone

        logger = logging.getLogger(__name__)
        result = {"points_earned": 0, "points_redeemed": 0}
        try:
            from apps.loyalty.models import (
                LoyaltyAccount,
                LoyaltyProgram,
                LoyaltyTransaction,
                TransactionTypeChoices,
            )

            # 1. Redeem
            if redeem_points > 0 and loyalty_account and loyalty_program:
                loyalty_account.points_balance -= redeem_points
                if loyalty_account.points_balance < 0:
                    loyalty_account.points_balance = 0
                loyalty_account.save(update_fields=["points_balance"])
                LoyaltyTransaction.objects.create(
                    account=loyalty_account,
                    points=-redeem_points,
                    transaction_type=TransactionTypeChoices.REDEEM,
                    reference_type="Sale",
                    reference_id=str(sale.pk),
                    description=f"Rachat sur vente {receipt_number}",
                    balance_after=loyalty_account.points_balance,
                )
                result["points_redeemed"] = redeem_points

            # 2. Earn (only when a client is linked and a program exists)
            if not client:
                return result
            program = loyalty_program or LoyaltyProgram.objects.filter(
                tenant=tenant, is_active=True
            ).first()
            if not program:
                return result

            account, _ = LoyaltyAccount.objects.get_or_create(
                tenant=tenant,
                client=client,
                defaults={"tier": "bronze"},
            )
            pts = program.points_for_amount(sale.total_amount, account.tier)
            if pts <= 0:
                return result

            account.points_balance += pts
            account.total_earned += pts
            account.recompute_tier()
            account.save()

            expires_at = None
            if program.expiry_months:
                expires_at = timezone.now() + timezone.timedelta(
                    days=30 * program.expiry_months
                )

            LoyaltyTransaction.objects.create(
                account=account,
                points=pts,
                transaction_type=TransactionTypeChoices.EARN,
                reference_type="Sale",
                reference_id=str(sale.pk),
                description=f"Points gagnés — {receipt_number}",
                balance_after=account.points_balance,
                expires_at=expires_at,
            )
            result["points_earned"] = pts

        except Exception:
            logger.exception("Loyalty processing failed for sale %s — points not awarded.", sale.pk)

        return result


class ReturnItemInput(serializers.Serializer):
    variant_id = serializers.IntegerField()
    quantity = serializers.IntegerField(min_value=1)
    restock = serializers.BooleanField(default=True)


class CreateReturnSerializer(serializers.Serializer):
    items = ReturnItemInput(many=True, min_length=1)
    reason = serializers.CharField()
    refund_amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.00"))
    refund_method = serializers.ChoiceField(choices=PaymentMethodChoices.choices)

    @transaction.atomic
    def create_return(self, sale, processed_by):
        tenant = sale.tenant
        data = self.validated_data

        return_obj = Return.objects.create(
            tenant=tenant,
            original_sale=sale,
            processed_by=processed_by,
            reason=data["reason"],
            refund_amount=data["refund_amount"],
            refund_method=data["refund_method"],
        )

        for item_data in data["items"]:
            variant = Variant.objects.get(pk=item_data["variant_id"], tenant=tenant)
            ReturnItem.objects.create(
                return_obj=return_obj,
                variant=variant,
                quantity=item_data["quantity"],
                restock=item_data["restock"],
            )
            if item_data["restock"]:
                StockMovement.objects.create(
                    tenant=tenant,
                    variant=variant,
                    quantity_delta=item_data["quantity"],
                    reason=MovementReasonChoices.RETURN,
                    reference_id=str(return_obj.pk),
                    reference_type="Return",
                    user=processed_by,
                )

        return return_obj
