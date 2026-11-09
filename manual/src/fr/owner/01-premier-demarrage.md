# Guide Propriétaire & Responsable de Magasin {#guide-gestionnaire}

Ce guide de référence est destiné aux propriétaires de boutiques, directeurs de magasins et gestionnaires de stocks utilisant la solution ShoeDZ. Il couvre l'ensemble des modules d'administration, de la configuration initiale de votre établissement jusqu'aux clôtures comptables annuelles.

---

## 1. Premier démarrage et configuration initiale {#premier-demarrage}

ShoeDZ fonctionne sous Windows de manière totalement autonome (architecture offline-first). L'application intègre un serveur local sécurisé (`127.0.0.1:8745`) et une base de données SQLite optimisée, ne nécessitant aucune connexion Internet permanente pour son fonctionnement quotidien.

### A. L'assistant de premier démarrage (Setup Wizard)

Lors du tout premier lancement après l'installation sous Windows :
1. L'application ouvre automatiquement l'écran d'initialisation.
2. Définissez le **Nom commercial de votre boutique** (ex : *"Chaussures El Mordjane"*).
3. Renseignez l'**Activité principale** (Commerce de détail de chaussures et maroquinerie).
4. Saisissez les coordonnées de contact :
   - **Numéro de téléphone principal** (format algérien mobile à 10 chiffres débutant par `05`, `06` ou `07`, ou fixe).
   - **Wilaya** de domiciliation parmi les 58 wilayas d'Algérie.
   - **Adresse physique** complète du magasin.
5. Créez le compte **Propriétaire principal (Owner)** en renseignant votre numéro de téléphone et un mot de passe sécurisé.

> 📷 **Capture d'écran :** *Écran de l'assistant de configuration initiale ShoeDZ avec saisie des coordonnées du magasin.*

---

### B. Choix du mode d'activité commercial (Business Mode)

ShoeDZ s'adapte à votre modèle de vente grâce à 3 modes configurables dans **Paramètres → Général** :

1. **Mode Détail (Rayon) :**
   - Idéal pour les boutiques de vente au détail grand public.
   - Les articles sont gérés et vendus à la paire unique, avec sélection rapide de la pointure (du 35 au 46) et de la couleur.
2. **Mode Gros / Demi-gros :**
   - Destiné aux dépôts et grossistes approvisionnant les détaillants.
   - Les articles sont vendus par cartons entiers ou séries de colis, avec répartition prédéfinie des pointures par boîte.
3. **Mode Mixte (Détail + Carton) :**
   - Permet de vendre simultanément au rayon (à la paire) et au carton complet pour les clients professionnels, en appliquant automatiquement la grille tarifaire adéquate.

> [!NOTE]
> Vous pouvez modifier le mode d'activité à tout moment sans perte de données. Vos stocks existants seront immédiatement réévalués en paires et en cartons équivalents.

---

### C. Identité fiscale et légale du magasin

Pour que vos factures formelles, devis et bons de livraison soient conformes à la réglementation commerciale algérienne, complétez vos identifiants fiscaux dans **Paramètres → Entreprise** :

- **NIF :** Numéro d'Identification Fiscale (15 chiffres).
- **RC :** Numéro du Registre de Commerce (ex : `16/00-1234567B16`).
- **AI :** Article d'Imposition (11 chiffres).
- **NIS :** Numéro d'Identification Statistique.

Dans **Paramètres → Politiques & Mode**, vous pouvez également choisir votre **Régime fiscal** :
- **Régime du réel :** La TVA (19%) est appliquée par défaut lors de la création de factures.
- **Impôt Forfaitaire Unique (IFU) :** La TVA est désactivée par défaut et la colonne TVA est masquée sur les factures imprimées. Vous pouvez aussi définir vos **Mentions légales sur factures** personnalisées (ex: exonération TVA / IFU) qui seront imprimées au bas de vos factures et devis.

Ces mentions obligatoires apparaîtront automatiquement sur l'en-tête de vos documents d'impression grand format (A4) et sur les tickets de caisse légaux.

