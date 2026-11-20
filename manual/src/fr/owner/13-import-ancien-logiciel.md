## 13. Migration et import de données existantes {#import-ancien-logiciel}

Si vous utilisiez auparavant un autre logiciel de gestion de magasin de chaussures ou des tableaux Excel, ShoeDZ vous permet de démarrer sans ressaisie manuelle. Les deux outils d'import se trouvent dans **Paramètres → Migration** et sont réservés au **propriétaire** et aux **responsables**.

### A. Importer le dossier d'un ancien logiciel (fichiers DBF)

De nombreux commerces utilisent d'anciens logiciels sous DOS ou Windows qui stockent leurs données dans des tables dBase (`.DBF`). ShoeDZ lit ces fichiers directement.

**1. Préparez les fichiers**

1. Fermez l'ancien logiciel, puis **copiez son dossier de données sur le Bureau** (ou compressez-le en fichier `.ZIP`). Tant que l'ancien logiciel est ouvert, Windows verrouille les fichiers et ShoeDZ affiche *« Impossible de lire le fichier … (accès verrouillé par Windows) »*.
2. ShoeDZ reconnaît ces fichiers (les noms sont ceux de l'ancien logiciel) :

| Fichier | Contenu importé |
|---|---|
| `ARTICLEB.DBF` (version Détail) ou `ARTICLE.DBF` (version Gros) | Catalogue : référence, libellé, prix d'achat, tarifs détail / demi-gros / gros, pointures, stock |
| `FAMILLE.DBF` | Familles d'articles, qui déterminent la catégorie et le genre |
| `CLIENT.DBF` (Détail) ou `CLIENTB.DBF` (Gros) | Clients, téléphones et soldes de dettes |
| `FOURNISS.DBF`, `FOURND.DBF` | Fournisseurs et leurs soldes, fournisseurs de charges |
| `GCPARAM.DBF` | Nom, téléphone et NIF du magasin |
| `ACHATART.DBF`, `ACHATMVT.DBF`, `VENTED01.DBF` à `VENTED12.DBF`, `CHEQUEXP.DBF`, `VERSECLT.DBF` | Facultatifs : achats, historique des ventes, chèques en attente, versements en cours |

**2. Réglez les options et chargez les fichiers**

3. Ouvrez **Paramètres → Migration** et descendez jusqu'à **Migration des données historiques** (sous l'assistant Excel & CSV).
4. Réglez les options :
   - **Mode de gestion du stock (Articles)** :
     - **Mode Simple (Recommandé, par défaut)** : 1 article = 1 référence avec son stock réel exact. L'encaissement reste en un clic, sans choisir de pointure.
     - **Mode Variantes (Découper par tailles)** : génère une grille de pointures et répartit le stock estimé sur chaque taille.
   - **Version de l'ancien logiciel** : **Détail (Standard)** ou **Gros / Demi-Gros**. Ce choix indique à ShoeDZ de lire `ARTICLEB` / `CLIENT` ou `ARTICLE` / `CLIENTB`.
   - **Sélectionnez les données à importer** : *Fournisseurs*, *Clients*, *Produits & Stock*, *Bons d'Achat & Réceptions (ACHAT)*, *Ventes historiques* (tout est coché par défaut).
5. Cliquez sur la zone en pointillés pour **sélectionner le dossier** contenant vos fichiers `.DBF`, ou cliquez sur **Téléverser une archive .ZIP** si vous avez compressé le dossier.

**3. Contrôlez l'aperçu (rien n'est encore enregistré)**

6. L'**Aperçu avant importation (Simulation)** s'affiche tout seul, sans rien enregistrer. Vérifiez :
   - les **compteurs** : produits et stock, articles en stock, clients, fournisseurs, bons d'achat, chèques en attente, versements en cours ;
   - les **Totaux financiers et valorisation** : *Valeur du stock (Coût)*, *Créances clients*, *Dettes fournisseurs*, etc. Comparez-les aux totaux de votre ancien logiciel ;
   - les **Avertissements détectés** : par exemple un produit sans prix de vente ou une pointure illisible. Ils n'empêchent pas l'import : corrigez-les ensuite dans la fiche produit.
7. Si vous changez une option, cliquez sur **Actualiser l'aperçu**.

![Aperçu avant importation d'un dossier DBF : compteurs, totaux financiers et avertissements, sans rien enregistrer.](../assets/fr/owner-13-legacy-import.webp)

*Aperçu avant importation d'un dossier DBF : compteurs, totaux financiers et avertissements, sans rien enregistrer.*

**4. Lancez l'import**

8. Si les chiffres correspondent, cliquez sur **Importer maintenant** (ou sur **Annuler** pour abandonner).
9. Patientez **15 à 30 secondes** selon la taille des données. Pendant l'import, la base est verrouillée en écriture : **n'encaissez aucune vente**. Un récapitulatif des éléments importés s'affiche ensuite.

> [!WARNING]
> **Ne lancez cet import qu'une seule fois, lors de la configuration**, pour éviter de dupliquer des enregistrements. Créez d'abord une sauvegarde (chapitre 11). Les soldes de clients et de fournisseurs deviennent des **soldes d'ouverture**.

---

### B. Importer un tableur Excel / CSV

Pour charger des **produits (avec leur stock d'ouverture)**, des **clients** ou des **fournisseurs** depuis un tableur, utilisez l'**Assistant d'Importation Excel & CSV**, en haut de **Paramètres → Migration**.

1. Dans l'assistant, cliquez sur **Excel / CSV** sur la carte **Produits & Stocks**, **Clients** ou **Fournisseurs**.
2. **Étape 1 — Fichier & Modèle :**
   - Téléchargez le **Modèle Excel (.xlsx)** ou **Modèle CSV (.csv)** pré-rempli avec des exemples.
   - Pour les produits, choisissez la **Boutique / Dépôt de destination pour le stock initial**.
   - Glissez-déposez votre fichier (`.xlsx` ou `.csv`, 10 Mo au maximum) ou cliquez sur **Parcourir vos fichiers**.
3. **Étape 2 — Correspondance des colonnes :** ShoeDZ associe automatiquement les colonnes de votre fichier aux champs du logiciel (*Auto-mappé*). Corrigez une association dans la liste, ou choisissez **-- Ne pas importer cette colonne --**. Les champs obligatoires doivent tous être associés.
4. **Étape 3 — Validation & Prévisualisation :** choisissez la **stratégie de gestion des doublons** : *Mettre à jour les enregistrements existants*, *Ignorer les doublons* ou *Toujours créer un nouvel enregistrement*. L'aperçu indique les lignes analysées, valides, en doublon et en erreur, ligne par ligne. Rien n'est enregistré à ce stade.
5. **Étape 4 — Importation & Résultat :** cliquez sur **Lancer l'importation définitive**. Le bilan indique ce qui a été créé ou mis à jour. En cas de lignes en erreur, cliquez sur **Télécharger le journal des erreurs**, corrigez le fichier et relancez. Terminez avec **Terminer et voir les données**.

**Règles du modèle « Produits » :**
- Le modèle contient **une ligne par pointure et par couleur** (par exemple Air Max Runner, pointure 42, Noir ; puis pointure 43, Noir ; puis 42, Blanc). Il n'accepte pas une série de pointures du type `39-45` dans une même cellule.
- Colonnes : *Nom* (obligatoire), *Marque*, *Référence*, *Catégorie*, *Genre*, *Pointure*, *Couleur*, *Prix Achat (DZD)*, *Prix Vente (DZD)* (obligatoire), *Prix Demi-Gros*, *Prix Gros*, *Stock Initial*, *Code-barres*, *Paires par Carton*, *Seuil Alerte*, *Description*.
- Le *Stock Initial* crée un **mouvement de stock d'ouverture** dans la boutique choisie à l'étape 1.
- Pour les clients, seul le *Nom* est obligatoire. Les colonnes *Type (detail / gros)*, *Wilaya*, *NIF*, *RC* et *Plafond Crédit (DZD)* sont facultatives.
