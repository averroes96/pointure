## 12. Troubleshooting Common Issues {#problemes}

Here are straightforward checks you can perform at the checkout counter whenever an unexpected issue occurs before contacting technical support.

---

### 1. Thermal Printer Is Not Printing Receipts

1. **Check physical connections:** Ensure the USB cable is firmly plugged into the PC and the printer's power adapter brick is turned on (green indicator light lit).
2. **Inspect the thermal paper roll:**
   - Open the printer hood.
   - Thermal paper has a heat-sensitive side: the paper must unroll **from underneath** with the thermal coating facing the print head. If the roll is inserted backward, receipts will feed out completely blank.
3. **Perform a software test print:**
   - Go to **Settings** (<kbd>Alt + P</kbd>) → **Printers** tab.
   - Click the **Print Test Receipt** button.
   - If the receipt prints cleanly, the hardware and driver are functioning normally.

---

### 2. Barcode Scanner Does Not Beep or Add Items to Cart

1. **Check USB connection:** Unplug the barcode reader and plug it into another USB port on the PC.
2. **Test scanner in a text field:**
   - Click into Windows Notepad or the POS search bar (<kbd>F2</kbd>).
   - Scan any barcode: the numeric digits should appear immediately, followed by an automated carriage return (Enter).
3. **If no characters appear:**
   - Scan the factory reset barcode from the paper manual included with your scanner to re-enable standard *USB HID Keyboard Wedge* mode.

---

### 3. System Clock Anomaly Alert (Orange Banner `TimeAnomalyBanner`)

If an orange warning banner appears across the top of the screen reading *"Anomaly detected on system clock"*:
- This indicates that the Windows system date or time was manually altered, or the motherboard CMOS battery has failed.
- For tax and legal compliance, sales transactions cannot be backdated.
- **Solution:** Navigate to **Settings** → **Desktop** tab, then click **Resync Clock** to synchronize time automatically via the Internet.

---

### 4. Error Message: "Closed Fiscal Period"

If the system rejects creating or updating a transaction with the error *"Cannot post transactions to a closed period"*:
- This indicates that the store manager or accountant has finalized and locked the previous month or fiscal year.
- Backdated entries into locked periods are prohibited. Record the transaction under today's open date.

---

### 5. Who to Contact When Issues Persist

If the problem remains unresolved after following these steps:
1. Immediately inform your **Store Manager or Owner**.
2. For persistent software or database issues: the manager can generate a **Diagnostic Bundle** from **Settings → Desktop** and forward it to ShoeDZ technical support.
