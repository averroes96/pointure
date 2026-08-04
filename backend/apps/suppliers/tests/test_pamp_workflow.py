"""
Tests for Weighted Average Cost (PAMP / CUMP) dynamic recalculation on Purchase Order reception
and reporting valuation.
"""
from decimal import Decimal
import pytest
from rest_framework.test import APIClient

from apps.core.models import PlanChoices, RoleChoices, Tenant, User
from apps.inventory.models import Branch, CategoryChoices, GenderChoices, Product, Variant
from apps.sales.models import Sale, SaleItem, PaymentMethodChoices, Payment
from apps.suppliers.models import POLine, PurchaseOrder, Supplier


@pytest.fixture
def tenant(db):
    return Tenant.objects.create(name="PAMP Test Boutique", plan=PlanChoices.PRO_RETAIL)


@pytest.fixture
def branch(tenant):
    return Branch.objects.create(
        tenant=tenant,
        name="Magasin Alger Centre",
        wilaya="16",
        phone="0555000001",
    )


@pytest.fixture
def manager_user(tenant, branch):
    user = User.objects.create_user(
        email="manager_pamp@shoedz.dz",
        password="password123",
        tenant=tenant,
        role=RoleChoices.MANAGER,
        first_name="Karim",
        last_name="Manager",
    )
    return user


@pytest.fixture
def supplier(tenant):
    return Supplier.objects.create(
        tenant=tenant,
        name="Importateur Chaussures DZ",
        phone="0555112233",
    )


@pytest.fixture
def product(tenant):
    return Product.objects.create(
        tenant=tenant,
        name="Sneaker Classic Leather",
        brand="Nike",
        category=CategoryChoices.SNEAKERS,
        gender=GenderChoices.MEN,
        purchase_price=Decimal("4000.00"),
        sale_price=Decimal("8000.00"),
    )


@pytest.fixture
def variant_42(tenant, product):
    return Variant.objects.create(
        tenant=tenant,
        product=product,
        size_eu=42,
        colour="Noir",
    )


@pytest.fixture
def variant_43(tenant, product):
    return Variant.objects.create(
        tenant=tenant,
        product=product,
        size_eu=43,
        colour="Noir",
    )


@pytest.mark.django_db
class TestPampWorkflow:
    def test_product_creation_initializes_pamp_from_purchase_price(self, tenant):
        """Creating a product with a purchase_price sets initial pamp."""
        prod = Product.objects.create(
            tenant=tenant,
            name="Air Runner",
            brand="Adidas",
            purchase_price=Decimal("3500.00"),
            sale_price=Decimal("7000.00"),
        )
        assert prod.pamp == Decimal("3500.00")
        assert prod.margin_pct == Decimal("100.00")

    def test_reception_updates_pamp_dynamically(
        self, tenant, branch, manager_user, supplier, product, variant_42
    ):
        client = APIClient()
        client.force_authenticate(user=manager_user)

        # 1. First reception: 10 pairs @ 4,000 DZD
        po1 = PurchaseOrder.objects.create(
            tenant=tenant,
            supplier=supplier,
            reference="PO-001",
        )
        line1 = POLine.objects.create(
            order=po1,
            variant=variant_42,
            quantity_ordered=10,
            agreed_unit_price=Decimal("4000.00"),
        )

        res1 = client.post(
            f"/api/v1/suppliers/purchase-orders/{po1.id}/receive/",
            {
                "branch_id": branch.id,
                "lines": [{"id": str(line1.id), "quantity_received": 10}],
            },
            format="json",
        )
        assert res1.status_code == 200, res1.data

        product.refresh_from_db()
        assert product.pamp == Decimal("4000.00")
        assert product.total_stock == 10

        # 2. Second reception at a higher price: 10 pairs @ 6,000 DZD
        po2 = PurchaseOrder.objects.create(
            tenant=tenant,
            supplier=supplier,
            reference="PO-002",
        )
        line2 = POLine.objects.create(
            order=po2,
            variant=variant_42,
            quantity_ordered=10,
            agreed_unit_price=Decimal("6000.00"),
        )

        res2 = client.post(
            f"/api/v1/suppliers/purchase-orders/{po2.id}/receive/",
            {
                "branch_id": branch.id,
                "lines": [{"id": str(line2.id), "quantity_received": 10}],
            },
            format="json",
        )
        assert res2.status_code == 200, res2.data

        # Prior stock was 10 @ 4,000 = 40,000 DZD
        # New reception is 10 @ 6,000 = 60,000 DZD
        # Total stock = 20 pairs -> New PAMP = (40,000 + 60,000) / 20 = 5,000 DZD
        product.refresh_from_db()
        assert product.total_stock == 20
        assert product.pamp == Decimal("5000.00")
        # Latest purchase price is 6000.00
        assert product.purchase_price == Decimal("6000.00")
        # Margin based on PAMP: (8000 - 5000) / 5000 * 100 = 60.0%
        assert product.margin_pct == Decimal("60.00")

    def test_carton_reception_updates_pamp(
        self, tenant, branch, manager_user, supplier, product, variant_42, variant_43
    ):
        client = APIClient()
        client.force_authenticate(user=manager_user)

        po = PurchaseOrder.objects.create(
            tenant=tenant,
            supplier=supplier,
            reference="PO-CARTON-01",
        )
        line = POLine.objects.create(
            order=po,
            description="Carton 10 paires",
            quantity_ordered=10,
            agreed_unit_price=Decimal("4500.00"),
        )

        res = client.post(
            f"/api/v1/suppliers/purchase-orders/{po.id}/receive/",
            {
                "branch_id": branch.id,
                "lines": [
                    {
                        "id": str(line.id),
                        "quantity_received": 10,
                        "carton_sizes": [
                            {"variant_id": str(variant_42.id), "size_eu": 42, "colour": "Noir", "quantity": 5},
                            {"variant_id": str(variant_43.id), "size_eu": 43, "colour": "Noir", "quantity": 5},
                        ],
                    }
                ],
            },
            format="json",
        )
        assert res.status_code == 200, res.data

        product.refresh_from_db()
        assert product.total_stock == 10
        assert product.pamp == Decimal("4500.00")

    def test_stock_valuation_and_profit_loss_use_pamp(
        self, tenant, branch, manager_user, supplier, product, variant_42
    ):
        client = APIClient()
        client.force_authenticate(user=manager_user)

        # Set product pamp explicitly to 5000.00 (while purchase_price was 4000.00)
        product.pamp = Decimal("5000.00")
        product.purchase_price = Decimal("6000.00")
        product.save()

        # Seed stock directly with movement
        from apps.inventory.models import StockMovement, MovementReasonChoices
        StockMovement.objects.create(
            tenant=tenant,
            variant=variant_42,
            branch=branch,
            quantity_delta=10,
            reason=MovementReasonChoices.RECEPTION,
        )
        variant_42.refresh_stock()

        # Check stock valuation endpoint
        val_res = client.get("/api/v1/reports/stock-valuation/")
        assert val_res.status_code == 200, val_res.data
        # 10 units * 5000.00 PAMP = 50,000.00 DZD
        assert Decimal(val_res.data["total_cost"]) == Decimal("50000.00")

        # Make a sale of 2 units @ 8000.00
        sale = Sale.objects.create(
            tenant=tenant,
            branch=branch,
            cashier=manager_user,
            total_amount=Decimal("16000.00"),
        )
        SaleItem.objects.create(
            sale=sale,
            variant=variant_42,
            quantity=2,
            unit_price=Decimal("8000.00"),
        )
        Payment.objects.create(
            sale=sale,
            amount=Decimal("16000.00"),
            method=PaymentMethodChoices.CASH,
        )

        # Check profit-loss report
        pl_res = client.get("/api/v1/reports/profit-loss/?period=day")
        assert pl_res.status_code == 200, pl_res.data
        # Total revenue = 16,000.00 DZD
        # Total COGS = 2 units * 5,000.00 PAMP = 10,000.00 DZD
        # Total Gross Margin = 6,000.00 DZD (37.5%)
        assert Decimal(pl_res.data["totals"]["revenue"]) == Decimal("16000.00")
        assert Decimal(pl_res.data["totals"]["cogs"]) == Decimal("10000.00")
        assert Decimal(pl_res.data["totals"]["gross_margin"]) == Decimal("6000.00")
