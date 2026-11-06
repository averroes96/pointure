"""
Unit and integration tests for fiscal year management closing & snapshots (Task 6.2).
Covers:
- Stock snapshot as of end_date (23:59:59 Africa/Algiers).
- Movements after end_date are excluded, except the linked year-end stocktake session's.
- Client and supplier ledger balance point-in-time calculation.
- Pending cheques tracking.
- Yearly revenue, stamp duty, TVA and COGS computation.
- Snapshot recomputability when open vs frozen when closed.
- Closing and reopening lifecycle.
"""
import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo
import pytest
from django.core.exceptions import ValidationError

from apps.clients.models import Cheque, ChequeDirectionChoices, ChequeStatusChoices, Client, ClientLedger
from apps.closing.models import BalanceKindChoices, BalanceSnapshotLine, FiscalYear, FiscalYearStatusChoices, StockSnapshotLine
from apps.closing.services.snapshot import build_snapshot
from apps.core.models import PlanChoices, RoleChoices, Tenant, User
from apps.inventory.models import MovementReasonChoices, Product, StockMovement, StocktakeSession, Variant
from apps.invoicing.models import CreditNote, Invoice, InvoiceLine, InvoiceStatusChoices
from apps.sales.models import Payment, PaymentMethodChoices, Sale, SaleItem
from apps.suppliers.models import Supplier, SupplierInvoice, SupplierPayment


@pytest.mark.django_db
class TestFiscalYearSnapshot:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.create(name="Closing Test Tenant", plan=PlanChoices.ENTERPRISE)
        self.owner = User.objects.create_user(
            email="owner@closing.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.OWNER,
        )
        self.manager = User.objects.create_user(
            email="manager@closing.com",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )

        self.fy = FiscalYear.objects.create(
            tenant=self.tenant,
            year=2026,
            start_date=datetime.date(2026, 1, 1),
            end_date=datetime.date(2026, 12, 31),
        )

        self.algiers_tz = ZoneInfo("Africa/Algiers")

    def _make_movement(self, variant, delta, dt, reason=MovementReasonChoices.RECEPTION, ref_id="", user=None):
        m = StockMovement.objects.create(
            tenant=self.tenant,
            variant=variant,
            quantity_delta=delta,
            reason=reason,
            reference_id=ref_id,
            user=user or self.manager,
        )
        # Update timestamp to specified historical datetime
        StockMovement.objects.filter(pk=m.pk).update(timestamp=dt)
        m.refresh_from_db()
        return m

    def test_movements_after_end_date_excluded_except_linked_stocktake(self):
        """
        Movements dated after end_date (2026-12-31 23:59:59) are excluded from the stock snapshot,
        EXCEPT movements originating from the linked year-end stocktake session.
        """
        prod = Product.objects.create(
            tenant=self.tenant,
            name="Classic Boot",
            brand="Belled",
            sale_price=Decimal("9000.00"),
            purchase_price=Decimal("5000.00"),
            pamp=Decimal("5200.00"),
        )
        v1 = Variant.objects.create(tenant=self.tenant, product=prod, size_eu=42, colour="Noir")
        v2 = Variant.objects.create(tenant=self.tenant, product=prod, size_eu=43, colour="Noir")

        # 1. 2026-06-01: v1 reception +20 (included)
        dt_2026_june = datetime.datetime(2026, 6, 1, 10, 0, tzinfo=self.algiers_tz)
        self._make_movement(v1, 20, dt_2026_june)

        # 2. 2026-11-15: v1 sale -5 (included)
        dt_2026_nov = datetime.datetime(2026, 11, 15, 14, 0, tzinfo=self.algiers_tz)
        self._make_movement(v1, -5, dt_2026_nov, reason=MovementReasonChoices.SALE)

        # 3. 2027-01-05: v1 normal sale -3 (dated in January 2027, after end_date -> EXCLUDED)
        dt_2027_sale = datetime.datetime(2027, 1, 5, 11, 0, tzinfo=self.algiers_tz)
        self._make_movement(v1, -3, dt_2027_sale, reason=MovementReasonChoices.SALE)

        # 4. 2027-01-10: v2 reception +10 (dated in January 2027 -> EXCLUDED)
        dt_2027_v2 = datetime.datetime(2027, 1, 10, 9, 0, tzinfo=self.algiers_tz)
        self._make_movement(v2, 10, dt_2027_v2)

        # 5. Year-end stocktake session conducted on 2027-01-02:
        # Physical count counted 17 pairs instead of 15 -> adjustment +2
        stocktake = StocktakeSession.objects.create(
            tenant=self.tenant,
            title="Inventaire Physique 31-12-2026",
        )
        dt_2027_stocktake = datetime.datetime(2027, 1, 2, 18, 0, tzinfo=self.algiers_tz)
        self._make_movement(
            v1,
            2,
            dt_2027_stocktake,
            reason=MovementReasonChoices.STOCKTAKE,
            ref_id=str(stocktake.id),
        )

        # Link stocktake to FiscalYear
        self.fy.stocktake_session = stocktake
        self.fy.save()

        # Build snapshot
        build_snapshot(self.fy)

        # Verify stock lines
        lines = StockSnapshotLine.objects.filter(fiscal_year=self.fy)
        assert lines.count() == 1
        line_v1 = lines.first()
        assert line_v1.variant == v1
        # Expected quantity: 20 (june) - 5 (nov) + 2 (stocktake) = 17
        # The -3 sale on 2027-01-05 must NOT be counted!
        assert line_v1.quantity == 17
        assert line_v1.unit_cost == Decimal("5200.00")
        assert line_v1.cost_value == Decimal("88400.00")  # 17 * 5200.00
        assert line_v1.unit_price == Decimal("9000.00")
        assert line_v1.retail_value == Decimal("153000.00")  # 17 * 9000.00

        # v2 must NOT appear because it had 0 stock as of 2026-12-31
        assert not lines.filter(variant=v2).exists()

    def test_ledger_balances_match_hand_computed_fixture(self):
        """Client ledger entries up to end_date match hand-computed balance, later entries excluded."""
        client_a = Client.objects.create(tenant=self.tenant, name="Client Alpha", phone="0550111111")
        client_b = Client.objects.create(tenant=self.tenant, name="Client Beta", phone="0550222222")
        client_c = Client.objects.create(tenant=self.tenant, name="Client Gamma", phone="0550333333")

        # Client A: 100,000 debit (March), 40,000 credit (May), 60,000 credit (Jan 2027 -> after end)
        ClientLedger.objects.create(
            client=client_a, entry_type="debit", amount=Decimal("100000.00"),
            description="Facture FA-2026-01", date=datetime.date(2026, 3, 1),
        )
        ClientLedger.objects.create(
            client=client_a, entry_type="credit", amount=Decimal("40000.00"),
            description="Versement mai", date=datetime.date(2026, 5, 1),
        )
        ClientLedger.objects.create(
            client=client_a, entry_type="credit", amount=Decimal("60000.00"),
            description="Versement janvier", date=datetime.date(2027, 1, 15),
        )

        # Client B: 25,000 debit (Aug), 25,000 credit (Aug) -> net 0
        ClientLedger.objects.create(
            client=client_b, entry_type="debit", amount=Decimal("25000.00"),
            description="Facture FA-2026-02", date=datetime.date(2026, 8, 1),
        )
        ClientLedger.objects.create(
            client=client_b, entry_type="credit", amount=Decimal("25000.00"),
            description="Paiement comptant", date=datetime.date(2026, 8, 2),
        )

        # Client C: Advance deposit of 15,000 in Oct 2026 -> balance -15,000 (credit)
        ClientLedger.objects.create(
            client=client_c, entry_type="credit", amount=Decimal("15000.00"),
            description="Acompte client", date=datetime.date(2026, 10, 1),
        )

        build_snapshot(self.fy)

        client_lines = BalanceSnapshotLine.objects.filter(
            fiscal_year=self.fy, kind=BalanceKindChoices.CLIENT
        )
        # Client B has zero balance, so only A and C are in the snapshot lines
        assert client_lines.count() == 2

        line_a = client_lines.get(party_id=client_a.id)
        assert line_a.balance == Decimal("60000.00")
        assert line_a.party_name == "Client Alpha"

        line_c = client_lines.get(party_id=client_c.id)
        assert line_c.balance == Decimal("-15000.00")
        assert line_c.party_name == "Client Gamma"

        # Check totals balance summary
        bal_summary = self.fy.totals["balance_summary"]
        assert Decimal(bal_summary["client_debt_total"]) == Decimal("60000.00")
        assert Decimal(bal_summary["client_credit_total"]) == Decimal("15000.00")

    def test_supplier_balances_invoices_minus_payments(self):
        """Supplier balance is computed from SupplierInvoice minus SupplierPayment up to end_date."""
        sup1 = Supplier.objects.create(tenant=self.tenant, name="Fournisseur Cuir Alger")
        sup2 = Supplier.objects.create(tenant=self.tenant, name="Fournisseur Semelles Oran")

        # Sup 1: Invoiced 200,000 in July 2026, Paid 120,000 in Aug 2026, Paid 80,000 in Jan 2027
        SupplierInvoice.objects.create(
            tenant=self.tenant, supplier=sup1, invoice_number="FC-001",
            date=datetime.date(2026, 7, 10), due_date=datetime.date(2026, 8, 10),
            total_amount=Decimal("200000.00"),
        )
        SupplierPayment.objects.create(
            tenant=self.tenant, supplier=sup1, amount=Decimal("120000.00"),
            method="cash", date=datetime.date(2026, 8, 1),
        )
        SupplierPayment.objects.create(
            tenant=self.tenant, supplier=sup1, amount=Decimal("80000.00"),
            method="cash", date=datetime.date(2027, 1, 10),
        )

        # Sup 2: Invoiced 50,000 in Jan 2027 (after year-end -> excluded)
        SupplierInvoice.objects.create(
            tenant=self.tenant, supplier=sup2, invoice_number="FS-002",
            date=datetime.date(2027, 1, 5), due_date=datetime.date(2027, 2, 5),
            total_amount=Decimal("50000.00"),
        )

        build_snapshot(self.fy)

        sup_lines = BalanceSnapshotLine.objects.filter(
            fiscal_year=self.fy, kind=BalanceKindChoices.SUPPLIER
        )
        assert sup_lines.count() == 1
        line_sup1 = sup_lines.first()
        assert line_sup1.party_id == sup1.id
        # Balance = 200,000 - 120,000 = 80,000 DZD (Jan 2027 payment is excluded)
        assert line_sup1.balance == Decimal("80000.00")
        assert self.fy.totals["balance_summary"]["supplier_debt_total"] == "80000.00"

    def test_pending_cheques_listed_in_totals(self):
        """Pending cheques across any period are tracked in totals."""
        client = Client.objects.create(tenant=self.tenant, name="Cheque Client", phone="0550999999")
        Cheque.objects.create(
            tenant=self.tenant,
            client=client,
            number="CHQ-7788",
            amount=Decimal("45000.00"),
            direction=ChequeDirectionChoices.RECEIVABLE,
            status=ChequeStatusChoices.PENDING,
            due_date=datetime.date(2027, 2, 15),
            bank="BNA",
        )
        Cheque.objects.create(
            tenant=self.tenant,
            client=client,
            number="CHQ-1122",
            amount=Decimal("30000.00"),
            direction=ChequeDirectionChoices.RECEIVABLE,
            status=ChequeStatusChoices.DEPOSITED,  # Not pending -> excluded
            due_date=datetime.date(2026, 9, 1),
            bank="BEA",
        )

        build_snapshot(self.fy)

        cheques_summary = self.fy.totals["pending_cheques"]
        assert cheques_summary["count"] == 1
        assert Decimal(cheques_summary["receivable_total"]) == Decimal("45000.00")
        assert len(cheques_summary["items"]) == 1
        assert cheques_summary["items"][0]["number"] == "CHQ-7788"

    def test_financial_totals_and_cost_basis_note(self):
        """Verifies sales, invoices, credit notes, COGS and cost_basis_note."""
        prod = Product.objects.create(
            tenant=self.tenant,
            name="Sneaker X",
            brand="Puma",
            sale_price=Decimal("10000.00"),
            purchase_price=Decimal("6000.00"),
            pamp=Decimal("6200.00"),
        )
        var = Variant.objects.create(tenant=self.tenant, product=prod, size_eu=41, colour="Bleu")

        # 1. Retail Sale in 2026
        dt_sale = datetime.datetime(2026, 4, 15, 12, 0, tzinfo=self.algiers_tz)
        sale = Sale.objects.create(
            tenant=self.tenant,
            cashier=self.manager,
            status="completed",
            total_amount=Decimal("20100.00"),
            timbre_fiscal=Decimal("100.00"),
        )
        Sale.objects.filter(pk=sale.pk).update(created_at=dt_sale)
        SaleItem.objects.create(
            sale=sale,
            variant=var,
            quantity=2,
            unit_price=Decimal("10000.00"),
            unit_cost=Decimal("6200.00"),
            unit_cost_estimated=False,
        )
        Payment.objects.create(sale=sale, amount=Decimal("20100.00"), method=PaymentMethodChoices.CASH)

        # 2. Wholesale Invoice in 2026
        client = Client.objects.create(tenant=self.tenant, name="Wholesale Buyer", phone="0550000001")
        inv = Invoice.objects.create(
            tenant=self.tenant,
            client=client,
            number="FA-2026-0001",
            date=datetime.date(2026, 5, 20),
            due_date=datetime.date(2026, 6, 20),
            status=InvoiceStatusChoices.PAID,
            total_ht=Decimal("50000.00"),
            tva_amount=Decimal("9500.00"),
            timbre_fiscal=Decimal("250.00"),
            total_ttc=Decimal("59750.00"),
        )
        InvoiceLine.objects.create(
            invoice=inv,
            variant=var,
            description="Sneaker X Wholesale",
            quantity=Decimal("5.00"),
            unit_price=Decimal("10000.00"),
            unit_cost=Decimal("6200.00"),
            unit_cost_estimated=False,
        )
        inv.compute_totals()
        inv.save()

        # 3. Credit Note in 2026
        CreditNote.objects.create(
            tenant=self.tenant,
            original_invoice=inv,
            number="AV-2026-0001",
            date=datetime.date(2026, 6, 1),
            total_ht=Decimal("10000.00"),
            tva_amount=Decimal("1900.00"),
            total_ttc=Decimal("11900.00"),
            reason="Retour marchandise défectueuse",
        )

        build_snapshot(self.fy)

        totals = self.fy.totals
        assert totals["cost_basis_note"] == "current PAMP at closing time"

        # Sales: 20100 - 100 = 20000 revenue, 100 stamp, COGS = 2 * 6200 = 12400
        assert Decimal(totals["sales"]["revenue"]) == Decimal("20000.00")
        assert Decimal(totals["sales"]["timbre_fiscal"]) == Decimal("100.00")
        assert Decimal(totals["sales"]["cogs"]) == Decimal("12400.00")

        # Invoices: 50000 HT, 9500 TVA, 0 stamp (not cash), COGS = 5 * 6200 = 31000
        assert Decimal(totals["invoices"]["total_ht"]) == Decimal("50000.00")
        assert Decimal(totals["invoices"]["tva_amount"]) == Decimal("9500.00")
        assert Decimal(totals["invoices"]["timbre_fiscal"]) == Decimal("0.00")
        assert Decimal(totals["invoices"]["cogs"]) == Decimal("31000.00")

        # Credit Notes: 10000 HT, 1900 TVA
        assert Decimal(totals["credit_notes"]["total_ht"]) == Decimal("10000.00")

        # Combined summary:
        # Net Revenue HT = 20,000 (sales) + 50,000 (inv) - 10,000 (cn) = 60,000.00
        # TVA = 9,500 - 1,900 = 7,600.00
        # Stamp = 100 (sales) + 0 (inv) = 100.00
        # Total COGS = 12,400 + 31,000 = 43,400.00
        # Gross Margin = 60,000 - 43,400 = 16,600.00
        fin = totals["financial_summary"]
        assert Decimal(fin["net_revenue_ht"]) == Decimal("60000.00")
        assert Decimal(fin["tva_amount"]) == Decimal("7600.00")
        assert Decimal(fin["timbre_fiscal"]) == Decimal("100.00")
        assert Decimal(fin["cogs"]) == Decimal("43400.00")
        assert Decimal(fin["gross_margin"]) == Decimal("16600.00")

    def test_snapshot_frozen_once_closed(self):
        """build_snapshot refuses to recompute when the fiscal year is closed."""
        build_snapshot(self.fy)
        self.fy.close(self.owner)
        assert self.fy.status == FiscalYearStatusChoices.CLOSED

        with pytest.raises(ValidationError) as exc:
            build_snapshot(self.fy)
        assert "Impossible de recalculer" in str(exc.value)

    def test_reopen_requires_reason_and_allows_recomputing(self):
        """Owner can reopen a closed fiscal year with an audited reason, allowing recomputation."""
        build_snapshot(self.fy)
        self.fy.close(self.owner)

        # Attempt reopen without reason -> fails
        with pytest.raises(ValidationError):
            self.fy.reopen(self.owner, "")

        # Reopen with reason -> succeeds
        self.fy.reopen(self.owner, "Rectification inventaire sur demande comptable")
        assert self.fy.status == FiscalYearStatusChoices.OPEN
        assert self.fy.reopened_reason == "Rectification inventaire sur demande comptable"
        assert self.fy.closed_at is None
        assert self.fy.closed_by is None

        # Now build_snapshot succeeds again
        build_snapshot(self.fy)
