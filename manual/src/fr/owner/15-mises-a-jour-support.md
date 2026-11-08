## 15. Mises à jour du logiciel et support technique {#mises-a-jour-support}

ShoeDZ bénéficie d'évolutions régulières pour intégrer les retours d'expérience des commerçants et rester en phase avec les normes fiscales algériennes.

### A. Mettre à jour l'application sous Windows

L'application de bureau ShoeDZ pour Windows est conçue pour fonctionner de manière totalement autonome :

1. **Mise à jour intégrée ou par installateur :**
   - Depuis **Paramètres → Desktop**, cliquez sur **Vérifier les mises à jour** pour télécharger et appliquer automatiquement la dernière version disponible (**Redémarrer et appliquer**).
   - Hors ligne, vous pouvez également exécuter le fichier d'installation (ex : `ShoeDZ-Setup-1.6.0.exe`) depuis une clé USB après avoir fermé ShoeDZ.
2. **Migration automatique de la base de données :**
   - Au redémarrage de l'application, ShoeDZ exécute automatiquement les scripts d'adaptation de votre base de données SQLite.
   - Vos données existantes (articles, prix, clients, ventes, dettes) sont intégralement conservées et prêtes à l'emploi.

> [!TIP]
> Par précaution élémentaire, créez toujours une sauvegarde manuelle sur clé USB avant de lancer une mise à jour logicielle majeure.

---

### B. Le Pack Diagnostic & Logs (Diagnostic Bundle)

En cas de comportement anormal du logiciel ou pour un audit de performance, le propriétaire ou le gérant peut générer un dossier technique complet en un clic :

1. Rendez-vous dans **Paramètres → Desktop**.
2. Dans la carte **Pack Diagnostic & Logs**, cliquez sur **Télécharger le pack (.zip)**.
3. Le propriétaire peut cocher l'option **Inclure une copie de la base de données** si l'équipe support en a besoin.
4. Le système génère une archive compressée `shodz_diagnostic_YYYYMMDD_HHMMSS.zip` contenant :
   - Le fichier `meta.json` : Version de l'application, plateforme Python/OS, état des migrations Django, vérification d'intégrité SQLite (`PRAGMA quick_check`) et liste des sauvegardes locales.
   - Le journal des événements applicatifs (`logs/shodz.log`).
   - Le journal des requêtes lentes (`logs/perf.log`).
   - Une copie cohérente de la base de données (`database/db_snapshot.sqlite3`, si demandée par le propriétaire).

> 📷 **Capture d'écran :** *Carte de téléchargement du pack diagnostic dans l'onglet Paramètres Desktop.*

---

### C. Contacter le support technique ShoeDZ

Pour toute demande d'assistance technique ou d'accompagnement matériel :
- ** Hotline téléphonique & Support WhatsApp :** Contactez directement votre conseiller technique dédié au numéro fourni lors de l'activation de votre licence.
- **Envoi du pack diagnostic :** Joignez l'archive `shodz_diagnostic_*.zip` à votre message pour permettre à l'équipe technique d'analyser immédiatement l'état de votre système sans avoir à se déplacer.
- **Intervention à distance :** Si nécessaire, le support peut vous guider pas à pas via un outil de prise en main à distance sécurisé pour ajuster vos imprimantes ou configurations réseau.

