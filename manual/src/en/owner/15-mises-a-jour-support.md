## 15. Software Updates and Technical Support {#mises-a-jour-support}

ShoeDZ receives ongoing updates to incorporate retailer feedback and maintain alignment with Algerian accounting and fiscal regulations.

### A. Updating the Windows Desktop Application

ShoeDZ for Windows operates autonomously:

1. **In-App or Installer Update Workflow:**
   - In **Settings → Desktop**, click **Check for updates** to automatically download and apply the latest version (**Restart and apply**).
   - Offline, you can also run the setup installer (e.g., `ShoeDZ-Setup-1.6.0.exe`) from a USB flash drive after closing ShoeDZ.
2. **Automatic Database Migration:**
   - Upon relaunching the app, ShoeDZ automatically executes local SQLite schema migration scripts.
   - All existing data (inventory, prices, customers, sales history, debts) is preserved.

> [!TIP]
> As a best practice, create a manual backup on a USB flash drive before applying major software updates.

---

### B. The Diagnostics & Logs Bundle

In the event of unexpected system behaviour or for performance reviews, the owner or manager can compile a complete diagnostic bundle in one click:

1. Open **Settings → Desktop**.
2. In the **Diagnostics & Logs Bundle** card, click **Download bundle (.zip)**.
3. The owner can check **Include a database backup copy** if requested by support.
4. The system packages an archive named `shodz_diagnostic_YYYYMMDD_HHMMSS.zip` containing:
   - `meta.json`: App version, Python/OS platform details, Django migration status, SQLite integrity check (`PRAGMA quick_check`), and local backup list.
   - Application event logs (`logs/shodz.log`).
   - Slow query and latency logs (`logs/perf.log`).
   - A consistent database snapshot (`database/db_snapshot.sqlite3`, if included by the owner).

> 📷 **Screenshot:** *Diagnostic bundle download card within the Desktop Settings tab.*

---

### C. Contacting ShoeDZ Technical Support

For technical assistance or hardware guidance:
- **Phone Hotline & WhatsApp Support:** Contact your dedicated support advisor at the direct telephone number provided upon license activation.
- **Submitting the Diagnostic Bundle:** Attach your `shodz_diagnostic_*.zip` file to your message to enable immediate troubleshooting without delay.
- **Remote Assistance:** If needed, a support engineer can guide you via secure remote desktop assistance to configure thermal printers or barcode scanners.

