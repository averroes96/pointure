## 15. Software Updates and Technical Support {#mises-a-jour-support}

ShoeDZ receives ongoing updates to incorporate retailer feedback and maintain alignment with Algerian accounting and fiscal regulations.

### A. Updating the Windows Desktop Application

ShoeDZ for Windows operates autonomously:

1. **Safe Update Workflow:**
   - Download the official setup installer for the new release (e.g., `ShoeDZ-Setup-1.6.0.exe`) provided by support or stored on your USB flash drive.
   - Close ShoeDZ completely on the counter PC.
   - Run the installer: it detects your existing installation directory and upgrades program files without affecting your data.
2. **Automatic Database Migration:**
   - Upon relaunching the app, ShoeDZ automatically executes local SQLite schema migration scripts.
   - All existing data (inventory, prices, customers, sales history, debts) is preserved.

> [!TIP]
> As a best practice, create a manual backup on a USB flash drive before applying major software updates.

---

### B. The Diagnostic Bundle

In the event of unexpected system behaviour or for performance reviews, the owner can compile a complete diagnostic bundle in one click:

1. Open **Settings → Desktop**.
2. Under *Diagnostics & Maintenance*, click **Download Diagnostic Bundle**.
3. Choose whether to include a database snapshot (restricted to the owner).
4. The system packages an archive named `diagnostics_YYYYMMDD_HHMMSS.zip` containing:
   - `meta.json`: App version, Windows environment details, free disk space, and database metrics.
   - Event and error logs (`pointure.log`).
   - Slow query and latency logs (`perf.log`).
   - Database snapshot (if selected).

> 📷 **Screenshot:** *Diagnostic bundle download card within the Desktop Settings tab.*

---

### C. Contacting ShoeDZ Technical Support

For technical assistance or hardware guidance:
- **Phone Hotline & WhatsApp Support:** Contact your dedicated support advisor at the direct telephone number provided upon license activation.
- **Submitting the Diagnostic Bundle:** Attach your `diagnostics_*.zip` file to your message to enable immediate troubleshooting without delay.
- **Remote Assistance:** If needed, a support engineer can guide you via secure remote desktop assistance to configure thermal printers or barcode scanners.

