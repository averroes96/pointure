## 9. Journal d'audit et traçabilité des opérations {#audit}

Pour garantir une transparence totale et prévenir les fraudes ou erreurs de manipulation, ShoeDZ intègre un système d'audit interne inaltérable.

### A. Qu'est-ce que le journal d'audit enregistre ?

Le journal d'audit consigne automatiquement chaque action sensible survenue dans le système.

> [!NOTE]
> Le journal d'audit ne trace pas l'intégralité des requêtes techniques de l'application, mais cible précisément les modèles de données audités (`AUDITED_MODELS`) :
> - **Ventes, retours et ventes en attente (`Sale`, `Return`, `HeldSale`) :** Création de ticket, remboursement, annulation, mise en attente et reprise.
> - **Caisse et sessions (`CashSession`, `CashMovement`) :** Ouverture/clôture de caisse et tout apport ou prélèvement d'espèces dans le tiroir.
> - **Articles, stocks et inventaires (`Product`, `Variant`, `StockMovement`, `StocktakeSession`, `DefectItem`) :** Modification de tarif, ajustements de stock, sessions d'inventaire et démarques défectueux.
> - **Fournisseurs et achats (`Supplier`, `PurchaseOrder`, `SupplierInvoice`, `SupplierPayment`) :** Commandes fournisseurs, réceptions, factures d'achat et règlements.
> - **Clients, chèques et fidélité (`Client`, `Cheque`, `Promotion`, `LoyaltyProgram`) :** Plafonds de crédit, suivi des chèques et campagnes promotionnelles.
> - **Facturation B2B (`Invoice`, `InvoicePayment`, `DeliveryNote`, `CreditNote`) :** Émission, confirmation, encaissement et annulation de pièces commerciales.
> - **Clôture fiscale et administration (`FiscalYear`, `User`) :** Clôture/réouverture d'exercice, création de comptes, rôles et autorisations par PIN.

---

### B. Détail d'une entrée d'audit

Chaque ligne enregistrée dans le journal comprend :
1. **Horodatage exact :** Date et heure à la seconde près.
2. **Utilisateur responsable :** Identifiant et nom de l'employé connecté ayant effectué l'opération.
3. **Type d'action :** `CREATE` (Création), `UPDATE` (Modification), ou `DELETE` (Suppression / Annulation).
4. **Objet concerné :** Référence ou identifiant du document ou de l'article impacté.
5. **Différentiel des données :** Comparaison explicite entre l'**Ancienne valeur** et la **Nouvelle valeur** des champs modifiés (ex : *Prix de vente modifié de 6 500 DZD à 5 800 DZD*).

> 📷 **Capture d'écran :** *Écran du journal d'audit avec filtres par date, utilisateur et visualisation avant/après.*

---

### C. Recherche et filtrage dans l'audit

Depuis le menu latéral **Journal d'audit** (`/settings/audit-log`, réservé au propriétaire) :
- Filtrez par **Utilisateur** pour auditer l'activité d'un caissier spécifique lors d'un incident de caisse.
- Filtrez par **Période** (ex : lors d'une semaine d'inventaire ou pendant les soldes).
- Filtrez par **Type d'opération** (ex : afficher toutes les autorisations accordées par le PIN d'un gérant).
- Ces registres sont immuables : aucun utilisateur, y compris le propriétaire, ne peut modifier ou effacer rétroactivement une entrée du journal d'audit.

