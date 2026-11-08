## 10. Matériel, imprimantes et périphériques de caisse {#materiel}

ShoeDZ est compatible avec l'ensemble des équipements de point de vente standard du marché fonctionnant sous Windows.

### A. Configuration des imprimantes

Depuis **Paramètres → Imprimantes**, vous pouvez assigner des imprimantes distinctes pour chaque usage :

1. **Imprimante à tickets thermique (Point de Vente) :**
   - Modèles compatibles : Imprimantes thermiques directes 80mm ou 58mm (Epson, Xprinter, Bixolon, etc.) connectées en USB ou en réseau Ethernet/Wi-Fi.
   - Sélectionnez la largeur du rouleau (`80mm` ou `58mm`).
   - Activez l'option **Ouverture automatique du tiroir-caisse** lors de l'encaissement.
2. **Imprimante de bureau standard (Documents A4) :**
   - Toute imprimante laser ou jet d'encre reconnue par Windows (HP, Canon, Brother, etc.).
   - Utilisée pour l'impression des factures officielles, bons de livraison B2B, extraits de comptes clients et rapports d'inventaire.
3. **Imprimante d'étiquettes codes-barres :**
   - Imprimantes thermiques dédiées à l'étiquetage des boîtes à chaussures (formats standard `50x30 mm` ou `40x25 mm`).

> 📷 **Capture d'écran :** *Onglet de configuration des imprimantes avec sélection du modèle et paramètres d'impression.*

---

### B. Module de vérification rapide du matériel (Hardware Quick Check)

Pour valider l'installation de vos périphériques sans faire une vraie vente :
1. Dans l'onglet **Paramètres → Imprimantes**, cliquez sur **Vérification rapide du matériel**.
2. Cliquez sur **Tester l'impression du ticket** :
   - Un ticket de test s'imprime immédiatement avec le logo ShoeDZ et la confirmation des paramètres.
3. Cliquez sur **Tester l'ouverture du tiroir-caisse** :
   - L'imprimante envoie une impulsion électrique au tiroir-caisse connecté (signal RJ11/RJ12), qui doit s'éjecter instantanément.
4. Si le tiroir ne s'ouvre pas :
   - Vérifiez que le câble RJ11 reliant le tiroir à l'arrière de l'imprimante est bien enclenché.
   - Modifiez le code d'impulsion tiroir (Broche 2 ou Broche 5) dans les options avancées.

---

### C. Lecteurs de codes-barres (Douchettes USB)

ShoeDZ prend en charge tous les scanners de codes-barres 1D et 2D fonctionnant en mode émulation clavier (**USB HID Keyboard Wedge**) :
- **Branchement :** Branchez simplement le lecteur sur un port USB du PC Windows. Aucun pilote spécifique n'est requis.
- **Caractère de fin de ligne (Suffixe Entrée) :** Le lecteur doit être configuré pour envoyer automatiquement la touche <kbd>Entrée</kbd> après chaque lecture de code-barres. Ce paramètre est actif par défaut sur la majorité des douchettes du marché. Si ce n'est pas le cas, scannez le code-barres *"Add CR/LF Suffix"* situé dans le manuel d'instructions papier fourni avec votre douchette.

