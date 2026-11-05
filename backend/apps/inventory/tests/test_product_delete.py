from decimal import Decimal
import pytest
from rest_framework.test import APIClient

from apps.core.models import PlanChoices, RoleChoices, Tenant, User
from apps.inventory.models import MovementReasonChoices, Product, StockMovement, Variant
from apps.sales.models import Sale, SaleItem


@pytest.mark.django_db
class TestProductDelete:
    """Tests for ProductViewSet.destroy and bulk_delete (Task 1.7 / D3)."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.create(name="Delete Shop", plan=PlanChoices.PRO_RETAIL)
        self.manager = User.objects.create_user(
            email="manager-del@test.com",
            password="password123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.api = APIClient()
        self.api.force_authenticate(user=self.manager)

    def _create_product_with_variant(self, name="Test Shoe", initial_stock=5):
        product = Product.objects.create(
            tenant=self.tenant,
            name=name,
            brand="Nike",
            sale_price=Decimal("6000.00"),
            purchase_price=Decimal("4000.00"),
        )
        variant = Variant.objects.create(
            tenant=self.tenant,
            product=product,
            size_eu=42,
            colour="Noir",
        )
        if initial_stock > 0:
            StockMovement.objects.create(
                tenant=self.tenant,
                variant=variant,
                quantity_delta=initial_stock,
                reason=MovementReasonChoices.INITIAL,
                user=self.manager,
            )
            variant.refresh_stock()
        return product, variant

    def test_delete_product_without_history_succeeds(self):
        """A product with no transaction history is permanently deleted (204)."""
        product, variant = self._create_product_with_variant(name="Clean Shoe")

        resp = self.api.delete(f"/api/v1/inventory/products/{product.pk}/")
        assert resp.status_code == 204
        assert not Product.objects.filter(pk=product.pk).exists()
        assert not Variant.objects.filter(pk=variant.pk).exists()

    def test_delete_product_with_sale_returns_400_and_preserves_product(self):
        """A product referenced in a sale returns 400 (even with ?force=true) and still exists."""
        product, variant = self._create_product_with_variant(name="Sold Shoe")
        sale = Sale.objects.create(
            tenant=self.tenant,
            cashier=self.manager,
            total_amount=Decimal("6000.00"),
            status="completed",
            receipt_number="RC-DEL-0001",
        )
        SaleItem.objects.create(
            sale=sale,
            variant=variant,
            quantity=1,
            unit_price=Decimal("6000.00"),
        )

        resp = self.api.delete(f"/api/v1/inventory/products/{product.pk}/?force=true")
        assert resp.status_code == 400, resp.data
        assert resp.data.get("has_transactions") is True
        assert resp.data.get("can_archive") is True
        assert Product.objects.filter(pk=product.pk).exists()
        assert SaleItem.objects.filter(variant=variant).exists()

    def test_bulk_delete_returns_per_item_result(self):
        """Bulk delete deletes products with no history and blocks products with sales, returning per-item results."""
        clean_prod, _ = self._create_product_with_variant(name="Clean Bulk")
        sold_prod, sold_var = self._create_product_with_variant(name="Sold Bulk")

        sale = Sale.objects.create(
            tenant=self.tenant,
            cashier=self.manager,
            total_amount=Decimal("6000.00"),
            status="completed",
            receipt_number="RC-DEL-0002",
        )
        SaleItem.objects.create(
            sale=sale,
            variant=sold_var,
            quantity=1,
            unit_price=Decimal("6000.00"),
        )

        resp = self.api.post(
            "/api/v1/inventory/products/bulk-delete/",
            {"product_ids": [str(clean_prod.pk), str(sold_prod.pk)]},
            format="json",
        )
        assert resp.status_code == 200, resp.data
        assert resp.data["deleted"] == 1
        assert len(resp.data["results"]) == 2

        by_id = {item["id"]: item for item in resp.data["results"]}
        assert by_id[str(clean_prod.pk)]["deleted"] is True
        assert by_id[str(sold_prod.pk)]["deleted"] is False
        assert by_id[str(sold_prod.pk)]["reason"] == "has_transactions"

        assert not Product.objects.filter(pk=clean_prod.pk).exists()
        assert Product.objects.filter(pk=sold_prod.pk).exists()

    def test_patch_variant_stock_qty_is_ignored_for_all_roles(self):
        """PATCH /api/v1/inventory/variants/{id}/ with {"stock_qty": 999} leaves stock_qty unchanged for all roles."""
        _, variant = self._create_product_with_variant(name="ReadOnly Stock", initial_stock=5)
        assert variant.stock_qty == 5

        owner = User.objects.create_user(
            email="owner-ro@test.com",
            password="password123",
            tenant=self.tenant,
            role=RoleChoices.OWNER,
        )
        cashier = User.objects.create_user(
            email="cashier-ro@test.com",
            password="password123",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )

        for user in (owner, self.manager, cashier):
            self.api.force_authenticate(user=user)
            resp = self.api.patch(
                f"/api/v1/inventory/variants/{variant.pk}/",
                {"stock_qty": 999},
                format="json",
            )
            assert resp.status_code in (200, 403), resp.data
            variant.refresh_from_db()
            assert variant.stock_qty == 5


