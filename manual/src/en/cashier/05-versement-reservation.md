## 5. Down Payments and Layaway Reservations {#versement-reservation}

A customer who cannot pay in full right away has two options at the register. They cannot be combined: a sale is either an installment (down payment) or a reservation.

| | **Installment (down payment)** | **Layaway / Reserved** |
|---|---|---|
| Purpose | The customer takes the pair and pays the rest later | The customer leaves the pair in the store and comes back for it |
| Minimum deposit | **30%** of the total (adjustable) | **20%** of the total (adjustable) |
| Customer | Required (adjustable) | A customer **or** a note identifying the reservation |
| Stock | Leaves stock immediately | **Reserved** (blocked) until pickup |
| Status in the history | *In Installment* | *Layaway (Reserved)* |
| Document handed over | **Versement slip** | **Reservation slip** (no. `RES-…`) |

> [!NOTE]
> The percentages and the default duration are set in **Settings → Policies & Mode** (owner). The *Layaway* option only appears at the register when it is enabled there.

---

### A. Creating a Reservation (Layaway)

1. Add the selected pair to the cart (size and colour).
2. Select the **customer** in the cart. Otherwise, enter a note that lets you find the reservation again. With neither a customer nor a note, the register refuses.
3. Open **Sale options** (below the cart) and switch on **Layaway / Reserved**. The line shows the minimum deposit (e.g. *20% = 1,648 DZD*) and *Reserved stock*.
4. Choose the **Reservation duration**: **3j**, **7j**, **14j** or **30j** (7 days by default).
5. Under the payment mode, enter the deposit handed over by the customer. The field is pre-filled with the minimum. Pick Cash, TPE or BaridiMob.
6. Check the blue summary: *Layaway (20% min)*, *Balance at pickup* and *Expires: D+14*.
7. Click **Confirm reservation (… DZD)** (<kbd>F10</kbd>).

The register records the deposit, takes the pair out of available stock, and prints the **Reservation slip** with the **pickup deadline**, the deposit paid and the **balance at pickup**. Hand it to the customer: they must present it at pickup.

![Register with a reservation in progress: Layaway option on, 14-day duration, 3,000 DZD deposit and the Confirm reservation button.](../assets/fr/cashier-05-layaway.webp)

*Register with a reservation in progress: Layaway option on, 14-day duration, 3,000 DZD deposit and the Confirm reservation button.*

> [!NOTE]
> Loyalty points cannot be redeemed on a reservation. Points are awarded at pickup.

---

### B. Following Up on Reservations

Open **Sales → History** and set the **Sale status** filter to *Layaway (Reserved)*. Each row shows a **Consignée** (reserved) badge and the deadline (*Jusqu'au …*). Past the deadline, the badge turns red: **Expirée** (expired).

> [!WARNING]
> An expired reservation is **not cancelled automatically**: the pair stays blocked until you collect or cancel it. Cancel it to put the pair back on the shelf.

---

### C. Pickup and Settling the Balance

When the customer returns:

1. In **History**, find the reservation (number `RES-…` or customer name).
2. Click the **Collect items & pay remaining layaway** icon.
3. The *Collect layaway* window shows the total, the deposit paid, the **remaining balance to collect** and the list of reserved items.
4. Enter the **final payment amount** (at least the balance) and the **balance payment method**. A handover note is optional.
5. Click **Confirm handover & collect payment**.

The final receipt prints, the sale becomes *Completed*, loyalty points are awarded, and you hand over the box.

If the customer pays an extra deposit without taking the pair, use the **Add layaway deposit payment** (+) icon on the same row.

---

### D. Cancelling a Reservation

If the customer gives up or does not return before the deadline:

1. In **History**, click the **Cancel layaway & release stock** icon.
2. Choose what happens to the deposit:
   - **Refund deposit to customer**: a cash payout *Remboursement Réservation* is recorded in the open register.
   - **Keep deposit (Abandoned / deadline expired)**: no refund, the store keeps the deposit as compensation.
3. Enter a **cancellation reason** if needed.
4. Click **Confirm cancellation & release stock**.

The pair returns to shelf stock immediately. A cashier must enter the **Manager PIN** to confirm the cancellation, unless they are allowed to process returns (see chapter 9).

---

### E. Installment: the Pair Leaves Right Away

1. Select the customer (if none is selected, the register asks for one), then click **Layaway Deposit** (<kbd>Alt + V</kbd>).
2. Enter the deposit (at least 30% of the total, already suggested) and complete the sale as usual. A customer blocked for credit is refused.
3. Hand over the pair and the **Versement slip**. The sale appears in the history with the status *In Installment* and in the **In installment** counter.

To collect a later payment, open **History** and click **Add payment** (+) on the row. When the total is reached, the sale automatically becomes *Completed*. These buttons are visible to the **owner and managers**: a cashier asks a manager to record the payment.
