"""
Tests for carton breakdown (série) and expand-cartons endpoint.
"""
from decimal import Decimal
import pytest
from rest_framework.test import APIClient
from django.core.exceptions import ValidationError

from apps.core.models import Branch, PlanChoices, RoleChoices, Tenant, User
from apps.inventory.models import MovementReasonChoices, Product, StockMovement, Variant
from apps.inventory.serializers import ProductSerializer


def _make_client(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user=user)
    return c


@pytest.mark.django_db
class TestCartonBreakdown:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.create(name="Wholesale Shop", plan=PlanChoices.PRO_WHOLESALE)
        self.headquarters = Branch.objects.create(
            tenant=self.tenant,
            name="Headquarters",
            is_headquarters=True,
        )
        self.other_branch = Branch.objects.create(
            tenant=self.tenant,
            name="Other Branch",
        )
        self.manager = User.objects.create_user(
            email="manager@carton.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.client = _make_client(self.manager)

    def test_carton_breakdown_validation(self):
        # Valid breakdown: 2 + 2 + 2 = 6, pairs_per_carton = 6
        product = Product.objects.create(
            tenant=self.tenant,
            name="Derby Classic",
            sale_price=Decimal("4000.00"),
            wholesale_price=Decimal("3200.00"),
            pairs_per_carton=6,
            carton_breakdown={"40": 2, "41": 2, "42": 2},
        )
        assert product.carton_breakdown == {"40": 2, "41": 2, "42": 2}

        # Invalid breakdown: 2 + 2 = 4 != 6 -> raises ValidationError on clean()
        p_invalid = Product(
            tenant=self.tenant,
            name="Derby Invalid",
            sale_price=Decimal("4000.00"),
            pairs_per_carton=6,
            carton_breakdown={"40": 2, "41": 2},
        )
        with pytest.raises(ValidationError):
            p_invalid.clean()

        # Serializer validation also rejects invalid breakdown
        serializer = ProductSerializer(
            data={
                "name": "Sneaker Sport",
                "sale_price": "5000.00",
                "pairs_per_carton": 8,
                "carton_breakdown": {"40": 2, "41": 2},  # sum is 4 != 8
            }
        )
        assert not serializer.is_valid()
        assert "carton_breakdown" in serializer.errors

    def test_carton_breakdown_rejects_negative_or_non_numeric_values(self):
        # Negative value {"40": -2, "41": 12}
        serializer = ProductSerializer(
            data={
                "name": "Sneaker Negative",
                "sale_price": "5000.00",
                "pairs_per_carton": 10,
                "carton_breakdown": {"40": -2, "41": 12},
            }
        )
        assert not serializer.is_valid()
        assert "carton_breakdown" in serializer.errors

        # Non-numeric value {"40": "abc"}
        serializer2 = ProductSerializer(
            data={
                "name": "Sneaker String",
                "sale_price": "5000.00",
                "pairs_per_carton": 10,
                "carton_breakdown": {"40": "abc"},
            }
        )
        assert not serializer2.is_valid()
        assert "carton_breakdown" in serializer2.errors

    @pytest.mark.parametrize(
        ("breakdown", "pairs_per_carton"),
        [
            ({"40": 1.5}, 1),
            ({"14": 1}, 1),
            ({"61": 1}, 1),
        ],
    )
    def test_carton_breakdown_rejects_fractional_quantities_and_invalid_sizes(
        self, breakdown, pairs_per_carton
    ):
        serializer = ProductSerializer(
            data={
                "name": "Invalid breakdown",
                "sale_price": "5000.00",
                "pairs_per_carton": pairs_per_carton,
                "carton_breakdown": breakdown,
            }
        )

        assert serializer.is_valid() is False
        assert set(serializer.errors) == {"carton_breakdown"}

    def test_expand_cartons_endpoint(self):
        product = Product.objects.create(
            tenant=self.tenant,
            name="Mocassin Cuir",
            sale_price=Decimal("5000.00"),
            wholesale_price=Decimal("4000.00"),
            pairs_per_carton=6,
            carton_breakdown={"40": 2, "41": 2, "42": 2},
        )
        variant_40 = Variant.objects.create(
            tenant=self.tenant,
            product=product,
            size_eu=40,
            colour="Noir",
        )
        variant_41 = Variant.objects.create(
            tenant=self.tenant,
            product=product,
            size_eu=41,
            colour="Noir",
        )
        variant_42 = Variant.objects.create(
            tenant=self.tenant,
            product=product,
            size_eu=42,
            colour="Noir",
        )

        # Branch stock intentionally differs so a global stock sum is detectable.
        for variant, hq_stock, other_stock in (
            (variant_40, 10, 2),
            (variant_41, 4, 10),
            (variant_42, 20, 1),
        ):
            for branch, quantity in (
                (self.headquarters, hq_stock),
                (self.other_branch, other_stock),
            ):
                StockMovement.objects.create(
                    tenant=self.tenant,
                    variant=variant,
                    branch=branch,
                    quantity_delta=quantity,
                    reason=MovementReasonChoices.INITIAL,
                    user=self.manager,
                )

        resp = self.client.post(
            f"/api/v1/inventory/products/{product.id}/expand-cartons/",
            {"colour": "Noir", "cartons": 3},
            format="json",
        )
        assert resp.status_code == 200, resp.data
        data = resp.data

        assert data["cartons"] == 3
        assert data["total_pairs"] == 18  # 6 pairs per carton * 3 cartons
        assert len(data["lines"]) == 3

        # Each size gets 2 * 3 = 6 pairs
        line_40 = next(l for l in data["lines"] if l["size_eu"] == 40)
        line_41 = next(l for l in data["lines"] if l["size_eu"] == 41)
        line_42 = next(l for l in data["lines"] if l["size_eu"] == 42)

        assert line_40["quantity"] == 6
        assert line_40["available_stock"] == 10
        assert line_40["is_sufficient_stock"] is True

        assert line_41["quantity"] == 6
        assert line_41["available_stock"] == 4
        assert line_41["is_sufficient_stock"] is False  # Insufficient stock reported!

        assert line_42["quantity"] == 6
        assert line_42["available_stock"] == 20
        assert line_42["is_sufficient_stock"] is True

        assert data["all_stock_sufficient"] is False

        other_branch_resp = self.client.post(
            f"/api/v1/inventory/products/{product.id}/expand-cartons/",
            {"colour": "Noir", "cartons": 3, "branch_id": str(self.other_branch.id)},
            format="json",
        )
        assert other_branch_resp.status_code == 200, other_branch_resp.data
        other_branch_line_40 = next(
            l for l in other_branch_resp.data["lines"] if l["size_eu"] == 40
        )
        assert other_branch_line_40["available_stock"] == 2

    @pytest.mark.parametrize(
        ("cartons", "error_code"),
        [(0, "min_value"), (-1, "min_value"), ("invalid", "invalid")],
    )
    def test_expand_cartons_rejects_invalid_carton_counts(self, cartons, error_code):
        product = Product.objects.create(
            tenant=self.tenant,
            name="Invalid Carton Count",
            sale_price=Decimal("2000.00"),
            pairs_per_carton=2,
            carton_breakdown={"40": 2},
        )

        resp = self.client.post(
            f"/api/v1/inventory/products/{product.id}/expand-cartons/",
            {"cartons": cartons},
            format="json",
        )

        assert resp.status_code == 400
        assert resp.data["error"]["code"] == error_code
        assert "cartons" in resp.data["error"]["details"]

    def test_expand_cartons_rejects_branch_from_another_tenant(self):
        product = Product.objects.create(
            tenant=self.tenant,
            name="Tenant Scoped Carton Product",
            sale_price=Decimal("2000.00"),
            pairs_per_carton=2,
            carton_breakdown={"40": 2},
        )
        other_tenant = Tenant.objects.create(name="Other Carton Tenant")
        foreign_branch = Branch.objects.create(
            tenant=other_tenant,
            name="Foreign Branch",
            is_headquarters=True,
        )

        resp = self.client.post(
            f"/api/v1/inventory/products/{product.id}/expand-cartons/",
            {"cartons": 1, "branch_id": str(foreign_branch.id)},
            format="json",
        )

        assert resp.status_code == 404
        assert resp.data["error"]["code"] == "not_found"

    def test_expand_cartons_without_breakdown_fails(self):
        product = Product.objects.create(
            tenant=self.tenant,
            name="Produit Simple",
            sale_price=Decimal("2000.00"),
            pairs_per_carton=10,
            carton_breakdown={},
        )
        resp = self.client.post(
            f"/api/v1/inventory/products/{product.id}/expand-cartons/",
            {"cartons": 1},
            format="json",
        )
        assert resp.status_code == 400
        assert resp.data["error"]["code"] == "no_carton_breakdown"

