## 12. Annual Fiscal Closing and Accounting Export {#cloture-exercice}

Sound retail management requires freezing year-end stock valuations, annual sales figures, and receivable/payable balances for your certified accountant.

> [!NOTE]
> **Scope of Closing in ShoeDZ:** ShoeDZ performs a **commercial and inventory management closing** (PAMP stock valuation snapshot, customer/supplier balance snapshot, period lock against backdated documents, and accountant export pack). It is not general-ledger SCF accounting software and does not require manual opening-entry journals.

### A. The Fiscal Year Calendar

By default, the fiscal year mirrors the calendar year (**January 1 to December 31**):
- Access the module from the sidebar **Fiscal Year Closing** menu (`/closing`, owner only).
- Click **Initialize Fiscal Year** to create the desired fiscal period (start and end dates can be adjusted while the period remains open).

---

### B. The 5-Step Fiscal Closing Wizard

1. **Step 1 — Pre-closing Checklist:**
   - Verifies that no **cash sessions** remain open in the period (blocking) and flags any draft purchase orders, unconfirmed invoices, partially paid sales, or pending cheques.
2. **Step 2 — Year-end Physical Stocktake:**
   - Link a completed physical stocktake session or explicitly opt in to using calculated ledger stock.
3. **Step 3 — Review Financial & Stock Snapshot:**
   - Freeze and inspect annual KPIs: **POS Sales (TTC excl. stamp duty)**, **Fiscal Stamp**, **B2B Invoices (HT)**, **VAT**, **Credit Notes (HT)**, **Net Revenue (HT)**, **Cost of Goods Sold (COGS)**, **Gross Margin**, **Stock Valuation (PAMP & retail)**, and **Receivables & Payables**.
4. **Step 4 — Accountant Pack Export:**
   - **Download Accountant Pack (`.xlsx`):** Complete Excel workbook with **9 sheets** (*Summary*, *Sales journal*, *Invoices*, *Credit notes*, *Purchases*, *Year-end stock*, *Client balances*, *Supplier balances*, *Outstanding cheques*).
   - **Print Annual Summary (`.pdf`):** Official 1-page A4 report with signature blocks for the store manager and certified accountant.
5. **Step 5 — Final Closing & Period Lock:**
   - Type the fiscal year (e.g., `2026`) and click **Permanently Close Fiscal Year**.
   - An automatic pre-close safety backup (`pre_close_<year>_*.sqlite3`) is created before locking.

> 📷 **Screenshot:** *5-step fiscal closing wizard with Excel/PDF export and period lock.*

---

### C. Period Lock Enforcement and Audited Reopening

1. **Period Lock:**
   - Once closed, no sales, returns, invoices, credit notes, supplier bills, stock movements, or payments can be created, updated, or deleted with a date falling inside the closed period.
2. **Continuous Operations:**
   - Live inventory quantities, customer receivables, and supplier balances continue seamlessly into the new year without manual carry-forward entries.
3. **Audited Reopening (Owner Only):**
   - If your external auditor requests an adjustment, the owner can click **Reopen Fiscal Year**, enter a mandatory **Reopening reason** (recorded in the audit log), post the adjustment, and close the year again.

