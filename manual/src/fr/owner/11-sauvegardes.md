## 11. Sauvegardes, sécurité et restauration des données {#sauvegardes}

Les données de votre magasin (historique des ventes, dettes clients, valorisation des stocks) constituent le patrimoine numérique de votre entreprise. Une stratégie de sauvegarde rigoureuse vous prémunit contre toute panne matérielle ou vol de PC.

### A. Sauvegardes automatiques et manuelles

ShoeDZ intègre un système de sauvegarde double niveau :
1. **Sauvegarde automatique quotidienne :**
   - L'application génère automatiquement une copie de sécurité de la base de données lors de chaque clôture de caisse ou à heure fixe programmée.
   - Les sauvegardes locales sont conservées dans le dossier sécurisé du logiciel avec un horodatage précis.
2. **Sauvegarde manuelle immédiate :**
   - À tout moment, rendez-vous dans **Paramètres → Desktop / Sauvegardes**.
   - Cliquez sur le bouton **Créer une sauvegarde maintenant**.

---

### B. Chiffrement et Fiche de secours (Recovery Sheet)

Pour protéger vos informations commerciales confidentielles en cas de perte de clé USB, chaque archive de sauvegarde est chiffrée à l'aide d'une **Phrase secrète de secours (Passphrase)** définie lors du premier démarrage.

> [!IMPORTANT]
> **Imprimez immédiatement votre Fiche de secours :**
> - Rendez-vous dans **Paramètres → Sauvegardes** et cliquez sur **Imprimer la fiche de secours**.
> - Cette fiche papier contient votre phrase secrète de déchiffrement ainsi que les consignes d'urgence.
> - **Conservez impérativement ce document papier dans le coffre-fort physique du magasin**, à l'abri des regards et séparé de l'ordinateur. Sans cette phrase, aucune sauvegarde chiffrée ne pourra être restaurée sur un nouveau PC.

---

### C. Copie externe sur clé USB (Recommandation vitale)

Une sauvegarde stockée uniquement sur le disque dur du PC caisse ne vous protège pas en cas de panne de disque dur, de surtension électrique ou de cambriolage.

1. Insérez chaque soir une **Clé USB dédiée** sur l'ordinateur.
2. Dans **Paramètres → Sauvegardes**, cliquez sur **Exporter vers clé USB**.
3. Sélectionnez le lecteur amovible de votre clé USB.
4. Le fichier de sauvegarde sécurisé (format `.enc` ou `.zip`) y est copié en quelques secondes.
5. Retirez la clé USB et emportez-la avec vous en quittant la boutique.

> 📷 **Capture d'écran :** *Interface de gestion des sauvegardes avec liste des archives et bouton d'export USB.*

---

### D. Restauration d'une sauvegarde en cas de sinistre

Si vous devez réinstaller ShoeDZ sur un nouvel ordinateur après un incident :
1. Installez ShoeDZ sur le nouveau poste Windows.
2. Sur l'écran d'accueil d'initialisation, cliquez sur **Restaurer à partir d'une sauvegarde existante**.
3. Branchez votre clé USB et sélectionnez le fichier de sauvegarde le plus récent.
4. Saisissez votre phrase secrète de secours inscrite sur votre fiche papier.
5. Cliquez sur **Lancer la restauration** : l'ensemble de votre catalogue, vos prix, vos clients et vos stocks sont instantanément réintégrés dans l'état exact où ils se trouvaient lors de la sauvegarde.

