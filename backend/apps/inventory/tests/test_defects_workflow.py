import datetime
from decimal import Decimal
import pytest
from rest_framework.test import APIClient
from apps.core.models import User, RoleChoices, Tenant, PlanChoices
from apps.inventory.models import (
    Branch,
    CategoryChoices,
    Product,
    Variant,
    DefectItem,
    DefectStatusChoices,
    DefectReasonChoices,
)
from apps.suppliers.models import (
    Supplier,
    SupplierInvoice,
    PurchaseOrder,
    POLine,
    SupplierReturnClaim,
    ClaimStatusChoices,
)


@pytest.fixture
def tenant(db):
    return Tenant.objects.create(name="Test Tenant", plan=PlanChoices.PRO_WHOLESALE)


@pytest.fixture
def branch(tenant):
    return Branch.objects.create(tenant=tenant, name="Main Store")


@pytest.fixture
def manager_user(tenant, branch):
    return User.objects.create_user(
        email="manager@shoedz.com",
        password="password123",
        tenant=tenant,
        role=RoleChoices.MANAGER,
        first_name="Manager",
        last_name="User",
    )


@pytest.fixture
def supplier(tenant):
    return Supplier.objects.create(
        tenant=tenant,
        name="Algeria Footwear SARL",
        phone="0555123456",
    )


@pytest.fixture
def product(tenant):
    return Product.objects.create(
        tenant=tenant,
        name="Air Sport 2026",
        category=CategoryChoices.SNEAKERS,
        brand="Algeria Footwear",
    )


@pytest.fixture
def variant(tenant, product):
    return Variant.objects.create(
        tenant=tenant,
        product=product,
        size_eu=42,
        colour="Noir",
    )


@pytest.mark.django_db
class TestDefectsWorkflow:
    def test_manual_defect_logging_and_quarantine(self, tenant, branch, manager_user, variant, supplier):
        client = APIClient()
        client.force_authenticate(user=manager_user)

        # 1. Log a defective item
        res = client.post(
            "/api/v1/inventory/defects/",
            {
                "variant": str(variant.id),
                "branch": str(branch.id),
                "supplier": str(supplier.id),
                "quantity": 2,
                "cost_price": "3500.00",
                "defect_reason": "sole_unglued",
                "notes": "Semelle décollée pied gauche",
            },
            format="json",
        )
        assert res.status_code == 201, res.data
        defect_id = res.data["id"]

        defect = DefectItem.objects.get(id=defect_id)
        assert defect.status == DefectStatusChoices.QUARANTINED
        assert defect.quantity == 2
        assert defect.defect_reason == "sole_unglued"

        # 2. Check metrics endpoint
        metrics_res = client.get("/api/v1/inventory/defects/metrics/")
        assert metrics_res.status_code == 200
        assert metrics_res.data["quarantined_pairs"] == 2
        assert Decimal(metrics_res.data["quarantined_value"]) == Decimal("7000.00")

    def test_purchase_order_reception_with_defect(self, tenant, branch, manager_user, variant, supplier):
        client = APIClient()
        client.force_authenticate(user=manager_user)

        # Create PO
        po = PurchaseOrder.objects.create(
            tenant=tenant,
            supplier=supplier,
            reference="PO-TEST-001",
        )
        line = POLine.objects.create(
            order=po,
            variant=variant,
            description="Air Sport 2026 - T42",
            quantity_ordered=10,
            agreed_unit_price=Decimal("4000.00"),
        )

        # Receive PO with 10 received and 2 defective
        res = client.post(
            f"/api/v1/suppliers/purchase-orders/{po.id}/receive/",
            {
                "bl_reference": "BL-2026-99",
                "lines": [
                    {
                        "id": str(line.id),
                        "quantity_received": 10,
                        "defect_quantity": 2,
                        "defect_reason": "mismatched_size",
                        "defect_notes": "Paire dépareillée 41 et 42",
                    }
                ],
            },
            format="json",
        )
        assert res.status_code == 200, res.data

        # Verify DefectItem was created automatically
        defect = DefectItem.objects.filter(purchase_order=po).first()
        assert defect is not None
        assert defect.quantity == 2
        assert defect.defect_reason == "mismatched_size"
        assert defect.status == DefectStatusChoices.QUARANTINED

    def test_supplier_return_claim_and_credit_application(self, tenant, branch, manager_user, variant, supplier):
        client = APIClient()
        client.force_authenticate(user=manager_user)

        # Create invoice of 50,000 DZD
        SupplierInvoice.objects.create(
            tenant=tenant,
            supplier=supplier,
            invoice_number="INV-50K",
            date=datetime.date.today(),
            due_date=datetime.date.today() + datetime.timedelta(days=30),
            total_amount=Decimal("50000.00"),
        )
        supplier.recompute_balance()
        assert supplier.outstanding_balance == Decimal("50000.00")

        # Create 2 defect items
        d1 = DefectItem.objects.create(
            tenant=tenant,
            variant=variant,
            branch=branch,
            supplier=supplier,
            quantity=3,
            cost_price=Decimal("2000.00"),
            defect_reason=DefectReasonChoices.SOLE_UNGLUED,
            status=DefectStatusChoices.QUARANTINED,
        )
        d2 = DefectItem.objects.create(
            tenant=tenant,
            variant=variant,
            branch=branch,
            supplier=supplier,
            quantity=2,
            cost_price=Decimal("2500.00"),
            defect_reason=DefectReasonChoices.TORN_LEATHER,
            status=DefectStatusChoices.QUARANTINED,
        )

        # Generate claim from defect items without instant credit
        res = client.post(
            "/api/v1/inventory/defects/create-supplier-claim/",
            {
                "item_ids": [str(d1.id), str(d2.id)],
                "supplier_id": str(supplier.id),
                "apply_credit": False,
                "notes": "Marchandise défectueuse",
            },
            format="json",
        )
        assert res.status_code == 201, res.data
        claim_data = res.data["claim"]
        claim_id = claim_data["id"]

        claim = SupplierReturnClaim.objects.get(id=claim_id)
        assert claim.total_amount == Decimal("11000.00")  # (3*2000) + (2*2500)
        assert claim.status == ClaimStatusChoices.SENT

        # Refresh defect items -> should now be CLAIM_PENDING
        d1.refresh_from_db()
        d2.refresh_from_db()
        assert d1.status == DefectStatusChoices.CLAIM_PENDING
        assert d2.status == DefectStatusChoices.CLAIM_PENDING

        # Apply credit note
        apply_res = client.post(f"/api/v1/suppliers/return-claims/{claim_id}/apply-credit/")
        assert apply_res.status_code == 200, apply_res.data

        claim.refresh_from_db()
        assert claim.credit_note_applied is True
        assert claim.status == ClaimStatusChoices.ACCEPTED

        # Defect items should now be RETURNED
        d1.refresh_from_db()
        d2.refresh_from_db()
        assert d1.status == DefectStatusChoices.RETURNED
        assert d2.status == DefectStatusChoices.RETURNED

        # Check supplier balance deduction: 50,000 - 11,000 = 39,000
        supplier.refresh_from_db()
        assert supplier.outstanding_balance == Decimal("39000.00")

    def test_write_off_and_discount_sale_actions(self, tenant, branch, manager_user, variant, supplier):
        client = APIClient()
        client.force_authenticate(user=manager_user)

        defect = DefectItem.objects.create(
            tenant=tenant,
            variant=variant,
            branch=branch,
            supplier=supplier,
            quantity=1,
            cost_price=Decimal("3000.00"),
            defect_reason=DefectReasonChoices.OTHER,
            status=DefectStatusChoices.QUARANTINED,
        )

        # Write off
        res = client.post(f"/api/v1/inventory/defects/{defect.id}/resolve-write-off/")
        assert res.status_code == 200, res.data
        defect.refresh_from_db()
        assert defect.status == DefectStatusChoices.WRITTEN_OFF

        # Discount sale
        defect2 = DefectItem.objects.create(
            tenant=tenant,
            variant=variant,
            branch=branch,
            supplier=supplier,
            quantity=1,
            cost_price=Decimal("3000.00"),
            defect_reason=DefectReasonChoices.SOLE_UNGLUED,
            status=DefectStatusChoices.QUARANTINED,
        )
        res2 = client.post(f"/api/v1/inventory/defects/{defect2.id}/resolve-discount-sale/")
        assert res2.status_code == 200, res2.data
        defect2.refresh_from_db()
        assert defect2.status == DefectStatusChoices.SOLD_DISCOUNT
