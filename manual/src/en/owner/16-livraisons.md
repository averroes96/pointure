## 16. Deliveries: Couriers and Shipment Tracking {#livraisons}

ShoeDZ reads your parcels directly from your courier (today: **Maystro**): where each parcel is, which were delivered or returned, and **where the money is**. This information is read-only: it changes neither your sales, your stock nor your till, and it does not appear in cash sessions or Z reports.

> Owner and managers only, on the Pro plan.

### A. Turning deliveries on

1. Open **Settings → Policies & Mode** (owner).
2. Tick **Enable delivery integrations**.
3. A **Delivery Settings** tab appears in Settings, and a **Shipments** menu appears in the sidebar, under **Sales**.

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
