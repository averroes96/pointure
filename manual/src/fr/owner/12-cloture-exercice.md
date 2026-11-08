## 12. Clôture annuelle d'exercice et export comptable {#cloture-exercice}

En Algérie, la gestion commerciale rigoureuse impose d'arrêter en fin d'année la valorisation des stocks, le chiffre d'affaires annuel et les soldes de créances/dettes à transmettre à votre cabinet comptable.

> [!NOTE]
> **Périmètre de la clôture dans ShoeDZ :** ShoeDZ assure une **clôture de gestion commerciale et de stocks** (instantané de valorisation au PAMP, photographie des soldes clients/fournisseurs, verrouillage des pièces antidatées et export du dossier pour l'expert-comptable). Il ne s'agit pas d'un logiciel de comptabilité générale SCF (pas de saisie de plan comptable ni d'écritures d'à-nouveaux).

### A. Le calendrier de l'exercice fiscal

Par défaut, l'exercice fiscal coïncide avec l'année civile (du **1er janvier au 31 décembre**) :
- Accédez au module depuis le menu latéral **Clôture d'exercice** (`/closing`, réservé au propriétaire).
- Cliquez sur **Initialiser un exercice** pour créer l'exercice de l'année souhaitée (les dates de début et de fin restent ajustables tant que l'exercice est ouvert).

---

### B. Les 5 étapes de l'assistant de clôture (Closing Wizard)

1. **Étape 1 — Vérifications préalables :**
   - Vérifie qu'aucune **session de caisse** n'est restée ouverte sur la période (bloquant) et signale les bons de commande fournisseurs en brouillon, factures non confirmées, ventes à paiement partiel ou chèques en attente.
2. **Étape 2 — Inventaire physique de fin d'année :**
   - Associez une session d'inventaire physique finalisée ou cochez explicitement l'option permettant d'utiliser le stock théorique calculé.
3. **Étape 3 — Bilan & Instantané (Snapshot) :**
   - Figer et contrôler les indicateurs annuels : **Ventes Caisse (TTC hors timbre)**, **Timbre fiscal**, **Factures B2B (HT)**, **TVA facturée**, **Avoirs clients (HT)**, **Chiffre d'Affaires Net (HT)**, **Coût des marchandises (COGS)**, **Marge brute réalisée**, **Valorisation des stocks (PAMP et détail)** et **Créances & Dettes**.
4. **Étape 4 — Téléchargement du pack comptable :**
   - **Télécharger le pack comptable (`.xlsx`) :** Classeur Excel complet comprenant **9 feuilles** (*Synthèse*, *Journal des ventes*, *Factures*, *Avoirs*, *Achats*, *Stock fin d'exercice*, *Soldes clients*, *Soldes fournisseurs*, *Chèques en circulation*).
   - **Imprimer la synthèse annuelle (`.pdf`) :** Rapport officiel d'une page A4 avec cadre de visas et signatures pour le gérant et l'expert-comptable.
5. **Étape 5 — Clôture définitive et verrouillage :**
   - Tapez l'année à clôturer (ex : `2026`) et cliquez sur **Clôturer définitivement l'exercice**.
   - Une sauvegarde automatique de sécurité (`pre_close_<année>_*.sqlite3`) est générée immédiatement avant le verrouillage.

> 📷 **Capture d'écran :** *Assistant de clôture d'exercice en 5 étapes avec téléchargement du pack Excel/PDF et verrouillage.*

---

### C. Effets du verrouillage et Réouverture exceptionnelle

1. **Verrouillage de la période :**
   - Dès que l'exercice est clôturé, aucune vente, retour, facture, avoir, achat fournisseur, mouvement de stock ou paiement ne peut être créé, modifié ou supprimé à une date appartenant à l'exercice clôturé.
2. **Continuité d'exploitation :**
   - Vos stocks courants, fiches clients et soldes fournisseurs restent continus au 1er janvier sans aucune ressaisie d'ouverture.
3. **Réouverture auditée (Propriétaire uniquement) :**
   - En cas de rectification demandée par votre commissaire aux comptes ou expert-comptable, le propriétaire peut cliquer sur **Réouvrir l'exercice**, saisir un **Motif de réouverture** obligatoire (consigné dans le journal d'audit), effectuer l'écriture corrective, puis clôturer à nouveau l'exercice.

