## 7. Facturation, bons de livraison et avoirs {#facturation}

Pour votre clientèle de revendeurs, d'entreprises ou d'administrations, ShoeDZ génère l'ensemble des pièces commerciales légales conformes au droit commercial algérien.

### A. Émettre une facture formelle de vente

1. Accédez au menu **Factures** (<kbd>F3</kbd>) puis cliquez sur **+ Nouvelle facture** (<kbd>Shift + F3</kbd>).
2. Sélectionnez le client destinataire (ses mentions NIF, RC et AI s'insèrent automatiquement).
3. Ajoutez les lignes de vente (modèles, pointures, quantités de paires ou cartons, prix unitaires HT).
4. Le système calcule automatiquement :
   - Le montant Total Hors Taxes (HT).
   - La TVA au taux légal en vigueur (19%).
   - Le droit de timbre fiscal (barème progressif légal de 1% à 2% pour les règlements en espèces dès 300 DZD).
   - Le montant Total Toutes Taxes Comprises (TTC) et le Net à Payer.
5. Cliquez sur **Confirmer la facture** :
   - Le compteur officiel (`FA-AAAA-#####`, ex : `FA-2026-00001`) attribue un numéro séquentiel inaltérable, déduit les quantités correspondantes du stock et inscrit le débit au grand livre client.
   - La facture peut être imprimée au format A4 avec vos coordonnées complètes ou exportée en PDF.

> 📷 **Capture d'écran :** *Éditeur de facture commerciale avec calcul automatique de la TVA et du timbre fiscal.*

---

### B. Bons de livraison (BL) et transformation en facture

1. Dans le menu **Bons de livraison** (<kbd>F6</kbd>), créez un BL (`BL-AAAA-#####`) pour accompagner l'expédition de cartons de chaussures vers un client ou une boutique partenaire.
2. Le bon de livraison est un document de transport qui **ne déduit pas** le stock par lui-même : la sortie de stock et l'écriture au compte client interviennent lors de la confirmation de la facture associée.
3. Dès que le client réceptionne et valide les colis :
   - Ouvrez le bon de livraison et cliquez sur **Convertir en facture**, puis confirmez la facture.

---

### C. Devis et factures proforma (Devis / Proforma)

Pour établir des propositions commerciales à vos clients grossistes avant commande ferme :
1. Accédez au menu **Devis & Proformas** puis cliquez sur **+ Nouveau Devis**.
2. Sélectionnez le client et renseignez la date d'émission ainsi que la date de validité (par défaut fixée à 15 jours).
3. Ajoutez les articles par pointures et cartons. Le système calcule les montants HT, la TVA et le Total TTC.
4. **Impact comptable et stock :** Le devis est une proposition purement commerciale. Il **n'engendre aucune sortie de stock** et **n'inscrit aucune créance** au compte du client.
5. Vous pouvez imprimer le devis au format A4 (`PF-AAAA-#####`) ou le partager instantanément par **WhatsApp**.
6. Dès accord du client :
   - Cliquez sur **Convertir en facture** pour générer automatiquement un brouillon de facture reprenant l'intégralité des lignes, prix et remises.
   - Ou cliquez sur **Convertir en bon de livraison** pour éditer le bon de livraison correspondant.
7. Les devis non validés dont la date de validité est échue sont automatiquement marqués comme expirés par la maintenance quotidienne du logiciel.

---

### D. Factures d'avoir (Credit Notes)

En cas d'accord sur une remise commerciale rétroactive ou de régularisation d'une facture émise :
1. Allez dans **Facturation → Avoirs**.
2. Cliquez sur **Créer un avoir**, puis sélectionnez la facture de vente d'origine et saisissez le montant HT et la TVA de l'avoir.
3. Validez l'avoir :
   - Un numéro officiel d'avoir (`AV-<Facture>-<id>`) est généré.
   - Le compte du client est automatiquement crédité du montant TTC correspondant pour diminuer sa dette.
   - Si des marchandises physiques sont reprises en stock, enregistrez l'ajustement ou le retour de stock séparément dans le module **Inventaire**.

---

### E. Prérequis de licence (Formules Pro / Entreprise)

> [!NOTE]
> L'émission de factures formelles A4, de bons de livraison groupés et de factures d'avoir B2B est soumise aux fonctionnalités activées par votre clé de licence ShoeDZ (formule Pro ou Entreprise). Contactez votre administrateur si un cadenas s'affiche sur ce module.

