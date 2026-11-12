## 6. Customer Directory, Credit Limits, and Receivables {#clients-credit}

Managing trade credit and customer receivables is essential for healthy store cash flow.

### A. Customer Records and Profiles

Under the **Customers** menu (<kbd>F4</kbd>), each customer file consolidates:
- Contact Information: Full name, mobile phone number (`05/06/07`), and wilaya.
- Commercial / Trade Accounts: Trade name, tax credentials (NIF, RC), and billing address.
- **Price Tier:** Choose the customer's default tier — Retail, Semi-wholesale, or Wholesale. This tier is selected when the customer is used at POS and in invoices and quotes.
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
- To open it, select a customer from **Customers** and choose the **Ledger** tab. Use the date range, movement type, and search filters to narrow the entries.
- **Debit:** Every credit sale or invoice increases the customer's balance due.
- **Credit:** Every cash installment, down payment, or cleared cheque reduces the debt.
- **Net Balance:** Accurate balance due computed in real time.
- **PDF** and **Excel** export the statement for the selected date range, including the opening balance, movements, and open invoices. **WhatsApp** prepares a reminder with the current balance due.

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

The **Download all statements (ZIP)** button generates a compressed archive containing individual statement PDFs for all debtor clients in a single click.

---

### F. Creditworthiness Scoring (Risk Grade) and Client Blocking

ShoeDZ automatically calculates a solvency risk grade for every customer to protect your receivables:
- **Grade A (Low Risk):** Prompt settlements (average settlement delay under 30 days), no overdue receivables, and zero bounced cheques.
- **Grade B (Moderate Risk):** Average settlement delay between 31 and 60 days, or overdue balance in the 31-60 days bracket.
- **Grade C (High Risk):** Average settlement delay over 60 days, or overdue balance in the 61-90 days bracket.
- **Grade D (Very High Risk):** Overdue debt older than 90 days, or at least one bounced cheque within the last 12 months.

The risk grade badge appears in real time across the customer directory, customer details view, POS checkout customer picker, and invoice builder.

**Blocking Delinquent Customers:**
- Managers and owners can block a client at any time from their profile using the **Block Customer** button.
- **Enforcement:** Blocked clients are barred from making credit purchases at POS (on-account and layaway/versement purchases are rejected) and cannot receive new invoices. Transactions paid immediately and in full in cash remain permitted.
- Unblocking is immediate by clicking **Unblock Customer**.


