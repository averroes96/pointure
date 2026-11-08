## 5. Gestion des stocks, inventaires et transferts {#inventaire}

Le suivi scrupuleux des paires en rayon et en réserve est le cœur de métier de la vente de chaussures.

### A. Réaliser une session d'inventaire physique

Pour vérifier l'exactitude de votre stock et identifier d'éventuelles disparitions ou erreurs de pointure :
1. Rendez-vous dans **Inventaire → Sessions d'inventaire**.
2. Cliquez sur **+ Nouvelle session d'inventaire**.
3. Choisissez le périmètre :
   - **Inventaire général :** Tous les articles du magasin.
   - **Inventaire partiel / ciblé :** Uniquement une marque, une catégorie (ex : Rayon Femme), ou un fournisseur précis.
4. Lancez le comptage :
   - À l'aide d'une douchette sans fil ou en saisie manuelle, scannez chaque boîte présente physiquement sur les étagères.
   - La grille affiche en temps réel : **Stock théorique en base**, **Quantité comptée**, et **Écart constaté** (en vert si exact, en orange si excédent, en rouge si manquant).
5. Vous pouvez suspendre la session et la reprendre à tout moment sans perturber l'activité.

> 📷 **Capture d'écran :** *Tableau de saisie de l'inventaire avec comparaison théorique vs compté.*

---

### B. Validation et ajustement automatique du stock

Une fois le comptage terminé et les écarts vérifiés :
1. Cliquez sur **Valider l'inventaire**.
2. Une synthèse des écarts financiers vous présente :
   - La valeur d'achat des manquants (pertes constatées).
   - La valeur des excédents (articles retrouvés ou non comptabilisés).
3. Cliquez sur **Approuver la régularisation** :
   - Le système génère automatiquement les mouvements d'ajustement (`StockMovement`) nécessaires.
   - Le stock du magasin est instantanément recalé sur les quantités réelles comptées.

---

### C. Gestion des articles défectueux et avaries

Lorsqu'une chaussure présente un défaut d'usine (semelle décollée, couture rompue, fermeture éclair cassée) ou a été abîmée lors des essayages en boutique :
1. Allez dans **Inventaire → Défectueux & Pertes**.
2. Cliquez sur **Déclarer un article défectueux**.
3. Scannez la paire ou sélectionnez la pointure et la couleur concernées.
4. Précisez le motif : *Défaut de fabrication*, *Abîmé lors d'un essayage*, *Paire dépareillée (chaussure droite ou gauche manquante)*.
5. Choisissez l'action à entreprendre :
   - **Retour au fabricant :** La paire est isolée en attente de retour et de remboursement par le fournisseur.
   - **Mise au rebut (Perte sèche) :** La paire est définitivement retirée du stock vendable et imputée aux pertes.

---

### D. Transferts entre boutiques et dépôts

Si votre entreprise possède plusieurs points de vente ou un entrepôt central de stockage :
1. Accédez à **Inventaire → Transferts de stock**.
2. Créez un **Bon de transfert** en sélectionnant le dépôt source et le magasin destinataire.
3. Ajoutez les paires de chaussures et quantités à transférer.
4. Cliquez sur **Expédier** : les articles quittent le stock de la source et passent en statut *En transit*.
5. Dès réception physique dans le magasin de destination, le responsable clique sur **Confirmer la réception** pour intégrer les paires dans son stock vendable.

