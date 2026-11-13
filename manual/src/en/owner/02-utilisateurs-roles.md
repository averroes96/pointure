## 2. User Accounts, Roles, and Permissions {#utilisateurs-roles}

Store security depends on a well-defined separation of duties between business owners, branch managers, and checkout cashiers.

### A. Creating a New User Account

1. Navigate to **Settings → Staff & Users**.
2. Click the **+ New User** button.
3. Fill in:
   - **Full Name**.
   - **Mobile Phone Number** (primary login credential, Algerian format `05`, `06`, or `07`).
   - **Assigned Role** (Cashier, Manager, or Owner).
   - **Initial Password** (which the employee can update upon their initial sign-in).
4. Click **Save**.

> 📷 **Screenshot:** *User creation form with role selection and permission checkboxes.*

---

### B. Role Hierarchy Matrix

ShoeDZ enforces a strict hierarchy of capabilities:

| Module / Action | Owner | Manager | Cashier |
| :--- | :---: | :---: | :---: |
| **POS Sales & Checkout** | ✓ | ✓ | ✓ |
| **Open / Close Personal Drawer Session** | ✓ | ✓ | ✓ |
| **Cash Movements (<kbd>Alt + M</kbd>)** | ✓ | ✓ | ✓ (if permitted) |
| **Customer Directory & Down Payments** | ✓ | ✓ | ✓ |
| **Browse Catalog & Stocks** | ✓ | ✓ | ✓ (read only) |
| **Create & Edit Products and Prices** | ✓ | ✓ | ✗ (blocked) |
| **Supplier Purchase Orders & Receiving** | ✓ | ✓ | ✗ (blocked) |
| **Stocktake Sessions & Adjustments** | ✓ | ✓ | ✗ (blocked) |
| **B2B Invoicing & Credit Notes** | ✓ | ✓ | ✗ (blocked) |
| **Financial Reports & Gross Margin** | ✓ | ✓ | ✗ (blocked) |
| **Local Backups & Diagnostic Bundle** | ✓ | ✓ (create/download) | ✗ (blocked) |
| **User Accounts & Role Management** | ✓ | ✗ (blocked) | ✗ (blocked) |
| **Annual Fiscal Closing & Audit Log** | ✓ | ✗ (blocked) | ✗ (blocked) |
| **Database Restore & Encrypted External Backup** | ✓ | ✗ (blocked) | ✗ (blocked) |
| **Remote owner (Telegram)** | ✓ | ✗ (blocked) | ✗ (blocked) |

---

### C. Cashier-Specific Permissions

For cashier accounts, owners and managers can fine-tune restrictions:
- **Max Discount Threshold (`max_discount_pct`):** Maximum discount percentage a cashier may grant without supervisor approval (e.g., 5% or 10%).
- **Process Returns (`can_process_returns`):** Permits handling exchanges or returns directly.
- **Modify Prices (`can_modify_price`):** Authorizes or disallows on-the-fly selling price changes at checkout.
- **Cancel Sales (`can_cancel_sale`):** Allows cancelling sales receipts prior to printing.

Any operation attempted beyond authorized thresholds triggers a **Manager PIN Authorization** prompt.

---

### D. The Manager PIN Code

The Manager PIN is a confidential **4-to-6-digit code** assigned to managers and owners.

1. **Configuring the PIN:**
   - Open **Settings → Users** and edit the relevant manager or owner profile.
   - Enter the **Manager PIN (4 to 6 digits)** (avoid `0000` or `1234`) and click **Save**.
2. **Usage:**
   - When a cashier requires an override, the manager enters their PIN directly on the cashier's screen.
   - The action is approved instantly and recorded in the audit trail with the manager's name and timestamp.

> [!WARNING]
> To prevent unauthorized brute-force attempts, PIN entry is locked for **15 minutes** after **5 consecutive failed attempts**.

