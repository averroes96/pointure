# Backlog

The single list of issues found while working on something else, and of work that is **not done yet**.
It started on 2026-11-18 as the follow-ups of the `fixes/v1.10` work (merged into `release`, PRs #19–#26, tag
`v1.10.3`, from the pilot store's `perf.log` and `shodz.log`) and was renamed from `v1.10-followups.md`.
Items marked **Decision** need the owner's choice before any code is written.

**Adding an item** (AGENTS.md §7): put it in the section that fits (1 decisions, 2 work items, 3 user manual,
4 pilot-store checks, 5 delivery) as a short heading with the date, what you were doing when you found it, the
evidence (file and line, log excerpt, or "read from the code, not reproduced") and the suggested fix. Never fix
it inside an unrelated task. When an item is done, mark it **Fixed** with the branch or commit, or delete it.

---

## 1. Decisions

### 1.1 Time guard: one future-dated sale dates every later sale in the future — **Decision**
- **Where:** `backend/apps/core/services/time_service.py`, `_trusted_from()` and `_apply_rollback_guard()`.
- **Problem:** the anti-rollback guard never dates a sale before the latest `Sale.created_at` /
  `StockMovement.timestamp`. If one row is dated far ahead (the store's clock jumped to 2072 once), every
  new sale is dated one second after it, and each new sale becomes the new maximum. It perpetuates itself,
  even online.
- **Check a store:** `python manage.py check_future_dated_records` (read-only, added in v1.10) says whether
  the guard is affected.
- **Options:**
  1. Leave it; repair affected stores by hand using the command.
  2. Ignore the high-water mark when it is more than ~31 days ahead of the PC clock. Fixes the
     poisoning, but lets someone who sets the clock back more than a month escape the guard.
  3. Owner-PIN "accept current clock" action: lists the future-dated rows, then re-dates them or lowers
     the high-water mark (audited). Safest; needs a small UI. **Recommended.**

### 1.2 Pin NumPy and onnxruntime in `requirements-desktop.txt` — **Decision**
- Neither is pinned, so builds are not reproducible: the store ran NumPy 2.5.4, pip resolved 2.5.5 a day
  later; onnxruntime resolves to 1.20.1 on win32 and 1.32.0 on x64 (last 32-bit wheel is 1.20.x).
- Proposal: pin `numpy==<version>` and `onnxruntime==1.20.1; platform_machine == "x86"` /
  `onnxruntime==<x64 version>; platform_machine != "x86"` (environment markers). AGENTS.md §4.12: ask first.

### 1.3 Visual C++ runtime: app-local (current) vs installer-run `vc_redist` — **Decision**
- v1.10 copies Microsoft's VC++ runtime DLLs next to `python.exe` (`desktop/scripts/build.ps1`) and fails
  the build if any bundled binary needs a DLL a clean PC lacks (`desktop/scripts/check_dll_imports.py`).
- Trade-off: app-local DLLs get no Windows Update security fixes. Alternative: ship `vc_redist.<arch>.exe`
  and run it silently from `desktop/installer.nsh` (installer is per-machine, already admin), handling
  exit codes 0 / 3010 (reboot) / 1638 (newer installed). Keep the DLL check either way.

### 1.4 Password hash strength — **Decision**
- PBKDF2 took ~1.7 s per hash on the pilot PC (login, user creation, manager-PIN check). A wrong password
  now costs one hash instead of three (v1.10).
- Measure on the store PC first: `python manage.py benchmark_password_hashing`.
- Options: keep the default; lower PBKDF2 iterations (e.g. 390k or 260k); switch to scrypt; use a lighter
  hasher for 4-digit manager PINs only.

### 1.5 Dashboard KPI poll interval — **Decision**
- KPIs refresh every 2 minutes on non-enterprise plans. Proposal: 5 minutes (the live feed covers enterprise).

### 1.6 Legacy DBF import: duplicate rows — **Decision**
- When the old database lists the same `REFERENCE` twice, the last row's stock wins (unchanged behaviour,
  now crash-free). If two rows mean "same article, two stock lines", summing would be correct.
- `stock_units_imported` counts both rows, so the preview overstates stock for duplicated articles.

---

### 1.7 When does a cashier's return or exchange need a manager PIN? — **Decision**
- The frontend and the backend disagree. Frontend (`ReturnModal`, `ExchangeModal`): PIN asked only when the
  cashier lacks `can_process_returns` **and** the store requires it. Backend (`CreateReturnSerializer`,
  `ExchangeSerializer`): PIN required when the store requires it **or** the cashier lacks the flag.

  | Store "PIN required" | Cashier has `can_process_returns` | Frontend asks | Server requires |
  |---|---|---|---|
  | on (default) | yes | **no** | **PIN** → the return fails with a validation error after submit |
  | on | no | PIN | PIN |
  | off | yes | no | no |
  | off | no | **no** | **PIN** → fails after submit |

- The manual (owner guide, ch. 02) and the Settings label "Retours libres" say the flag lets a cashier accept a
  return **without calling the manager**, which matches the frontend. Proposed policy: the flag wins over the
  store setting (rows 1 and 4 then follow the frontend: row 1 no PIN, row 4 PIN). Needs the owner's confirmation
  because it changes who can refund money without a PIN. Whatever is chosen, one helper on each side and a test
  for all four rows (none exists today).

## 2. Work items (no decision needed)

### 2.1 Cold start takes 30–75 s; users restart the app mid-load
- Log: "Django setup done in 58.9s", "Backend ready in 74.3s"; warm restarts ~6 s. Several launches
  restarted within 1–2 minutes (26 Oct 18:34/18:35/18:46, 28 Oct 09:35–09:40), each one cold again.
- Likely: antivirus scanning the Python files, cold disk cache, no precompiled `.pyc` for site-packages.
- Ideas: progress/splash screen with "starting…" stages (Electron `splash.html` exists), `compileall` of
  `python-dist/Lib/site-packages` at build time, ask whether Defender exclusions are acceptable.

### 2.2 Legacy import as a background job
- The import runs in one request inside one `transaction.atomic()`: SQLite allows one writer, so the POS
  is blocked for the whole import. Move it to a background job (`run_task`) with progress polling.

### 2.3 Log noise
- The licence warning banner is printed (multi-line) on every start.
- `apps.sales.views` logs the full request payload when sale validation fails (client id, items, payments).
  AGENTS.md §4.11: never log customer data; log the error and a sale reference only.

### 2.4 No warning before an overpayment at the POS
- 3 Nov: a TPE payment of 6400 for a 3400 sale was rejected twice by the server ("Payment total significantly
  exceeds sale total"). The POS could warn before submitting.

### 2.5 `Branch.id` / `Variant.id` typed `number` but are UUID strings
- `frontend/src/types/index.ts`. The mismatch let `parseInt`/`Number` on ids compile (three bugs fixed in
  v1.10; `noIdCoercion.test.ts` now guards the pattern). Change the types to `string` across the app.

### 2.6 Remaining non-indexable date filters (`created_at__date`)
- Converted in v1.10 for reports, sales, z-report, reorder, size curve. Still using `__date`:
  `apps/notifications/services/owner_dispatch.py`, `apps/closing/views.py`, `apps/mobile/views.py`
  (dormant), `apps/reports/query_engine.py` (report builder, user-chosen fields).
  Use `apps.core.utils.dates.day_range` / `on_day`.

### 2.7 AGENTS.md §4.3 side-effects table
- Add: `SyncOutbox` rows are written only when `SYNC_OUTBOX_ENABLED` (off unless `CLOUD_API_URL` is set);
  `/reports/best-sellers/` is cached 5 minutes per tenant and window.

### 2.8 Webhooks page answered 404 in the store's log (unexplained)
- `/api/v1/webhooks/endpoints/` and `event_types/` returned 404 on 1 Oct and 28 Oct although the routes
  exist in current code (plan gating returns 403, not 404). Check with the installed build's version.

---

### 2.9 Found while preparing the manual screenshots (2026-11-19)
- **Login page shows demo credentials to every store:** `features/auth/LoginPage.tsx` always renders
  "Demo : 0555 12 34 56 / admin@demo.com / demo1234" (hard-coded French, not behind a demo flag).
- **Two different "margins" for the same product:** the edit form shows "Marge estimée" 42.9 % (on the sale
  price) and the detail page "Marge brute" 75.0 % (on the purchase price, i.e. markup) for Air Max Pro
  (6 965 / 3 980 DA). One helper, one definition (AGENTS.md §4.9).
- **Cash session lookup falls back to any open register in the tenant:** `CashSessionViewSet.current` and
  `CashSession.get_open_session` try cashier → branch → **tenant**. While any register is open anywhere, every
  cashier at every branch is attached to it and never gets the "open register" dialog. Breaks multi-branch.

### 2.10 Seed and demo data (`seed_demo`)
- **Every demo sale is dated today.** `seed_demo.py` passes `created_at=sale_date` (line ~561) but `Sale.created_at`
  is `auto_now_add`, so Django overwrites it: the daily report of a fresh demo shows "61 vente(s)" /
  769 365 DZD on one day, and the "30 days" history, seasonal and best-seller reports are wrong.
  Set the date with a queryset `.update(created_at=…)` after creating (as the tests do).
- **Payments use only cash and CCP** (`random.choice(["cash", "ccp"])`): TPE, BaridiMob, cheque and account
  payments never appear in demo reports or the manual screenshots.
- **Demo login line:** see 2.9 (the login page shows demo credentials to every store).

### 2.11 Docker development environment
- **`make dev` / `make dev-bg` / `make restart` never rebuild images.** Only `make setup` runs
  `docker compose build`. After a dependency change the containers run new code on an old image:
  `hijridate` (added 13 Nov) made celery fail with `ModuleNotFoundError` against the 9 Nov image. Use
  `docker compose up -d --build` in those targets (the cached `pip` layer makes it cheap when nothing changed).
- **`Dockerfile.dev` apt step takes ~30 minutes when its cache is invalidated:** `fonts-noto` +
  `fonts-noto-extra` pull the CJK fonts (`fonts-noto-cjk` 56 MB, `fonts-noto-cjk-extra` 134 MB). Replace with
  `fonts-noto-core` + `--no-install-recommends` after checking that PDFs still render Arabic and French;
  check `Dockerfile.prod` and `Dockerfile.render` for the same list. Docker/server images only: the Windows
  desktop does not use them.

### 2.12 Date fields follow the browser language, not the app language
- `<input type="date">` on the daily report and the cash-register closing page shows `mm / dd / yyyy` /
  `11 / 20 / 2026` when the browser is not in French, inside a French UI (and in the manual screenshots).
  On Windows the Electron app takes the OS region; check what the pilot store's PCs show. Options: a small
  shared date component that formats with the app language, or set `lang` on the input.

### 2.13 Cashier actions hidden in the sales history
- **Fixed in this branch:** Return and Exchange buttons were shown to owners and managers only (`isManager`), so a
  cashier, even with `can_process_returns`, could not start a return (found while taking the chapter 07
  screenshot). Now `canStartReturnOrExchange` (`lib/saleActions.ts`) shows them to every role on a completed sale.
- **Probably the same bug, not verified in the UI:** for a `partially_paid` sale (versement) the *Add payment* and
  *Cancel versement* buttons are also `isManager`-only, although the cashier manual (ch. 05) has the cashier
  collect the balance, and the server has no role restriction on `add_payment`. Check which of these a cashier
  is meant to do (cancelling already depends on `can_cancel_sale`) and gate them by the flags, not by role.
- **POS: the negative-stock confirmation skips the manager-PIN checks (read from the code, not reproduced).**
  `handleConfirmSale` (`SalesPage.tsx`) raises the negative-stock alert **before** the credit-limit, discount and
  price checks and returns. Confirming that alert calls `executeSaleSubmission` directly (three places), so a
  cashier's over-limit discount never gets the PIN dialog; the server then refuses the sale (a PIN is required
  for the excess discount) and the cashier sees a generic error instead. Run the checks, then show the alert.
- **POS: a manager PIN stays valid for the rest of the cart.** `managerPinRef` is only cleared on a new client,
  after the sale, or when the cart is cleared, so after one PIN approval (e.g. a price change) a later, larger
  discount in the same cart is not asked again. Decide whether a PIN covers one action or the whole sale.

### 2.14 Promotions (found 2026-11-20 while rewriting manual chapter 14; all read from the code, not reproduced)
- **The POS applies the promotion discount `qty` times too many (probably a real money bug).**
  `PromotionViewSet.applicable` returns `computed_discount` = discount for the **whole line**
  (`Promotion.compute_discount(unit_price, qty)`), but `applyPromo` in `SalesPage.tsx:594-598` multiplies it by
  `qty` again (`Number(res.data.computed_discount) * qty`). With 1 pair the result is right; with 3 pairs at
  20 %, the line gets 3 × (20 % of 3 pairs) = 180 % of one pair's price. The only test
  (`promotions/tests/test_applicable_promotion_tiers.py`) uses `qty=1`. Fix: drop the `* qty` and add a test
  with qty > 1 (backend and frontend). Also check whether `CreateSaleSerializer` re-validates the client-sent
  line `discount_amount` against the promotion (AGENTS.md §4.4: the server computes totals).
- **`Promotion.uses_count` is never incremented**, so *Utilisations* always shows 0 and `max_uses` never stops a
  promotion (the filter in `applicable` reads it). Increment it atomically (`F("uses_count") + 1`) when the sale
  is created, and decrement on cancel/return, or hide the two fields. The manual currently tells owners to leave
  *Utilisations* empty.
- **`PromotionsPage.tsx` has hardcoded French text** (AGENTS.md rule 3): the category names (`CATEGORIES`), the
  *Début* label, the `ex: 3` / `ex: 10000` placeholders, "Modifier" / "Supprimer" titles, the delete
  confirmation and the validation messages. In Arabic and English the form shows French.
- **The model's `product` filter has no UI**: a promotion can target one product in the API, not in the form.
  Decide whether owners need it (fins de série) or drop the field.
- **Date-only promotions use `timezone.now().date()`** (`views.py`), UTC-based; AGENTS.md §4.4 asks for
  `timezone.localdate()` (Africa/Algiers). Between 00:00 and 01:00 local time the "today" of a promotion is
  yesterday.

### 2.15 Excel/CSV import ignores the chosen branch (found 2026-11-20 while rewriting chapter 13; read from the code)
- `BaseImportView.get_branch` (`apps/core/import_views.py:47`) does `Branch.objects.get(id=int(branch_id))`, but
  `Branch.id` is a UUID: `int()` raises `ValueError`, which is swallowed, and the import falls back to the
  tenant's **first branch**. A multi-branch store that picks another branch in step 1 gets its opening stock
  in the wrong branch (AGENTS.md §4.6: never `int()` an id). Fix: use the UUID, return a 400 on an unknown
  branch, add a test with two branches. `ImportTemplateView` is also `AllowAny` (blank templates only; confirm
  that is intended).

## 3. User manual (`manual/src/{fr,ar,en}/`)
- Reset & backups: a reset is refused when the safety backup fails; pre-reset backups are never auto-pruned.
- OCR troubleshooting: "La lecture automatique (OCR) n'est pas disponible" → update to v1.10.3 or later
  (bundles the VC++ runtime); on older installs, install "Visual C++ Redistributable 2015–2022"
  (x86 on 32-bit Windows).
- Dashboard: the best-sellers card now covers the last 90 days (optional; the manual does not describe it).
- Defects page: write-off, 2nd-choice sale and supplier claim buttons work again (they called wrong routes).

### 3.1 The manual's steps do not match the real screens (found while taking screenshots)
Button and field names in the numbered steps differ from the application. Plan: after the 25 screenshots,
one pass over fr, en and ar to align each chapter with the real labels.
- **05 Versements / Réservations: rewritten in fr, en and ar (2026-11-20)** from the code (POS options panel,
  `CollectLayawayModal`, `CancelLayawayModal`, `CreateSaleSerializer` rules) and the layaway screenshot is wired.
  The old text described a "Versement / Réservation" button, a "Date limite de retrait" field and an "avoir"
  option on cancellation; none of these exist (cancelling offers *refund* or *keep the deposit*). Things the
  rewrite documents that are worth a product decision:
  - An **expired layaway is never released automatically**: only a red "Expirée" badge shows, the stock stays
    locked until someone collects or cancels it. Consider a daily job or a reminder on the dashboard.
  - The cashier **cannot add a payment to or cancel a versement** (buttons are `isManager`-only, see 2.13), so the
    chapter tells the cashier to ask a manager. For a layaway the same buttons are visible to every role.
  - The English locale labels the *Versement* button "Layaway Deposit" and the layaway switch "Layaway / Reserved":
    two names for two different features that read as one. Rename the first "Installment / Part payment".
- **13 Import ancien logiciel: rewritten in fr, en and ar (2026-11-20).** What was wrong (kept for reference): the settings tab is **Migration** (not "Importation &
  Migration"). There is no "Importer une base DBF" / "Lancer l'analyse préliminaire" / "Confirmer l'importation":
  the flow is *select the folder of `.DBF` files* **or** *upload a `.ZIP`* → the **Aperçu avant importation
  (Simulation)** opens automatically with the totals and warnings (nothing is saved) → **Importer maintenant**.
  The page also has options the chapter does not mention: stock mode (*Mode Simple* / *Mode Variantes*), old
  software version (*Détail* / *Gros / Demi-Gros*) and the entities to import. The chapter lists `FAMILLE.DBF`,
  `ARTICLEB/ARTICLE.DBF`, `CLIENT/CLIENTB.DBF`, `FOURNISS.DBF`, `FOURND.DBF`, `GCPARAM.DBF`; the importer also
  reads `ACHATART/ACHATMVT`, `VENTED01–12`, `CHEQUEXP`, `CREANCE`, `VERSECLT` (all optional).
- **13 Import: the preview mislabels a number (found 2026-11-20 while capturing the chapter 13 screenshot).** Under
  *Valeur du stock (Coût)* the preview prints "**Ventes historiques** : 5 158 200,00", but the value is
  `totals.stock_retail_value`, the stock at **retail price**, not past sales
  (`LegacyImportSection.tsx:702`, uses `settings.legacy_sales`). Add a key such as "Valeur de vente" in the 3
  locale files. Also visible in the same screen: the badge reads "DRY RUN" (English, not translated), the drop zone
  says "Cliquez pour sélectionner le dossier /LEGACY", and `settings.legacy_desc` talks about "le dossier /LEGACY"
  (a developer path, not meaningful to a store owner).
- **12 Clôture:** compared with the real wizard, the chapter matches (steps, button names). The chapter 12
  screenshot was taken with the 2026 year open and the snapshot built; step 5 (the lock) was deliberately not shown.
- **14 Promotions: rewritten in fr, en and ar (2026-11-20), the loyalty section checked against `LoyaltyPage`, the POS and the receipt.** What was wrong (kept for reference): the chapter offers "Tout le magasin / Par catégorie / Par sélection de modèles", but the form
  has one **Catégorie** drop-down plus *Qté minimum*, *Montant min*, *% Remise* or *Montant fixe*, *Priorité*,
  *Utilisations*; there is no model picker. The button is **Créer**, not "Activer la promotion". The date
  fields show the browser's month/day/year order (see 2.12), which looks wrong in a French screenshot.
- **04 Client au comptoir:** "Enregistrer" is **Créer et sélectionner**; the form has Nom and Téléphone only.
- **06 Mise en attente:** "Confirmer la mise en attente" is **Mettre en attente (Entrée)**; the *Mettre en
  attente* button is in the cart header, not at the bottom of the cart.
- **08 Mouvements de caisse:** "Valider le mouvement" is **Enregistrer le mouvement**; the choice is
  *Dépense / Retrait (−)* or *Apport d'espèces (+)*; the entry point is the *Mouvement* chip next to the session.
- **10 Fermer la caisse:** there is no "Vérifier l'écart de caisse" step (the gap updates while typing) and the
  button is **Clôturer le shift & Valider le Rapport Z**; the dialog also asks the real TPE and BaridiMob totals.
- **09 PIN Responsable:** the text says a **4-digit** PIN everywhere; the dialog says "Entrez le code PIN du
  responsable (**4 à 6 chiffres**)", and the PIN prompt for discounts appears only for the **cashier role** when
  the sale is validated (a manager or owner discounting is never asked). The chapter's table of when the PIN is
  asked should also say: return or exchange (per decision 1.7), discount over the limit, price change, credit
  limit exceeded; it lists "retour sans ticket" and "accès aux clôtures verrouillées", which are not what the
  code checks.
- **04 Achats:** the screenshot section describes creating an order with carton lines, which lives on the order
  *form* (`/purchase-orders/new`), not on the order detail page (receiving).
- The other chapters have not been compared yet.

### 3.2 Manual screenshots
- Plan and status: `docs/plans/manual-screenshots-plan.md`. English and Arabic pages currently use the French
  images (`../assets/fr/…`); swap the path per language when localized shots exist.
- **All 25 French screenshots are wired (2026-11-20)** in fr, en and ar (`manual/assets/fr/`, 2 MB in total). The
  en and ar pages still show the French images; localized shots come later. If a future chapter gets a
  "📷 Capture d'écran" placeholder, it shows to readers: hide placeholders in `build-manual.mjs` or finish the
  chapter before a release.
- `build-manual.mjs` copies `manual/assets/**` as is, including macOS `.DS_Store` files (and `.gitkeep`), into
  `frontend/public/manual/assets` and so into the installer. Skip dotfiles when copying.
- Screenshots were taken on macOS with a floating round icon (an island picture) over the bottom-right corner
  of most captures. It is not part of ShoeDZ; shots are cropped around it, or retaken with it hidden.

---

## 4. To run on the pilot store's PC
- `python manage.py check_future_dated_records`: rows dated in the future after the 2072 clock episode.
- `python manage.py prune_sync_outbox` (dry run by default; `--delete [--vacuum]` to clear).
- `python manage.py benchmark_password_hashing`: feeds decision 1.4.
- Disk type (HDD or SSD) and Windows edition (32/64-bit). The OCR failure points to the 32-bit installer.
- Until it runs v1.10.3+: install the VC++ Redistributable 2015–2022 to bring OCR back.

---

## 5. Delivery integrations (branch `feature/delivery-integration`)
- PR #18 (NOEST) is open into `release`.
- Real-account verification tasks P3.4, P3.8, P3.12, P3.16 need courier credentials
  (see `docs/plans/delivery-v1-plan.md`).
