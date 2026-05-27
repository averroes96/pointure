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
    notes = serializers.CharField(required=False, allow_blank=True)

    def validate(self, data):
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

        # Validate payment total covers sale total
        items_total = sum(
            (item["unit_price"] * item["quantity"]) - item["discount_amount"]
            for item in data["items"]
        ) - data["cart_discount"]

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

        # Resolve optional FKs
        branch = None
        if validated_data.get("branch_id"):
            from apps.core.models import Branch
            branch = Branch.objects.get(pk=validated_data["branch_id"], tenant=tenant)

        client = None
        if validated_data.get("client_id"):
            client = Client.objects.get(pk=validated_data["client_id"], tenant=tenant)

        # Compute total
        items_total = sum(
            (item["unit_price"] * item["quantity"]) - item["discount_amount"]
            for item in validated_data["items"]
        )
        cart_discount = validated_data.get("cart_discount", Decimal("0.00"))
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

        return sale


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
