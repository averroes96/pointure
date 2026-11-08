## 9. Autorisations et PIN Responsable {#autorisation-pin}

Pour protéger le commerce et éviter les erreurs involontaires, certaines opérations sensibles sur la caisse sont soumises à l'approbation d'un gérant ou propriétaire via un **code PIN à 4 chiffres**.

### Quand le PIN Responsable est-il demandé ?

Une boîte de dialogue d'autorisation s'affiche automatiquement dans les situations suivantes :

| Opération sensible | Raison de la restriction |
| :--- | :--- |
| **Remise supérieure au plafond autorisé** | Votre compte caissier est limité à un pourcentage maximal (ex : 10%). Toute remise supérieure nécessite l'accord du responsable. |
| **Modification manuelle d'un prix de vente** | Empêche la vente d'une chaussure à un prix non conforme à la politique tarifaire du magasin. |
| **Annulation d'une vente validée** | Toute annulation de ticket émis annule les mouvements de stock et écrit une trace dans le journal d'audit. |
| **Retour d'article sans ticket de caisse** | Permet de s'assurer de la provenance réelle de l'article avant de décaisser des espèces ou d'émettre un avoir. |
| **Accès aux clôtures fiscales verrouillées** | Empêche la modification accidentelle de données comptables déjà arrêtées. |

---

### Comment procéder lors d'une demande de PIN ?

1. Lorsque l'écran affiche la boîte modale **Autorisation Responsable** :
   - Ne demandez jamais au responsable de vous dicter son code à haute voix devant les clients.
2. Invitez votre gérant ou manager à taper directement son **code PIN personnel à 4 chiffres** sur le pavé numérique.
3. Si le code est correct, la boîte se referme avec un message vert de validation et l'action demandée est immédiatement appliquée.
4. L'identité du responsable ayant accordé l'autorisation est automatiquement consignée dans le journal d'audit interne pour la traçabilité.

> 📷 **Capture d'écran :** *Boîte de dialogue de saisie du PIN Responsable à 4 chiffres.*

> [!WARNING]
> Après **5 tentatives consécutives erronées**, la saisie du PIN est temporairement bloquée pendant 15 minutes pour prévenir les tentatives de devinette.

