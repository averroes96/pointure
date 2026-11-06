from decimal import Decimal
import pytest
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient

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
    Variant,
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


