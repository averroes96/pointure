## 14. Promotions and the Loyalty Program {#promotions-fidelite}

To drive store traffic and keep your customers coming back, ShoeDZ offers two tools: **promotions** (automatic discounts at checkout) and a **loyalty points program**.

### A. Creating a Promotion (Sales, Quantity Discounts…)

A promotion is an **automatic discount rule**: at the register, as soon as an item meets the conditions, the discount applies by itself on its line. The page is reserved to the **owner** and **managers**.

1. Open the menu **Sales → Promotions**.
2. Click **New Promotion**.
3. Fill in the window:
   - **Name** (required): for example *Summer Sale 2026*, *Back-to-school offer*, *Eid promo*.
   - **Début** (start, required) and **End (optional)**: **dates** (no time). The promotion applies from the start day to the end day inclusive. Without an end date, it stays in force until you deactivate it.
   - **Conditions**: every condition you fill in must be met; an empty condition limits nothing.
     - **Category**: *Sneakers*, *Boots*, *Sandales*, *Chaussures formelles*, *Sport*, *Enfants*, *Chaussons* or *Autre*. **Toutes catégories** applies the promotion to the whole store.
     - **Minimum Qty**: number of pairs on the same cart line (for example `3` for "from 3 pairs").
     - **Min amount (DZD)**: amount of the line (price × quantity).
   - **Discount**: fill in **either** **% Discount** (e.g. `20`) **or** **Fixed amount / unit (DZD)** (e.g. `500` DZD per pair), never both.
   - **Priority**: if several promotions match the same line, **only one** applies, the one with the highest priority. Discounts do not add up.
   - **Uses**: leave **Unlimited**. (The usage limit is not yet enforced by the register.)
   - **Active**: ticked, the promotion is in force from its start date.
4. Click **Create**.

![The "New Promotion" window: name, start and end dates, category condition and percentage discount.](../assets/fr/owner-14-promotions.webp)

*The "New Promotion" window: name, start and end dates, category condition and percentage discount.*

> [!NOTE]
> A promotion targets a **category** (or the whole store): there is no model-by-model selection. Some labels of this window (for example the category names and "Début") are still shown in French whatever the language.

**What the cashier sees**

- As soon as an item is added (or its quantity changes), the register looks for an applicable promotion. If it finds one, a **green badge with the promotion's name** appears under the item and the discount is deducted from the line price.
- The discount is calculated on the **current price tier** (Retail, Semi-wholesale or Wholesale).

**Managing your promotions**

The list shows each promotion's conditions, discount, period and status.
- Click the **status** (*Active* / *Inactive*) to activate or deactivate a promotion without deleting it.
- Click the pencil to edit it, or the bin to delete it (a confirmation is asked).

---

### B. The Customer Loyalty Program

The program works with points: customers earn them on every purchase and exchange them for a discount.

**Setting up the program** (menu **Clients → Loyalty**, reserved to the owner and managers; this page only appears if your plan includes it):

1. Under **Rules Configuration**, set:
   - **Program status**: *Active* or *Inactive*;
   - **Points earned per 100 DZD spent** (default `1`);
   - **Points required for 100 DZD discount** (default `100`, i.e. 1 point = 1 DZD);
   - **Minimum redemption threshold (in points)** (default `500`);
   - **Points expiration (in months, empty = unlimited)**;
   - the **tiers**: *Bronze* (from enrolment), *Silver* and *Gold*, with their **threshold in cumulated points** and their earning **multiplier** (default Silver at 5,000 points, ×1.20; Gold at 15,000 points, ×1.50);
   - the **welcome bonus** (points offered when the account is opened).
2. The **conversion simulator** shows what a given purchase amount earns.
3. Under **Program members**, you can **Enroll Client** or **Enroll All Active Clients** (creates a Bronze account in one click). A new client is enrolled automatically. For each member: **print the loyalty card**, **adjust points** (add or remove, with a reason) and view the **points history**.

**At the counter**

1. Select the client in the cart. Their loyalty line shows their balance (*loyalty pts*) and its value in dinars (≈ … DZD).
2. On every completed sale, the client **earns points** according to the scale and their tier. The confirmation screen shows *+N loyalty points earned*.
3. **Using points**: when the balance reaches the minimum redemption threshold and the program is active, the **Use Max** button appears, with a *Pts* field to type an exact number. The line **Loyalty discount applied: −… DZD** shows the discount; it is deducted from the total and the points are debited. **Cancel** removes the discount.
4. The receipt prints a **LOYALTY** block with the client's status, points earned, points redeemed and points balance.

> [!NOTE]
> Points cannot be redeemed on a **reservation** (see the cashier guide, chapter 5); points are awarded at pickup.
