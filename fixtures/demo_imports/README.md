# ShoeDZ Demo Import Fixtures

This directory contains synthetic, fully anonymized sample datasets designed for demonstration, user guide walkthroughs, automated tests, and import wizards in ShoeDZ (Pointure).

> **Privacy & Compliance Notice:**
> All records in this directory are 100% synthetic fixtures generated programmatically. No real customer, supplier, or financial data from legacy archives is stored or committed.

---

## 1. Directory Structure

```
fixtures/demo_imports/
├── legacy_dbf/                # Algerian footwear store dBase III migration files
│   ├── CLIENT.DBF             # Clients with price tiers (1=détail, 2=demi-gros, 3=gros), debts, NIF, RC
│   ├── FOURNISS.DBF           # Suppliers with outstanding balances and phone numbers
│   ├── ARTICLE.DBF            # Articles with 3 price tiers (BTARIF1, BTARIF2, BTARIF3), sizes (POINTURE), shelves (CASIER)
│   ├── FAMILLE.DBF            # Categories (Homme, Femme, Sport, Enfant, Ville)
│   ├── CHEQUEXP.DBF           # Client cheques received and pending deposit (BNA, CPA, BEA)
│   ├── CREANCE.DBF            # Opening debit ledger entries / promissory notes
│   └── GCPARAM.DBF            # Legacy store configuration (NIF, phone, company name)
│
├── purchase_orders/           # Supplier Purchase Order import templates
│   ├── bon_commande_fournisseur_french.xlsx   # Standard French footwear purchase order
│   ├── bon_commande_fournisseur_arabic.xlsx   # Arabic purchase order (CP1256 / UTF-8, RTL)
│   ├── supplier_order_matrix_english.xlsx     # English size-breakdown matrix (sizes 39..44 columns)
│   └── bon_commande_simple.csv                # Semicolon-delimited CSV format
│
└── products/                  # Mass product catalog onboarding
    ├── catalogue_produits_import.xlsx         # Multi-variant Excel catalog
    └── catalogue_produits_import.csv          # Standard CSV catalog import
```

---

## 2. How to Use These Fixtures in the Application

### A. Legacy dBase Migration (Assistant de Migration)
1. In the sidebar, navigate to **Paramètres** → **Migration / Importation Legacy**.
2. Select or upload the folder `fixtures/demo_imports/legacy_dbf/` (or package it into a `.zip` archive).
3. Choose your migration options:
   - **Mode Simple (1-clic)** or **Mode Complet (Tailles & Variantes)**.
   - Initial stock allocation strategy.
4. Click **Tester (Simulation / Dry-Run)** to inspect warnings and balance verification.
5. Click **Lancer l'importation** to populate the store with realistic Algerian footwear data.

### B. Smart Purchase Order Importer (Import Bon de Commande Fournisseur)
1. Go to **Fournisseurs** → **Bons de commande** → **Importer (Excel / CSV)**.
2. Select any supplier (e.g. *Sarl El Eulma Import*).
3. Drag & drop any of the files in `fixtures/demo_imports/purchase_orders/`:
   - `bon_commande_fournisseur_french.xlsx`
   - `bon_commande_fournisseur_arabic.xlsx`
   - `supplier_order_matrix_english.xlsx`
4. The import engine automatically detects the header language, encodings, and column formats.
5. Review the preview and click **Créer le bon de commande**.

### C. Mass Product Import Wizard (Import Catalogue Produits)
1. Go to **Stock & Articles** → **Importer des produits**.
2. Upload `fixtures/demo_imports/products/catalogue_produits_import.xlsx`.
3. Preview variants, barcodes, and initial stock units, then confirm the import.

---

## 3. Regenerating Fixtures via CLI

You can regenerate or reset these fixtures at any time using Django management commands:

```bash
cd backend
# Regenerates all fixtures and updates demo database:
venv/bin/python manage.py seed_demo --reset
```
