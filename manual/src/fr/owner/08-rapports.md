## 8. Rapports de vente, rentabilité et valorisation {#rapports}

Les tableaux de bord et rapports d'activité fournissent aux décideurs une visibilité immédiate sur les performances financières de chaque boutique.

### A. Rapport journalier consolidé (Synthèse des caisses)

Dans **Rapports → Journalier** :
1. Visualisez la synthèse de toutes les sessions de caisse ouvertes et fermées sur la journée.
2. Pour chaque caissier, consultez :
   - Le chiffre d'affaires brut et net encaissé.
   - La ventilation exacte par moyen de paiement : **Espèces**, **TPE (CIB/Edahabia)**, **BaridiMob**, **Chèques**, et **Ventes à crédit**.
   - Le cumul des entrées et sorties de caisse diverses.
   - Les éventuels écarts de caisse constatés lors du Rapport Z.
3. Imprimez la synthèse journalière récapitulative pour votre classeur comptable.

> 📷 **Capture d'écran :** *Tableau de bord du rapport journalier consolidé avec répartition par mode de paiement.*

---

### B. Analyse du chiffre d'affaires et de la marge brute réelle

Le menu **Rapports → Ventes & Rentabilité** vous permet de mesurer avec précision vos gains réels :
- **Chiffre d'affaires TTC et HT :** Filtrable par jour, semaine, mois ou période personnalisée.
- **Marge brute réelle :** Calculée sur la base du coût d'achat unitaire réel (`unit_cost` / PAMP) enregistré à la ligne pour chaque vente effectuée :
  $$\text{Marge brute} = \text{Prix de vente HT} - \text{Coût d'achat (PAMP)}$$
  $$\text{Taux de marge (\%)} = \frac{\text{Marge brute}}{\text{Prix de vente HT}} \times 100$$
- **Performances par marque et catégorie :** Identifiez en un clin d'œil les marques les plus profitables et les catégories motrices de votre point de vente (ex : Baskets Homme vs Escarpins Femme).
- **Palmarès des ventes (Top / Flop) :** Classement des modèles les plus vendus (bestsellers) et détection précoce des articles à faible rotation (stocks dormants) pour préparer d'éventuelles promotions.

---

### C. État de stock valorisé (Inventaire financier)

Le rapport **État du stock** certifie la valeur marchande globale des marchandises présentes dans vos locaux :
- **Nombre total de paires :** Décomposé par pointure et par modèle.
- **Valeur d'achat globale (au PAMP) :** Capital financier actuellement immobilisé dans vos rayons et réserves. Ce chiffre est indispensable pour votre bilan comptable de fin d'année.
- **Valeur marchande potentielle (au prix de vente détail) :** Chiffre d'affaires potentiel attendu en cas d'écoulement complet du stock.
- **Marge potentielle en stock :** Différence entre la valeur de vente et la valeur d'achat du stock existant.

### D. Courbe des pointures et tailles cassées

Dans **Rapports → Courbe des pointures** :
1. Choisissez la période (8 semaines par défaut), une marque, une catégorie ou un genre.
2. Le graphique et le tableau montrent, pour chaque pointure : paires vendues nettes des retours, part des ventes, stock, quantités encore en commande, semaines de couverture et taux d'écoulement.
3. La liste **Tailles cassées** signale un modèle qui a encore du stock, mais dont une pointure centrale est à zéro. Les pointures centrales sont celles qui font au moins 70 % des ventes du modèle sur 52 semaines. Sans historique, le calcul utilise la catégorie, puis le genre, puis des pointures habituelles. Le montant immobilisé est valorisé au PAMP.

### E. Suggestions de réassort

Dans **Rapports → Réassort**, ou depuis **Stock bas** et **Courbe des pointures** :
1. Chaque pointure propose une quantité : ventes des 8 dernières semaines, ramenées à une semaine, multipliées par les semaines de couverture (6 par défaut, réglage du propriétaire), moins le stock, moins les quantités déjà commandées.
2. Si le modèle a un découpage par carton, la quantité est arrondie au carton entier pour cette couleur.
3. Le fournisseur proposé est celui du dernier bon de commande du modèle. Corrigez les quantités, puis créez un **brouillon** de bon de commande par fournisseur.

