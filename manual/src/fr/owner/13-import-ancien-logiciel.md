## 13. Migration et import de données existantes {#import-ancien-logiciel}

Si vous utilisiez auparavant un autre logiciel de gestion de magasin de chaussures ou des tableaux Excel, ShoeDZ met à votre disposition des outils d'importation automatisés pour démarrer sans ressaisie manuelle.

### A. Importation depuis d'anciens logiciels de caisse (Fichiers DBF)

De nombreux commerces de chaussures en Algérie utilisent d'anciens logiciels sous DOS ou Windows stockant leurs données dans des tables dBase (`.DBF`). ShoeDZ est capable de lire nativement ces fichiers d'origine grâce à son moteur de migration intégré (`legacy_dbf.py`) :

1. Récupérez le dossier de données de votre ancien logiciel sur clé USB.
2. ShoeDZ reconnaît automatiquement les fichiers standards suivants :
   - `ARTICLE.DBF` ou `ARTICLEB.DBF` : Catalogue des chaussures, marques, pointures, codes-barres et prix de vente.
   - `CLIENT.DBF` : Répertoire complet des clients avec leurs numéros de téléphone et soldes de dettes antérieurs.
   - `FOURNISS.DBF` ou `FOURND.DBF` : Annuaire des fournisseurs et soldes créditeurs.
3. Rendez-vous dans **Paramètres → Importation & Migration**.
4. Cliquez sur **Importer une base DBF**, puis sélectionnez le dossier source.
5. Cliquez sur **Lancer l'analyse préliminaire** : le système affiche le nombre exact d'articles, de variantes et de clients détectés.
6. Cliquez sur **Confirmer l'importation** : l'ensemble des données est converti et intégré dans votre nouvelle base ShoeDZ en quelques minutes.

> 📷 **Capture d'écran :** *Assistant d'importation DBF avec analyse du nombre d'articles et clients détectés.*

---

### B. Importation en masse par tableur Excel / CSV

Si vous gérez vos stocks sur tableur Excel :
1. Dans **Paramètres → Importation & Migration**, cliquez sur **Importer via Excel / CSV**.
2. Téléchargez notre **Modèle Excel officiel** pour disposer des bonnes colonnes :
   - `reference` : Référence du modèle ou code fabricant.
   - `nom` : Désignation de la chaussure (ex : *"Mocassin Cuir Homme"*).
   - `marque` : Nom de la marque.
   - `pointures` : Série de pointures (ex : `39-45` ou `40,41,42,43,44`).
   - `couleur` : Couleur principale.
   - `prix_achat` : Coût d'achat HT unitaire en DZD.
   - `prix_vente` : Prix de vente TTC en DZD.
   - `stock_initial` : Nombre de paires en rayon au démarrage.
3. Remplissez le fichier avec vos données et importez-le dans ShoeDZ.
4. **Validation à blanc (Dry-run) :** Le logiciel contrôle chaque ligne, signale les éventuels doublons ou pointures incorrectes, et vous permet de corriger avant enregistrement définitif.
5. Validez l'importation pour charger votre catalogue complet.

