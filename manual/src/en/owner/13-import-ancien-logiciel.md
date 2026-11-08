## 13. Data Migration and Legacy Imports {#import-ancien-logiciel}

If you previously used legacy point-of-sale software or Excel spreadsheets, ShoeDZ includes automated migration tools to get you up and running without re-typing data.

### A. Importing from Legacy POS Systems (dBase DBF Files)

Many footwear shops in Algeria rely on legacy DOS or Windows applications that store data in dBase (`.DBF`) tables. ShoeDZ natively ingests these legacy databases via its embedded migration engine (`legacy_dbf.py`):

1. Copy the data folder from your previous software onto a USB flash drive.
2. ShoeDZ automatically detects these standard files:
   - `ARTICLE.DBF` or `ARTICLEB.DBF`: Footwear catalog, brands, sizes, barcodes, and retail prices.
   - `CLIENT.DBF`: Customer directory with phone numbers and historical debt balances.
   - `FOURNISS.DBF` or `FOURND.DBF`: Supplier directory and accounts payable balances.
3. Open **Settings → Data Migration & Import**.
4. Click **Import DBF Database** and select the folder.
5. Click **Run Pre-Scan**: the software displays counts of detected models, sizes, and clients.
6. Click **Confirm Import**: all historical records are converted into ShoeDZ within minutes.

> 📷 **Screenshot:** *DBF import assistant showing pre-scan counts of detected footwear models and clients.*

---

### B. Bulk Import via Excel / CSV Worksheets

If your catalog is organized in spreadsheets:
1. In **Settings → Data Migration & Import**, click **Import via Excel / CSV**.
2. Download the **Standard Template** to match expected columns:
   - `reference`: Factory model or article code.
   - `nom`: Shoe model description (e.g., *"Men's Classic Leather Loafer"*).
   - `marque`: Brand name.
   - `pointures`: Footwear size run (e.g., `39-45` or `40,41,42,43,44`).
   - `couleur`: Primary colour.
   - `prix_achat`: Unit purchase cost in DZD.
   - `prix_vente`: Retail price including tax in DZD.
   - `stock_initial`: Starting pair count on shelves.
3. Populate the file and upload it into ShoeDZ.
4. **Dry-Run Validation:** The importer reviews every row, highlights missing fields or size errors, and allows corrections prior to saving.
5. Confirm the upload to populate your catalog.

