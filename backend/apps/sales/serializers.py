"""Sales serializers with atomic sale creation."""
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from rest_framework import serializers

from apps.inventory.models import MovementReasonChoices, StockMovement, Variant
from .models import (
    CashReconciliation, Exchange, ExchangeNewItem, ExchangeReturnItem,
    Payment, PaymentMethodChoices, Return, ReturnItem, Sale, SaleItem,
)


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
    client_name = serializers.CharField(source="client.name", default=None, read_only=True)
    loyalty_tier = serializers.SerializerMethodField()
    loyalty_points = serializers.SerializerMethodField()
    exchange_count = serializers.IntegerField(source="exchanges.count", read_only=True)

    def _loyalty_account(self, obj):
        if not obj.client_id:
            return None
        for acct in obj.client.loyalty_accounts.all():
            if acct.tenant_id == obj.tenant_id:
                return acct
        return None

    def get_loyalty_tier(self, obj):
        acct = self._loyalty_account(obj)
        return acct.tier if acct else None

    def get_loyalty_points(self, obj):
        acct = self._loyalty_account(obj)
        return acct.points_balance if acct else None

    class Meta:
        model = Sale
        fields = [
            "id", "branch", "cashier", "cashier_name", "client", "client_name",
            "loyalty_tier", "loyalty_points", "status",
            "total_amount", "discount_amount", "amount_paid", "balance_due",
            "receipt_number", "notes", "due_date", "items", "payments",
            "exchange_count", "created_at",
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
    is_versement = serializers.BooleanField(default=False)

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

        # Versement validation
        is_versement = data.get("is_versement", False)
        if is_versement:
            from apps.core.models import StoreSettings
            tenant = self.context["request"].tenant
            store_settings = StoreSettings.objects.filter(tenant=tenant).first()
            min_pct = store_settings.min_versement_pct if store_settings else 30
            due_days = store_settings.versement_due_days if store_settings else 90
            requires_client = store_settings.versement_requires_client if store_settings else True

            min_required = items_total * Decimal(min_pct) / Decimal("100")
            if payment_total < min_required:
                raise serializers.ValidationError(
                    {"payments": f"L'acompte minimum pour un versement est de {min_pct}% du total ({min_required:.2f} DZD)."}
                )
            if requires_client and not data.get("client_id"):
                raise serializers.ValidationError(
                    {"client_id": "Un client doit être sélectionné pour un versement."}
                )
            # Stash for create_sale
            data["_versement_due_days"] = due_days

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
        is_versement = validated_data.pop("is_versement", False)
        versement_due_days = validated_data.pop("_versement_due_days", 90)

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

        # Determine status and due_date for versement
        payment_total = sum(p["amount"] for p in validated_data["payments"])
        if is_versement and payment_total < total:
            sale_status = "partially_paid"
            due_date = today + datetime.timedelta(days=versement_due_days)
        else:
            sale_status = "completed"
            due_date = None

        sale = Sale.objects.create(
            tenant=tenant,
            branch=branch,
            cashier=cashier,
            client=client,
            total_amount=total,
            discount_amount=cart_discount,
            notes=validated_data.get("notes", ""),
            receipt_number=receipt_number,
            status=sale_status,
            due_date=due_date,
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
        # Skip loyalty for versement — points awarded only when sale completes
        if is_versement and sale_status == "partially_paid":
            sale._loyalty_summary = {"points_earned": 0, "points_redeemed": 0}
        else:
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


class AddPaymentSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    method = serializers.ChoiceField(choices=PaymentMethodChoices.choices)
    notes = serializers.CharField(required=False, allow_blank=True)


class ReturnItemInput(serializers.Serializer):
    variant_id = serializers.IntegerField()
    quantity = serializers.IntegerField(min_value=1)
    restock = serializers.BooleanField(default=True)


class CreateReturnSerializer(serializers.Serializer):
    items = ReturnItemInput(many=True, min_length=1)
    reason = serializers.CharField()
    refund_amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.00"))
    refund_method = serializers.ChoiceField(choices=PaymentMethodChoices.choices)

    def validate(self, data):
        sale = self.context.get("sale")
        if not sale:
            return data

        # Build a map of how many units of each variant were sold
        sold_qty: dict[int, int] = {
            item.variant_id: item.quantity for item in sale.items.all()
        }

        # Build a map of how many units have already been used (returned or exchanged)
        already_returned: dict[int, int] = {}
        for row in ReturnItem.objects.filter(
            return_obj__original_sale=sale
        ).values("variant_id").annotate(total=Sum("quantity")):
            already_returned[row["variant_id"]] = row["total"]
        for row in ExchangeReturnItem.objects.filter(
            exchange__original_sale=sale
        ).values("variant_id").annotate(total=Sum("quantity")):
            already_returned[row["variant_id"]] = (
                already_returned.get(row["variant_id"], 0) + row["total"]
            )

        errors = []
        for item in data["items"]:
            vid = item["variant_id"]
            new_qty = item["quantity"]
            original = sold_qty.get(vid)
            if original is None:
                errors.append(
                    f"La variante {vid} ne fait pas partie de cette vente."
                )
                continue
            already = already_returned.get(vid, 0)
            if already + new_qty > original:
                remaining = original - already
                errors.append(
                    f"Variante {vid}&nbsp;: {already} déjà retourné(s), "
                    f"maximum {remaining} retournable(s)."
                )
        if errors:
            raise serializers.ValidationError({"items": errors})

        return data

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

        self._reverse_loyalty(sale, return_obj, data["refund_amount"])

        # Mark sale as refunded if every sold item is now fully returned
        sold = {item.variant_id: item.quantity for item in sale.items.all()}
        returned = dict(
            ReturnItem.objects
            .filter(return_obj__original_sale=sale)
            .values("variant_id")
            .annotate(total=Sum("quantity"))
            .values_list("variant_id", "total")
        )
        if all(returned.get(vid, 0) >= qty for vid, qty in sold.items()):
            sale.status = "refunded"
            sale.save(update_fields=["status"])

        return return_obj

    @staticmethod
    def _reverse_loyalty(sale, return_obj, refund_amount):
        """Deduct loyalty points proportional to the refunded amount. Silent — never blocks a return."""
        import logging
        logger = logging.getLogger(__name__)
        try:
            if not sale.client_id:
                return
            from decimal import Decimal as D
            from apps.loyalty.models import LoyaltyAccount, LoyaltyTransaction, TransactionTypeChoices

            account = LoyaltyAccount.objects.filter(
                tenant=sale.tenant, client_id=sale.client_id
            ).first()
            if not account:
                return

            # Find the original EARN transaction for this sale
            earn_tx = LoyaltyTransaction.objects.filter(
                account=account,
                transaction_type=TransactionTypeChoices.EARN,
                reference_type="Sale",
                reference_id=str(sale.pk),
            ).first()
            if not earn_tx or earn_tx.points <= 0:
                return

            sale_total = D(sale.total_amount)
            if sale_total <= 0:
                return

            # Proportional deduction: refund_amount / sale_total × points_earned
            proportion = min(D(refund_amount) / sale_total, D("1.0"))
            pts_to_deduct = int(earn_tx.points * proportion)
            if pts_to_deduct <= 0:
                return

            pts_to_deduct = min(pts_to_deduct, account.points_balance)
            account.points_balance -= pts_to_deduct
            account.recompute_tier()
            account.save()

            LoyaltyTransaction.objects.create(
                account=account,
                points=-pts_to_deduct,
                transaction_type=TransactionTypeChoices.ADJUST,
                reference_type="Return",
                reference_id=str(return_obj.pk),
                description=f"Retour — déduction proportionnelle ({int(proportion * 100)}%)",
                balance_after=account.points_balance,
            )
        except Exception:
            logger.exception("Loyalty reversal failed for return %s — skipped.", return_obj.pk)


class CashReconciliationSerializer(serializers.ModelSerializer):
    submitted_by_name = serializers.CharField(source="submitted_by.full_name", read_only=True, default=None)
    approved_by_name = serializers.CharField(source="approved_by.full_name", read_only=True, default=None)
    branch_name = serializers.CharField(source="branch.name", read_only=True, default=None)
    gap_cash = serializers.SerializerMethodField()
    gap_cheque = serializers.SerializerMethodField()
    gap_ccp = serializers.SerializerMethodField()
    gap_virement = serializers.SerializerMethodField()
    total_system = serializers.SerializerMethodField()
    total_actual = serializers.SerializerMethodField()
    total_gap = serializers.SerializerMethodField()

    class Meta:
        model = CashReconciliation
        fields = [
            "id", "date", "branch", "branch_name", "status",
            "submitted_by", "submitted_by_name",
            "approved_by", "approved_by_name",
            "system_cash", "system_cheque", "system_ccp", "system_virement",
            "system_account", "system_sales_count", "system_total_refunds",
            "actual_cash", "actual_cheque", "actual_ccp", "actual_virement",
            "gap_cash", "gap_cheque", "gap_ccp", "gap_virement",
            "total_system", "total_actual", "total_gap",
            "notes", "approved_at", "created_at",
        ]
        read_only_fields = [
            "id", "submitted_by", "approved_by", "status",
            "system_cash", "system_cheque", "system_ccp", "system_virement",
            "system_account", "system_sales_count", "system_total_refunds",
            "approved_at", "created_at",
        ]

    def _gap(self, actual, system):
        return str(actual - system)

    def get_gap_cash(self, obj):
        return self._gap(obj.actual_cash, obj.system_cash)

    def get_gap_cheque(self, obj):
        return self._gap(obj.actual_cheque, obj.system_cheque)

    def get_gap_ccp(self, obj):
        return self._gap(obj.actual_ccp, obj.system_ccp)

    def get_gap_virement(self, obj):
        return self._gap(obj.actual_virement, obj.system_virement)

    def get_total_system(self, obj):
        return str(obj.system_cash + obj.system_cheque + obj.system_ccp + obj.system_virement)

    def get_total_actual(self, obj):
        return str(obj.actual_cash + obj.actual_cheque + obj.actual_ccp + obj.actual_virement)

    def get_total_gap(self, obj):
        actual = obj.actual_cash + obj.actual_cheque + obj.actual_ccp + obj.actual_virement
        system = obj.system_cash + obj.system_cheque + obj.system_ccp + obj.system_virement
        return str(actual - system)


class CreateReconciliationSerializer(serializers.Serializer):
    date = serializers.DateField()
    branch = serializers.IntegerField(required=False, allow_null=True)
    actual_cash = serializers.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    actual_cheque = serializers.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    actual_ccp = serializers.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    actual_virement = serializers.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    notes = serializers.CharField(required=False, allow_blank=True, default="")


# ─── Exchange input ───────────────────────────────────────────────────────────

class ExchangeReturnItemInput(serializers.Serializer):
    variant_id = serializers.IntegerField()
    quantity = serializers.IntegerField(min_value=1)


class ExchangeNewItemInput(serializers.Serializer):
    variant_id = serializers.IntegerField()
    quantity = serializers.IntegerField(min_value=1)
    unit_price = serializers.DecimalField(max_digits=12, decimal_places=2)


class CreateExchangeSerializer(serializers.Serializer):
    """
    Input for POST /api/v1/sales/{id}/exchange/
    returned_items must be a subset of the original sale's items.
    new_items can be any in-stock variant.
    """
    returned_items = ExchangeReturnItemInput(many=True, min_length=1)
    new_items = ExchangeNewItemInput(many=True, min_length=1)
    reason = serializers.CharField(required=False, allow_blank=True, default="")
    extra_payment_method = serializers.ChoiceField(
        choices=PaymentMethodChoices.choices, required=False, allow_blank=True, default=""
    )

    def validate(self, data):
        sale = self.context.get("sale")
        request = self.context.get("request")
        if not sale:
            return data

        # Hard limit: 3 exchanges per sale
        MAX_EXCHANGES = 3
        exchange_count = Exchange.objects.filter(original_sale=sale).count()
        if exchange_count >= MAX_EXCHANGES:
            raise serializers.ValidationError(
                {"non_field_errors": f"Cette vente a déjà été échangée {exchange_count} fois. Maximum {MAX_EXCHANGES} échanges par vente."}
            )

        tenant = request.tenant if request else sale.tenant

        # Build sold quantity and original price maps
        sold_qty: dict[int, int] = {}
        sold_price: dict[int, Decimal] = {}
        for item in sale.items.all():
            sold_qty[item.variant_id] = item.quantity
            sold_price[item.variant_id] = item.unit_price

        # Count already-used units per variant (returns + prior exchanges)
        already_used: dict[int, int] = {}
        for row in ReturnItem.objects.filter(
            return_obj__original_sale=sale
        ).values("variant_id").annotate(total=Sum("quantity")):
            already_used[row["variant_id"]] = row["total"]
        for row in ExchangeReturnItem.objects.filter(
            exchange__original_sale=sale
        ).values("variant_id").annotate(total=Sum("quantity")):
            already_used[row["variant_id"]] = (
                already_used.get(row["variant_id"], 0) + row["total"]
            )

        errors = []

        # Validate returned items belong to sale and have enough remaining qty
        for item in data["returned_items"]:
            vid = item["variant_id"]
            new_qty = item["quantity"]
            original = sold_qty.get(vid)
            if original is None:
                errors.append(f"La variante {vid} ne fait pas partie de cette vente.")
                continue
            already = already_used.get(vid, 0)
            if already + new_qty > original:
                remaining = original - already
                errors.append(
                    f"Variante {vid} : {already} déjà utilisé(s), "
                    f"maximum {remaining} échangeable(s)."
                )
            # Stash original price for create_exchange to use
            item["_unit_price"] = sold_price.get(vid, Decimal("0"))

        # Validate new items exist and have sufficient stock
        for item in data["new_items"]:
            vid = item["variant_id"]
            try:
                variant = Variant.objects.get(pk=vid, tenant=tenant)
                item["_variant"] = variant
                if variant.stock_qty < item["quantity"]:
                    errors.append(
                        f"Stock insuffisant pour la variante {vid} "
                        f"(disponible : {variant.stock_qty}, demandé : {item['quantity']})."
                    )
            except Variant.DoesNotExist:
                errors.append(f"La variante {vid} est introuvable.")

        if errors:
            raise serializers.ValidationError({"items": errors})

        # Compute price difference
        returned_value = sum(
            item["_unit_price"] * item["quantity"] for item in data["returned_items"]
        )
        new_value = sum(
            item["unit_price"] * item["quantity"] for item in data["new_items"]
        )
        diff = new_value - returned_value

        data["_returned_value"] = returned_value
        data["_new_value"] = new_value
        data["_price_diff"] = diff

        if diff > Decimal("0") and not data.get("extra_payment_method"):
            raise serializers.ValidationError(
                {"extra_payment_method": "Le moyen de paiement est requis quand le client paie un supplément."}
            )

        return data

    @transaction.atomic
    def create_exchange(self, sale, processed_by):
        tenant = sale.tenant
        data = self.validated_data
        diff = data["_price_diff"]

        extra_payment_amount = max(diff, Decimal("0"))
        refund_amount = max(-diff, Decimal("0"))

        exchange_obj = Exchange.objects.create(
            tenant=tenant,
            original_sale=sale,
            processed_by=processed_by,
            reason=data.get("reason", ""),
            extra_payment_amount=extra_payment_amount,
            extra_payment_method=data.get("extra_payment_method", "") if extra_payment_amount > 0 else "",
            refund_amount=refund_amount,
        )

        # Returned items: restock
        for item_data in data["returned_items"]:
            variant = Variant.objects.get(pk=item_data["variant_id"], tenant=tenant)
            ExchangeReturnItem.objects.create(
                exchange=exchange_obj,
                variant=variant,
                quantity=item_data["quantity"],
                unit_price=item_data["_unit_price"],
            )
            StockMovement.objects.create(
                tenant=tenant,
                variant=variant,
                branch=sale.branch,
                quantity_delta=item_data["quantity"],
                reason=MovementReasonChoices.RETURN,
                reference_id=str(exchange_obj.pk),
                reference_type="Exchange",
                user=processed_by,
            )

        # New items: deduct from stock
        for item_data in data["new_items"]:
            variant = item_data["_variant"]
            ExchangeNewItem.objects.create(
                exchange=exchange_obj,
                variant=variant,
                quantity=item_data["quantity"],
                unit_price=item_data["unit_price"],
            )
            StockMovement.objects.create(
                tenant=tenant,
                variant=variant,
                branch=sale.branch,
                quantity_delta=-item_data["quantity"],
                reason=MovementReasonChoices.SALE,
                reference_id=str(exchange_obj.pk),
                reference_type="Exchange",
                user=processed_by,
            )

        # Swap SaleItem variants: the sale now reflects what the customer actually has
        returned_list = data["returned_items"]
        new_list = data["new_items"]
        for ret, new in zip(returned_list, new_list):
            SaleItem.objects.filter(
                sale=sale, variant_id=ret["variant_id"]
            ).update(
                variant=new["_variant"],
                unit_price=new["unit_price"],
                discount_amount=Decimal("0.00"),
            )

        # Award loyalty points only on extra payment (customer pays more)
        if extra_payment_amount > 0 and sale.client_id:
            self._award_exchange_loyalty(sale, exchange_obj, extra_payment_amount, tenant)

        return exchange_obj

    @staticmethod
    def _award_exchange_loyalty(sale, exchange_obj, amount, tenant):
        import logging
        logger = logging.getLogger(__name__)
        try:
            from django.utils import timezone
            from apps.loyalty.models import (
                LoyaltyAccount, LoyaltyProgram,
                LoyaltyTransaction, TransactionTypeChoices,
            )

            program = LoyaltyProgram.objects.filter(tenant=tenant, is_active=True).first()
            if not program:
                return

            account, _ = LoyaltyAccount.objects.get_or_create(
                tenant=tenant, client=sale.client, defaults={"tier": "bronze"}
            )
            pts = program.points_for_amount(amount, account.tier)
            if pts <= 0:
                return

            account.points_balance += pts
            account.total_earned += pts
            account.recompute_tier()
            account.save()

            expires_at = None
            if program.expiry_months:
                expires_at = timezone.now() + timezone.timedelta(days=30 * program.expiry_months)

            LoyaltyTransaction.objects.create(
                account=account,
                points=pts,
                transaction_type=TransactionTypeChoices.EARN,
                reference_type="Exchange",
                reference_id=str(exchange_obj.pk),
                description=f"Points gagnés — supplément échange #{exchange_obj.pk}",
                balance_after=account.points_balance,
                expires_at=expires_at,
            )
        except Exception:
            logger.exception("Loyalty processing failed for exchange %s — skipped.", exchange_obj.pk)
