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
   - **Location & Size Range (Series):** For each item, you can specify its shelf location (e.g., `C20`) and commercial size series (e.g., `37/41`, `40-45`). In simple mode (without matrix breakdown), this range is stored as product metadata without generating multiple unnecessary variants.
4. Enter the agreed purchase price per pair or per carton.
5. Confirm the order: status advances to *Confirmed*, awaiting delivery.
   - Shelf labels automatically format the location and series as `LOCATION (RANGE)`, e.g., `C20 (37/41)`.

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

---

### F. Smart Purchase Order Import (Multi-language Excel & CSV)

ShoeDZ provides an intelligent import engine to directly convert procurement spreadsheets received from footwear suppliers (`.xlsx`, `.csv`) into official purchase orders:
1. In the purchase order form or from a supplier's Orders tab, click **Import (Excel / CSV)**.
2. Upload the file: the engine automatically detects encoding (UTF-8, Arabic Windows CP1256, French CP1252), delimiter (`;`, `,`, tab), and header rows.
3. **Column Mapping and Footwear Sizing Modes:**
   - **Trilingual Synonym Dictionary:** Headers in French (*Réf, Désignation, Pointure, Prix*), Arabic (*المرجع، المقاس، الكمية، سعر الشراء*), and English are automatically recognized and mapped.
   - **Single Size per Row:** Each row corresponds to a single shoe size and quantity.
   - **Size Range Mode:** Detects ranges (e.g., `37-41`) and distributes carton pairs based on the product's configured carton breakdown or balanced distribution.
   - **Matrix Grid Mode:** Detects size column headers (`36` through `46`) and transposes them into individual order line items.
4. **Catalog Reconciliation & Confirmation:**
   - The preview table summarizes total cartons, total pairs, and estimated total cost, flagging matched products, missing size variants, and new models.
   - The auto-create option instantly registers missing products and size variants into your store catalog.
   - Check **Save as template** to store this supplier's format for streamlined one-click imports in the future.
5. Review the preview lines and totals. If the mapping is wrong, go back to the column mapping step to adjust it, then click **Create Purchase Order**. The imported order is created as a draft; review and confirm it through the normal purchase order workflow.

---

### G. Optical Recognition & Supplier Slip Scanner (Photos & Images) {#fournisseurs-scan-ocr}

When your supplier delivers a handwritten paper delivery note, printed receipt, or physical order slip, you can scan and digitize it directly using the offline scanning utility:
1. In the purchase order form or from the supplier's Orders tab, click **Scan photo / slip**.
2. Select a photo or image file (`.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`) taken with your smartphone or a flatbed scanner.
3. **Autonomous Optical Processing (100% Offline):**
   - The OpenCV vision pipeline automatically deskews tilted documents (up to $\pm 45^\circ$) and normalizes uneven camera lighting/shadows.
   - The embedded neural OCR engine (RapidOCR) extracts text tokens, references, footwear sizes, and unit prices in under 500 ms without needing an internet connection.
   - **Footwear-Specific Grammars:** The engine automatically detects footwear size runs (e.g. `37-41`, `40/45`), carton/pair ratios (e.g. `12c/20p` for 12 cartons of 20 pairs), and Algerian supplier phone numbers (`05`, `06`, `07`) to auto-select the supplier.
4. **Split-Screen Review Interface:**
   - The left pane displays the document image with pan/zoom navigation and interactive SVG bounding box highlights.
   - The right pane provides an editable review table where you can adjust extracted values, remove noise lines, or manually bind items to existing catalog products.
5. Click **Generate purchase order** to create the draft purchase order with pre-filled line items.



