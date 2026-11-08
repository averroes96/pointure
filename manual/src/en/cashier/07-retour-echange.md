## 7. Returns, Exchanges, and Store Credit {#retour-echange}

A customer may return to the store to exchange an ill-fitting shoe size (e.g., size 41 instead of 42) or request a refund.

### A. Return with Sales Receipt (Standard Workflow)

1. Open the **Sales History** menu or click the **Return / Exchange** button.
2. Scan the barcode printed on the customer's receipt, or enter its number manually (format: `RC-AAAAMMJJ-####`).
3. The original sale's line items are displayed.
4. Check the box next to the item(s) being returned.
5. Specify the **Returned Quantity** and **Return Reason** (e.g., *Wrong size*, *Defect observed*, *Customer mind change*).
6. Select the outcome for the transaction:
   - **Immediate Exchange:** The returned item's value is credited toward the active cart to offset the cost of the newly selected pair.
   - **Cash Refund:** The refund amount is paid out directly from the cash drawer to the customer.
   - **Store Credit Voucher (Avoir):** A store credit voucher is issued for the customer's future purchases.
7. Click **Confirm Return**: the returned shoe variant's stock is immediately restored in the system, and a return receipt prints.

> 📷 **Screenshot:** *Selecting returned items, quantities, and reasons with an existing sales receipt.*

---

### B. Return without Sales Receipt

If the customer has lost their paper receipt:

1. Click **Return without Receipt**.
2. Manually search for the shoe item by model name or reference and select the returned size.
3. The system checks your cashier user account permissions:
   - If your account does not have the `can_process_returns` permission, the **Manager Authorization** dialog appears.
   - Request your store manager to input their 4-digit PIN to approve the transaction.
4. Complete the exchange or credit voucher according to store policy.

> [!WARNING]
> Always inspect the shoe sole and original packaging before accepting any return. Worn, scuffed, or soiled footwear must never be restocked into sellable inventory without explicit manager approval.
