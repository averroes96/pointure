"""
Tests for automatic supplier balance maintenance via signals.
"""
import datetime
from decimal import Decimal

import pytest


@pytest.mark.django_db
class TestSupplierBalance:
    """Supplier.outstanding_balance is kept in sync automatically."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.core.models import PlanChoices, Tenant
        from apps.suppliers.models import Supplier

        self.tenant = Tenant.objects.create(name="Balance Test Shop", plan=PlanChoices.PRO_WHOLESALE)
        self.supplier = Supplier.objects.create(
            tenant=self.tenant,
            name="Test Supplier",
        )

    def _make_invoice(self, amount):
        from apps.suppliers.models import SupplierInvoice
        return SupplierInvoice.objects.create(
            tenant=self.tenant,
            supplier=self.supplier,
            invoice_number=f"INV-{amount}",
            date=datetime.date.today(),
            due_date=datetime.date.today() + datetime.timedelta(days=30),
            total_amount=Decimal(str(amount)),
        )

    def _make_payment(self, amount, invoice=None):
        from apps.suppliers.models import SupplierPayment
        from apps.core.models import User, RoleChoices
        user, _ = User.objects.get_or_create(
            email="sup_pay_user@test.com",
            defaults={"tenant": self.tenant, "role": RoleChoices.OWNER},
        )
        if not user.has_usable_password():
            user.set_password("testpass123")
            user.save()
        return SupplierPayment.objects.create(
            tenant=self.tenant,
            supplier=self.supplier,
            supplier_invoice=invoice,
            amount=Decimal(str(amount)),
            method="cash",
            date=datetime.date.today(),
            recorded_by=user,
        )

    def test_invoice_increases_balance(self):
        """Creating an invoice increases the outstanding balance."""
        self.supplier.refresh_from_db()
        assert self.supplier.outstanding_balance == Decimal("0.00")

        self._make_invoice(10000)

        self.supplier.refresh_from_db()
        assert self.supplier.outstanding_balance == Decimal("10000")

    def test_payment_decreases_balance(self):
        """Creating a payment reduces the outstanding balance."""
        inv = self._make_invoice(10000)
        self._make_payment(3000, invoice=inv)

        self.supplier.refresh_from_db()
        assert self.supplier.outstanding_balance == Decimal("7000")

    def test_delete_payment_restores_balance(self):
        """Deleting a payment increases outstanding_balance back."""
        inv = self._make_invoice(10000)
        payment = self._make_payment(4000, invoice=inv)

        self.supplier.refresh_from_db()
        assert self.supplier.outstanding_balance == Decimal("6000")

        payment.delete()

        self.supplier.refresh_from_db()
        assert self.supplier.outstanding_balance == Decimal("10000")

    def test_delete_invoice_decreases_balance(self):
        """Deleting an invoice decreases outstanding_balance."""
        inv = self._make_invoice(8000)
        self.supplier.refresh_from_db()
        assert self.supplier.outstanding_balance == Decimal("8000")

        inv.delete()

        self.supplier.refresh_from_db()
        assert self.supplier.outstanding_balance == Decimal("0")


@pytest.mark.django_db
class TestSuppliersAndPromotionsRBAC:
    """Tests for Task 2.3e: cashier gets 403 on promotions mutations and suppliers endpoints."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.core.models import PlanChoices, RoleChoices, Tenant, User
        from apps.promotions.models import Promotion
        from apps.suppliers.models import Supplier

        self.tenant = Tenant.objects.create(name="RBAC 23e Shop", plan=PlanChoices.PRO_WHOLESALE)
        self.manager = User.objects.create_user(
            email="mgr-23e@test.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cashier-23e@test.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )
        self.supplier = Supplier.objects.create(
            tenant=self.tenant,
            name="Supplier 23e",
        )
        self.promo = Promotion.objects.create(
            tenant=self.tenant,
            name="Soldes Hiver",
            discount_pct=Decimal("10.00"),
            start_date=datetime.date.today(),
            is_active=True,
        )

    def test_cashier_gets_403_on_promotions_mutations(self):
        from rest_framework.test import APIClient

        api = APIClient()
        api.force_authenticate(user=self.cashier)

        # Create -> 403
        assert (
            api.post(
                "/api/v1/promotions/",
                {
                    "name": "Hacked Promo",
                    "discount_pct": "50.00",
                    "start_date": str(datetime.date.today()),
                },
                format="json",
            ).status_code
            == 403
        )
        # Update -> 403
        assert (
            api.patch(
                f"/api/v1/promotions/{self.promo.pk}/",
                {"discount_pct": "90.00"},
                format="json",
            ).status_code
            == 403
        )
        # Delete -> 403
        assert api.delete(f"/api/v1/promotions/{self.promo.pk}/").status_code == 403

    def test_cashier_gets_403_on_suppliers_endpoints(self):
        from rest_framework.test import APIClient

        api = APIClient()
        api.force_authenticate(user=self.cashier)

        assert api.get("/api/v1/suppliers/").status_code == 403
        assert (
            api.post("/api/v1/suppliers/", {"name": "New Sup"}, format="json").status_code
            == 403
        )
        assert api.get("/api/v1/suppliers/purchase-orders/").status_code == 403
        assert api.get("/api/v1/suppliers/invoices/").status_code == 403
        assert api.get("/api/v1/suppliers/payments/").status_code == 403
        assert api.get("/api/v1/suppliers/return-claims/").status_code == 403

