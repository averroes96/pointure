# Plan: screenshots for the user manual

Goal: replace the 25 `📷 Capture d'écran` placeholders of the manual with real screenshots, in French,
English and Arabic (75 images), taken from the running app with synthetic demo data.

Status: **approved 2026-11-19** (WebP, light theme only, keep the seeded demo data).
**Change:** the owner captures the screenshots himself; Claude converts them to WebP (`manual/assets/<lang>/`,
names below), checks each one against its caption, and wires them into the Markdown. Sections 1 and 6 described
an automated capture that is no longer used; the table in section 3 is the shot list.

---

## 1. How the shots are taken

- **App:** the desktop backend (`config.settings.desktop`) on a scratch data folder, seeded with
  `python manage.py seed_demo` (synthetic store "ShoeDZ Demo Store": 20 products, 6 clients, 3 suppliers,
  purchase orders, quotes, 30 sales, invoices). It serves the built SPA as in production. No real store
  data is used (`LEGACY/` is never read).
- **Browser:** Playwright with headless Chromium (already cached on this machine), run from a scratch
  folder: **not added to the project's dependencies** unless you want the script kept to regenerate shots.
- **Accounts (from `seed_demo`):** owner `0555000001`, manager `0555000002`, cashier `0555000003`,
  password `demo1234`. Plan `pro_wholesale`, so invoicing is unlocked.
- **Language:** set before each run (`i18nextLng` = `fr` / `en` / `ar`); Arabic renders right-to-left.
- **Window:** 1366 × 768 (a typical shop laptop) at 2× pixel density, so text stays sharp when zoomed.
- **Framing:** a modal is cropped to the dialog plus a margin; a page is captured as the visible window
  with the sidebar. No browser chrome.
- **Theme:** light. (Dark mode would double the count: see decisions.)
- **Check:** I open every image to confirm it shows what the caption says before it goes in the manual.

## 2. Files and Markdown

- Images: `manual/assets/{fr,en,ar}/<guide>-<chapter>-<slug>.webp`, e.g. `cashier-01-login.webp`.
  `frontend/scripts/build-manual.mjs` already copies `manual/assets/` next to the built pages and warns on
  a missing image.
- In each chapter, the placeholder becomes an image plus the existing caption, e.g.:

  ```markdown
  ![Écran de connexion](../assets/fr/cashier-01-login.webp)
  *Écran de connexion avec les champs numéro de téléphone et mot de passe.*
  ```

  (paths are relative to the built page, `public/manual/<lang>/<guide>.html`).
- Size budget: WebP at ~80–150 KB each, about 10 MB for all 75. They ship inside the installer (the
  manual is part of the SPA). PNG would be 3–4× larger.

## 3. The 25 shots

Role: **C** cashier, **M** manager, **O** owner. "Setup" = data the script creates first, through the API.

### Cashier guide

| # | Chapter | Screen / route | Role | State to show | Setup |
|---|---|---|---|---|---|
| 1 | 01 Connexion | `/login` | — | Phone `0555 00 00 03` typed, password masked | Logged out |
| 2 | 02 Ouvrir la caisse | `/sales/new`, open-session dialog | C | Opening float 5 000 DA typed | No open session for the cashier |
| 3 | 03 Encaisser | `/sales/new` | C | Search "Air", size grid of one model open, 2 lines in the cart | Open session |
| 4 | 04 Client au comptoir | POS → new client | C | Quick form: name, phone `0550 12 34 56`, wilaya | Open session |
| 5 | 05 Versement / réservation | POS → layaway dialog | C | Deposit 3 000 DA on a 9 500 DA cart, due date | Cart with 2 items, a client selected |
| 6 | 06 Mise en attente | POS → <kbd>Alt+H</kbd> | C | Label "Client en essayage" typed | Cart with items |
| 7 | 07 Retour / échange | Sale history → return | C | 1 item ticked, reason "Pointure", restock on | A completed sale from today |
| 8 | 08 Mouvements de caisse | POS → <kbd>Alt+M</kbd> | C | Cash out 1 500 DA, "Achat fournitures" | Open session |
| 9 | 09 Autorisation PIN | Manager PIN dialog | C | 2 of 4 digits entered (masked) | Discount above the cashier's limit |
| 10 | 10 Fermer la caisse | `/sales/reconciliation` | C | Counted cash entered, expected vs counted and the gap shown | 3 sales and 1 cash out in the session |

### Owner guide

| # | Chapter | Screen / route | Role | State to show | Setup |
|---|---|---|---|---|---|
| 11 | 01 Premier démarrage | `/setup` | — | Store details step filled | **Separate empty database** (wizard only shows before setup) |
| 12 | 02 Utilisateurs | Settings → Utilisateurs → add | O | Name, phone, role "Caissier", discount limit | — |
| 13 | 03 Produits | `/inventory/products/:id` (detail page, not edit) | O | "Variantes (Taille × Couleur)" grid of a seeded model | — |
| 14 | 04 Achats | `/purchase-orders/:id` | O | Seeded "ordered" PO with sizes per carton | — |
| 15 | 05 Inventaire | `/inventory/stocktake` | O | Session scoped to one brand, 5 counts entered, 2 differences | Stocktake session created |
| 16 | 06 Clients & crédit | `/clients/:id` | O | Client with debt and credit limit | Seeded client with a balance |
| 17 | 07 Facturation | `/invoices/new` | O | Client + 2 lines, TVA and stamp duty computed | — |
| 18 | 08 Rapports | `/reports/daily` | O | Today's totals with breakdown by payment method | Sales today in cash, TPE, BaridiMob |
| 19 | 09 Audit | `/settings/audit-log` | O | Filters set, one entry expanded (before / after) | A product price change |
| 20 | 10 Matériel | Settings → Imprimantes | O | Thermal 80 mm selected, options visible | — |
| 21 | 11 Sauvegardes | Settings → Sauvegardes & Application | O | Local backups list + external destination card | 2 backups made |
| 22 | 12 Clôture d'exercice | `/closing` | O | Wizard on the export step (Excel / PDF pack) | A fiscal year to close |
| 23 | 13 Import ancien logiciel | Settings → Migration | O | Preview after analysis: counts of articles, clients, suppliers | **Synthetic DBF files** (see risks) |
| 24 | 14 Promotions | `/promotions` → new | M | Campaign: dates, % off, 3 models ticked | — |
| 25 | 15 Support | Settings → Sauvegardes & Application | O | "Pack Diagnostic & Logs" card | — |

## 4. Decisions needed

1. **Format:** WebP (≈10 MB in total, recommended) or PNG (≈35–40 MB, in the installer)?
2. **Dark mode:** light only (75 images), or also dark (150)?
3. **Script:** throw-away (scratch folder, nothing added), or kept in the repo as
   `frontend/scripts/manual-screenshots.mjs` with Playwright as a dev dependency so shots can be regenerated
   after UI changes (AGENTS.md §4.12: needs your approval)?
4. **Demo data:** the seeded names (brands like Nike/Adidas, French product names) appear in all three
   languages. OK, or do you want local brand names / Arabic product names for the Arabic shots?

## 5. Risks and limits

- **Not Windows / Electron:** the installer, splash screen, native menus and the Windows print dialog are not
  captured; none of the 25 placeholders needs them. Shots 21 and 25 (Desktop tab) work in a browser for the
  backup list and diagnostics card; buttons that open a Windows folder picker are shown, not clicked.
- **Shot 23 (DBF import):** the preview needs real `.dbf` files. Plan: generate small synthetic dBase files
  (a minimal writer, ~50 lines, fake articles and clients) in the scratch folder. If that fails, the shot
  shows the upload step instead and I flag it.
- **Shot 11 (setup wizard):** needs a second, empty database; captured first, before seeding.
- **Captions that are vague:** I'll follow the table above; anything I had to interpret is listed in the
  delivery report for you to check.
- **Hardware output** (printed tickets, labels, scanners) is out of scope.

## 6. Delivery

1. Capture French first and send you 3–4 samples for format and framing approval.
2. Then all 75, replacing the placeholders in `manual/src/{fr,en,ar}/`.
3. Run `npm run manual` (no missing-image warnings) and `npm run build --prefix frontend`.
4. Report: list of shots, anything interpreted, total size.
