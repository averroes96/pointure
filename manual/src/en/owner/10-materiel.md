## 10. Hardware, Printers, and POS Peripherals {#materiel}

ShoeDZ is compatible with standard Windows retail POS hardware.

### A. Printer Configuration

From **Settings → Printers**, assign dedicated printers for different operational needs:

1. **Thermal Receipt Printer (POS Checkout):**
   - Compatible devices: Direct thermal 80mm or 58mm ESC/POS printers (Epson, Xprinter, Bixolon, etc.) via USB or Ethernet/Wi-Fi network.
   - Select paper roll width (`80mm` or `58mm`).
   - Enable **Automatic Cash Drawer Ejection** upon checkout.
2. **Standard Office Printer (A4 Documents):**
   - Any laser or inkjet printer recognized by Windows (HP, Canon, Brother, etc.).
   - Used for A4 sales invoices, B2B delivery notes, customer account statements, and stocktake sheets.
3. **Barcode Label Printer:**
   - Thermal label printers for shoe boxes and price tags (standard dimensions `50x30 mm` or `40x25 mm`).

> 📷 **Screenshot:** *Printer setup tab with device selectors and printing options.*

---

### B. Hardware Quick Check

To verify hardware connections without processing a live sale:
1. In **Settings → Printers**, click **Hardware Quick Check**.
2. Click **Print Test Receipt**:
   - A test ticket prints immediately showing the ShoeDZ header and verified settings.
3. Click **Test Drawer Ejection**:
   - The printer sends an electrical pulse to the connected cash drawer (RJ11/RJ12 connector), which should pop open.
4. If the drawer does not open:
   - Check the RJ11 cable connecting the drawer to the rear of the receipt printer.
   - Adjust the kick pin signal (Pin 2 or Pin 5) in advanced printer options.

---

### C. Barcode Scanners (USB Handheld Readers)

ShoeDZ supports 1D and 2D barcode scanners operating in standard keyboard emulation mode (**USB HID Keyboard Wedge**):
- **Plug-and-Play:** Plug the scanner into any PC USB port. No specialized drivers are required.
- **Enter Key Suffix:** The scanner must send an automated <kbd>Enter</kbd> keystroke immediately after reading a barcode. Most retail scanners enable this by default. If yours does not, scan the *"Add CR/LF Suffix"* barcode in the manufacturer's manual.

