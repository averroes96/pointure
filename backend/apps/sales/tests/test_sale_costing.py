"""
Tests for sale line costing and revenue calculations (Task 6.1).
Covers:
- Recording unit_cost on sale items and exchanges at creation time.
- Ensuring historical COGS in profit/loss report does not drift when PAMP changes.
- Revenue calculation in best_sellers, sales_by_period, and daily reports accounting
  for quantity and discount amounts.
- Invoicing line unit_cost recording.
"""
from decimal import Decimal
import pytest
from rest_framework.test import APIClient

from apps.core.models import PlanChoices, RoleChoices, Tenant, User
from apps.inventory.models import MovementReasonChoices, Product, StockMovement, Variant
from apps.inventory.services.costing import current_unit_cost
from apps.invoicing.models import InvoiceLine
from apps.sales.models import ExchangeNewItem, PaymentMethodChoices, Sale, SaleItem


@pytest.mark.django_db
class TestSaleCostingAndReports:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.create(name="Costing Test Shop", plan=PlanChoices.PRO_RETAIL)
        self.manager = User.objects.create_user(
            email="manager@costing.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cashier@costing.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )

        # Product with PAMP > 0
        self.product = Product.objects.create(
            tenant=self.tenant,
            name="Air Max Runner",
            brand="Nike",
            sale_price=Decimal("12000.00"),
            purchase_price=Decimal("7000.00"),
            pamp=Decimal("7500.00"),
        )
        self.variant = Variant.objects.create(
            tenant=self.tenant,
            product=self.product,
            size_eu=42,
            colour="Noir",
        )
        StockMovement.objects.create(
            tenant=self.tenant,
            variant=self.variant,
            quantity_delta=50,
            reason=MovementReasonChoices.RECEPTION,
            user=self.manager,
        )
        self.variant.refresh_stock()

        self.client = APIClient()

    def test_current_unit_cost_helper(self):
        """Helper returns PAMP if > 0, else purchase_price, fallback Decimal('0.00')."""
        assert current_unit_cost(self.variant) == Decimal("7500.00")

        # Zero PAMP falls back to purchase_price
        Product.objects.filter(pk=self.product.pk).update(pamp=Decimal("0.00"), purchase_price=Decimal("7000.00"))
        self.variant.refresh_from_db()
        assert current_unit_cost(self.variant) == Decimal("7000.00")

        # Both zero falls back to 0.00
        Product.objects.filter(pk=self.product.pk).update(pamp=Decimal("0.00"), purchase_price=Decimal("0.00"))
        self.variant.refresh_from_db()
        assert current_unit_cost(self.variant) == Decimal("0.00")

        # None variant
        assert current_unit_cost(None) == Decimal("0.00")

    def test_sale_creation_records_unit_cost_from_pamp(self):
        """Creating a sale via API records unit_cost equal to current PAMP and unit_cost_estimated=False."""
        self.client.force_authenticate(user=self.cashier)
        payload = {
            "items": [
                {
                    "variant_id": str(self.variant.pk),
                    "quantity": 2,
                    "unit_price": "12000.00",
                    "discount_amount": "500.00",
                }
            ],
            "payments": [
                {
                    "amount": "23500.00",
                    "method": PaymentMethodChoices.CASH,
                }
            ],
        }
        res = self.client.post("/api/v1/sales/", payload, format="json")
        assert res.status_code == 201, res.data

        sale_item = SaleItem.objects.get(sale_id=res.data["id"])
        assert sale_item.unit_cost == Decimal("7500.00")
        assert sale_item.unit_cost_estimated is False

    def test_sale_creation_falls_back_to_purchase_price_when_pamp_zero(self):
        """When PAMP is 0, sale records purchase_price as unit_cost."""
        self.product.pamp = Decimal("0.00")
        self.product.purchase_price = Decimal("6800.00")
        self.product.save()

        self.client.force_authenticate(user=self.cashier)
        payload = {
            "items": [
                {
                    "variant_id": str(self.variant.pk),
                    "quantity": 1,
                    "unit_price": "12000.00",
                    "discount_amount": "0.00",
                }
            ],
            "payments": [
                {
                    "amount": "12000.00",
                    "method": PaymentMethodChoices.CASH,
                }
            ],
        }
        res = self.client.post("/api/v1/sales/", payload, format="json")
        assert res.status_code == 201, res.data

        sale_item = SaleItem.objects.get(sale_id=res.data["id"])
        assert sale_item.unit_cost == Decimal("6800.00")
        assert sale_item.unit_cost_estimated is False

    def test_changing_pamp_afterwards_does_not_change_historical_cogs(self):
        """
        Changing PAMP after a sale does NOT alter historical COGS in profit/loss report.
        Initial sale: 2 units @ PAMP 7,500.00 -> COGS = 15,000.00.
        PAMP updated later to 10,000.00 -> Historical COGS must remain 15,000.00.
        """
        self.client.force_authenticate(user=self.cashier)
        payload = {
            "items": [
                {
                    "variant_id": str(self.variant.pk),
                    "quantity": 2,
                    "unit_price": "12000.00",
                    "discount_amount": "0.00",
                }
            ],
            "payments": [
                {
                    "amount": "24000.00",
                    "method": PaymentMethodChoices.CASH,
                }
            ],
        }
        res = self.client.post("/api/v1/sales/", payload, format="json")
        assert res.status_code == 201, res.data

        # Manager checks profit/loss report
        self.client.force_authenticate(user=self.manager)
        pl_res = self.client.get("/api/v1/reports/profit-loss/?period=day")
        assert pl_res.status_code == 200, pl_res.data
        assert Decimal(str(pl_res.data["totals"]["cogs"])) == Decimal("15000.00")
        assert Decimal(str(pl_res.data["totals"]["gross_margin"])) == Decimal("9000.00")

        # Now simulate a subsequent PO reception or price change that alters PAMP
        self.product.pamp = Decimal("10000.00")
        self.product.save()

        # Profit/Loss report must STILL report COGS = 15000.00 (not 20000.00)
        pl_res2 = self.client.get("/api/v1/reports/profit-loss/?period=day")
        assert pl_res2.status_code == 200, pl_res2.data
        assert Decimal(str(pl_res2.data["totals"]["cogs"])) == Decimal("15000.00")
        assert Decimal(str(pl_res2.data["totals"]["gross_margin"])) == Decimal("9000.00")

    def test_best_sellers_revenue_accounts_for_quantity_and_discount(self):
        """
        best_sellers must compute revenue as Sum(quantity * unit_price - discount_amount),
        NOT Sum(unit_price).
        """
        self.client.force_authenticate(user=self.manager)
        payload = {
            "items": [
                {
                    "variant_id": str(self.variant.pk),
                    "quantity": 4,
                    "unit_price": "10000.00",
                    "discount_amount": "1000.00",
                }
            ],
            "payments": [
                {
                    "amount": "39000.00",
                    "method": PaymentMethodChoices.CASH,
                }
            ],
        }
        res = self.client.post("/api/v1/sales/", payload, format="json")
        assert res.status_code == 201, res.data

        self.client.force_authenticate(user=self.manager)
        bs_res = self.client.get("/api/v1/reports/best-sellers/")
        assert bs_res.status_code == 200, bs_res.data
        assert len(bs_res.data) == 1
        item = bs_res.data[0]
        assert item["units_sold"] == 4
        # Revenue must be 4 * 10000.00 - 1000.00 = 39000.00 (not 10000.00)
        assert Decimal(str(item["revenue"])) == Decimal("39000.00")

    def test_sales_by_period_top_products_revenue(self):
        """Top products in sales-by-period must account for quantity and discount."""
        self.client.force_authenticate(user=self.manager)
        payload = {
            "items": [
                {
                    "variant_id": str(self.variant.pk),
                    "quantity": 3,
                    "unit_price": "8000.00",
                    "discount_amount": "400.00",
                }
            ],
            "payments": [
                {
                    "amount": "23600.00",
                    "method": PaymentMethodChoices.CASH,
                }
            ],
        }
        res = self.client.post("/api/v1/sales/", payload, format="json")
        assert res.status_code == 201, res.data

        self.client.force_authenticate(user=self.manager)
        sbp_res = self.client.get("/api/v1/reports/sales-by-period/?period=day")
        assert sbp_res.status_code == 200, sbp_res.data
        top = sbp_res.data["top_products"]
        assert len(top) == 1
        assert top[0]["units_sold"] == 3
        # 3 * 8000.00 - 400.00 = 23600.00
        assert Decimal(str(top[0]["revenue"])) == Decimal("23600.00")

    def test_daily_report_top_products_revenue(self):
        """Top products in daily report must account for quantity and discount."""
        self.client.force_authenticate(user=self.manager)
        payload = {
            "items": [
                {
                    "variant_id": str(self.variant.pk),
                    "quantity": 2,
                    "unit_price": "5000.00",
                    "discount_amount": "200.00",
                }
            ],
            "payments": [
                {
                    "amount": "9800.00",
                    "method": PaymentMethodChoices.CASH,
                }
            ],
        }
        res = self.client.post("/api/v1/sales/", payload, format="json")
        assert res.status_code == 201, res.data

        self.client.force_authenticate(user=self.manager)
        daily_res = self.client.get("/api/v1/reports/daily/")
        assert daily_res.status_code == 200, daily_res.data
        top = daily_res.data["top_products"]
        assert len(top) == 1
        assert top[0]["units"] == 2
        # 2 * 5000.00 - 200.00 = 9800.00
        assert Decimal(str(top[0]["revenue"])) == Decimal("9800.00")

    def test_exchange_records_unit_cost(self):
        """Exchange creates ExchangeNewItem with unit_cost and updates swapped SaleItem unit_cost."""
        # Create a second variant with different cost
        product2 = Product.objects.create(
            tenant=self.tenant,
            name="Air Max Plus",
            brand="Nike",
            sale_price=Decimal("15000.00"),
            purchase_price=Decimal("9000.00"),
            pamp=Decimal("9200.00"),
        )
        variant2 = Variant.objects.create(
            tenant=self.tenant,
            product=product2,
            size_eu=43,
            colour="Blanc",
        )
        StockMovement.objects.create(
            tenant=self.tenant,
            variant=variant2,
            quantity_delta=10,
            reason=MovementReasonChoices.RECEPTION,
            user=self.manager,
        )
        variant2.refresh_stock()

        # Initial sale of variant 1
        self.client.force_authenticate(user=self.cashier)
        res = self.client.post(
            "/api/v1/sales/",
            {
                "items": [
                    {
                        "variant_id": str(self.variant.pk),
                        "quantity": 1,
                        "unit_price": "12000.00",
                        "discount_amount": "0.00",
                    }
                ],
                "payments": [{"amount": "12000.00", "method": "cash"}],
            },
            format="json",
        )
        assert res.status_code == 201
        sale_id = res.data["id"]

        # Exchange: return variant 1, take variant 2 (extra 3000.00)
        self.client.force_authenticate(user=self.manager)
        ex_res = self.client.post(
            f"/api/v1/sales/{sale_id}/exchange/",
            {
                "returned_items": [{"variant_id": str(self.variant.pk), "quantity": 1}],
                "new_items": [
                    {"variant_id": str(variant2.pk), "quantity": 1, "unit_price": "15000.00"}
                ],
                "extra_payment_method": "cash",
            },
            format="json",
        )
        assert ex_res.status_code == 200, ex_res.data

        # Check ExchangeNewItem
        from apps.sales.models import Exchange
        exchange = Exchange.objects.get(original_sale_id=sale_id)
        new_item = ExchangeNewItem.objects.get(exchange=exchange)
        assert new_item.unit_cost == Decimal("9200.00")
        assert new_item.unit_cost_estimated is False

        # Swapped SaleItem must reflect variant2 and its unit_cost
        swapped_sale_item = SaleItem.objects.get(sale_id=sale_id)
        assert swapped_sale_item.variant == variant2
        assert swapped_sale_item.unit_cost == Decimal("9200.00")
        assert swapped_sale_item.unit_cost_estimated is False

    def test_invoicing_line_records_unit_cost(self):
        """Invoicing line creation records unit_cost and unit_cost_estimated=False."""
        self.tenant.plan = PlanChoices.ENTERPRISE
        self.tenant.save()
        from apps.clients.models import Client
        client = Client.objects.create(tenant=self.tenant, name="Invoicing Client", phone="0550112233")
        self.client.force_authenticate(user=self.manager)

        inv_payload = {
            "client": str(client.pk),
            "date": "2026-11-06",
            "due_date": "2026-12-06",
            "lines": [
                {
                    "variant": str(self.variant.pk),
                    "description": "Nike Air Max",
                    "quantity": "5.00",
                    "unit_price": "14000.00",
                }
            ],
        }
        res = self.client.post("/api/v1/invoicing/invoices/", inv_payload, format="json")
        assert res.status_code == 201, res.data

        line = InvoiceLine.objects.get(invoice_id=res.data["id"])
        assert line.unit_cost == Decimal("7500.00")
        assert line.unit_cost_estimated is False

    def test_backfill_logic_for_legacy_null_unit_cost(self):
        """Existing legacy rows with unit_cost=None are backfilled with PAMP and unit_cost_estimated=True."""
        # Create a sale item manually with unit_cost=None (simulating legacy data)
        sale = Sale.objects.create(tenant=self.tenant, cashier=self.manager, status="completed", total_amount=Decimal("12000.00"))
        legacy_item = SaleItem.objects.create(
            sale=sale,
            variant=self.variant,
            quantity=1,
            unit_price=Decimal("12000.00"),
            unit_cost=None,
            unit_cost_estimated=False,
        )
        assert legacy_item.unit_cost is None

        # Run the backfill logic (identical to migration 0009)
        import importlib
        migration_0009 = importlib.import_module("apps.sales.migrations.0009_exchangenewitem_unit_cost_and_more")
        backfill_sale_costs = migration_0009.backfill_sale_costs
        from django.apps import apps
        backfill_sale_costs(apps, None)

        legacy_item.refresh_from_db()
        assert legacy_item.unit_cost == Decimal("7500.00")
        assert legacy_item.unit_cost_estimated is True

    def test_unit_cost_hidden_from_cashier_in_sale_and_invoice_responses(self):
        """
        Cashiers (can_see_costs=False) must not see unit_cost or unit_cost_estimated
        in SaleItemSerializer or InvoiceLineSerializer API responses, whereas managers do.
        """
        self.client.force_authenticate(user=self.cashier)
        payload = {
            "items": [
                {
                    "variant_id": str(self.variant.pk),
                    "quantity": 1,
                    "unit_price": "12000.00",
                    "discount_amount": "0.00",
                }
            ],
            "payments": [{"amount": "12000.00", "method": PaymentMethodChoices.CASH}],
        }
        res_cashier = self.client.post("/api/v1/sales/", payload, format="json")
        assert res_cashier.status_code == 201
        cashier_item = res_cashier.data["items"][0]
        assert "unit_cost" not in cashier_item
        assert "unit_cost_estimated" not in cashier_item

        # GET /api/v1/sales/{id}/ as cashier also masks unit_cost
        get_cashier = self.client.get(f"/api/v1/sales/{res_cashier.data['id']}/")
        assert get_cashier.status_code == 200
        assert "unit_cost" not in get_cashier.data["items"][0]

        # GET /api/v1/sales/{id}/ as manager includes unit_cost
        self.client.force_authenticate(user=self.manager)
        get_mgr = self.client.get(f"/api/v1/sales/{res_cashier.data['id']}/")
        assert get_mgr.status_code == 200
        assert Decimal(str(get_mgr.data["items"][0]["unit_cost"])) == Decimal("7500.00")

