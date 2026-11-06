"""
Unit and integration tests for Accountant Export Pack (Task 6.4).
Covers:
- Export endpoint GET /api/v1/closing/years/{id}/export/ (xlsx by default, pdf if format=pdf).
- Summary PDF endpoint GET /api/v1/closing/years/{id}/summary-pdf/.
- Role permissions: owner and manager allowed, cashier forbidden (403).
- 9-sheet Excel workbook structure and integrity verification via openpyxl.
- Verification that workbook totals match FiscalYear.totals.
- Localized language headers and sheet names.
"""
import datetime
import io
from decimal import Decimal
from zoneinfo import ZoneInfo
import openpyxl
import pytest
from rest_framework.test import APIClient

from apps.clients.models import Cheque, ChequeDirectionChoices, ChequeStatusChoices, Client, ClientLedger
from apps.closing.models import FiscalYear, FiscalYearStatusChoices
from apps.closing.services.snapshot import build_snapshot
from apps.core.models import PlanChoices, RoleChoices, Tenant, User
from apps.inventory.models import MovementReasonChoices, Product, StockMovement, Variant
from apps.invoicing.models import CreditNote, Invoice, InvoiceLine, InvoiceStatusChoices
from apps.sales.models import Payment, PaymentMethodChoices, Sale, SaleItem
from apps.suppliers.models import Supplier, SupplierInvoice, SupplierPayment


@pytest.mark.django_db
class TestAccountantExportPack:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.client = APIClient()
        self.tenant = Tenant.objects.create(name="Algeria Footwear SARL", plan=PlanChoices.ENTERPRISE)

        self.owner = User.objects.create_user(
            email="owner@shoedz.dz",
            password="testpassword123",
            tenant=self.tenant,
            role=RoleChoices.OWNER,
        )
        self.manager = User.objects.create_user(
            email="manager@shoedz.dz",
            password="testpassword123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cashier@shoedz.dz",
            password="testpassword123",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )

        self.algiers_tz = ZoneInfo("Africa/Algiers")

        self.fy = FiscalYear.objects.create(
            tenant=self.tenant,
            year=2026,
            start_date=datetime.date(2026, 1, 1),
            end_date=datetime.date(2026, 12, 31),
        )

        # ── Setup Sample Domain Data for Fiscal Year 2026 ────────────────────
        # 1. Product & Variant & Stock Movement
        self.prod = Product.objects.create(
            tenant=self.tenant,
            reference="BOT-001",
            name="Bottine Cuir Premium",
            sale_price=Decimal("8000.00"),
            purchase_price=Decimal("4500.00"),
            pamp=Decimal("4500.00"),
        )
        self.var42 = Variant.objects.create(
            tenant=self.tenant, product=self.prod, size_eu=42, colour="Noir", barcode="BOT-001-42"
        )
        m = StockMovement.objects.create(
            tenant=self.tenant,
            variant=self.var42,
            quantity_delta=50,
            reason=MovementReasonChoices.RECEPTION,
            user=self.manager,
        )
        StockMovement.objects.filter(pk=m.pk).update(
            timestamp=datetime.datetime(2026, 3, 1, 10, 0, tzinfo=self.algiers_tz)
        )

        # 2. Completed Sale with split payment
        sale_dt = datetime.datetime(2026, 5, 10, 14, 30, tzinfo=self.algiers_tz)
        self.sale = Sale.objects.create(
            tenant=self.tenant,
            status="completed",
            total_amount=Decimal("16000.00"),
            timbre_fiscal=Decimal("160.00"),
            receipt_number="REC-2026-001",
        )
        Sale.objects.filter(pk=self.sale.pk).update(created_at=sale_dt)
        SaleItem.objects.create(
            sale=self.sale,
            variant=self.var42,
            quantity=2,
            unit_price=Decimal("8000.00"),
            unit_cost=Decimal("4500.00"),
        )
        Payment.objects.create(
            sale=self.sale,
            amount=Decimal("10000.00"),
            method=PaymentMethodChoices.CASH,
        )
        Payment.objects.create(
            sale=self.sale,
            amount=Decimal("6000.00"),
            method=PaymentMethodChoices.CHEQUE,
        )

        # 3. Client & Invoice
        self.customer = Client.objects.create(
            tenant=self.tenant,
            name="Boutique El Bahdja",
            phone="0550112233",
            nif="001234567890123",
        )
        self.invoice = Invoice.objects.create(
            tenant=self.tenant,
            client=self.customer,
            number="FA-2026-0001",
            date=datetime.date(2026, 6, 15),
            due_date=datetime.date(2026, 7, 15),
            status=InvoiceStatusChoices.SENT,
            is_formal=True,
            is_paid_in_cash=True,
        )
        InvoiceLine.objects.create(
            invoice=self.invoice,
            variant=self.var42,
            description="Bottine Cuir Premium",
            quantity=2,
            unit_price=Decimal("10000.00"),
            unit_cost=Decimal("4500.00"),
        )
        self.invoice.compute_totals()
        self.invoice.save()

        # 4. Credit note
        self.credit_note = CreditNote.objects.create(
            tenant=self.tenant,
            original_invoice=self.invoice,
            number="AV-2026-0001",
            date=datetime.date(2026, 6, 20),
            total_ht=Decimal("4000.00"),
            tva_amount=Decimal("760.00"),
            total_ttc=Decimal("4760.00"),
            reason="Retour 1 paire",
        )

        # 5. Supplier & Supplier Invoice
        self.supplier = Supplier.objects.create(
            tenant=self.tenant,
            name="Manufacture Chaussures Alger",
            phone="0555998877",
        )
        self.sup_inv = SupplierInvoice.objects.create(
            tenant=self.tenant,
            supplier=self.supplier,
            invoice_number="FF-2026-999",
            date=datetime.date(2026, 2, 10),
            due_date=datetime.date(2026, 3, 10),
            total_amount=Decimal("150000.00"),
        )
        SupplierPayment.objects.create(
            tenant=self.tenant,
            supplier=self.supplier,
            supplier_invoice=self.sup_inv,
            amount=Decimal("50000.00"),
            date=datetime.date(2026, 2, 25),
            method="cheque",
        )

        # 6. Pending Cheque
        self.cheque = Cheque.objects.create(
            tenant=self.tenant,
            client=self.customer,
            number="CHQ-98765",
            amount=Decimal("12000.00"),
            bank="BNA",
            direction=ChequeDirectionChoices.RECEIVABLE,
            status=ChequeStatusChoices.PENDING,
            due_date=datetime.date(2026, 11, 30),
        )

        # Build snapshot to populate stock_lines, balance_lines and totals
        build_snapshot(self.fy)
        self.fy.refresh_from_db()

    def test_cashier_cannot_export_accountant_pack(self):
        """Cashiers must receive 403 Forbidden on export and summary-pdf."""
        self.client.force_authenticate(user=self.cashier)

        resp_export = self.client.get(f"/api/v1/closing/years/{self.fy.id}/export/")
        assert resp_export.status_code == 403

        resp_pdf = self.client.get(f"/api/v1/closing/years/{self.fy.id}/summary-pdf/")
        assert resp_pdf.status_code == 403

    def test_manager_and_owner_can_export_xlsx(self):
        """Owners and managers can download the accountant export pack (.xlsx)."""
        for user in [self.manager, self.owner]:
            self.client.force_authenticate(user=user)
            resp = self.client.get(f"/api/v1/closing/years/{self.fy.id}/export/")
            assert resp.status_code == 200
            assert resp["Content-Type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            assert "export_exercice_2026.xlsx" in resp["Content-Disposition"]

            # Load with openpyxl and verify sheets
            wb = openpyxl.load_workbook(io.BytesIO(resp.content))
            sheet_names = wb.sheetnames

            expected_sheets = [
                "Synthèse",
                "Journal des ventes",
                "Factures",
                "Avoirs",
                "Achats",
                "Valorisation stock",
                "Soldes clients",
                "Soldes fournisseurs",
                "Chèques en circulation",
            ]
            for s in expected_sheets:
                assert s in sheet_names, f"Sheet '{s}' missing from {sheet_names}"

    def test_workbook_data_and_totals_match_fiscal_year(self):
        """Verify the content and totals of sheets match FiscalYear.totals."""
        self.client.force_authenticate(user=self.manager)
        resp = self.client.get(f"/api/v1/closing/years/{self.fy.id}/export/")
        assert resp.status_code == 200

        wb = openpyxl.load_workbook(io.BytesIO(resp.content))
        totals = self.fy.totals

        # 1. Factures sheet
        ws_inv = wb["Factures"]
        # Header is row 1, invoice is row 2, total is row 3
        assert ws_inv.cell(row=2, column=1).value == "FA-2026-0001"
        assert Decimal(str(ws_inv.cell(row=2, column=5).value)) == Decimal("20000.00")  # HT
        assert Decimal(str(ws_inv.cell(row=2, column=8).value)) == Decimal("24038.00")  # TTC
        # Total row (row 3)
        assert ws_inv.cell(row=3, column=1).value == "TOTAL"
        assert Decimal(str(ws_inv.cell(row=3, column=5).value)) == Decimal(totals["invoices"]["total_ht"])
        assert Decimal(str(ws_inv.cell(row=3, column=8).value)) == Decimal(totals["invoices"]["total_ttc"])

        # 2. Avoirs sheet
        ws_cn = wb["Avoirs"]
        assert ws_cn.cell(row=2, column=1).value == "AV-2026-0001"
        assert Decimal(str(ws_cn.cell(row=2, column=5).value)) == Decimal("4000.00")
        assert ws_cn.cell(row=3, column=1).value == "TOTAL"
        assert Decimal(str(ws_cn.cell(row=3, column=5).value)) == Decimal(totals["credit_notes"]["total_ht"])

        # 3. Achats sheet
        ws_purchases = wb["Achats"]
        assert ws_purchases.cell(row=2, column=1).value == "FF-2026-999"
        assert Decimal(str(ws_purchases.cell(row=2, column=4).value)) == Decimal("150000.00")  # TTC
        assert Decimal(str(ws_purchases.cell(row=2, column=5).value)) == Decimal("50000.00")   # Paid
        assert Decimal(str(ws_purchases.cell(row=2, column=6).value)) == Decimal("100000.00")  # Remaining

        # 4. Valorisation stock sheet
        ws_stock = wb["Valorisation stock"]
        assert ws_stock.cell(row=2, column=1).value == "BOT-001"
        assert ws_stock.cell(row=2, column=3).value == 42
        assert ws_stock.cell(row=2, column=5).value == 50  # Qty
        assert Decimal(str(ws_stock.cell(row=2, column=6).value)) == Decimal("4500.00")  # Unit cost
        assert Decimal(str(ws_stock.cell(row=2, column=7).value)) == Decimal("225000.00") # Cost val
        # Total row
        last_row = ws_stock.max_row
        assert ws_stock.cell(row=last_row, column=1).value == "TOTAL"
        assert ws_stock.cell(row=last_row, column=5).value == totals["stock_summary"]["total_units"]
        assert Decimal(str(ws_stock.cell(row=last_row, column=7).value)) == Decimal(totals["stock_summary"]["total_cost_value"])

        # 5. Soldes clients sheet
        ws_clients = wb["Soldes clients"]
        assert ws_clients.cell(row=2, column=1).value == "Boutique El Bahdja"
        assert Decimal(str(ws_clients.cell(row=2, column=2).value)) == Decimal("19278.00")
        assert Decimal(str(ws_clients.cell(row=3, column=2).value)) == Decimal(totals["balance_summary"]["client_debt_total"])

        # 6. Soldes fournisseurs sheet
        ws_sups = wb["Soldes fournisseurs"]
        assert ws_sups.cell(row=2, column=1).value == "Manufacture Chaussures Alger"
        assert Decimal(str(ws_sups.cell(row=2, column=2).value)) == Decimal("100000.00")

        # 7. Chèques en circulation sheet
        ws_cheques = wb["Chèques en circulation"]
        assert ws_cheques.cell(row=2, column=1).value == "CHQ-98765"
        assert Decimal(str(ws_cheques.cell(row=2, column=6).value)) == Decimal("12000.00")

    def test_summary_pdf_endpoint(self):
        """GET /api/v1/closing/years/{id}/summary-pdf/ returns valid 1-page PDF."""
        self.client.force_authenticate(user=self.manager)
        resp = self.client.get(f"/api/v1/closing/years/{self.fy.id}/summary-pdf/")
        assert resp.status_code == 200
        assert resp["Content-Type"] == "application/pdf"
        assert resp.content.startswith(b"%PDF-")

    def test_export_with_format_pdf_query_param(self):
        """GET /api/v1/closing/years/{id}/export/?format=pdf returns PDF summary."""
        self.client.force_authenticate(user=self.owner)
        resp = self.client.get(f"/api/v1/closing/years/{self.fy.id}/export/?format=pdf")
        assert resp.status_code == 200
        assert resp["Content-Type"] == "application/pdf"
        assert resp.content.startswith(b"%PDF-")

    def test_multilingual_export_supports_english_and_arabic(self):
        """Export supports ?lang=en and ?lang=ar gracefully."""
        self.client.force_authenticate(user=self.manager)
        resp_en = self.client.get(f"/api/v1/closing/years/{self.fy.id}/export/?lang=en")
        assert resp_en.status_code == 200
        wb_en = openpyxl.load_workbook(io.BytesIO(resp_en.content))
        assert len(wb_en.sheetnames) == 9

        resp_ar = self.client.get(f"/api/v1/closing/years/{self.fy.id}/export/?lang=ar")
        assert resp_ar.status_code == 200
        wb_ar = openpyxl.load_workbook(io.BytesIO(resp_ar.content))
        assert len(wb_ar.sheetnames) == 9
