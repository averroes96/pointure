## 5. Stock Management, Inventory Counts, and Transfers {#inventaire}

Accurate tracking of shoes on store shelves and in backroom stock is the cornerstone of footwear retail.

### A. Performing a Physical Stocktake Session

To reconcile physical inventory and detect size discrepancies or missing stock:
1. Navigate to **Inventory → Stocktake Sessions**.
2. Click **+ New Stocktake Session**.
3. Choose the count scope:
   - **Full Inventory:** Every product across the entire store.
   - **Targeted / Partial Inventory:** A specific brand, department (e.g., Kids Footwear), or vendor.
4. Begin counting:
   - Using a wireless scanner or manual sheet input, scan each box physically on the shelves.
   - The grid displays in real time: **System Theoretical Stock**, **Counted Quantity**, and **Discrepancy** (green for matched, amber for surplus, red for shortage).
5. You can pause the count and resume later without disrupting ongoing sales at the counter.

> 📷 **Screenshot:** *Stocktake entry grid showing theoretical vs counted units and variance.*

---

### B. Validating Stocktake and Auto-Adjusting Inventory

Once counting is complete and discrepancies are reviewed:
1. Click **Validate Stocktake**.
2. A financial variance summary appears:
   - Total purchase cost of missing pairs (shrinkage).
   - Total value of surplus stock found.
3. Click **Approve Adjustment**:
   - The system automatically creates balancing stock movements (`StockMovement`).
   - Shelf quantities are instantly updated to match actual physical counts.

---

### C. Defective Footwear and Damage Tracking

When a shoe has a factory flaw (detached sole, broken stitching, faulty zipper) or suffers fitting damage:
1. Open **Inventory → Defects & Losses**.
2. Click **Log Defective Product**.
3. Scan the shoe and select size and colour.
4. Specify the cause: *Manufacturing defect*, *Fitting room damage*, *Mismatched lone shoe*.
5. Select the action:
   - **Return to Manufacturer:** The shoe is set aside awaiting vendor credit or replacement.
   - **Write-Off (Direct Loss):** The pair is permanently removed from sellable inventory and written off.

---

### D. Inter-Branch and Depot Stock Transfers

If your business operates multiple sales outlets or a central storage depot:
1. Open **Inventory → Stock Transfers**.
2. Create a **Transfer Order** selecting the source branch and destination store.
3. Add the shoe models, sizes, and quantities to transfer.
4. Click **Dispatch**: items leave source inventory and enter *In Transit* status.
5. Upon physical arrival at the receiving store, the supervisor clicks **Confirm Receipt** to assimilate the pairs into sellable inventory.

