## 4. Supplier Purchases, Receiving, and PAMP Valuation {#achats-reception}

Rigorous procurement management ensures balanced inventory and accurate cost tracking.

### A. Supplier Directory

1. Open the **Suppliers** menu to manage footwear manufacturers, importers, and regional workshops.
2. For each supplier, record:
   - Business name or representative contact.
   - Direct telephone number and wilaya.
   - Tax identifiers (NIF, RC) for purchasing invoices.
   - Standard payment terms (e.g., cash on delivery, net 30 days, or consignment).

---

### B. Purchase Orders (PO)

1. Click **+ New Purchase Order**.
2. Select the relevant supplier.
3. Add the shoe models being ordered:
   - You can order by **Assorted Cartons** (e.g., 10 cartons of 12 pairs each, totaling 120 pairs with standard size breakdown 39 to 45) or by **Single Pairs**.
4. Enter the agreed purchase price per pair or per carton.
5. Confirm the order: status advances to *Confirmed*, awaiting delivery.

> 📷 **Screenshot:** *Supplier purchase order showing size distribution per carton.*

---

### C. Receiving Merchandise and Stock Inward

When boxes arrive at the store or warehouse:
1. Open the pending purchase order and click **Receive Merchandise**.
2. Verify delivered quantities against the delivery slip.
3. If cartons contain mismatched sizes or damaged pairs, adjust the actual quantity received (partial receipt).
4. Click **Confirm Receipt**:
   - The system automatically logs inward stock movements (`StockMovement`) for each size.
   - Available shelf inventory counts increase immediately.
   - Barcode labels can be printed in one click to tag newly arrived boxes.

---

### D. Supplier Invoices and Settlement

1. Upon receiving the supplier's invoice, record it from the order screen to track accounts payable.
2. When making vendor payments:
   - Click **Record Supplier Payment**.
   - Choose the payment method: **Cash**, **Bank Cheque** (logging cheque number and maturity date), or **Bank Transfer**.
   - The system updates the **Outstanding Supplier Balance** in real time.

---

### E. Understanding PAMP (Weighted Average Purchase Cost)

ShoeDZ uses the **PAMP** standard recommended by the Algerian Financial Accounting System (SCF) for inventory valuation and gross margin calculations:

> [!NOTE]
> PAMP represents the average unit cost of each pair in stock, recalculated with each incoming shipment at varying purchase prices:
>
> $$\text{New PAMP} = \frac{(\text{Current Stock} \times \text{Old PAMP}) + (\text{Received Qty} \times \text{New Unit Purchase Price})}{\text{Current Stock} + \text{Received Qty}}$$

**Practical Example:**
- You have 10 pairs of a loafer in stock purchased at `3 000 DZD`.
- You receive a new shipment of 10 pairs of the same shoe purchased at `3 500 DZD`.
- The new PAMP computed automatically by ShoeDZ is:
  $$\frac{(10 \times 3\,000) + (10 \times 3\,500)}{10 + 10} = \frac{30\,000 + 35\,000}{20} = 3\,250 \text{ DZD}$$

When any pair of this loafer is subsequently sold, the software deducts a cost of `3 250 DZD`, guaranteeing accurate profit margins.

