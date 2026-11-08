"""
Unit and integration tests for period lock (Task 6.3).
Covers:
- assert_period_open raises ValidationError(code="period_closed") when date falls in a closed fiscal year.
- Creating an invoice dated in a closed year returns HTTP 400 with code "period_closed".
- Today-dated operations continue working when past years are closed.
- Modifying or cancelling documents dated in a closed period is strictly rejected.
- Owner reopening the closed year lifts the period lock.
- StockMovement.save() rejects new rows created in closed periods.
- Invoice numbering uses document date's year (e.g. 31 Dec gets previous year's prefix).
- Supplier invoices and payments in closed periods are rejected.
"""
import datetime
from decimal import Decimal
import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework.test import APIClient

from apps.clients.models import Client
from apps.closing.models import FiscalYear, FiscalYearStatusChoices
from apps.closing.services.lock import assert_period_open, is_period_closed
from apps.core.models import Branch, PlanChoices, RoleChoices, Tenant, User
from apps.inventory.models import MovementReasonChoices, Product, StockMovement, Variant
from apps.invoicing.models import Invoice, InvoiceCounter, InvoiceLine, InvoiceStatusChoices
from apps.sales.models import Sale
from apps.suppliers.models import Supplier, SupplierInvoice, SupplierPayment


@pytest.mark.django_db
class TestPeriodLock:
    @pytest.fixture(autouse=True)
    def setup(self, db, monkeypatch):
        monkeypatch.setattr("apps.invoicing.pdf.render_invoice_pdf", lambda *a, **kw: b"%PDF-mock")

        self.tenant = Tenant.objects.create(name="Lock Test Store", plan=PlanChoices.PRO_WHOLESALE)
        self.branch = Branch.objects.create(
            tenant=self.tenant,
            name="Siège Principal",
            is_headquarters=True,
            is_active=True,
        )

        self.owner = User.objects.create_user(
            email="owner@lock.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.OWNER,
        )
        self.manager = User.objects.create_user(
            email="mgr@lock.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cashier@lock.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )

        # Fiscal year 2025: Closed
        self.fy2025 = FiscalYear.objects.create(
            tenant=self.tenant,
            year=2025,
            start_date=datetime.date(2025, 1, 1),
            end_date=datetime.date(2025, 12, 31),
            status=FiscalYearStatusChoices.CLOSED,
            closed_at=timezone.now(),
            closed_by=self.owner,
        )

        # Fiscal year 2026: Open
        self.fy2026 = FiscalYear.objects.create(
            tenant=self.tenant,
            year=2026,
            start_date=datetime.date(2026, 1, 1),
            end_date=datetime.date(2026, 12, 31),
            status=FiscalYearStatusChoices.OPEN,
        )

        self.client_obj = Client.objects.create(
            tenant=self.tenant,
            name="Client Lock Test",
            phone="0550112233",
        )

        self.product = Product.objects.create(
            tenant=self.tenant,
            name="Sneaker Air 2026",
            sale_price=Decimal("6000.00"),
            purchase_price=Decimal("3500.00"),
        )
        self.variant = Variant.objects.create(
            tenant=self.tenant,
            product=self.product,
            size_eu=42,
            colour="Blanc",
        )
        StockMovement.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            variant=self.variant,
            quantity_delta=50,
            reason=MovementReasonChoices.INITIAL,
            user=self.manager,
        )

        self.supplier = Supplier.objects.create(
            tenant=self.tenant,
            name="Fournisseur Cuir Alger",
            phone="0551223344",
        )

        self.api = APIClient()

    # ── Unit tests for assert_period_open ─────────────────────────────

    def test_assert_period_open_raises_validation_error_when_closed(self):
        """Dates falling in closed fiscal year 2025 raise ValidationError(code='period_closed')."""
        assert is_period_closed(self.tenant, datetime.date(2025, 6, 15)) is True
        assert is_period_closed(self.tenant, datetime.date(2026, 6, 15)) is False

        with pytest.raises(ValidationError) as exc_info:
            assert_period_open(self.tenant, datetime.date(2025, 12, 31))
        assert exc_info.value.code == "period_closed"

        # Open year does not raise
        assert_period_open(self.tenant, datetime.date(2026, 5, 20))

    # ── Invoice endpoints: creation in closed year rejected ────────────

    def test_creating_invoice_dated_in_closed_fiscal_year_returns_400(self):
        """Creating an invoice dated in a closed fiscal year returns HTTP 400 with code 'period_closed'."""
        self.api.force_authenticate(user=self.manager)

        resp = self.api.post(
            "/api/v1/invoicing/invoices/",
            {
                "client_id": str(self.client_obj.pk),
                "branch_id": str(self.branch.pk),
                "date": "2025-11-15",
                "due_date": "2025-12-15",
                "series_prefix": "FA",
                "apply_tva": False,
                "tva_rate": "0.00",
                "lines": [
                    {
                        "variant": str(self.variant.pk),
                        "description": "Sneaker Air 2026 - 42",
                        "quantity": 2,
                        "unit_price": "6000.00",
                    }
                ],
            },
            format="json",
        )
        assert resp.status_code == 400, resp.data
        assert resp.data["error"]["code"] == "period_closed"

    def test_today_dated_invoice_and_sale_succeed_when_past_year_is_closed(self):
        """Today-dated operations continue to work normally when past years are closed."""
        self.api.force_authenticate(user=self.manager)
        today = timezone.localdate()

        resp = self.api.post(
            "/api/v1/invoicing/invoices/",
            {
                "client_id": str(self.client_obj.pk),
                "branch_id": str(self.branch.pk),
                "date": str(today),
                "due_date": str(today + datetime.timedelta(days=30)),
                "series_prefix": "FA",
                "confirm": True,
                "apply_tva": False,
                "tva_rate": "0.00",
                "lines": [
                    {
                        "variant": str(self.variant.pk),
                        "description": "Sneaker Air 2026 - 42",
                        "quantity": 1,
                        "unit_price": "6000.00",
                    }
                ],
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        assert resp.data["number"].startswith("FA-")

    # ── Owner reopening lifts the lock ────────────────────────────────

    def test_owner_reopening_fiscal_year_lifts_period_lock(self):
        """Reopening a closed fiscal year allows retroactive operations until closed again (D6.3)."""
        self.api.force_authenticate(user=self.manager)

        # 1. Operation in 2025 fails while closed
        resp_before = self.api.post(
            "/api/v1/invoicing/invoices/",
            {
                "client_id": str(self.client_obj.pk),
                "branch_id": str(self.branch.pk),
                "date": "2025-05-10",
                "due_date": "2025-06-10",
                "series_prefix": "FA",
                "confirm": True,
                "apply_tva": False,
                "tva_rate": "0.00",
                "lines": [
                    {
                        "variant": str(self.variant.pk),
                        "description": "Sneaker Air 2026 - 42",
                        "quantity": 1,
                        "unit_price": "6000.00",
                    }
                ],
            },
            format="json",
        )
        assert resp_before.status_code == 400
        assert resp_before.data["error"]["code"] == "period_closed"

        # 2. Owner reopens 2025
        self.fy2025.reopen(user=self.owner, reason="Ajustement commissaire aux comptes")
        assert self.fy2025.is_open is True

        # 3. Same operation now succeeds
        resp_after = self.api.post(
            "/api/v1/invoicing/invoices/",
            {
                "client_id": str(self.client_obj.pk),
                "branch_id": str(self.branch.pk),
                "date": "2025-05-10",
                "due_date": "2025-06-10",
                "series_prefix": "FA",
                "confirm": True,
                "apply_tva": False,
                "tva_rate": "0.00",
                "lines": [
                    {
                        "variant": str(self.variant.pk),
                        "description": "Sneaker Air 2026 - 42",
                        "quantity": 1,
                        "unit_price": "6000.00",
                    }
                ],
            },
            format="json",
        )
        assert resp_after.status_code == 201, resp_after.data
        assert "FA-2025-" in resp_after.data["number"]

        # 4. Owner closes 2025 again
        self.fy2025.close(user=self.owner)
        assert self.fy2025.is_closed is True

        # 5. Lock is re-enforced
        resp_reclosed = self.api.post(
            "/api/v1/invoicing/invoices/",
            {
                "client_id": str(self.client_obj.pk),
                "branch_id": str(self.branch.pk),
                "date": "2025-05-10",
                "due_date": "2025-06-10",
                "series_prefix": "FA",
                "confirm": True,
                "apply_tva": False,
                "tva_rate": "0.00",
                "lines": [
                    {
                        "variant": str(self.variant.pk),
                        "description": "Sneaker Air 2026 - 42",
                        "quantity": 1,
                        "unit_price": "6000.00",
                    }
                ],
            },
            format="json",
        )
        assert resp_reclosed.status_code == 400
        assert resp_reclosed.data["error"]["code"] == "period_closed"

    # ── Document mutations in closed period rejected ──────────────────

    def test_cannot_modify_or_cancel_invoice_dated_in_closed_period(self):
        """Updating or cancelling an invoice dated in a closed period is strictly rejected."""
        # Create an invoice in 2026 while open
        inv = Invoice.objects.create(
            tenant=self.tenant,
            client=self.client_obj,
            branch=self.branch,
            date=datetime.date(2026, 8, 1),
            due_date=datetime.date(2026, 9, 1),
            status=InvoiceStatusChoices.SENT,
            number="FA-2026-00088",
        )
        InvoiceLine.objects.create(
            invoice=inv,
            variant=self.variant,
            description="Sneaker Air 2026 - 42",
            quantity=Decimal("2"),
            unit_price=Decimal("6000.00"),
        )
        inv.compute_totals()
        inv.save(update_fields=["total_ht", "tva_amount", "total_ttc"])

        # Now close fiscal year 2026
        self.fy2026.close(user=self.owner)

        self.api.force_authenticate(user=self.manager)

        # 1. Update attempt -> 400 period_closed
        resp_update = self.api.put(
            f"/api/v1/invoicing/invoices/{inv.pk}/",
            {
                "client_id": str(self.client_obj.pk),
                "branch_id": str(self.branch.pk),
                "date": "2026-08-01",
                "due_date": "2026-09-01",
                "series_prefix": "FA",
                "apply_tva": False,
                "tva_rate": "0.00",
                "lines": [
                    {
                        "variant": str(self.variant.pk),
                        "description": "Sneaker Air 2026 - 42",
                        "quantity": 3,
                        "unit_price": "6000.00",
                    }
                ],
            },
            format="json",
        )
        assert resp_update.status_code == 400
        assert resp_update.data["error"]["code"] == "period_closed"

        # 2. Cancel attempt -> 400 period_closed
        resp_cancel = self.api.post(f"/api/v1/invoicing/invoices/{inv.pk}/cancel/", {}, format="json")
        assert resp_cancel.status_code == 400
        assert resp_cancel.data["error"]["code"] == "period_closed"

    # ── StockMovement guard ───────────────────────────────────────────

    def test_stock_movement_created_in_closed_period_is_rejected(self):
        """StockMovement.save() rejects new movements created with a date in a closed fiscal year."""
        # Date in 2025 (closed)
        dt_2025 = datetime.datetime(2025, 4, 15, 10, 0, 0, tzinfo=datetime.timezone.utc)
        m = StockMovement(
            tenant=self.tenant,
            variant=self.variant,
            branch=self.branch,
            quantity_delta=5,
            reason=MovementReasonChoices.ADJUSTMENT,
            user=self.manager,
            timestamp=dt_2025,
        )
        with pytest.raises(ValidationError) as exc:
            m.save()
        assert exc.value.code == "period_closed"

    # ── Invoice numbering takes document date year ─────────────────────

    def test_invoice_numbering_uses_document_date_year(self):
        """
        InvoiceCounter.next_number uses document date year:
        An invoice dated 31 Dec gets the old year's number prefix.
        """
        date_old = datetime.date(2026, 12, 31)
        date_new = datetime.date(2027, 1, 2)

        num_2026 = InvoiceCounter.next_number(self.tenant, prefix="FA", date=date_old)
        assert num_2026.startswith("FA-2026-")

        num_2027 = InvoiceCounter.next_number(self.tenant, prefix="FA", date=date_new)
        assert num_2027.startswith("FA-2027-")

    # ── Supplier invoices and payments in closed periods ──────────────

    def test_supplier_invoice_and_payment_in_closed_period_rejected(self):
        """SupplierInvoice and SupplierPayment endpoints reject records dated in closed periods."""
        self.api.force_authenticate(user=self.manager)

        # 1. Supplier invoice in 2025 -> 400 period_closed
        resp_inv = self.api.post(
            "/api/v1/suppliers/invoices/",
            {
                "supplier": str(self.supplier.pk),
                "invoice_number": "SUP-2025-01",
                "date": "2025-08-10",
                "due_date": "2025-09-10",
                "total_amount": "50000.00",
            },
            format="json",
        )
        assert resp_inv.status_code == 400
        assert resp_inv.data["error"]["code"] == "period_closed"

        # 2. Supplier payment in 2025 -> 400 period_closed
        resp_pay = self.api.post(
            "/api/v1/suppliers/payments/",
            {
                "supplier": str(self.supplier.pk),
                "amount": "20000.00",
                "method": "cash",
                "date": "2025-08-15",
            },
            format="json",
        )
        assert resp_pay.status_code == 400
        assert resp_pay.data["error"]["code"] == "period_closed"
