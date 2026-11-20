## 13. Migrating and Importing Existing Data {#import-ancien-logiciel}

If you previously used another shoe-store system or Excel spreadsheets, ShoeDZ lets you start without retyping everything. Both import tools are in **Settings → Migration** and are reserved to the **owner** and **managers**.

### A. Importing an Old Software's Folder (DBF Files)

Many stores use older DOS or Windows programs that keep their data in dBase tables (`.DBF`). ShoeDZ reads these files directly.

**1. Prepare the files**

1. Close the old software, then **copy its data folder to the Desktop** (or compress it into a `.ZIP` file). While the old software is open, Windows locks the files and ShoeDZ shows *"Unable to read file … (locked by Windows)"*.
2. ShoeDZ recognises these files (the names are those of the old software):

| File | What is imported |
|---|---|
| `ARTICLEB.DBF` (Retail version) or `ARTICLE.DBF` (Wholesale version) | Catalogue: reference, label, purchase price, retail / semi-wholesale / wholesale prices, sizes, stock |
| `FAMILLE.DBF` | Article families, which set the category and gender |
| `CLIENT.DBF` (Retail) or `CLIENTB.DBF` (Wholesale) | Clients, phone numbers and debt balances |
| `FOURNISS.DBF`, `FOURND.DBF` | Suppliers and their balances, expense suppliers |
| `GCPARAM.DBF` | Store name, phone and tax ID (NIF) |
| `ACHATART.DBF`, `ACHATMVT.DBF`, `VENTED01.DBF` to `VENTED12.DBF`, `CHEQUEXP.DBF`, `VERSECLT.DBF` | Optional: purchases, sales history, pending cheques, instalments in progress |

**2. Set the options and load the files**

3. Open **Settings → Migration** and scroll to the legacy-data migration section (below the Excel & CSV wizard).
4. Set the options:
   - **Inventory Management Mode (Products)**:
     - **Simple Mode (Recommended, default)**: 1 article = 1 reference with its exact real stock. Checkout stays one-click, with no size to pick.
     - **Variants Mode (Split by sizes)**: generates a size grid and spreads the estimated stock over each size.
   - **Legacy Software Version**: **Retail (Standard)** or **Wholesale**. This tells ShoeDZ whether to read `ARTICLEB` / `CLIENT` or `ARTICLE` / `CLIENTB`.
   - **Select the data to import**: *Suppliers*, *Clients*, *Products & Stock*, *Purchase Orders & Receptions (ACHAT)*, *Historical Sales* (all ticked by default).
5. Click the dashed area to **select the folder** containing your `.DBF` files, or click **Upload a .ZIP archive** if you compressed the folder.

**3. Check the preview (nothing is saved yet)**

6. The **Pre-Import Preview (Dry Run)** opens by itself and saves nothing. Check:
   - the **counts**: products and stock, items in stock, clients, suppliers, purchase orders, pending cheques, instalments in progress;
   - the **Financial & Stock Valuation Totals**: *Stock Value (Cost)*, *Client Debts*, *Supplier Debts*, etc. Compare them with the totals of your old software;
   - the **Warnings Detected**: for example a product without a sale price or an unreadable size. They do not block the import: fix them afterwards in the product sheet.
7. If you change an option, click **Refresh Preview**.

![Pre-import preview of a DBF folder: counts, financial totals and warnings, with nothing saved.](../assets/fr/owner-13-legacy-import.webp)

*Pre-import preview of a DBF folder: counts, financial totals and warnings, with nothing saved.*

**4. Run the import**

8. If the figures match, click **Import Now** (or **Cancel** to abandon).
9. Wait **15 to 30 seconds** depending on the data size. During the import the database is locked for writing: **do not ring up any sale**. A summary of the imported items is then shown.

> [!WARNING]
> **Run this import only once, during setup**, to avoid duplicating records. Create a backup first (chapter 11). Client and supplier balances become **opening balances**.

---

### B. Importing an Excel / CSV Spreadsheet

To load **products (with their opening stock)**, **clients** or **suppliers** from a spreadsheet, use the **Bulk Excel & CSV Import Wizard** at the top of **Settings → Migration**.

1. In the wizard, click **Excel / CSV** on the **Products & Stock**, **Clients** or **Suppliers** card.
2. **Step 1 — File & Template:**
   - Download the **Excel Template (.xlsx)** or **CSV Template (.csv)**, pre-filled with examples.
   - For products, choose the **Target Branch / Warehouse for opening stock**.
   - Drag and drop your file (`.xlsx` or `.csv`, 10 MB maximum) or click **Browse files**.
3. **Step 2 — Column Mapping:** ShoeDZ automatically matches your file's columns to the software's fields (*Auto-matched*). Fix a match in the list, or choose **-- Do not import this column --**. All required fields must be mapped.
4. **Step 3 — Preview & Validation:** choose the **duplicate handling strategy**: *Update existing records*, *Skip duplicates* or *Always create new records*. The preview shows the rows analysed, valid, duplicated and in error, line by line. Nothing is saved at this stage.
5. **Step 4 — Execution & Report:** click **Start Bulk Import**. The report shows what was created or updated. If some rows are in error, click **Download error report**, fix the file and run it again. Finish with **Finish and view data**.

**Rules of the "Products" template:**
- The template has **one row per size and per colour** (for example Air Max Runner, size 42, Black; then size 43, Black; then 42, White). It does not accept a size range such as `39-45` in one cell.
- Columns: *Product Name* (required), *Brand*, *Reference / SKU*, *Category*, *Gender*, *EU Size*, *Colour*, *Purchase Price (DZD)*, *Sale Price (DZD)* (required), *Semi-Wholesale Price*, *Wholesale Price*, *Initial Stock*, *Barcode*, *Pairs per Box*, *Alert Threshold*, *Description*.
- *Initial Stock* creates an **opening stock movement** in the branch chosen in step 1.
- For clients, only the *Name* is required. The *Type (detail / gros)*, *Wilaya*, *NIF*, *RC* and *Credit Limit (DZD)* columns are optional.
