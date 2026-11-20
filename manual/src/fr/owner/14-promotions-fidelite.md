## 14. Promotions et programme de fidélité {#promotions-fidelite}

Pour stimuler la fréquentation de votre boutique et fidéliser votre clientèle, ShoeDZ propose deux outils : des **promotions** (remises automatiques en caisse) et un **programme de points de fidélité**.

### A. Créer une promotion (soldes, remise par quantité…)

Une promotion est une **règle de remise automatique** : à la caisse, dès qu'un article répond aux conditions, la remise s'applique toute seule sur sa ligne. La page est réservée au **propriétaire** et aux **responsables**.

1. Ouvrez le menu **Ventes → Promotions**.
2. Cliquez sur **Nouvelle promotion**.
3. Renseignez la fenêtre :
   - **Nom** (obligatoire) : par exemple *Soldes d'été 2026*, *Offre Rentrée*, *Promo Aïd*.
   - **Début** (obligatoire) et **Fin (optionnel)** : des **dates** (sans heure). La promotion s'applique du jour de début au jour de fin inclus. Sans date de fin, elle reste en vigueur jusqu'à sa désactivation.
   - **Conditions** : toutes celles que vous remplissez doivent être réunies ; une condition vide ne limite rien.
     - **Catégorie** : *Sneakers*, *Boots*, *Sandales*, *Chaussures formelles*, *Sport*, *Enfants*, *Chaussons* ou *Autre*. **Toutes catégories** applique la promotion à tout le magasin.
     - **Qté minimum** : nombre de paires sur la même ligne du panier (par exemple `3` pour « dès 3 paires »).
     - **Montant min (DZD)** : montant de la ligne (prix × quantité).
   - **Remise** : renseignez **soit** **% Remise** (ex : `20`), **soit** **Montant fixe / unité (DZD)** (ex : `500` DZD par paire), jamais les deux.
   - **Priorité** : si plusieurs promotions correspondent à la même ligne, **une seule** s'applique, celle qui a la priorité la plus haute. Les remises ne s'additionnent pas.
   - **Utilisations** : laissez **Illimité**. (La limite d'utilisations n'est pas encore appliquée par la caisse.)
   - **Active** : cochée, la promotion est en vigueur dès sa date de début.
4. Cliquez sur **Créer**.

![Fenêtre « Nouvelle promotion » : nom, dates de début et de fin, condition de catégorie et remise en pourcentage.](../assets/fr/owner-14-promotions.webp)

*Fenêtre « Nouvelle promotion » : nom, dates de début et de fin, condition de catégorie et remise en pourcentage.*

> [!NOTE]
> Une promotion cible une **catégorie** (ou tout le magasin) : il n'y a pas de sélection modèle par modèle.

**Ce que voit le caissier**

- Dès qu'il ajoute un article (ou change sa quantité), la caisse cherche une promotion applicable. Si elle en trouve une, un **badge vert avec le nom de la promotion** s'affiche sous l'article et la remise est déduite du prix de la ligne.
- La remise est calculée sur le **tarif en cours** (Détail, Demi-gros ou Gros).

**Gérer vos promotions**

La liste affiche pour chaque promotion ses conditions, sa remise, sa période et son statut.
- Cliquez sur le **statut** (*Active* / *Inactive*) pour activer ou désactiver une promotion sans la supprimer.
- Cliquez sur le crayon pour la modifier, sur la corbeille pour la supprimer (une confirmation est demandée).

---

### B. Le programme de fidélité client

Le programme fonctionne par points : le client en gagne à chaque achat et les échange contre une remise.

**Configurer le programme** (menu **Clients → Fidélité**, réservé au propriétaire et aux responsables ; cette page n'apparaît que si votre formule l'inclut) :

1. Dans **Configuration des règles**, réglez :
   - **Statut du programme** : *Actif* ou *Inactif* ;
   - **Points gagnés par tranche de 100 DZD dépensés** (par défaut `1`) ;
   - **Points requis pour 100 DZD de remise** (par défaut `100`, soit 1 point = 1 DZD) ;
   - **Seuil minimum de rachat (en points)** (par défaut `500`) ;
   - **Expiration des points (en mois, vide = illimité)** ;
   - les **niveaux** : *Bronze* (dès l'inscription), *Argent* et *Or*, avec leur **seuil en points cumulés** et leur **multiplicateur** de gain (par défaut Argent à 5 000 points, ×1,20 ; Or à 15 000 points, ×1,50) ;
   - le **bonus de bienvenue** (points offerts à l'ouverture du compte).
2. Le **Simulateur de conversion** montre ce que rapporte un montant d'achat donné.
3. Dans **Membres du programme**, vous pouvez **Inscrire un client** ou **Inscrire tous les clients actifs** (crée un compte Bronze en un clic). Un nouveau client est inscrit automatiquement. Pour chaque membre : **Imprimer Carte de Fidélité**, **Ajuster les points** (ajout ou retrait avec un motif) et consulter l'**Historique des points**.

**Au comptoir**

1. Sélectionnez le client dans le panier. Sa ligne fidélité affiche son solde (*pts fidélité*) et sa valeur en dinars (≈ … DZD).
2. À chaque vente encaissée, le client **gagne des points** selon le barème et son niveau. L'écran de confirmation indique *+N points de fidélité gagnés*.
3. **Utiliser les points** : quand le solde atteint le seuil minimum de rachat et que le programme est actif, le bouton **Utiliser Max** apparaît, avec un champ *Pts* pour saisir un nombre précis. La ligne **Remise fidélité appliquée : −… DZD** indique la remise ; elle se déduit du total et les points sont débités. **Annuler** retire la remise.
4. Le ticket imprime un bloc **FIDÉLITÉ** avec le statut du client, les points gagnés, les points rachetés et le solde de points.

> [!NOTE]
> Le rachat de points n'est pas possible sur une **réservation** (voir le guide du caissier, chapitre 5) ; les points sont attribués au retrait.
