## 7. Invoicing, Delivery Notes, and Credit Notes {#facturation}

For wholesale clients, regional resellers, and business accounts, ShoeDZ creates commercial documents conforming to Algerian commercial law.

### A. Issuing an Official Sales Invoice

1. Open the **Invoices** menu (<kbd>F3</kbd>) and click **+ New Invoice** (<kbd>Shift + F3</kbd>).
2. Select the customer (their NIF, RC, AI, and NIS credentials populate automatically).
3. Add line items (shoe models, sizes, pairs or cartons, and unit prices excluding tax HT).
4. The system calculates automatically:
   - Total Amount Excluding Tax (HT).
   - VAT at statutory rate (19%).
   - Fiscal Stamp Duty (1% for cash settlements ≥ 400 DZD, capped at 10,000 DZD).
   - Total Amount Including Tax (TTC) and Net Payable.
5. Click **Validate and Issue Invoice**:
   - An immutable sequential number (`FA-AAAAMMJJ-####`) is generated.
   - The invoice can be printed in full A4 format or exported to PDF.

> 📷 **Screenshot:** *Commercial invoice builder with automatic VAT and fiscal stamp computation.*

---

### B. Delivery Notes (BL) and Invoice Conversion

1. In the **Delivery Notes** menu (<kbd>F6</kbd>), generate a delivery slip to accompany outgoing shoe shipments.
2. The delivery note deducts items from inventory immediately without booking a tax liability until billed.
3. Once the customer receives and signs for the shipment:
   - Open the delivery note and click **Convert to Invoice**.
   - An official sales invoice is created instantly with identical line items and quantities.

---

### C. Credit Notes (Avoirs)

When billed merchandise is returned or a retroactive discount is granted:
1. Open **Invoicing → Credit Notes**.
2. Click **Create Credit Note** and select the original sales invoice.
3. Check the returned shoe models and specify quantities.
4. Validate the credit note:
   - An official credit note number (`AV-AAAAMMJJ-####`) is allocated.
   - Returned shoe variants are restored to active inventory.
   - The customer's account is credited with the total TTC amount to reduce their outstanding debt.

---

### D. License Plan Requirements (Pro & Enterprise)

> [!NOTE]
> Issuing A4 formal invoices, delivery notes, and B2B credit notes is governed by your active ShoeDZ license tier (Pro or Enterprise edition). Contact support if a lock badge appears on this module.

