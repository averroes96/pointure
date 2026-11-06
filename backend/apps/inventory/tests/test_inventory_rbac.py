from decimal import Decimal
import pytest
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient, APIRequestFactory

from apps.core.models import Branch, PlanChoices, RoleChoices, Tenant, User
from apps.inventory.models import (
    CategoryChoices,
    DefectItem,
    DefectReasonChoices,
    DefectStatusChoices,
    MovementReasonChoices,
    Product,
    StockMovement,
    StockTransfer,
    StocktakeItem,
    StocktakeSession,
    StocktakeStatusChoices,
    Variant,
)
from apps.inventory.serializers import (
    DefectItemSerializer,
    ProductListSerializer,
    ProductSerializer,
    StocktakeItemSerializer,
    StocktakeSessionDetailSerializer,
    StocktakeSessionListSerializer,
    VariantSerializer,
)
from apps.suppliers.models import Supplier, SupplierReturnClaim


@pytest.mark.django_db
class TestInventoryRBACAndGuards:
    """Tests for Task 2.3a: inventory role permissions and state guards."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.create(name="Inventory RBAC Store", plan=PlanChoices.PRO_WHOLESALE)
        self.branch_a = Branch.objects.create(tenant=self.tenant, name="Branch A", is_headquarters=True)
        self.branch_b = Branch.objects.create(tenant=self.tenant, name="Branch B")

        self.manager = User.objects.create_user(
            email="mgr-inv@test.com",
            password="password123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cashier-inv@test.com",
            password="password123",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )

        self.product = Product.objects.create(
            tenant=self.tenant,
            name="Runner Pro",
            brand="Nike",
            category=CategoryChoices.SNEAKERS,
            sale_price=Decimal("8000.00"),
            purchase_price=Decimal("5000.00"),
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
            branch=self.branch_a,
            quantity_delta=10,
            reason=MovementReasonChoices.INITIAL,
            user=self.manager,
        )

        self.supplier = Supplier.objects.create(
            tenant=self.tenant,
            name="Footwear Supplier DZ",
            phone="0550112233",
        )

        self.api = APIClient()

    # ── ProductViewSet RBAC ──────────────────────────────────────────

    def test_cashier_gets_403_on_product_write_actions(self):
        self.api.force_authenticate(user=self.cashier)

        # Read is allowed
        res_list = self.api.get("/api/v1/inventory/products/")
        assert res_list.status_code == 200

        # Create -> 403
        res_create = self.api.post(
            "/api/v1/inventory/products/",
            {"name": "Unauthorized Shoe", "sale_price": "5000.00"},
            format="json",
        )
        assert res_create.status_code == 403

        # Update (PUT) -> 403
        res_put = self.api.put(
            f"/api/v1/inventory/products/{self.product.pk}/",
            {"name": "Edited", "sale_price": "9000.00"},
            format="json",
        )
        assert res_put.status_code == 403

        # Partial update (PATCH) -> 403
        res_patch = self.api.patch(
            f"/api/v1/inventory/products/{self.product.pk}/",
            {"sale_price": "9500.00"},
            format="json",
        )
        assert res_patch.status_code == 403

        # Destroy (DELETE) -> 403
        res_del = self.api.delete(f"/api/v1/inventory/products/{self.product.pk}/")
        assert res_del.status_code == 403

    # ── StockTransferViewSet RBAC & mark_received guard ──────────────

    def test_cashier_gets_403_on_transfer_mutations_and_receive(self):
        transfer = StockTransfer.objects.create(
            tenant=self.tenant,
            from_branch=self.branch_a,
            to_branch=self.branch_b,
            variant=self.variant,
            quantity=2,
            created_by=self.manager,
        )

        self.api.force_authenticate(user=self.cashier)

        res_patch = self.api.patch(
            f"/api/v1/inventory/transfers/{transfer.pk}/",
            {"notes": "Hacked note"},
            format="json",
        )
        assert res_patch.status_code == 403

        res_put = self.api.put(
            f"/api/v1/inventory/transfers/{transfer.pk}/",
            {
                "from_branch": str(self.branch_a.pk),
                "to_branch": str(self.branch_b.pk),
                "variant": str(self.variant.pk),
                "quantity": 5,
            },
            format="json",
        )
        assert res_put.status_code == 403

        res_receive = self.api.post(f"/api/v1/inventory/transfers/{transfer.pk}/receive/")
        assert res_receive.status_code == 403

        res_del = self.api.delete(f"/api/v1/inventory/transfers/{transfer.pk}/")
        assert res_del.status_code == 403

    def test_transfer_mark_received_locks_and_refuses_second_receive(self):
        transfer = StockTransfer.objects.create(
            tenant=self.tenant,
            from_branch=self.branch_a,
            to_branch=self.branch_b,
            variant=self.variant,
            quantity=3,
            created_by=self.manager,
        )

        self.api.force_authenticate(user=self.manager)

        # First receive succeeds
        res1 = self.api.post(f"/api/v1/inventory/transfers/{transfer.pk}/receive/")
        assert res1.status_code == 200, res1.data
        assert res1.data["status"] == "received"

        movements_count = StockMovement.objects.filter(
            reference_type="StockTransfer",
            reference_id=str(transfer.pk),
        ).count()
        assert movements_count == 2

        # Second receive via API returns 400 and creates no extra movements
        res2 = self.api.post(f"/api/v1/inventory/transfers/{transfer.pk}/receive/")
        assert res2.status_code == 400
        assert (
            StockMovement.objects.filter(
                reference_type="StockTransfer",
                reference_id=str(transfer.pk),
            ).count()
            == 2
        )

        # Direct model call to mark_received also refuses a second receive
        transfer.refresh_from_db()
        with pytest.raises(ValidationError):
            transfer.mark_received(self.manager)
        assert (
            StockMovement.objects.filter(
                reference_type="StockTransfer",
                reference_id=str(transfer.pk),
            ).count()
            == 2
        )

    # ── DefectItemViewSet RBAC & state guards ────────────────────────

    def test_cashier_gets_403_on_defect_resolve_and_claim(self):
        defect = DefectItem.objects.create(
            tenant=self.tenant,
            variant=self.variant,
            branch=self.branch_a,
            supplier=self.supplier,
            quantity=1,
            cost_price=Decimal("5000.00"),
            defect_reason=DefectReasonChoices.SOLE_UNGLUED,
            status=DefectStatusChoices.QUARANTINED,
        )

        self.api.force_authenticate(user=self.cashier)

        res_wo = self.api.post(f"/api/v1/inventory/defects/{defect.pk}/resolve-write-off/")
        assert res_wo.status_code == 403

        res_disc = self.api.post(f"/api/v1/inventory/defects/{defect.pk}/resolve-discount-sale/")
        assert res_disc.status_code == 403

        res_claim = self.api.post(
            "/api/v1/inventory/defects/create-supplier-claim/",
            {"item_ids": [str(defect.pk)], "supplier_id": str(self.supplier.pk)},
            format="json",
        )
        assert res_claim.status_code == 403

    def test_defect_cannot_be_resolved_or_claimed_twice(self):
        d1 = DefectItem.objects.create(
            tenant=self.tenant,
            variant=self.variant,
            branch=self.branch_a,
            supplier=self.supplier,
            quantity=1,
            cost_price=Decimal("5000.00"),
            defect_reason=DefectReasonChoices.SOLE_UNGLUED,
            status=DefectStatusChoices.QUARANTINED,
        )
        d2 = DefectItem.objects.create(
            tenant=self.tenant,
            variant=self.variant,
            branch=self.branch_a,
            supplier=self.supplier,
            quantity=2,
            cost_price=Decimal("5000.00"),
            defect_reason=DefectReasonChoices.TORN_LEATHER,
            status=DefectStatusChoices.QUARANTINED,
        )

        self.api.force_authenticate(user=self.manager)

        # Resolve d1 as write-off
        res1 = self.api.post(f"/api/v1/inventory/defects/{d1.pk}/resolve-write-off/")
        assert res1.status_code == 200

        # Resolving d1 a second time fails with 400
        res1_again = self.api.post(f"/api/v1/inventory/defects/{d1.pk}/resolve-write-off/")
        assert res1_again.status_code == 400

        res1_discount = self.api.post(f"/api/v1/inventory/defects/{d1.pk}/resolve-discount-sale/")
        assert res1_discount.status_code == 400

        # Claiming already-resolved d1 fails with 400
        res_claim_d1 = self.api.post(
            "/api/v1/inventory/defects/create-supplier-claim/",
            {"item_ids": [str(d1.pk)], "supplier_id": str(self.supplier.pk)},
            format="json",
        )
        assert res_claim_d1.status_code == 400

        # Claim d2 once -> 201
        res_claim_d2 = self.api.post(
            "/api/v1/inventory/defects/create-supplier-claim/",
            {"item_ids": [str(d2.pk)], "supplier_id": str(self.supplier.pk), "apply_credit": False},
            format="json",
        )
        assert res_claim_d2.status_code == 201
        assert SupplierReturnClaim.objects.filter(tenant=self.tenant).count() == 1

        # Claiming d2 a second time -> 400, no extra claim created
        res_claim_d2_again = self.api.post(
            "/api/v1/inventory/defects/create-supplier-claim/",
            {"item_ids": [str(d2.pk)], "supplier_id": str(self.supplier.pk)},
            format="json",
        )
        assert res_claim_d2_again.status_code == 400
        assert SupplierReturnClaim.objects.filter(tenant=self.tenant).count() == 1

        # Resolving already-claimed d2 as discount sale or write-off -> 400
        res_d2_wo = self.api.post(f"/api/v1/inventory/defects/{d2.pk}/resolve-write-off/")
        assert res_d2_wo.status_code == 400

    # ── VariantViewSet RBAC & Repointing / Deletion Guards ──────────

    def test_cashier_gets_403_on_variant_write_actions(self):
        self.api.force_authenticate(user=self.cashier)

        # List is allowed
        res_list = self.api.get("/api/v1/inventory/variants/")
        assert res_list.status_code == 200

        # Create -> 403
        res_create = self.api.post(
            "/api/v1/inventory/variants/",
            {
                "product": str(self.product.pk),
                "size_eu": 43,
                "colour": "Bleu",
            },
            format="json",
        )
        assert res_create.status_code == 403

        # Update (PUT) -> 403
        res_put = self.api.put(
            f"/api/v1/inventory/variants/{self.variant.pk}/",
            {
                "product": str(self.product.pk),
                "size_eu": 42,
                "colour": "Noir",
                "barcode": "HACKED123",
            },
            format="json",
        )
        assert res_put.status_code == 403

        # Partial update (PATCH) -> 403
        res_patch = self.api.patch(
            f"/api/v1/inventory/variants/{self.variant.pk}/",
            {"barcode": "HACKED123"},
            format="json",
        )
        assert res_patch.status_code == 403

        # Destroy (DELETE) -> 403
        res_del = self.api.delete(f"/api/v1/inventory/variants/{self.variant.pk}/")
        assert res_del.status_code == 403

    def test_cannot_repoint_variant_to_different_product(self):
        cheaper_product = Product.objects.create(
            tenant=self.tenant,
            name="Cheap Slipper",
            brand="Generic",
            category=CategoryChoices.SLIPPERS,
            sale_price=Decimal("500.00"),
            purchase_price=Decimal("200.00"),
        )
        self.api.force_authenticate(user=self.manager)

        # Attempt to repoint variant to cheaper_product via PATCH
        res_patch = self.api.patch(
            f"/api/v1/inventory/variants/{self.variant.pk}/",
            {"product": str(cheaper_product.pk)},
            format="json",
        )
        assert res_patch.status_code == 400
        self.variant.refresh_from_db()
        assert self.variant.product == self.product

        # Attempt to repoint variant to cheaper_product via PUT
        res_put = self.api.put(
            f"/api/v1/inventory/variants/{self.variant.pk}/",
            {
                "product": str(cheaper_product.pk),
                "size_eu": 42,
                "colour": "Noir",
            },
            format="json",
        )
        assert res_put.status_code == 400
        self.variant.refresh_from_db()
        assert self.variant.product == self.product

    def test_cannot_delete_variant_with_transaction_history(self):
        self.api.force_authenticate(user=self.manager)

        # self.variant has a StockMovement in setup()
        assert self.variant.movements.exists()

        res_del = self.api.delete(f"/api/v1/inventory/variants/{self.variant.pk}/")
        assert res_del.status_code == 400
        assert res_del.data["error"]["code"] == "has_history"
        assert Variant.objects.filter(pk=self.variant.pk).exists()

        # An unused variant with 0 movements can be deleted
        clean_variant = Variant.objects.create(
            tenant=self.tenant,
            product=self.product,
            size_eu=45,
            colour="Blanc",
        )
        res_del_clean = self.api.delete(f"/api/v1/inventory/variants/{clean_variant.pk}/")
        assert res_del_clean.status_code == 204
        assert not Variant.objects.filter(pk=clean_variant.pk).exists()


@pytest.mark.django_db
class TestCostAndPurchasePriceMaskingFromCashiers:
    """Verifies that cost and purchase prices are stripped for cashiers (Task 2.3)."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.create(name="Cost Masking Store", plan=PlanChoices.PRO_WHOLESALE)
        self.branch = Branch.objects.create(tenant=self.tenant, name="Headquarters", is_headquarters=True)

        self.manager = User.objects.create_user(
            email="manager-cost@test.com",
            password="password123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cashier-cost@test.com",
            password="password123",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )

        self.product = Product.objects.create(
            tenant=self.tenant,
            name="Air Max Premium",
            brand="Nike",
            category=CategoryChoices.SNEAKERS,
            sale_price=Decimal("12000.00"),
            purchase_price=Decimal("7000.00"),
        )
        self.variant = Variant.objects.create(
            tenant=self.tenant,
            product=self.product,
            size_eu=42,
            colour="Noir",
            barcode="COST-TEST-BARCODE-01",
        )
        StockMovement.objects.create(
            tenant=self.tenant,
            variant=self.variant,
            branch=self.branch,
            quantity_delta=15,
            reason=MovementReasonChoices.INITIAL,
            user=self.manager,
        )

        self.factory = APIRequestFactory()
        self.api = APIClient()

    def test_variant_serializer_and_api_mask_purchase_price_for_cashier(self):
        # 1. Serializer direct check
        req_cashier = self.factory.get("/")
        req_cashier.user = self.cashier
        data_cashier = VariantSerializer(self.variant, context={"request": req_cashier}).data
        assert "purchase_price" not in data_cashier

        req_manager = self.factory.get("/")
        req_manager.user = self.manager
        data_manager = VariantSerializer(self.variant, context={"request": req_manager}).data
        assert "purchase_price" in data_manager
        assert Decimal(data_manager["purchase_price"]) == Decimal("7000.00")

        # 2. Endpoint check: list variants
        self.api.force_authenticate(user=self.cashier)
        res_list_cashier = self.api.get("/api/v1/inventory/variants/")
        assert res_list_cashier.status_code == 200
        assert "purchase_price" not in res_list_cashier.data["results"][0]

        self.api.force_authenticate(user=self.manager)
        res_list_manager = self.api.get("/api/v1/inventory/variants/")
        assert res_list_manager.status_code == 200
        assert "purchase_price" in res_list_manager.data["results"][0]

        # 3. Endpoint check: retrieve variant
        self.api.force_authenticate(user=self.cashier)
        res_detail_cashier = self.api.get(f"/api/v1/inventory/variants/{self.variant.pk}/")
        assert res_detail_cashier.status_code == 200
        assert "purchase_price" not in res_detail_cashier.data

        self.api.force_authenticate(user=self.manager)
        res_detail_manager = self.api.get(f"/api/v1/inventory/variants/{self.variant.pk}/")
        assert res_detail_manager.status_code == 200
        assert "purchase_price" in res_detail_manager.data

    def test_product_serializers_and_api_mask_purchase_price_and_nested_variant_costs(self):
        # 1. Serializer direct check
        req_cashier = self.factory.get("/")
        req_cashier.user = self.cashier

        prod_data_cashier = ProductSerializer(self.product, context={"request": req_cashier}).data
        assert "purchase_price" not in prod_data_cashier
        assert "pamp" not in prod_data_cashier
        assert "margin_pct" not in prod_data_cashier
        assert "purchase_price" not in prod_data_cashier["variants"][0]

        prod_list_cashier = ProductListSerializer(self.product, context={"request": req_cashier}).data
        assert "purchase_price" not in prod_list_cashier
        assert "pamp" not in prod_list_cashier
        assert "purchase_price" not in prod_list_cashier["variants"][0]

        req_manager = self.factory.get("/")
        req_manager.user = self.manager
        prod_data_manager = ProductSerializer(self.product, context={"request": req_manager}).data
        assert "purchase_price" in prod_data_manager
        assert "purchase_price" in prod_data_manager["variants"][0]

        prod_list_manager = ProductListSerializer(self.product, context={"request": req_manager}).data
        assert "purchase_price" in prod_list_manager
        assert "purchase_price" in prod_list_manager["variants"][0]

        # 2. Endpoint check: list and detail
        self.api.force_authenticate(user=self.cashier)
        res_prod_list = self.api.get("/api/v1/inventory/products/")
        assert res_prod_list.status_code == 200
        first_item = res_prod_list.data["results"][0]
        assert "purchase_price" not in first_item
        assert "purchase_price" not in first_item["variants"][0]

        res_prod_detail = self.api.get(f"/api/v1/inventory/products/{self.product.pk}/")
        assert res_prod_detail.status_code == 200
        assert "purchase_price" not in res_prod_detail.data
        assert "purchase_price" not in res_prod_detail.data["variants"][0]

        self.api.force_authenticate(user=self.manager)
        res_prod_mgr = self.api.get(f"/api/v1/inventory/products/{self.product.pk}/")
        assert res_prod_mgr.status_code == 200
        assert "purchase_price" in res_prod_mgr.data
        assert "purchase_price" in res_prod_mgr.data["variants"][0]

    def test_defect_serializer_and_api_mask_cost_price_for_cashier(self):
        defect = DefectItem.objects.create(
            tenant=self.tenant,
            variant=self.variant,
            branch=self.branch,
            quantity=1,
            cost_price=Decimal("7000.00"),
            defect_reason=DefectReasonChoices.SOLE_UNGLUED,
            logged_by=self.cashier,
        )

        # 1. Serializer direct check
        req_cashier = self.factory.get("/")
        req_cashier.user = self.cashier
        defect_data_cashier = DefectItemSerializer(defect, context={"request": req_cashier}).data
        assert "cost_price" not in defect_data_cashier

        req_manager = self.factory.get("/")
        req_manager.user = self.manager
        defect_data_manager = DefectItemSerializer(defect, context={"request": req_manager}).data
        assert "cost_price" in defect_data_manager
        assert Decimal(defect_data_manager["cost_price"]) == Decimal("7000.00")

        # 2. Endpoint check: list and detail
        self.api.force_authenticate(user=self.cashier)
        res_list_cashier = self.api.get("/api/v1/inventory/defects/")
        assert res_list_cashier.status_code == 200
        assert "cost_price" not in res_list_cashier.data["results"][0]

        res_detail_cashier = self.api.get(f"/api/v1/inventory/defects/{defect.pk}/")
        assert res_detail_cashier.status_code == 200
        assert "cost_price" not in res_detail_cashier.data

        self.api.force_authenticate(user=self.manager)
        res_detail_manager = self.api.get(f"/api/v1/inventory/defects/{defect.pk}/")
        assert res_detail_manager.status_code == 200
        assert "cost_price" in res_detail_manager.data
        assert Decimal(res_detail_manager.data["cost_price"]) == Decimal("7000.00")

    def test_stocktake_serializers_and_api_mask_cost_fields_for_cashier(self):
        session = StocktakeSession.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            title="Winter Stocktake",
            status=StocktakeStatusChoices.IN_PROGRESS,
            total_expected=15,
            total_counted=12,
            total_variance=-3,
            total_variance_cost=Decimal("-21000.00"),
            created_by=self.manager,
        )
        item = StocktakeItem.objects.create(
            tenant=self.tenant,
            session=session,
            variant=self.variant,
            expected_qty=15,
            counted_qty=12,
            unit_cost=Decimal("7000.00"),
            unit_price=Decimal("12000.00"),
        )

        # 1. Serializer direct check: StocktakeItemSerializer
        req_cashier = self.factory.get("/")
        req_cashier.user = self.cashier
        item_data_cashier = StocktakeItemSerializer(item, context={"request": req_cashier}).data
        assert "unit_cost" not in item_data_cashier
        assert "variance_cost" not in item_data_cashier
        assert "unit_price" in item_data_cashier  # Retail price is visible

        req_manager = self.factory.get("/")
        req_manager.user = self.manager
        item_data_manager = StocktakeItemSerializer(item, context={"request": req_manager}).data
        assert "unit_cost" in item_data_manager
        assert "variance_cost" in item_data_manager
        assert Decimal(item_data_manager["unit_cost"]) == Decimal("7000.00")

        # 2. Serializer direct check: StocktakeSessionListSerializer
        session_list_cashier = StocktakeSessionListSerializer(session, context={"request": req_cashier}).data
        assert "total_variance_cost" not in session_list_cashier

        session_list_manager = StocktakeSessionListSerializer(session, context={"request": req_manager}).data
        assert "total_variance_cost" in session_list_manager
        assert Decimal(session_list_manager["total_variance_cost"]) == Decimal("-21000.00")

        # 3. Endpoint check: list stocktakes
        self.api.force_authenticate(user=self.cashier)
        res_list_cashier = self.api.get("/api/v1/inventory/stocktakes/")
        assert res_list_cashier.status_code == 200
        assert "total_variance_cost" not in res_list_cashier.data["results"][0]

        self.api.force_authenticate(user=self.manager)
        res_list_manager = self.api.get("/api/v1/inventory/stocktakes/")
        assert res_list_manager.status_code == 200
        assert "total_variance_cost" in res_list_manager.data["results"][0]

        # 4. Endpoint check: retrieve stocktake detail
        self.api.force_authenticate(user=self.cashier)
        res_detail_cashier = self.api.get(f"/api/v1/inventory/stocktakes/{session.pk}/")
        assert res_detail_cashier.status_code == 200
        assert "total_variance_cost" not in res_detail_cashier.data
        first_item_cashier = res_detail_cashier.data["items"][0]
        assert "unit_cost" not in first_item_cashier
        assert "variance_cost" not in first_item_cashier
        assert "unit_price" in first_item_cashier

        self.api.force_authenticate(user=self.manager)
        res_detail_manager = self.api.get(f"/api/v1/inventory/stocktakes/{session.pk}/")
        assert res_detail_manager.status_code == 200
        assert "total_variance_cost" in res_detail_manager.data
        first_item_manager = res_detail_manager.data["items"][0]
        assert "unit_cost" in first_item_manager
        assert "variance_cost" in first_item_manager
        assert "unit_price" in first_item_manager



