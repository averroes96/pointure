## 11. Backups, Security, and Data Recovery {#sauvegardes}

Your store's operational data represents the digital lifeblood of your enterprise. A rigorous backup routine protects your business against hardware breakdowns, power surges, or PC theft.

### A. Automated and Manual Backups

ShoeDZ provides dual-level data protection:
1. **Automated Daily Backups:**
   - The application automatically snapshots the SQLite database every **24 hours** (as well as automatically prior to any fiscal year closing, database restoration, or data reset).
   - Local archives (`.sqlite3`, unencrypted to enable instant local recovery) are saved in the `backups/` directory with a rolling retention of the **14 most recent copies**.
2. **Immediate Manual Backup:**
   - At any time, navigate to **Settings → Desktop**.
   - Click the **Create Backup Now** button.

---

### B. External Backup (USB / Synced Folder) and AES-256 Encryption

Keeping backups solely on the PC's internal drive offers no protection against hard drive failure, electrical damage, or hardware theft.

1. In **Settings → Desktop**, click **Configure external backup**.
2. Specify the **Destination folder path** (e.g., your USB flash drive `E:\Backups` or a Google Drive / OneDrive synced folder).
3. Enable **AES-256-GCM encryption** (enabled by default for external copies) and set your **Encryption passphrase**:
   - External copies are written in the encrypted `.shodzbak` format with a default retention of **30 copies**.
   - Encryption protects off-site copies on USB or external drives against loss or theft, while local automatic backups on the POS PC remain unencrypted (`.sqlite3`) for instant recovery.

> [!IMPORTANT]
> **Print and Safely Store Your Recovery Sheet Outside the Store:**
> - When saving your passphrase, click **Print recovery sheet**.
> - **Store this physical sheet in a secure place outside the store premises**. If this passphrase is lost, no encrypted backup (`.shodzbak`) can be restored, even by ShoeDZ technical support.

> 📷 **Screenshot:** *Local and external backup management panel in Settings → Desktop.*

---

### C. Disaster Recovery and System Restoration

To restore your database (on the current PC or after installing ShoeDZ on a replacement PC):
1. Navigate to **Settings → Desktop** (signed in as **Owner**).
2. Click **Restore this backup** next to a local snapshot, or click **Restore a file...** to upload a `.sqlite3` or `.shodzbak` file from your USB drive.
3. If the backup is encrypted (`.shodzbak`), enter your **Restore passphrase**.
4. Type the confirmation word (`RESTORE` or `RESTAURER`) and click **Restore & Restart**: an automatic pre-restore safety backup (`pre_restore_*.sqlite3`) is created, and the application restarts automatically with your restored data.

---

### D. Remote owner (Telegram)

The owner can receive read-only messages on Telegram. The bot token stays in the computer's local configuration and is not stored in the database.

1. Create a bot with **@BotFather** and copy its token.
2. Open **Settings → Remote owner** (signed in as **Owner**).
3. Paste the token and click **Check**.
4. Click **Link**. The app shows a 6-digit code for 5 minutes.
5. In Telegram, send the bot `/start` followed by the code. Up to 3 chats can be linked. Each chat can be removed, and a **Test message** confirms the link.
6. Messages from a chat that is not linked are ignored.
7. On the same screen, set the daily digest time (default 21:00) and turn alerts on or off: cash gap, cancelled sale, refund, approved discount, fiscal year still open after 15 January, and an external backup older than 3 days. The text follows the owner's language.

