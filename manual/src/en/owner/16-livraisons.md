## 16. Deliveries: Couriers and Shipment Tracking {#livraisons}

ShoeDZ reads your parcels directly from your courier (today: **Maystro**): where each parcel is, which were delivered or returned, and **where the money is**. Parcels created in the courier's app or in DZBuild are read-only: they change neither your sales, your stock nor your till. Parcels **sent from ShoeDZ** (section H) take the stock out when sent and become a sale when delivered. None of this appears in cash sessions or Z reports.

> Owner and managers only, on the Pro plan.

### A. Turning deliveries on

1. Open **Settings → Policies & Mode** (owner).
2. Tick **Enable delivery integrations**.
3. A **Delivery Settings** tab appears in Settings, and **Delivery orders** and **Shipments** menus appear in the sidebar, under **Sales**.

### B. Adding a courier account

1. Open **Settings → Delivery Settings**.
2. Choose your courier from the list (you can search it). The list is downloaded from the internet and kept on the computer, so you must be online the first time.
3. Enter the credentials this courier asks for. They stay on this computer and are **never shown again**: a saved credential reads **Saved**, with a **Replace** button.
4. Click **Test connection** to check the credentials.

**Maystro:** use the **store token** (40 characters) Maystro gives you. An integration key starting with `ak_` is accepted, but Maystro does not let it read orders or payouts; the test says so.

A courier that already has shipments cannot be deleted: deactivate it instead.

### C. The Shipments page

Open **Sales → Shipments**.

- **At the top:** each courier, with the time of its last update and any problem. The **Refresh** button starts an update.
- **Automatic updates:** when the page opens, if the last update is more than 10 minutes old. The page refreshes itself meanwhile. Nothing is read from the courier while the page is closed.
- **First update:** parcels from the last 90 days.
- **Cards:** In progress, To follow up, Held by courier, Ready to be paid, Paid, Returned. Clicking a card filters the table; clicking it again clears the filter.
- **Filters:** search (tracking number, customer name or phone), status, cash, courier, and dates of the last change.
- **Details:** click a row to see the parcel, its amounts and its tracking history. The history loads the first time it is opened.

### D. Parcel statuses

| Status | Meaning |
|---|---|
| Registered | The parcel exists at the courier. |
| Awaiting pickup | The courier still has to collect it. |
| Picked up, In transit, At sorting hub | The parcel is on its way. |
| Out for delivery | The driver has it, or it is waiting at the pickup point. |
| **Delivery attempted** | The customer was not reached or did not take the parcel. |
| **On hold** | Delivery postponed or blocked (customer unreachable, postponement requested…). |
| Delivered | Handed to the customer. |
| Return in transit, Returned | The parcel is coming back to the store. |
| Cancelled, Lost | The parcel will not be delivered. |

**Delivery attempted** and **On hold** parcels are grouped in the **To follow up** card: call the customer quickly, which often prevents a return. Hover over a status to see the courier's own wording.

### E. Where is the money?

| Cash | Meaning |
|---|---|
| Awaiting delivery | The parcel is not delivered yet. |
| Held by courier | Delivered: the courier collected the money but has not paid it to you yet. |
| Ready to be paid | The courier is preparing the payout that includes this parcel. |
| Paid | The parcel is in one of the courier's payouts (the date is in the details). |
| Not applicable | Returned, cancelled, or a parcel with no amount (for example an exchange). |

In a parcel's details:

- **Paid by the customer:** the amount collected at the door.
- **Delivery fee:** what the courier keeps.
- **Owed to the store:** what the courier pays you. The money cards show this amount.

### F. Update messages

| Message | What to do |
|---|---|
| credentials refused | Replace the credentials in **Delivery Settings**, then test the connection. |
| these credentials cannot read orders | Use the Maystro store token instead of an `ak_` key. |
| courier unreachable | Check the internet connection, then click **Refresh**. |
| too many requests, retrying later | Wait a few minutes: updating will resume. |
| tracking not available for this courier yet | Tracking exists today for Maystro; other couriers will follow. |
| partial update | Many changes at once: click **Refresh** again. |

### G. Payouts Picked Up at the Agency

Money picked up at the courier's agency is recorded in the **Payouts** tab of the **Shipments** page. This money **does not go into the till**: it appears neither in cash sessions nor in Z reports. The number next to the tab shows how many payouts are waiting for your confirmation.

**Confirming a payout reported by the courier (Maystro)**

ShoeDZ knows the payouts Maystro has already made. They are listed under **Maystro payouts to confirm**, with the date, the number of parcels and the expected amount (what the courier owes the store).

1. Click **Confirm** on the line of the payout you picked up.
2. In **Amount counted**, enter what you actually received (the expected amount is suggested). The **difference** appears: green when it is zero, red when money is missing, amber when there is too much.
3. Add the **date**, the **courier's reference** and a **note** if needed, then click **Record the payout**.

**Old payouts already received:** tick them (or tick the header box to select all), then click **Confirm selected**. Each payout is recorded for its expected amount, on its payment date.

**Manual entry (agency sheet)**

For a courier without online payouts, or a partial pickup: click **Manual entry (agency sheet)**, paste or scan the sheet's tracking numbers (one per line), click **Check the parcels**, then enter the amount counted and record it. Unknown numbers and parcels that are not delivered or already recorded are listed so you can fix them.

**Recorded payouts**

A payout's parcels become **Paid**. The **Recorded payouts** list shows the date, courier, number of parcels, expected, received and difference; a line's arrow shows its parcels. "Not confirmed by the courier" marks parcels the courier has not reported as paid yet: check them with the courier.

**Made a mistake?** Click **Void** on the payout's line: every parcel gets back the state it had before, and you can record it again. A payout cannot be edited or deleted.

### H. Sending a parcel from ShoeDZ

Open **Sales → Delivery orders**, then click **New order** (or **Open** on a draft).

1. **Customer:** full name, phone, and a second phone if needed.
2. **Delivery:** the wilaya, then the commune **as the courier spells it** (the list comes from the courier). Choose **Home delivery** or **Stop desk (courier office)**; for a desk, pick it from the courier's list.
3. **Articles:** search the stock (name, reference or barcode). Adding the same article twice raises its quantity. Each line's price and discount can be changed.
4. **Amounts:**
   - **Delivery fee paid by the customer:** the courier's rate is shown. If it differs from your fee, click **Use this rate** to take it.
   - **Free delivery**, **Customer may open the package** and **Note for the driver** are passed to the courier.
   - **Amount to collect:** by default, the goods plus delivery (unless delivery is free). Enter a smaller amount if the customer already paid a deposit. It must be whole dinars and cannot exceed goods plus delivery.
5. Click **Save draft** to finish later, or choose the **Courier** and click **Send to courier**.

**After sending:**

- The **stock goes out** at once (movement "Delivery dispatch"). No sale is created yet, and nothing goes into the till.
- The parcel appears in **Shipments** at the next update.
- **Delivered:** ShoeDZ creates the sale, dated on the delivery day, paid "Collected by courier". It counts in the day's revenue but not in the till or the Z reports. The money is then followed in **Payouts** (section G).
- **Returned**, or **cancelled before pickup:** the stock comes back by itself (movement "Delivery return").

**If the courier refuses**, the order stays a draft and the courier's answer is shown (for example: same customer and phone within 24 h at Maystro). Fix it and send again. **If the courier does not answer**, check in its app whether the parcel was created before sending again.

**"Needs attention" tab:** ShoeDZ does not act alone in these cases.

| Message | What to do |
|---|---|
| Returned after delivery | The sale exists: do a POS return when the parcel comes back. |
| Cancelled after pickup | The parcel may be on its way back: the stock returns when it is marked returned. |
| Parcel lost | See the courier. The stock does not come back. |
| Parcel exists at the courier, dispatch not recorded | Usually after a send that got no answer: check the parcel in the courier's app. |
| Closed period | The date falls in a closed fiscal year: nothing was recorded. |
| The sale could not be created | ShoeDZ retries at the next update; if the message stays, contact support. |
