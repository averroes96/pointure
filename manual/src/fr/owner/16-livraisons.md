## 16. Livraisons : transporteurs et suivi des expéditions {#livraisons}

ShoeDZ lit vos colis directement chez votre transporteur (aujourd'hui : **Maystro**) : où se trouve chaque colis, lesquels sont livrés ou retournés, et **où est l'argent**. Ces informations sont en lecture seule : elles ne modifient ni vos ventes, ni votre stock, ni votre caisse, et n'apparaissent pas dans les sessions de caisse ni dans les rapports Z.

> Réservé au propriétaire et aux managers, avec la formule Pro.

### A. Activer les livraisons

1. Ouvrez **Paramètres → Politiques & Mode** (propriétaire).
2. Cochez **Activer les intégrations de livraison**.
3. L'onglet **Paramètres de Livraison** apparaît dans les Paramètres, et le menu **Expéditions** apparaît dans la barre latérale, sous **Ventes**.

### B. Ajouter un compte transporteur

1. Ouvrez **Paramètres → Paramètres de Livraison**.
2. Choisissez votre transporteur dans la liste (vous pouvez le rechercher). La liste est téléchargée depuis Internet puis gardée sur le poste : il faut être connecté la première fois.
3. Saisissez les identifiants demandés par ce transporteur. Ils restent sur ce poste et ne sont **jamais réaffichés** : un identifiant enregistré apparaît comme **Enregistré**, avec un bouton **Remplacer**.
4. Cliquez sur **Tester la connexion** pour vérifier les identifiants.

**Maystro :** utilisez le **jeton boutique** (40 caractères) fourni par Maystro. Une clé d'intégration qui commence par `ak_` est acceptée, mais Maystro ne lui permet pas de lire les commandes ni les versements : le test l'indique.

Un transporteur qui a déjà des expéditions ne peut pas être supprimé : désactivez-le à la place.

### C. La page Expéditions

Ouvrez **Ventes → Expéditions**.

- **En haut :** chaque transporteur, avec l'heure de la dernière mise à jour et, s'il y en a un, le problème rencontré. Le bouton **Actualiser** relance une mise à jour.
- **Mise à jour automatique :** à l'ouverture de la page, si la dernière mise à jour date de plus de 10 minutes. La page se met à jour toute seule pendant ce temps. Rien n'est lu chez le transporteur quand la page est fermée.
- **Première mise à jour :** les colis des 90 derniers jours.
- **Cartes :** En cours, À relancer, Chez le transporteur, Prêt à être versé, Versé, Retournés. Un clic sur une carte filtre le tableau ; un second clic retire le filtre.
- **Filtres :** recherche (numéro de suivi, nom ou téléphone du client), statut, argent, transporteur, et dates du dernier changement.
- **Détail :** cliquez sur une ligne pour voir le colis, ses montants et son historique de suivi. L'historique se charge à la première ouverture.

### D. Statuts des colis

| Statut | Signification |
|---|---|
| Enregistré | Le colis est créé chez le transporteur. |
| En attente de ramassage | Le transporteur doit venir le chercher. |
| Ramassé, En transit, Au centre de tri | Le colis est en route. |
| En cours de livraison | Le livreur l'a avec lui, ou il attend au point relais. |
| **Tentative de livraison** | Le client n'a pas été joint ou n'a pas pris le colis. |
| **En attente** | Livraison reportée ou bloquée (client injoignable, report demandé…). |
| Livré | Remis au client. |
| Retour en cours, Retourné | Le colis revient à la boutique. |
| Annulé, Perdu | Le colis ne sera pas livré. |

Les colis **Tentative de livraison** et **En attente** sont regroupés dans la carte **À relancer** : appelez le client rapidement, c'est souvent ce qui évite un retour. Passez la souris sur un statut pour voir le libellé exact du transporteur.

### E. Où est l'argent ?

| Argent | Signification |
|---|---|
| En attente de livraison | Le colis n'est pas encore livré. |
| Chez le transporteur | Livré : le transporteur a encaissé, mais ne vous a pas encore versé l'argent. |
| Prêt à être versé | Le transporteur prépare le versement qui contient ce colis. |
| Versé | Le colis figure dans un versement du transporteur (la date est dans le détail). |
| Sans objet | Retourné, annulé, ou colis sans montant (par exemple un échange). |

Dans le détail d'un colis :

- **Payé par le client :** le montant encaissé à la porte.
- **Frais de livraison :** ce que garde le transporteur.
- **Dû à la boutique :** ce que le transporteur vous reverse. Les cartes d'argent affichent ce montant.

### F. Messages de mise à jour

| Message | Que faire |
|---|---|
| identifiants refusés | Remplacez les identifiants dans **Paramètres de Livraison**, puis testez la connexion. |
| ces identifiants ne permettent pas de lire les commandes | Utilisez le jeton boutique Maystro au lieu d'une clé `ak_`. |
| transporteur injoignable | Vérifiez la connexion Internet, puis cliquez sur **Actualiser**. |
| trop de demandes, réessai plus tard | Attendez quelques minutes : la mise à jour reprendra. |
| suivi pas encore disponible pour ce transporteur | Le suivi existe aujourd'hui pour Maystro ; d'autres transporteurs suivront. |
| mise à jour partielle | Beaucoup de changements d'un coup : cliquez de nouveau sur **Actualiser**. |
