## 3. Ringing Up Sales and Checkout {#encaisser}

The POS checkout screen (<kbd>F1</kbd>) is built for high-speed item entry, using either your keyboard or a barcode scanner.

### A. Adding an Item to the Cart

You can add shoes or accessories to the active cart using two methods:

#### Method 1: Via Barcode Scanner (USB Handheld)
1. Point the barcode scanner at the barcode label located on the shoe box or price tag.
2. Pull the scanner trigger: the shoe variant with its exact size and colour is instantly added to the cart.
3. Scanning the same barcode again automatically increments the item quantity by 1.

#### Method 2: Via Manual Search (<kbd>F2</kbd>)
1. Press <kbd>F2</kbd> or click into the search input at the top of the POS screen.
2. Type part of the shoe model name, brand, or reference code (e.g., *"Leather Loafer"* or *"Nike Air"*).
3. In the dropdown list, click the item.
4. Select the desired **Size** (e.g., 41, 42, 43) and **Colour**.
5. Click **Add to Cart** or press <kbd>Enter</kbd>.

> 📷 **Screenshot:** *POS screen displaying search bar, footwear size grid, and side cart.*

---

### B. Modifying the Cart

- **Change quantity:** Click the `+` / `-` buttons or type the number directly into the quantity field.
- **Apply a line discount:** Click the percentage `%` icon next to the line price, then enter the discount amount (e.g., `500 DZD`) or percentage (e.g., `10%`).
- **Apply an overall cart discount:** Click the *Global Discount* button beneath the cart subtotal.
- **Remove an item:** Click the red trash icon on the right side of the row.
- **Clear the whole cart:** Press <kbd>Esc</kbd> when the search input is empty.

> [!WARNING]
> Your cashier account has an authorized maximum discount threshold (`max_discount_pct`, e.g., 10%). If you attempt to grant a higher discount, a **Manager PIN Authorization** dialog will appear.

#### Customer Price Tier

Selecting a customer applies their default tier (Retail, Semi-wholesale, or Wholesale) to the cart prices. Press <kbd>Alt + G</kbd> to cycle Retail → Semi-wholesale → Wholesale, or choose a tier directly from the selector in the cart.

---

### C. Choosing the Payment Method

Once the cart is ready, click the green **Checkout** button or press <kbd>F10</kbd> (or the decimal point key <kbd>.</kbd> on your numeric keypad).

Select the agreed payment method with the customer:

1. **Cash:**
   - Click the quick denomination buttons (`1 000`, `2 000`, `5 000 DZD`) or enter the exact amount handed over by the customer.
   - The system instantly computes the **Change Due** in large green numbers.
2. **TPE (CIB / Edahabia Debit Card):**
   - Insert or tap the customer's card on the bank TPE terminal, prompt the customer to enter their PIN, and confirm in ShoeDZ.
3. **BaridiMob:**
   - Fast electronic payment via Algérie Poste instant transfer. Confirm receipt notification on your store phone before finalizing.
4. **Bank Cheque:**
   - Enter the cheque number, issuing bank, and agreed maturity/deposit date.
5. **CCP or Bank Transfer (Virement):**
   - Select **CCP** or **Bank Transfer** to record postal or bank transfer payments.
6. **Split / Mixed Payment:**
   - You can combine multiple payment methods (e.g., `3 000 DZD` in cash and the remainder via TPE).

> [!NOTE]
> **Fiscal Stamp Duty:** In accordance with Algerian fiscal regulations, when an official sales receipt is paid in cash for an amount equal to or greater than 400 DZD, a 1% fiscal stamp duty (capped at 10,000 DZD) is automatically calculated and added to the receipt.

---

### D. Finalizing and Printing the Receipt

1. Click **Confirm Sale** (<kbd>F10</kbd> or <kbd>.</kbd>).
2. The connected physical cash drawer pops open automatically.
3. The thermal receipt printer (80mm or 58mm format) prints the sales ticket with size details, prices, and applicable fiscal stamp duty.
4. The cart resets immediately, ready for the next customer in line.
