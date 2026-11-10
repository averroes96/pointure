"""
Unit & Integration tests for Location and Size Range in Purchase Orders and Shelf Labels (Task 7.12).

Tests:
1. PO creation with new_variant including location="C20" and size_range="37/41".
2. Invariant verification: size_range is product-level metadata and does NOT proc variant generation.
3. PO direct reception updates ProductLocation for target branch and persists size_range.
4. _render_shelf_label properly formats:
   - location + size_range -> "C20 (37/41)"
   - location only -> "C20"
   - size_range only -> "(37/41)"
   - neither -> "—"
5. Cashier role receives 403 permission denied on PO creation.
"""
from decimal import Decimal
import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import Branch, PlanChoices, RoleChoices, Tenant, User
from apps.inventory.models import Product, ProductLocation, Variant
from apps.inventory.views import _render_shelf_label
from apps.suppliers.models import PurchaseOrder, Supplier


@pytest.mark.django_db
class TestLocationAndSizeRange:
    @pytest.fixture(autouse=True)
    def setup_data(self):
        self.tenant = Tenant.objects.create(name="Footwear Retail Shop", plan=PlanChoices.PRO_WHOLESALE)
        self.branch = Branch.objects.create(tenant=self.tenant, name="Siège / Magasin Principal")
        self.owner = User.objects.create_user(
            phone="0555112233",
            password="testpassword",
            tenant=self.tenant,
            role=RoleChoices.OWNER,
        )
        self.cashier = User.objects.create_user(
            phone="0555445566",
            password="testpassword",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )
        self.supplier = Supplier.objects.create(
            tenant=self.tenant,
            name="Fournisseur Cuir Bab Ezzouar",
            phone="0550123456",
        )
        self.client = APIClient()

    def test_po_creation_with_location_and_size_range(self):
        """Creating a PO with a new_variant persists location and size_range without exploding variants."""
        self.client.force_authenticate(user=self.owner)
        payload = {
            "supplier": self.supplier.id,
            "reference": "BC-2026-001",
            "branch": str(self.branch.id),
            "lines": [
                {
                    "description": "Mocassin Cuir Souple",
                    "quantity_ordered": 12,
                    "agreed_unit_price": "3500.00",
                    "cartons": 1,
                    "pairs_per_carton": 12,
                    "new_variant": {
                        "product_name": "Mocassin Cuir Souple",
                        "reference": "MOC-CS-01",
                        "brand": "Pointure Brand",
                        "category": "formal",
                        "size_eu": 0,
                        "colour": "Standard",
                        "purchase_price": "3500.00",
                        "sale_price": "5200.00",
                        "pairs_per_carton": 12,
                        "location": "C20",
                        "size_range": "37/41",
                    },
                }
            ],
        }
        res = self.client.post("/api/v1/suppliers/purchase-orders/", payload, format="json")
        assert res.status_code == status.HTTP_201_CREATED, res.data

        # Verify product created with size_range
        product = Product.objects.get(tenant=self.tenant, reference="MOC-CS-01")
        assert product.name == "Mocassin Cuir Souple"
        assert product.size_range == "37/41"

        # Verify ProductLocation created for the target branch
        loc = ProductLocation.objects.get(tenant=self.tenant, product=product, branch=self.branch)
        assert loc.location == "C20"

        # CRUCIAL INVARIANT: size_range must NOT proc creation of variants!
        # Only the single standard variant (size_eu=0) must exist for this product.
        variants = Variant.objects.filter(product=product)
        assert variants.count() == 1
        v = variants.first()
        assert v.size_eu == 0
        assert v.colour == "Standard"

    def test_direct_reception_persists_location_and_size_range(self):
        """Direct reception of a PO creates variants, persists size_range, and upserts branch location."""
        self.client.force_authenticate(user=self.owner)
        payload = {
            "supplier": self.supplier.id,
            "reference": "BC-DIR-002",
            "branch": str(self.branch.id),
            "receive_immediately": True,
            "lines": [
                {
                    "description": "Basket Running Sport",
                    "quantity_ordered": 10,
                    "agreed_unit_price": "4000.00",
                    "cartons": 1,
                    "pairs_per_carton": 10,
                    "carton_sizes": [
                        {
                            "size_eu": 0,
                            "quantity": 10,
                            "new_variant": {
                                "product_name": "Basket Running Sport",
                                "reference": "RUN-SPT-01",
                                "brand": "SportWear",
                                "category": "sport",
                                "size_eu": 0,
                                "colour": "Standard",
                                "purchase_price": "4000.00",
                                "sale_price": "6000.00",
                                "pairs_per_carton": 10,
                                "location": "B05",
                                "size_range": "40-45",
                            },
                        }
                    ],
                }
            ],
        }
        res = self.client.post("/api/v1/suppliers/purchase-orders/", payload, format="json")
        assert res.status_code == status.HTTP_201_CREATED, res.data

        product = Product.objects.get(tenant=self.tenant, reference="RUN-SPT-01")
        assert product.size_range == "40-45"

        loc = ProductLocation.objects.get(tenant=self.tenant, product=product, branch=self.branch)
        assert loc.location == "B05"

        # Invariant: exactly 1 variant
        assert Variant.objects.filter(product=product).count() == 1

    def test_shelf_label_formatting(self):
        """Shelf label formats LOCATION (RANGE) -> 'C20 (37/41)', '(37/41)', or 'C20'."""
        # Case 1: Both location and size_range
        p1 = Product.objects.create(
            tenant=self.tenant,
            name="Escarpin Glamour",
            reference="ESC-01",
            sale_price=Decimal("4500.00"),
            size_range="37/41",
        )
        ProductLocation.objects.create(tenant=self.tenant, branch=self.branch, product=p1, location="C20")
        v1 = Variant.objects.create(tenant=self.tenant, product=p1, size_eu=0, colour="Standard")

        svg1 = _render_shelf_label(p1, location="C20", variant=v1)
        assert "C20 (37/41)" in svg1

        # Case 2: Location only (no size_range)
        p2 = Product.objects.create(
            tenant=self.tenant,
            name="Bottine Hiver",
            reference="BOT-01",
            sale_price=Decimal("7000.00"),
            size_range="",
        )
        ProductLocation.objects.create(tenant=self.tenant, branch=self.branch, product=p2, location="R14")
        v2 = Variant.objects.create(tenant=self.tenant, product=p2, size_eu=0, colour="Standard")

        svg2 = _render_shelf_label(p2, location="R14", variant=v2)
        assert "R14" in svg2
        assert "(" not in svg2  # no size range parenthesis

        # Case 3: Size range only (no location)
        p3 = Product.objects.create(
            tenant=self.tenant,
            name="Sandale Été",
            reference="SAN-01",
            sale_price=Decimal("2500.00"),
            size_range="36/41",
        )
        v3 = Variant.objects.create(tenant=self.tenant, product=p3, size_eu=0, colour="Standard")

        svg3 = _render_shelf_label(p3, location="", variant=v3)
        assert "(36/41)" in svg3

        # Case 4: Neither
        p4 = Product.objects.create(
            tenant=self.tenant,
            name="Chausson Maison",
            reference="CH-01",
            sale_price=Decimal("800.00"),
            size_range="",
        )
        v4 = Variant.objects.create(tenant=self.tenant, product=p4, size_eu=0, colour="Standard")

        svg4 = _render_shelf_label(p4, location="", variant=v4)
        assert ">—</div>" in svg4

    def test_cashier_denied_purchase_order_creation(self):
        """Cashier role is not permitted to create purchase orders (403 Forbidden)."""
        self.client.force_authenticate(user=self.cashier)
        payload = {
            "supplier": self.supplier.id,
            "lines": [
                {
                    "description": "Article Test",
                    "quantity_ordered": 5,
                    "agreed_unit_price": "1000.00",
                }
            ],
        }
        res = self.client.post("/api/v1/suppliers/purchase-orders/", payload, format="json")
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_po_creation_with_existing_product_carton_breakdown_does_not_crash(self):
        """Creating/receiving a PO for a product with existing carton_breakdown (12 pairs) does not crash or overwrite pairs_per_carton."""
        product = Product.objects.create(
            tenant=self.tenant,
            name="Basket 12 Paires",
            reference="BSK-12P",
            brand="SportWear",
            pairs_per_carton=12,
            carton_breakdown={"40": 2, "41": 2, "42": 2, "43": 2, "44": 2, "45": 2},
            sale_price=Decimal("5000.00"),
        )
        self.client.force_authenticate(user=self.owner)
        payload = {
            "supplier": self.supplier.id,
            "reference": "BC-CARTON-DIFF",
            "branch": str(self.branch.id),
            "receive_immediately": True,
            "lines": [
                {
                    "description": "Basket 12 Paires",
                    "quantity_ordered": 10,
                    "agreed_unit_price": "3000.00",
                    "cartons": 1,
                    "pairs_per_carton": 10,
                    "carton_sizes": [
                        {
                            "size_eu": 0,
                            "quantity": 10,
                            "new_variant": {
                                "product_id": str(product.id),
                                "product_name": "Basket 12 Paires",
                                "reference": "BSK-12P",
                                "pairs_per_carton": 10,
                            },
                        }
                    ],
                }
            ],
        }
        res = self.client.post("/api/v1/suppliers/purchase-orders/", payload, format="json")
        assert res.status_code == status.HTTP_201_CREATED, res.data
        product.refresh_from_db()
        assert product.pairs_per_carton == 12
        assert product.carton_breakdown == {"40": 2, "41": 2, "42": 2, "43": 2, "44": 2, "45": 2}
