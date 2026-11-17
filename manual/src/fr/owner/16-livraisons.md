## 16. Livraisons : transporteurs et suivi des expéditions {#livraisons}

ShoeDZ lit vos colis directement chez votre transporteur (aujourd'hui : **Maystro**, et la famille **Yalidine** : Yalidine, Yalitec, Guepex, Easy & Speed, Economiqua, We Can Services) : où se trouve chaque colis, lesquels sont livrés ou retournés, et **où est l'argent**. Les colis créés dans l'application du transporteur ou dans DZBuild sont en lecture seule : ils ne modifient ni vos ventes, ni votre stock, ni votre caisse. Les colis **envoyés depuis ShoeDZ** (section H) font sortir le stock à l'envoi et deviennent une vente à la livraison. Rien de tout cela n'apparaît dans les sessions de caisse ni dans les rapports Z.

> Réservé au propriétaire et aux managers, avec la formule Pro.

### A. Activer les livraisons

1. Ouvrez **Paramètres → Politiques & Mode** (propriétaire).
2. Cochez **Activer les intégrations de livraison**.
3. L'onglet **Paramètres de Livraison** apparaît dans les Paramètres, et les menus **Commandes à livrer** et **Expéditions** apparaissent dans la barre latérale, sous **Ventes**.

### B. Ajouter un compte transporteur

1. Ouvrez **Paramètres → Paramètres de Livraison**.
2. Choisissez votre transporteur dans la liste (vous pouvez le rechercher). La liste est téléchargée depuis Internet puis gardée sur le poste : il faut être connecté la première fois.
3. Saisissez les identifiants demandés par ce transporteur. Ils restent sur ce poste et ne sont **jamais réaffichés** : un identifiant enregistré apparaît comme **Enregistré**, avec un bouton **Remplacer**.
4. Cliquez sur **Tester la connexion** pour vérifier les identifiants.

**Maystro :** utilisez le **jeton boutique** (40 caractères) fourni par Maystro. Une clé d'intégration qui commence par `ak_` est acceptée, mais Maystro ne lui permet pas de lire les commandes ni les versements : le test l'indique.

**Famille Yalidine** (Yalidine, Yalitec, Guepex, Easy & Speed, Economiqua, We Can Services) : saisissez l'**API ID** et le **jeton API (token)** de l'espace développeur de votre transporteur. Le suivi de ces transporteurs a été construit d'après leur documentation et **n'est pas encore vérifié sur un vrai compte** : le test de connexion l'indique. Signalez tout statut ou montant qui vous paraît faux. Ces transporteurs limitent le nombre de demandes : quand la limite approche, ShoeDZ s'arrête et reprend plus tard (message « trop de demandes, réessai plus tard »).

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
| trop de demandes, réessai plus tard | Attendez : la mise à jour reprendra d'elle-même (quelques minutes ; jusqu'à quelques heures pour la famille Yalidine si son quota du jour est presque épuisé). |
| suivi pas encore disponible pour ce transporteur | Le suivi existe aujourd'hui pour Maystro et la famille Yalidine ; d'autres transporteurs suivront. |
| mise à jour partielle | Beaucoup de changements d'un coup : cliquez de nouveau sur **Actualiser**. |

### G. Versements récupérés à l'agence

L'argent récupéré à l'agence du transporteur s'enregistre dans l'onglet **Versements** de la page **Expéditions**. Cet argent **n'entre pas dans la caisse** : il n'apparaît ni dans les sessions de caisse ni dans les rapports Z. Le chiffre à côté de l'onglet indique combien de versements attendent votre confirmation.

**Confirmer un versement annoncé par le transporteur (Maystro, famille Yalidine)**

ShoeDZ connaît les versements que le transporteur a déjà faits. Ils apparaissent dans **Versements Maystro à confirmer** (ou le nom de votre transporteur), avec la date, le nombre de colis et le montant attendu (ce que le transporteur doit à la boutique).

1. Cliquez sur **Confirmer** sur la ligne du versement récupéré.
2. Dans **Montant compté**, saisissez ce que vous avez réellement reçu (le montant attendu est proposé). L'**écart** s'affiche : vert s'il est nul, rouge s'il manque de l'argent, orange s'il y en a trop.
3. Ajoutez si besoin la **date**, la **référence du transporteur** et une **remarque**, puis cliquez sur **Enregistrer le versement**.

**Anciens versements déjà reçus :** cochez-les (ou cochez la case de l'en-tête pour tout sélectionner), puis cliquez sur **Confirmer la sélection**. Chaque versement est enregistré pour son montant attendu, à sa date de paiement.

**Famille Yalidine :** le transporteur indique quels colis sont payés et dans quel versement, mais **pas la date du versement**. La ligne affiche « Date non fournie » avec le numéro du versement ; la date enregistrée est celle que vous saisissez (aujourd'hui pour une confirmation groupée). Le montant attendu est, pour l'instant, le montant encaissé moins les frais de livraison : comparez-le au bordereau du transporteur.

**Saisie manuelle (bordereau)**

Pour un transporteur sans versements en ligne, ou un retrait partiel : cliquez sur **Saisie manuelle (bordereau)**, collez ou scannez les numéros de suivi du bordereau (un par ligne), cliquez sur **Vérifier les colis**, puis saisissez le montant compté et enregistrez. Les numéros inconnus, les colis non livrés ou déjà enregistrés sont listés pour être corrigés.

**Versements enregistrés**

Les colis d'un versement passent à **Versé**. La liste **Versements enregistrés** montre la date, le transporteur, le nombre de colis, l'attendu, le reçu et l'écart ; la flèche d'une ligne affiche ses colis. La mention « non confirmés par le transporteur » signale des colis que le transporteur n'a pas encore déclarés payés : vérifiez-les avec lui.

**Erreur de saisie ?** Cliquez sur **Annuler** sur la ligne du versement : chaque colis retrouve l'état qu'il avait avant, et vous pouvez l'enregistrer de nouveau. Un versement ne se modifie pas et ne se supprime pas.

### H. Envoyer un colis depuis ShoeDZ

Ouvrez **Ventes → Commandes à livrer**, puis cliquez sur **Nouvelle commande** (ou sur **Ouvrir** pour un brouillon).

1. **Client :** nom complet, téléphone, et un second téléphone si besoin.
2. **Livraison :** la wilaya, puis la commune **telle que le transporteur l'écrit** (la liste vient du transporteur). Choisissez **À domicile** ou **Point relais (bureau)** ; pour un bureau, choisissez-le dans la liste du transporteur.
3. **Articles :** recherchez-les dans le stock (nom, référence ou code-barres). Ajouter deux fois le même article augmente sa quantité. Le prix et la remise de chaque ligne sont modifiables.
4. **Montants :**
   - **Frais de livraison payés par le client :** le tarif du transporteur s'affiche. S'il est différent de vos frais, cliquez sur **Utiliser ce tarif** pour le reprendre.
   - **Livraison gratuite**, **Le client peut ouvrir le colis** et **Note pour le livreur** sont transmis au transporteur.
   - **Montant à encaisser :** par défaut, les articles plus la livraison (sauf livraison gratuite). Saisissez un montant plus petit si le client a déjà payé un acompte. Il doit être en dinars entiers et ne peut pas dépasser les articles plus la livraison.
5. Cliquez sur **Enregistrer le brouillon** pour finir plus tard, ou choisissez le **Transporteur** puis cliquez sur **Envoyer au transporteur**.

**Après l'envoi :**

- Le **stock sort** aussitôt (mouvement « Envoi livraison »). Aucune vente n'est encore créée, et rien n'entre dans la caisse.
- Le colis apparaît dans **Expéditions** à la mise à jour suivante.
- **Livré :** ShoeDZ crée la vente, datée du jour de la livraison, payée « Encaissé par le livreur ». Elle compte dans le chiffre d'affaires du jour mais pas dans la caisse ni dans les rapports Z. L'argent se suit ensuite dans **Versements** (section G).
- **Retourné**, ou **annulé avant ramassage :** le stock revient tout seul (mouvement « Retour livraison »).

**Si le transporteur refuse**, la commande reste un brouillon et sa réponse s'affiche (par exemple : même client et même téléphone en moins de 24 h chez Maystro). Corrigez puis renvoyez. **S'il ne répond pas**, vérifiez dans son application si le colis a été créé avant de renvoyer la commande.

**Onglet « À vérifier » :** ShoeDZ n'agit pas seul dans ces cas.

| Message | Que faire |
|---|---|
| Retournée après livraison | La vente existe : faites un retour en caisse quand le colis revient. |
| Annulée après ramassage | Le colis est peut-être en route vers la boutique : le stock reviendra quand il sera marqué retourné. |
| Colis perdu | Voyez avec le transporteur. Le stock ne revient pas. |
| Colis créé chez le transporteur, envoi non enregistré | Souvent après un envoi resté sans réponse : vérifiez le colis dans l'application du transporteur. |
| Période clôturée | La date tombe dans un exercice clôturé : rien n'a été enregistré. |
| La vente n'a pas pu être créée | ShoeDZ réessaie à la prochaine mise à jour ; si le message reste, contactez le support. |
