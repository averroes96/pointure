## 9. Internal Audit Trail and Operations History {#audit}

To ensure complete operational integrity and deter fraud or handling errors, ShoeDZ maintains an immutable internal audit log.

### A. What Does the Audit Trail Cover?

The audit log captures sensitive actions performed on audited data models (`AUDITED_MODELS`):

> [!NOTE]
> The audit trail does not record every routine HTTP call; it specifically targets models in `AUDITED_MODELS`:
> - **Sales, Returns, and Held Sales (`Sale`, `Return`, `HeldSale`):** Issued tickets, refunds, reversals, parked carts, and resumptions.
> - **Cash Drawer Sessions (`CashSession`, `CashMovement`):** Session openings/closings, cash inflows, and expense withdrawals.
> - **Products, Stock, and Stocktakes (`Product`, `Variant`, `StockMovement`, `StocktakeSession`, `DefectItem`):** Selling price updates, inventory adjustments, stocktake counts, and defect write-offs.
> - **Suppliers and Purchasing (`Supplier`, `PurchaseOrder`, `SupplierInvoice`, `SupplierPayment`):** Purchase orders, receiving, supplier bills, and payments.
> - **Customers, Cheques, and Loyalty (`Client`, `Cheque`, `Promotion`, `LoyaltyProgram`):** Credit limits, cheque status transitions, and promotional campaigns.
> - **B2B Invoicing (`Invoice`, `InvoicePayment`, `DeliveryNote`, `CreditNote`):** Commercial document issuance, confirmation, payments, and cancellations.
> - **Fiscal Closing and Administration (`FiscalYear`, `User`):** Fiscal year closing/reopening, user provisioning, roles, and Manager PIN overrides.

---

### B. Audit Entry Details

Every logged event records:
1. **Timestamp:** Exact date and time down to the second.
2. **Responsible User:** Name and ID of the authenticated user who initiated the change.
3. **Action Type:** `CREATE`, `UPDATE`, or `DELETE`.
4. **Target Entity:** Unique identifier or reference code of the altered record.
5. **Field Diffs:** Clear side-by-side comparison between **Previous Value** and **New Value** (e.g., *Selling price changed from 6 500 DZD to 5 800 DZD*).

> 📷 **Screenshot:** *Audit log screen with date filters, user selection, and before/after diff inspector.*

---

### C. Searching and Filtering the Audit Log

From the sidebar **Audit Log** menu (`/settings/audit-log`, owner only):
- Filter by **User** to investigate specific cashier shifts during discrepancy reviews.
- Filter by **Date Range** (e.g., during seasonal sales campaigns or annual stocktakes).
- Filter by **Action Type** (e.g., inspecting all authorizations granted via Manager PIN).
- The log is immutable: no user, including the store owner, can delete or retroactively alter audit records.

