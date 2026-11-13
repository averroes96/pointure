## 11. Sauvegardes, sécurité et restauration des données {#sauvegardes}

Les données de votre magasin (historique des ventes, dettes clients, valorisation des stocks) constituent le patrimoine numérique de votre entreprise. Une stratégie de sauvegarde rigoureuse vous prémunit contre toute panne matérielle ou vol de PC.

### A. Sauvegardes automatiques et manuelles

ShoeDZ intègre un système de sauvegarde double niveau :
1. **Sauvegarde automatique quotidienne :**
   - L'application génère automatiquement une copie de sécurité de la base de données toutes les **24 heures** (ainsi qu'automatiquement avant toute clôture d'exercice fiscal, restauration ou réinitialisation).
   - Les sauvegardes locales (`.sqlite3`, non chiffrées pour permettre une reprise locale immédiate) sont conservées dans le dossier `backups/` avec une rétention glissante des **14 dernières copies**.
2. **Sauvegarde manuelle immédiate :**
   - À tout moment, rendez-vous dans **Paramètres → Desktop**.
   - Cliquez sur le bouton **Créer une sauvegarde maintenant**.

---

### B. Sauvegarde externe (USB / Dossier synchronisé) et Chiffrement AES-256

Une sauvegarde stockée uniquement sur le disque dur du PC caisse ne vous protège pas en cas de panne de disque dur, de surtension électrique ou de vol de l'ordinateur.

1. Dans **Paramètres → Desktop**, cliquez sur **Configurer la sauvegarde externe**.
2. Indiquez le **Chemin du dossier de destination** (ex : lettre de votre clé USB `E:\Sauvegardes` ou dossier synchronisé Google Drive / OneDrive).
3. Activez le **Chiffrement AES-256-GCM** (activé par défaut pour les copies externes) et définissez votre **Phrase de passe de chiffrement** :
   - Les copies externes sont enregistrées au format chiffré `.shodzbak` avec une rétention par défaut de **30 copies**.
   - Le chiffrement protège vos copies externes en cas de perte ou de vol de la clé USB, tandis que les sauvegardes locales sur le PC de caisse restent au format `.sqlite3` pour un dépannage instantané.

> [!IMPORTANT]
> **Imprimez immédiatement votre Fiche de récupération :**
> - Lors de l'enregistrement de votre phrase de passe, cliquez sur **Imprimer la fiche de récupération**.
> - **Conservez impérativement ce document papier hors du magasin (ex : coffre-fort de direction)**. En cas de perte de cette phrase de passe, aucune sauvegarde chiffrée (`.shodzbak`) ne pourra être restaurée, même par l'équipe technique ShoeDZ.

> 📷 **Capture d'écran :** *Interface de gestion des sauvegardes locales et externes dans Paramètres → Desktop.*

---

### C. Restauration d'une sauvegarde en cas de sinistre

Pour restaurer votre base de données (sur le poste actuel ou après installation de ShoeDZ sur un nouveau PC) :
1. Rendez-vous dans **Paramètres → Desktop** (connecté en tant que **Propriétaire**).
2. Cliquez sur **Restaurer cette sauvegarde** en face d'une archive locale, ou sur **Restaurer un fichier...** pour sélectionner un fichier `.sqlite3` ou `.shodzbak` depuis votre clé USB.
3. Si le fichier est chiffré (`.shodzbak`), saisissez votre **Phrase de passe de restauration**.
4. Tapez le mot de confirmation demandé (`RESTAURER`), puis cliquez sur **Restaurer et Redémarrer** : une sauvegarde automatique pré-restauration (`pre_restore_*.sqlite3`) est créée, puis l'application redémarre automatiquement avec vos données restaurées.
'
---

### D. Patron à distance (Telegram)

Le propriétaire peut recevoir des messages en lecture seule sur Telegram. Le jeton du bot reste dans la configuration locale de l'ordinateur ; il n'est pas enregistré dans la base de données.

1. Créez un bot avec **@BotFather** et copiez son jeton.
2. Ouvrez **Paramètres → Patron à distance** (compte **Propriétaire**).
3. Collez le jeton et cliquez sur **Vérifier**.
4. Cliquez sur **Lier**. L'application affiche un code à 6 chiffres pendant 5 minutes.
5. Dans Telegram, envoyez au bot `/start` suivi du code. Jusqu'à 3 discussions peuvent être liées. Chaque discussion peut être retirée, et un **Message test** confirme le lien.
6. Les messages venant d'une discussion non liée sont ignorés.
7. Sur le même écran, choisissez l'heure du résumé quotidien (21:00 par défaut) et activez les alertes : écart de caisse, vente annulée, remboursement, remise approuvée, exercice non clôturé après le 15 janvier, sauvegarde externe de plus de 3 jours. Les textes suivent la langue du propriétaire.

