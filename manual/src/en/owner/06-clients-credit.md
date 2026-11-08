## 6. Customer Directory, Credit Limits, and Receivables {#clients-credit}

Managing trade credit and customer receivables is essential for healthy store cash flow.

### A. Customer Records and Profiles

Under the **Customers** menu (<kbd>F4</kbd>), each customer file consolidates:
- Contact Information: Full name, mobile phone number (`05/06/07`), and wilaya.
- Commercial / Trade Accounts: Trade name, tax credentials (NIF, RC), and billing address.
- Financial History: Chronological list of all sales receipts, invoices, and layaway deposit slips.

---

### B. Credit Limits and Automatic Credit Control

To mitigate bad debt risks, ShoeDZ provides automated credit governance:
1. In the customer profile, set the **Authorized Credit Limit** (`credit_limit`, e.g., `50 000 DZD`).
2. At checkout or when issuing an invoice, if an on-account transaction would cause the outstanding balance to exceed this threshold, the system blocks the credit sale unless approved by a manager or owner.
3. **Suspending Credit or Archiving Delinquent Accounts:**
   - To stop granting credit to a delinquent account, lower their **Authorized Credit Limit** to `0 DZD` or deactivate their customer profile (`is_active`).

> 📷 **Screenshot:** *Customer profile displaying balance due and authorized credit limit.*

---

### C. Customer Ledger (Statement of Account)

ShoeDZ maintains an automated running ledger for every customer:
- **Debit:** Every credit sale or invoice increases the customer's balance due.
- **Credit:** Every cash installment, down payment, or cleared cheque reduces the debt.
- **Net Balance:** Accurate balance due computed in real time.
- Clicking **Print Account Statement** generates a certified statement detailing all transactions and the exact balance due.

---

### D. Cheque Tracking and Banking

In the **Cheque Management** tab:
1. View all bank cheques received across checkout registers.
2. For each cheque, track cheque number, issuing bank, drawer name, and **Maturity / Due Date**.
3. When the due date arrives and the cheque is deposited at your bank:
   - Click **Mark Deposited / Cleared**.
4. In the event of a bounced cheque:
   - Click **Flag Bounced Cheque**.
   - The receivable is instantly reinstated onto the customer's account for recovery.

---

### E. Debt Ageing Analysis

The **Debt Ageing** table breaks down outstanding receivables across aging brackets:
- **Under 30 Days:** Normal operating trade credit.
- **30 to 60 Days:** Minor delays suitable for friendly phone reminders.
- **60 to 90 Days:** Overdue receivables requiring formal collection notices.
- **Over 90 Days:** High-risk balances warranting account blocking and recovery procedures.

