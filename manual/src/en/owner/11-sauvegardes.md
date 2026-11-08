## 11. Backups, Security, and Data Recovery {#sauvegardes}

Your store's operational data represents the digital lifeblood of your enterprise. A rigorous backup routine protects your business against hardware breakdowns, power surges, or PC theft.

### A. Automated and Manual Backups

ShoeDZ provides dual-level data protection:
1. **Automated Daily Backups:**
   - The application automatically snapshots the SQLite database upon register closing or at a scheduled time.
   - Local archives are saved in the software's data directory with chronological timestamps.
2. **Immediate Manual Backup:**
   - At any time, navigate to **Settings → Desktop / Backups**.
   - Click the **Create Backup Now** button.

---

### B. Encryption and the Recovery Sheet

To safeguard confidential commercial data, all backup archives are encrypted with a secure **Passphrase** defined during initial setup.

> [!IMPORTANT]
> **Print and Safely Store Your Recovery Sheet:**
> - In **Settings → Backups**, click **Print Recovery Sheet**.
> - This printed page contains your emergency decryption passphrase and recovery instructions.
> - **Store this physical sheet in the store's physical safe**, away from the computer. Without this passphrase, encrypted backups cannot be restored onto a replacement PC.

---

### C. Daily External USB Drive Copy (Critical Rule)

Keeping backups solely on the PC's internal drive offers no protection against hard drive failure or hardware theft.

1. Insert a **Dedicated USB Flash Drive** into the PC every evening.
2. In **Settings → Backups**, click **Export to USB Drive**.
3. Select the external drive letter.
4. The encrypted backup archive (`.enc` or `.zip`) copies over in seconds.
5. Unplug the drive and take it home when leaving the store.

> 📷 **Screenshot:** *Backup management panel showing snapshot archive list and USB export button.*

---

### D. Disaster Recovery and System Restoration

If you must set up ShoeDZ on a replacement computer following an incident:
1. Install ShoeDZ on the new Windows PC.
2. On the initial startup screen, select **Restore from an Existing Backup**.
3. Connect your USB flash drive and select the most recent backup archive.
4. Enter the emergency passphrase from your printed recovery sheet.
5. Click **Begin Restoration**: your catalog, prices, customer ledgers, and inventory counts are fully restored.

