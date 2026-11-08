## 9. Authorizations and Manager PIN {#autorisation-pin}

To safeguard the business and prevent accidental errors, sensitive operations on the cash register require approval from a store manager or owner via a **4-digit PIN code**.

### When Is a Manager PIN Required?

An authorization modal automatically pops up in the following scenarios:

| Sensitive Operation | Reason for Restriction |
| :--- | :--- |
| **Discount exceeding authorized ceiling** | Your cashier account is capped at a maximum discount percentage (e.g., 10%). Any higher discount requires supervisory approval. |
| **Manual override of a retail sales price** | Prevents selling footwear below approved store pricing policies. |
| **Cancelling an already confirmed sale** | Reversing an issued receipt reverses stock movements and writes a permanent entry to the audit log. |
| **Returning an item without a receipt** | Verifies the item's origin and condition before paying out cash or issuing a store credit voucher. |
| **Accessing locked fiscal periods** | Prevents unintended alterations to closed accounting and tax periods. |

---

### How to Proceed When a PIN Is Requested

1. When the **Manager Authorization** dialog appears on screen:
   - Never ask the manager to speak their secret PIN aloud in front of customers or colleagues.
2. Invite your manager or supervisor to type their **confidential 4-digit PIN** directly on the numeric keypad.
3. If the PIN is valid, the dialog closes with a green confirmation message and the requested action is immediately executed.
4. The identity of the approving supervisor is automatically logged in the internal audit trail for accountability.

> 📷 **Screenshot:** *Manager PIN authorization dialog with 4-digit passcode input.*

> [!WARNING]
> After **5 consecutive incorrect attempts**, PIN entry is temporarily locked for 15 minutes to prevent brute-force guessing.
