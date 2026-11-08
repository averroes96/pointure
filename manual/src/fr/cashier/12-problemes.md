## 12. Résolution des problèmes courants {#problemes}

Voici les vérifications simples à effectuer en cas d'imprévu au comptoir avant de contacter l'assistance technique.

---

### 1. L'imprimante thermique ne sort pas de ticket

1. **Vérifiez les câbles physiques :** Assurez-vous que le câble USB est fermement branché à l'ordinateur et que le bloc d'alimentation de l'imprimante est allumé (voyant vert allumé).
2. **Vérifiez le rouleau de papier thermique :**
   - Ouvrez le capot de l'imprimante.
   - Le papier thermique possède une face sensible : le papier doit se dérouler **par le dessous** (face thermique orientée vers le capteur). Si le rouleau est à l'envers, le ticket sortira complètement blanc.
3. **Effectuez un test d'impression logiciel :**
   - Ouvrez **Paramètres** (<kbd>Alt + P</kbd>) → onglet **Imprimantes**.
   - Cliquez sur le bouton **Imprimer un ticket de test**.
   - Si le ticket sort correctement, le matériel fonctionne normalement.

---

### 2. Le lecteur de code-barres ne bipe pas ou n'ajoute pas l'article

1. **Vérifiez le branchement USB :** Débranchez et rebranchez le lecteur de code-barres sur un autre port USB de l'ordinateur.
2. **Testez la lecture dans un champ texte :**
   - Cliquez dans le bloc-notes Windows ou dans la barre de recherche (<kbd>F2</kbd>).
   - Scannez un code-barres : les chiffres doivent s'écrire instantanément suivis d'un saut de ligne.
3. **Si les chiffres ne s'affichent pas :**
   - Scannez le code-barres de réinitialisation usine fourni dans le manuel papier de votre douchette pour réactiver le mode clavier USB standard (*USB HID Keyboard Wedge*).

---

### 3. Alerte d'anomalie d'horloge (Bandeau orange `TimeAnomalyBanner`)

Si un bandeau orange apparaît en haut de l'écran avec le message *"Anomalie détectée sur l'horloge système"* :
- Cela signifie que l'heure ou la date de Windows a été modifiée manuellement, ou que la pile de la carte mère de l'ordinateur est déchargée.
- Pour des raisons de conformité fiscale, les ventes ne peuvent pas être antidatées.
- **Solution :** Allez dans **Paramètres** → onglet **Desktop**, puis cliquez sur **Recaler l'horloge** pour resynchroniser automatiquement l'heure officielle par Internet.

---

### 4. Message d'erreur : "Période fiscale clôturée"

Si le système refuse la modification ou la création d'un document avec le message *"Impossible d'enregistrer sur une période clôturée"* :
- Cela indique que le gérant ou l'expert-comptable a définitivement verrouillé le mois ou l'année fiscale écoulée.
- Vous ne pouvez plus enregistrer d'opération sur cette date passée. Enregistrez l'opération sur la date du jour en cours.

---

### 5. Qui contacter en cas de blocage persistant ?

Si le problème persiste après ces vérifications :
1. Prévenez immédiatement votre **Gérant ou Propriétaire du magasin**.
2. Pour les pannes logicielles ou de base de données : le gérant peut générer un **Pack Diagnostic** depuis l'onglet **Paramètres → Desktop** et le transmettre au support technique ShoeDZ.

