## 12. Clôture annuelle d'exercice et export comptable {#cloture-exercice}

En Algérie, le Système Comptable Financier (SCF) et la législation fiscale imposent un arrêté annuel des comptes pour établir le bilan et la liasse fiscale de l'entreprise.

### A. Le calendrier de l'exercice fiscal

Par défaut, l'exercice fiscal coïncide avec l'année civile (du **1er janvier au 31 décembre**) :
- Vous pouvez visualiser l'état de l'exercice en cours dans **Paramètres → Exercices fiscaux**.
- Si votre comptable préconise des dates d'ouverture ou de clôture spécifiques, celles-ci sont modifiables par le propriétaire avant le verrouillage officiel.

---

### B. L'assistant de clôture d'exercice (Closing Wizard)

Au 31 décembre de chaque année, suivez les étapes de l'assistant de clôture :

1. **Inventaire physique général de fin d'année :**
   - Réalisez un comptage exhaustif de toutes les paires de chaussures du magasin et validez la session d'inventaire (<kbd>F5</kbd> → **Inventaire**).
2. **Apurement des opérations en cours :**
   - Vérifiez et soldez les réservations/acomptes non réclamés.
   - Saisissez les dernières factures d'achat fournisseurs de l'année.
3. **Contrôle des totaux fiscaux :**
   - L'assistant récapitule :
     - Chiffre d'affaires brut et net annuel.
     - Total de la TVA collectée (19%).
     - Total du droit de timbre fiscal perçu sur les encaissements en espèces.
     - Coût d'Achat des Marchandises Vendues (CAMV / COGS basé sur le PAMP).
     - Valeur marchande exacte du stock final arrêté au 31 décembre.

> 📷 **Capture d'écran :** *Assistant de clôture d'exercice avec récapitulatif fiscal annuel et boutons de verrouillage.*

---

### C. Verrouillage fiscal de la période

Dès que les totaux annuels sont validés en accord avec votre comptable :
1. Cliquez sur **Verrouiller définitivement l'exercice fiscal**.
2. **Effets du verrouillage :**
   - Aucune vente, facture, avoir ou mouvement de stock ne pourra plus être antidaté sur l'année écoulée.
   - Toute tentative d'écriture sur cette période sera bloquée avec le message d'erreur *"Période fiscale clôturée"*.
   - Ce mécanisme protège votre magasin contre tout redressement fiscal résultant de modifications involontaires de bilans déjà arrêtés.

---

### D. Export pour l'expert-comptable

1. Dans la fiche de l'exercice clôturé, cliquez sur **Télécharger le pack comptable**.
2. ShoeDZ génère un fichier Excel/CSV normé contenant :
   - Le journal récapitulatif des ventes journalières.
   - Le journal des achats et réceptions fournisseurs.
   - Le tableau récapitulatif de la TVA et des timbres fiscaux.
   - L'état d'inventaire physique détaillé chiffré au PAMP au 31 décembre.
3. Transmettez directement ce fichier à votre cabinet d'expertise comptable pour l'établissement de la déclaration G50 et de la liasse fiscale annuelle.

---

### E. Réouverture et report des soldes à nouveau

Lors de l'ouverture du 1er janvier :
- Le système initialise automatiquement le nouvel exercice.
- Les quantités finales en stock deviennent les **Stocks initiaux d'ouverture**.
- Les créances clients et dettes fournisseurs sont automatiquement reportées à nouveau.

