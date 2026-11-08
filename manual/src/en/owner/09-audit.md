## 9. Internal Audit Trail and Operations History {#audit}

To ensure complete operational integrity and deter fraud or handling errors, ShoeDZ maintains an immutable internal audit log.

### A. What Does the Audit Trail Cover?

The audit log captures sensitive actions performed on audited data models (`AUDITED_MODELS`):

> [!NOTE]
> The audit trail does not record every routine HTTP call; it specifically targets models with financial or governance implications:
> - **Sales and Checkout (`Sale`):** Issued tickets, reversals, and extraordinary discounts.
> - **Products and Prices (`Product`, `Variant`):** Selling price overrides and wholesale tier updates.
> - **Stock Movements (`StockMovement`):** Manual count adjustments, logged defects, and receiving inward slips.
> - **Cash Movements (`CashMovement`):** Cash drawer inflows and expense withdrawals.
> - **Users and Permissions (`User`):** Account provisioning, role changes, and PIN assignments.
> - **Invoices and Credit Notes (`Invoice`, `CreditNote`):** Commercial document issuance and cancellations.
> - **Customer Records (`Client`):** Credit ceiling adjustments and account blocking status.

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

From **Settings → Audit Log**:
- Filter by **User** to investigate specific cashier shifts during discrepancy reviews.
- Filter by **Date Range** (e.g., during seasonal sales campaigns or annual stocktakes).
- Filter by **Action Type** (e.g., inspecting all authorizations granted via Manager PIN).
- The log is immutable: no user, including the store owner, can delete or retroactively alter audit records.

