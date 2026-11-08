# Store Owner & Manager Guide {#guide-gestionnaire}

This reference guide is designed for store owners, retail managers, and warehouse supervisors using ShoeDZ. It covers end-to-end administration, from initial boutique setup to annual fiscal closings.

---

## 1. Initial Setup and Store Configuration {#premier-demarrage}

ShoeDZ runs under Windows in a completely autonomous mode (offline-first architecture). The software integrates an embedded secure backend server (`127.0.0.1:8745`) and an optimized SQLite database, requiring no continuous Internet connection for daily sales operations.

### A. The Setup Wizard

Upon launching ShoeDZ for the first time following Windows installation:
1. The initial setup wizard opens automatically.
2. Enter your **Store Trade Name** (e.g., *"El Mordjane Footwear"*).
3. Specify your **Primary Business Activity** (Footwear and leather goods retail).
4. Enter store contact details:
   - **Primary Mobile Phone** (10-digit Algerian format starting with `05`, `06`, or `07`).
   - **Wilaya** of residence among Algeria's 58 wilayas.
   - **Physical Store Address**.
5. Create your **Primary Owner Account** by specifying your phone number and a secure password.

> 📷 **Screenshot:** *ShoeDZ initial setup wizard displaying store contact and wilaya fields.*

---

### B. Business Mode Selection

ShoeDZ adapts to your retail model via 3 configurable modes in **Settings → General**:

1. **Retail Mode (Rayon / Pairs):**
   - Tailored for retail walk-in customer footwear boutiques.
   - Products are tracked and sold as individual pairs, with fast size (EU 35–46) and colour selection.
2. **Wholesale Mode (Carton / Demi-gros):**
   - Designed for wholesale depots and regional distributors supplying other retailers.
   - Products are sold in full cartons or bundled shipping cases with predefined size assortments.
3. **Mixed Mode (Retail + Wholesale):**
   - Allows ringing up single pairs for retail shoppers and full cartons for trade accounts with automatic pricing tiers.

> [!NOTE]
> You can switch business modes at any time without data loss. Existing inventory is instantly recomputed into pairs and carton equivalents.

---

### C. Fiscal and Legal Store Identity

To ensure your official invoices, quotes, and delivery notes comply with Algerian trade regulations, enter your legal credentials in **Settings → Company**:

- **NIF:** Tax Identification Number (15 digits).
- **RC:** Commercial Register Number (e.g., `16/00-1234567B16`).
- **AI:** Tax Article Number (11 digits).

These mandatory legal mentions automatically populate invoice headers and receipt printouts.

