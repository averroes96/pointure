## 7. Invoicing, Delivery Notes, and Credit Notes {#facturation}

For wholesale clients, regional resellers, and business accounts, ShoeDZ creates commercial documents conforming to Algerian commercial law.

### A. Issuing an Official Sales Invoice

1. Open the **Invoices** menu (<kbd>F3</kbd>) and click **+ New Invoice** (<kbd>Shift + F3</kbd>).
2. Select the customer (their NIF, RC, and AI credentials populate automatically).
3. Add line items (shoe models, sizes, pairs or cartons, and unit prices excluding tax HT).
4. The system calculates automatically:
   - Total Amount Excluding Tax (HT).
   - VAT at statutory rate (19%).
   - Fiscal Stamp Duty (progressive statutory brackets from 1% to 2% for cash settlements ≥ 300 DZD).
   - Total Amount Including Tax (TTC) and Net Payable.
5. Click **Confirm Invoice**:
   - An immutable sequential number (`FA-YYYY-#####`, e.g., `FA-2026-00001`) is generated, deducting the sold quantities from stock and posting the debit to the customer ledger.
   - The invoice can be printed in full A4 format or exported to PDF.

> 📷 **Screenshot:** *Commercial invoice builder with automatic VAT and fiscal stamp computation.*

---

### B. Delivery Notes (BL) and Invoice Conversion

1. In the **Delivery Notes** menu (<kbd>F6</kbd>), generate a delivery slip (`BL-YYYY-#####`) to accompany outgoing shoe shipments.
2. A delivery note is a shipping document that **does not deduct** stock on its own: stock deduction and customer ledger posting occur when the linked invoice is confirmed.
3. Once the customer receives and signs for the shipment:
   - Open the delivery note, click **Convert to Invoice**, and confirm the invoice.

---

### C. Credit Notes (Avoirs)

When a retroactive commercial discount or billing adjustment is granted on an issued invoice:
1. Open **Invoicing → Credit Notes**.
2. Click **Create Credit Note**, select the original sales invoice, and enter the credit amount (HT) and VAT.
3. Validate the credit note:
   - An official credit note number (`AV-<Invoice>-<id>`) is allocated.
   - The customer's account is automatically credited with the total TTC amount to reduce their outstanding debt.
   - If physical merchandise is returned to the warehouse, record the stock adjustment or inward return separately in the **Inventory** module.

---

### D. License Plan Requirements (Pro & Enterprise)

> [!NOTE]
> Issuing A4 formal invoices, delivery notes, and B2B credit notes is governed by your active ShoeDZ license tier (Pro or Enterprise edition). Contact support if a lock badge appears on this module.

