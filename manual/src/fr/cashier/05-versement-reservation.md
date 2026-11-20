## 5. Versements partiels et Réservations {#versement-reservation}

Un client qui ne peut pas payer tout de suite dispose de deux options à la caisse. Elles ne se combinent pas : une vente est soit un versement, soit une réservation.

| | **Versement** | **Mise de côté (Réservation)** |
|---|---|---|
| À quoi ça sert | Le client emporte sa paire et paie le reste plus tard | Le client laisse la paire au magasin et revient la chercher |
| Acompte minimum | **30 %** du total (réglable) | **20 %** du total (réglable) |
| Client | Obligatoire (réglable) | Client **ou** une note qui identifie la réservation |
| Stock | Sort du stock tout de suite | **Consigné** (bloqué) jusqu'au retrait |
| Statut dans l'historique | *En versement* | *Réservée (Mise de côté)* |
| Document remis | **Bon de versement** | **Bon de réservation** (n° `RES-…`) |

> [!NOTE]
> Les pourcentages et la durée par défaut se règlent dans **Paramètres → Politiques & Mode** (propriétaire). L'option *Mise de côté* n'apparaît à la caisse que si elle y est activée.

---

### A. Créer une réservation (mise de côté)

1. Ajoutez au panier la paire choisie (pointure et couleur).
2. Sélectionnez le **client** dans le panier. À défaut, renseignez une note qui permet de retrouver la réservation. Sans client ni note, la caisse refuse.
3. Ouvrez **Options de vente** (sous le panier) et activez **Mise de côté (Réservation)**. La ligne indique l'acompte minimum (ex : *20 % = 1 648 DZD*) et *Stock consigné*.
4. Choisissez la **Durée de réservation** : **3j**, **7j**, **14j** ou **30j** (7 jours par défaut).
5. Dans **Mode de règlement**, saisissez l'acompte remis par le client. Le champ est déjà rempli avec le minimum. Choisissez Espèces, TPE ou BaridiMob.
6. Vérifiez l'encart bleu : *Mise de côté (20 % min)*, *Solde au retrait* et *Expiration : J+14*.
7. Cliquez sur **Valider la réservation (… DZD)** (<kbd>F10</kbd>).

La caisse enregistre l'acompte, sort la paire du stock disponible et imprime le **Bon de réservation** avec la **date limite de retrait**, l'acompte versé et le **solde au retrait**. Remettez-le au client : il devra le présenter au retrait.

![Caisse avec une réservation en cours : option Mise de côté activée, durée de 14 jours, acompte de 3 000 DZD et bouton Valider la réservation.](../assets/fr/cashier-05-layaway.webp)

*Caisse avec une réservation en cours : option Mise de côté activée, durée de 14 jours, acompte de 3 000 DZD et bouton Valider la réservation.*

> [!NOTE]
> Le rachat de points de fidélité n'est pas possible sur une réservation. Les points sont attribués au retrait.

---

### B. Suivre les réservations

Ouvrez **Ventes → Historique** et réglez le filtre **Statut de la vente** sur *Réservée (Mise de côté)*. Chaque ligne affiche un badge **Consignée** et la date limite (*Jusqu'au …*). Passé ce délai, le badge devient rouge : **Expirée**.

> [!WARNING]
> Une réservation expirée **n'est pas annulée automatiquement** : la paire reste bloquée tant que vous ne la retirez pas ou ne l'annulez pas. Annulez-la pour remettre la paire en rayon.

---

### C. Retrait de la marchandise et règlement du solde

Quand le client revient :

1. Dans **Historique**, repérez la réservation (numéro `RES-…` ou nom du client).
2. Cliquez sur l'icône **Retirer les articles & solder la réservation**.
3. La fenêtre *Retirer la réservation* rappelle le total, l'acompte versé, le **solde restant à percevoir** et la liste des articles consignés.
4. Saisissez le **montant du règlement final** (au moins le solde) et le **mode de paiement**. Une note de remise est facultative.
5. Cliquez sur **Confirmer le retrait & Encaisser**.

Le ticket final s'imprime, la vente passe à *Terminée*, les points de fidélité sont attribués et vous remettez la boîte au client.

Si le client verse un acompte supplémentaire sans retirer la paire, utilisez l'icône **Ajouter un acompte intermédiaire** (+) sur la même ligne.

---

### D. Annuler une réservation

Si le client renonce ou ne revient pas avant la date limite :

1. Dans **Historique**, cliquez sur l'icône **Annuler la réservation & libérer le stock**.
2. Choisissez le sort de l'acompte :
   - **Rembourser l'acompte au client** : une sortie d'espèces *Remboursement Réservation* est inscrite dans la caisse ouverte.
   - **Conserver l'acompte (Abandon / Délai expiré)** : aucun remboursement, le magasin garde l'acompte à titre d'indemnité.
3. Indiquez si besoin le **motif d'annulation**.
4. Cliquez sur **Confirmer l'annulation & Libérer stock**.

La paire retourne immédiatement dans le stock en rayon. Un caissier doit saisir le **PIN Responsable** pour valider l'annulation, sauf s'il a l'autorisation de traiter les retours (voir le chapitre 9).

---

### E. Versement : la paire part tout de suite

1. Sélectionnez le client (si aucun n'est choisi, la caisse vous le demande), puis cliquez sur **Versement** (<kbd>Alt + V</kbd>).
2. Saisissez l'acompte (au moins 30 % du total, déjà proposé) et validez comme une vente normale. Un client bloqué pour le crédit est refusé.
3. Remettez la paire et le **Bon de versement** au client. La vente apparaît dans l'historique avec le statut *En versement* et dans le compteur **En versement**.

Pour encaisser un paiement suivant, ouvrez **Historique** et cliquez sur **Ajouter un paiement** (+) sur la ligne. Quand le total est atteint, la vente passe automatiquement à *Terminée*. Ces boutons sont visibles pour le **propriétaire et les responsables** : un caissier demande au responsable d'enregistrer le paiement.
