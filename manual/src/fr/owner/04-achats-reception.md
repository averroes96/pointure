## 4. Achats fournisseurs, réceptions et valorisation PAMP {#achats-reception}

Une gestion d'approvisionnement rigoureuse garantit des stocks optimaux et une parfaite maîtrise de vos prix de revient.

### A. Répertoire des fournisseurs

1. Accédez au menu **Fournisseurs** pour gérer vos fabricants, importateurs et ateliers partenaires.
2. Pour chaque fournisseur, renseignez :
   - Raison sociale ou nom du représentant.
   - Numéro de téléphone direct et wilaya.
   - Identifiants légaux (NIF, RC) pour la facturation d'achat.
   - Délai de paiement habituel (ex : comptant, 30 jours, ou paiement après vente).

---

### B. Bons de commande fournisseurs (Purchase Orders)

1. Cliquez sur **+ Nouveau bon de commande**.
2. Sélectionnez le fournisseur concerné.
3. Ajoutez les modèles de chaussures commandés :
   - Vous pouvez commander par **Cartons assortis** (ex : 10 cartons de 12 paires, soit 120 paires avec répartition standard des pointures 39 à 45) ou par **Paires unitaires**.
4. Saisissez le prix d'achat convenu par paire ou par carton.
5. Validez le bon : son statut passe en *Confirmé*, en attente de livraison.

> 📷 **Capture d'écran :** *Bon de commande fournisseur avec répartition des pointures par carton.*

---

### C. Réception de marchandise et entrée en stock

À l'arrivée des colis au magasin ou au dépôt :
1. Ouvrez le bon de commande en attente et cliquez sur **Réceptionner la marchandise**.
2. Vérifiez physiquement les quantités livrées par rapport au bon de livraison du livreur.
3. Si un carton présente des pointures manquantes ou non conformes, ajustez directement la quantité réellement reçue (réception partielle).
4. Cliquez sur **Valider la réception** :
   - Le système génère automatiquement un mouvement d'entrée en stock (`StockMovement`) pour chaque pointure reçue.
   - Les niveaux de stock disponibles en rayon sont immédiatement incrémentés.
   - Les étiquettes codes-barres peuvent être imprimées en un clic pour étiqueter les nouvelles boîtes.

---

### D. Factures fournisseurs et règlements

1. Dès réception de la facture fournisseur, enregistrez-la depuis la commande pour comptabiliser la dette du magasin.
2. Lorsque vous réglez le fournisseur :
   - Cliquez sur **Nouveau règlement fournisseur**.
   - Choisissez le mode de paiement : **Espèces**, **Chèque bancaire** (en indiquant le numéro de chèque et la date d'échéance convenue), ou **Virement bancaire**.
   - Le système met à jour en temps réel le **Solde fournisseur restant dû**.

---

### E. Comprendre le PAMP (Prix d'Achat Moyen Pondéré)

ShoeDZ utilise la méthode du **PAMP** recommandée par le Système Comptable Financier (SCF) pour valoriser vos stocks et calculer votre marge réelle :

> [!NOTE]
> Le PAMP correspond au coût moyen réel de chaque paire en stock, recalculé à chaque nouvel arrivage à des prix différents.
>
> $$\text{Nouveau PAMP} = \frac{(\text{Stock actuel} \times \text{Ancien PAMP}) + (\text{Quantité reçue} \times \text{Prix d'achat unitaire})}{\text{Stock actuel} + \text{Quantité reçue}}$$

**Exemple concret :**
- Vous avez en stock 10 paires d'un mocassin achetées à `3 000 DZD`.
- Vous recevez un nouvel arrivage de 10 paires du même modèle achetées à `3 500 DZD`.
- Le nouveau PAMP calculé par le logiciel est de :
  $$\frac{(10 \times 3\,000) + (10 \times 3\,500)}{10 + 10} = \frac{30\,000 + 35\,000}{20} = 3\,250 \text{ DZD}$$

Chaque vente de ce mocassin déduira un coût de revient de `3 250 DZD`, garantissant un calcul d'une précision totale de votre marge brute réelle.

---

### F. Import intelligent de bons de commande (Excel & CSV multilingue)

ShoeDZ intègre un module d'importation intelligent pour convertir directement les listes d'achats transmises par vos fournisseurs sous forme de fichiers Excel (`.xlsx`, `.xls`) ou CSV :
1. Dans l'écran de création de commande ou depuis l'onglet Commandes d'un fournisseur, cliquez sur **Importer (Excel / CSV)**.
2. Déposez votre fichier : le moteur détecte automatiquement l'encodage (UTF-8, Windows Arabe CP1256, Français CP1252), le séparateur (`;`, `,`, tabulation) et la ligne des en-têtes.
3. **Reconnaissance des colonnes et pointures :**
   - **Dictionnaire trilingue :** Les en-têtes en Français (*Réf, Désignation, Pointure, Prix*), en Arabe (*المرجع، التعيين، المقاس، سعر الشراء*) et en Anglais sont automatiquement reconnus et mappés.
   - **Mode 1 pointure par ligne :** Chaque ligne correspond à une pointure et quantité unique.
   - **Mode Plage de pointures :** Détecte les plages (ex : `37-41`) et répartit automatiquement les paires selon la répartition configurée sur le produit ou par distribution équilibrée.
   - **Mode Grille matricielle :** Détecte les colonnes de pointures (`36` à `46`) et transpose le tableau en lignes d'articles par taille.
4. **Rapprochement catalogue et validation :**
   - Le tableau d'aperçu affiche le total des colis, paires et montants estimés, ainsi que l'état de rapprochement (produits existants, variantes à ajouter, nouveaux articles).
   - L'option de création automatique génère instantanément les fiches produits et déclinaisons en catalogue.
   - Vous pouvez cocher **Enregistrer comme modèle d'import** pour mémoriser le format de ce fournisseur et accélérer les réapprovisionnements futurs.

---

### G. Reconnaissance optique et scan de bons fournisseurs papier (Photos & Images) {#fournisseurs-scan-ocr}

Lorsque votre fournisseur vous remet un bon de livraison papier manuscrit, un ticket de caisse ou une facture imprimée, vous pouvez le numériser directement à l'aide de l'outil de scan hors-ligne :
1. Dans l'écran de création d'une commande ou depuis la fiche fournisseur, cliquez sur **Scanner photo / bon**.
2. Sélectionnez une photo ou un fichier image (`.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`) pris depuis votre smartphone ou un scanner de bureau.
3. **Traitement optique autonome (100% hors-ligne) :**
   - Le moteur de vision OpenCV redresse automatiquement l'angle d'inclinaison de l'image (jusqu'à $\pm 45^\circ$) et normalise l'éclairage pour éliminer les zones d'ombres.
   - Le réseau neuronal embarqué (RapidOCR) extrait le texte, les références, les pointures et les montants en moins d'une demi-seconde sans aucune connexion Internet.
   - **Détection spécialisée de la chaussure :** Le système reconnaît automatiquement les plages de pointures (ex : `37-41`, `40/45`), les notations de colisage (ex : `12c/20p` pour 12 cartons de 20 paires), ainsi que les numéros de téléphone algériens (`05`, `06`, `07`) pour identifier automatiquement le fournisseur.
4. **Interface de révision en écran partagé :**
   - Le volet de gauche présente l'image avec zoom interactif et surbrillance des zones détectées.
   - Le volet de droite propose un tableau dynamique éditable : vous pouvez corriger une valeur, supprimer des lignes parasites ou lier un article à une fiche catalogue existante.
5. Cliquez sur **Générer le bon de commande** pour enregistrer la commande brouillon avec les lignes pré-remplies.



