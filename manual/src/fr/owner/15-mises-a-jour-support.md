## 15. Mises à jour du logiciel et support technique {#mises-a-jour-support}

ShoeDZ bénéficie d'évolutions régulières pour intégrer les retours d'expérience des commerçants et rester en phase avec les normes fiscales algériennes.

### A. Mettre à jour l'application sous Windows

L'application de bureau ShoeDZ pour Windows est conçue pour fonctionner de manière totalement autonome :

1. **Procédure de mise à jour sécurisée :**
   - Téléchargez le fichier d'installation de la nouvelle version (ex : `ShoeDZ-Setup-1.6.0.exe`) fourni par le support ou disponible sur votre clé USB.
   - Fermez complètement l'application ShoeDZ sur votre poste de caisse.
   - Lancez le programme d'installation : il détecte automatiquement votre répertoire d'installation existant et met à niveau les fichiers du logiciel.
2. **Migration automatique de la base de données :**
   - Au redémarrage de l'application, ShoeDZ exécute automatiquement les scripts d'adaptation de votre base de données SQLite.
   - Vos données existantes (articles, prix, clients, ventes, dettes) sont intégralement conservées et prêtes à l'emploi.

> [!TIP]
> Par précaution élémentaire, créez toujours une sauvegarde manuelle sur clé USB avant de lancer une mise à jour logicielle majeure.

---

### B. Le Pack Diagnostic technique (Diagnostic Bundle)

En cas de comportement anormal du logiciel ou pour un audit de performance, le propriétaire peut générer un dossier technique complet en un clic :

1. Rendez-vous dans **Paramètres → Desktop**.
2. Dans la section *Diagnostic et Maintenance*, cliquez sur **Télécharger le pack diagnostic**.
3. Choisissez si vous souhaitez inclure une copie de la base de données (réservé exclusivement au propriétaire).
4. Le système génère une archive compressée `diagnostics_YYYYMMDD_HHMMSS.zip` contenant :
   - Le fichier `meta.json` : Version de l'application, informations système Windows, espace disque restant et volumétrie des données.
   - Le journal des événements applicatifs (`pointure.log`).
   - Le journal des requêtes lentes (`perf.log`).
   - La copie de la base de données (si demandée).

> 📷 **Capture d'écran :** *Carte de téléchargement du pack diagnostic dans l'onglet Paramètres Desktop.*

---

### C. Contacter le support technique ShoeDZ

Pour toute demande d'assistance technique ou d'accompagnement matériel :
- **Hotline téléphonique & Support WhatsApp :** Contactez directement votre conseiller technique dédié au numéro fourni lors de l'activation de votre licence.
- **Envoi du pack diagnostic :** Joignez l'archive `diagnostics_*.zip` à votre message pour permettre à l'équipe technique d'analyser immédiatement l'état de votre système sans avoir à se déplacer.
- **Intervention à distance :** Si nécessaire, le support peut vous guider pas à pas via un outil de prise en main à distance sécurisé pour ajuster vos imprimantes ou configurations réseau.

