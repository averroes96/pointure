## 6. Portefeuille clients, crédit et suivi des créances {#clients-credit}

La maîtrise du crédit accordé aux clients est cruciale pour préserver la trésorerie de votre commerce.

### A. Fiche client et profil commercial

Dans le menu **Clients** (<kbd>F4</kbd>), chaque fiche client centralise :
- Coordonnées : Nom complet, numéro de téléphone mobile (`05/06/07`), et wilaya de résidence.
- Pour les clients professionnels (boutiques revendeuses, entreprises) : Raison sociale, NIF, RC et adresse de facturation.
- Historique d'achats : Liste chronologique de tous les tickets de caisse, factures et versements d'acomptes émis pour ce client.

---

### B. Plafond de crédit et verrouillage automatique

Pour limiter les risques d'impayés, ShoeDZ intègre un contrôle strict du crédit :
1. Sur la fiche du client, renseignez le champ **Plafond de crédit autorisé** (ex : `50 000 DZD`).
2. Lors d'un passage en caisse, si une vente à crédit amène le solde débiteur au-delà de cette limite, le système refuse la validation à moins qu'un responsable ne déverrouille l'opération via son PIN.
3. **Blocage d'un client défaillant :**
   - Si un client accumule des retards de paiement inacceptables, activez l'option **Bloquer le client**.
   - Un client bloqué ne peut plus acheter à crédit ni recevoir de nouvelle facture. Il peut uniquement régler ses achats au comptant en espèces ou par carte.

> 📷 **Capture d'écran :** *Fiche client avec solde débiteur, jauge de plafond de crédit et bouton de blocage.*

---

### C. L'extrait de compte client (Grand livre client)

ShoeDZ tient automatiquement à jour le grand livre de chaque client :
- **Débit :** Chaque vente à crédit ou facture émise augmente la dette du client.
- **Crédit :** Chaque versement d'acompte, règlement en espèces ou chèque encaissé diminue la dette.
- **Solde net :** Le montant restant dû en temps réel.
- En cliquant sur **Imprimer l'extrait de compte**, vous pouvez remettre au client un récapitulatif détaillé certifiant l'ensemble de ses opérations et son solde exact à ce jour.

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

