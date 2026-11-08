## 2. Gestion des utilisateurs, rôles et sécurité {#utilisateurs-roles}

La sécurité de votre point de vente repose sur une séparation claire des responsabilités entre le propriétaire, les gérants de boutique et les caissiers.

### A. Créer un nouvel utilisateur

1. Rendez-vous dans **Paramètres → Équipe & Utilisateurs**.
2. Cliquez sur le bouton **+ Nouvel utilisateur**.
3. Renseignez :
   - **Nom et prénom** du collaborateur.
   - **Numéro de téléphone mobile** (identifiant de connexion principal au format algérien `05`, `06` ou `07`).
   - **Rôle attribué** (Caissier, Gérant ou Propriétaire).
   - **Mot de passe initial** (que l'employé modifiera lors de sa première connexion).
4. Cliquez sur **Enregistrer**.

> 📷 **Capture d'écran :** *Formulaire de création d'un utilisateur avec sélection du rôle et des permissions.*

---

### B. Matrice des rôles et des autorisations

ShoeDZ applique une hiérarchie stricte des privilèges :

| Module / Action | Propriétaire (Owner) | Gérant (Manager) | Caissier (Cashier) |
| :--- | :---: | :---: | :---: |
| **Vente POS & Encaissement** | ✓ | ✓ | ✓ |
| **Ouvrir / Clôturer sa propre caisse** | ✓ | ✓ | ✓ |
| **Mouvements de caisse (<kbd>Alt + M</kbd>)** | ✓ | ✓ | ✓ (selon droit) |
| **Créer des clients & Versements** | ✓ | ✓ | ✓ |
| **Consulter le catalogue & stocks** | ✓ | ✓ | ✓ (lecture seule) |
| **Créer & modifier les articles/prix** | ✓ | ✓ | ✗ (bloqué) |
| **Commandes fournisseurs & Réception** | ✓ | ✓ | ✗ (bloqué) |
| **Sessions d'inventaire & Ajustements** | ✓ | ✓ | ✗ (bloqué) |
| **Facturation & Avoirs B2B** | ✓ | ✓ | ✗ (bloqué) |
| **Rapports financiers & Marge brute** | ✓ | ✓ | ✗ (bloqué) |
| **Sauvegardes locales & Pack diagnostic** | ✓ | ✓ (création/téléchargement) | ✗ (bloqué) |
| **Gestion des utilisateurs & Rôles** | ✓ | ✗ (bloqué) | ✗ (bloqué) |
| **Clôture annuelle & Journal d'audit** | ✓ | ✗ (bloqué) | ✗ (bloqué) |
| **Restauration & Sauvegarde externe chiffrée** | ✓ | ✗ (bloqué) | ✗ (bloqué) |

---

### C. Permissions spécifiques aux caissiers

Pour chaque compte caissier, le gérant ou propriétaire peut ajuster des restrictions fines :
- **Plafond de remise autorisée (`max_discount_pct`) :** Pourcentage maximal de remise que le caissier peut accorder sans autorisation (ex : 5% ou 10%).
- **Autorisation de retour (`can_process_returns`) :** Permet d'accepter un échange ou retour direct sans appel préalable du manager.
- **Modification de prix (`can_modify_price`) :** Autorise ou interdit de changer manuellement le prix d'une paire en caisse.
- **Annulation de vente (`can_cancel_sale`) :** Permet d'annuler un ticket avant impression.

Toute action tentée par le caissier au-delà de ses droits déclenche immédiatement la demande d'approbation par **PIN Responsable**.

---

### D. Le code PIN Responsable

Le PIN Responsable est un code confidentiel de **4 à 6 chiffres** attribué à chaque gérant et propriétaire.

1. **Configuration du PIN :**
   - Rendez-vous dans **Paramètres → Utilisateurs** et ouvrez la fiche du gérant ou propriétaire concerné.
   - Renseignez le champ **PIN Responsable (4 à 6 chiffres)** (évitez `0000` ou `1234`) puis cliquez sur **Enregistrer**.
2. **Utilisation :**
   - Lorsqu'un caissier sollicite une remise exceptionnelle ou un retour sans ticket, le responsable tape son PIN sur l'écran du caissier.
   - L'autorisation est instantanément validée et consignée dans le journal d'audit avec la date et le nom du responsable.

> [!WARNING]
> Pour prévenir les attaques par force brute, le système bloque la saisie du PIN pendant **15 minutes** après **5 tentatives consécutives erronées**.

