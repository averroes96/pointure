## 6. Portefeuille clients, crédit et suivi des créances {#clients-credit}

La maîtrise du crédit accordé aux clients est cruciale pour préserver la trésorerie de votre commerce.

### A. Fiche client et profil commercial

Dans le menu **Clients** (<kbd>F4</kbd>), chaque fiche client centralise :
- Coordonnées : Nom complet, numéro de téléphone mobile (`05/06/07`), et wilaya de résidence.
- Pour les clients professionnels (boutiques revendeuses, entreprises) : Raison sociale, NIF, RC et adresse de facturation.
- Historique d'achats : Liste chronologique de tous les tickets de caisse, factures et versements d'acomptes émis pour ce client.

---

### B. Plafond de crédit et contrôle automatique

Pour limiter les risques d'impayés, ShoeDZ intègre un contrôle strict du crédit :
1. Sur la fiche du client, renseignez le champ **Plafond de crédit autorisé** (`credit_limit`, ex : `50 000 DZD`).
2. Lors d'un passage en caisse ou de l'émission d'une facture, si une vente à crédit amène le solde débiteur au-delà de ce plafond, le système bloque la validation à crédit (sauf autorisation expresse d'un gérant ou propriétaire).
3. **Désactivation / Archivage d'un compte client :**
   - Si vous ne souhaitez plus accorder de crédit à un client défaillant, abaissez son **Plafond de crédit** à `0 DZD` ou désactivez sa fiche (`is_active`).

> 📷 **Capture d'écran :** *Fiche client avec solde débiteur et plafond de crédit autorisé.*

---

### C. L'extrait de compte client (Grand livre client)

ShoeDZ tient automatiquement à jour le grand livre de chaque client :
- **Débit :** Chaque vente à crédit ou facture émise augmente la dette du client.
- **Crédit :** Chaque versement d'acompte, règlement en espèces ou chèque encaissé diminue la dette.
- **Solde net :** Le montant restant dû en temps réel.
- En cliquant sur **PDF** ou **Excel**, vous pouvez exporter un relevé de compte officiel sur la période choisie (avec solde initial, détail des mouvements et factures non soldées). Le bouton **WhatsApp** permet de partager instantanément le montant du solde restant dû.

---

### D. Suivi et encaissement des chèques bancaires

Dans l'onglet **Gestion des chèques** :
1. Consultez la liste de tous les chèques reçus au magasin.
2. Pour chaque chèque, visualisez le numéro, la banque émettrice, le nom de l'émetteur et la **Date d'échéance**.
3. Lorsque la date d'échéance arrive et que vous déposez le chèque en banque :
   - Cliquez sur **Marquer comme déposé / Encaissé**.
4. Si un chèque revient impayé :
   - Cliquez sur **Déclarer chèque impayé (Rejet)**.
   - La créance est automatiquement réactivée sur le compte du client pour recouvrement.

---

### E. Balance âgée des créances (Debt Ageing)

L'état de la **Balance âgée** vous permet d'analyser la santé de votre carnet de créances en classant les dettes clients par tranche d'ancienneté :
- **Moins de 30 jours :** Créances normales d'exploitation en cours.
- **De 30 à 60 jours :** Retards modérés nécessitant une première relance téléphonique.
- **De 60 à 90 jours :** Créances préoccupantes exigeant une mise en demeure.
- **Plus de 90 jours :** Créances douteuses ou contentieuses justifiant le blocage immédiat du compte client.

Le bouton **Télécharger tous les relevés (ZIP)** permet d'exporter en un clic l'ensemble des relevés de compte individuels en PDF pour tous les clients ayant un solde débiteur.

---

### F. Score de solvabilité (Grade de risque) et blocage client

ShoeDZ calcule automatiquement un grade de solvabilité pour chaque client afin de sécuriser vos créances :
- **Grade A (Risque faible) :** Règlements rapides (délai moyen inférieur à 30 jours), aucune dette en retard et aucun chèque rejeté.
- **Grade B (Risque modéré) :** Délai moyen de règlement entre 31 et 60 jours ou créances en retard de 31 à 60 jours.
- **Grade C (Risque élevé) :** Délai moyen supérieur à 60 jours ou créances en retard de 61 à 90 jours.
- **Grade D (Risque très élevé) :** Créances en souffrance de plus de 90 jours ou au moins un chèque rejeté au cours des 12 derniers mois.

Le badge de risque apparaît en temps réel sur la liste des clients, la fiche client, le sélecteur client en caisse (POS) et le module de facturation.

**Blocage d'un client défaillant :**
- Les gérants et propriétaires peuvent bloquer un client à tout moment depuis sa fiche via le bouton **Bloquer le client**.
- **Effets du blocage :** Le client ne peut plus effectuer d'achats à crédit en caisse (ventes à crédit ou versements d'acompte refusés) ni recevoir de nouvelles factures. Les achats réglés immédiatement et intégralement au comptant restent en revanche autorisés.
- Le déblocage s'effectue en un clic sur **Débloquer le client**.

