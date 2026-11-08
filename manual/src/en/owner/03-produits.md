## 3. Product Catalog, Variants, and Labels {#produits}

In footwear retail, catalog management requires a structured breakdown by model, size, and colour.

### A. Creating a New Shoe Item

1. Navigate to the products list (<kbd>F8</kbd>) and click **+ New Product** (<kbd>F9</kbd>).
2. Enter general product information:
   - **Model Name:** e.g., *"Verona Leather Loafer"*, *"Runner Sport Sneaker"*.
   - **Factory Reference Code:** e.g., *"MOD-882"*.
   - **Brand:** Select or add a brand.
   - **Category:** Men, Women, Kids, Sport, Accessories.
   - **Primary Supplier:** Assign your preferred vendor.
3. Configure variant matrices:
   - Check available **Colours** (e.g., Black, Brown, Tan, Navy).
   - Select the **Size Series** (e.g., adult series 39 to 45, or kids series 28 to 35).
4. The system automatically creates a distinct variant for each combination (Colour + Size) with an individual SKU and barcode.

> 📷 **Screenshot:** *Product card showing the auto-generated footwear size and colour matrix.*

---

### B. Pricing Structure

Define your store's pricing strategy for each shoe model:
- **Purchase Price (HT) and Weighted Average Cost (PAMP):** Supplier purchase price and weighted average cost updated automatically upon receiving purchase orders.
- **Retail Selling Price (Rayon):** Standard unit retail price charged to walk-in customers.
- **Wholesale Price (Carton):** Discounted price applied when selling complete cartons or bulk bundles to trade clients.

---

### C. Barcode Label Printing

ShoeDZ includes an integrated thermal label generator for shoe boxes and price tags:
1. From the product card or upon receiving shipments, click **Print Labels**.
2. Select the label dimensions suited to your thermal label printer (e.g., `50x30 mm` or `40x25 mm`).
3. Select which variants to print (all sizes or received quantities).
4. Click **Start Printing**: each label prints with model name, brand, large size indicator, colour, DZD price, and scannable barcode.

---

### D. Archiving Products (Never Delete)

> [!IMPORTANT]
> To preserve financial and audit integrity, **a product that has historical sales, inventory movements, or invoices can never be permanently deleted from the database**.

When a model is discontinued or a seasonal run concludes:
1. Open the product card.
2. Click **Archive Product**.
3. The item is removed from active POS search (<kbd>F1</kbd>) and the active catalog to eliminate clutter.
4. Historical sales records, profit margins, and past stocktake counts remain 100% accurate.
5. If the model returns next season, you can **Unarchive** it in one click from the *Archived Products* filter.

