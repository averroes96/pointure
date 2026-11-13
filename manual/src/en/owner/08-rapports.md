## 8. Sales Reporting, Profitability, and Valuation {#rapports}

Executive reporting dashboards provide store owners with immediate visibility into store performance.

### A. Consolidated Daily Report (Registers Summary)

Under **Reports → Daily**:
1. Review an aggregated summary of all cashier sessions opened and closed during the business day.
2. For each cashier, review:
   - Gross and net revenue collected.
   - Breakdown by payment method: **Cash**, **TPE (CIB/Edahabia)**, **BaridiMob**, **Cheques**, and **Credit Sales**.
   - Petty cash inflows and outflows.
   - Any cash variances logged during the Z-Report closing.
3. Print the daily consolidated summary for your accounting files.

> 📷 **Screenshot:** *Consolidated daily report dashboard displaying payment method breakdown.*

---

### B. Revenue and True Gross Margin Analysis

Under **Reports → Sales & Profitability**, measure your actual trading profits:
- **Gross and Net Revenue:** Filterable by day, week, month, or custom date ranges.
- **True Gross Margin:** Calculated from the actual line-item unit cost (`unit_cost` / PAMP) captured at the time of each sale:
  $$\text{Gross Margin} = \text{Selling Price (HT)} - \text{Unit Cost (PAMP)}$$
  $$\text{Margin Rate (\%)} = \frac{\text{Gross Margin}}{\text{Selling Price (HT)}} \times 100$$
- **Performance by Brand and Category:** Identify high-margin brands and leading product lines (e.g., Men's Dress Loafers vs Women's Sneakers).
- **Top and Slow-Moving Products:** Rank bestsellers and uncover dormant inventory to plan timely promotions.

---

### C. Inventory Valuation Report

The **Stock Valuation Report** certifies the capital investment tied up in store inventory:
- **Total Pair Count:** Segmented by model and size.
- **Total Purchase Valuation (at PAMP):** Capital currently held across shelves and reserves. This figure is required for your annual balance sheet.
- **Potential Retail Value (at Selling Price):** Potential revenue if current inventory sells through completely.
- **Potential Gross Profit:** Projected margin residing in current stock.

### D. Size curve and broken size runs

In **Reports → Size curve**:
1. Choose the period (8 weeks by default), a brand, a category, or a gender.
2. The chart and table show, for each size: pairs sold net of returns, sales share, stock, quantity still on order, weeks of cover, and sell-through.
3. **Broken size runs** lists a model that still has stock while one of its core sizes is at zero. Core sizes are those that make up at least 70% of that model's sales over 52 weeks. With no history, the calculation uses the category, then the gender, then the usual sizes. Tied-up stock is valued at weighted average cost.

### E. Reorder suggestions

In **Reports → Reorder**, or from **Low stock** and **Size curve**:
1. Each size suggests a quantity: sales over the last 8 weeks, per week, multiplied by the cover weeks (6 by default, an owner setting), minus stock, minus quantities already on order.
2. If the model has a carton breakdown, the quantity is rounded up to a whole carton for that colour.
3. The suggested supplier is the one on the model's latest purchase order. Edit the quantities, then create one **draft** purchase order per supplier.

### F. Aïd and the school term

The dashboard announces the next Aïd and recalls the pairs and sizes sold over the same stretch the previous time, with a link to reorder.

In **Reports → Aïd and term**, compare revenue and sizes for the 30 days (or 15, 45, 60) before each occurrence.

In **Settings → Seasons**, the owner corrects the date. Aïd is calculated (1 Shawwal and 10 Dhu al-Hijjah, 2020–2035) and stays estimated until it is edited. The school term defaults to 1 September.

