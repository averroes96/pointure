# ShoeDZ Delivery v1: courier-neutral shipments, cash status and agency payouts

**Audience:** the AI coding agent implementing this plan, and the owner reviewing it.
**Read first:** [`AGENTS.md`](../../AGENTS.md). All of its rules apply: small tasks, verification commands (§2.1), side-effects table (§4.3), invariants (§4.4), background work (§4.7), migrations (§4.8), security (§4.11), tests (§5).
**Starting point:** written on `fixes/v1.9-release-pipeline` (`3f544c1`). Since 2026-11-17 the work continues on branch **`release`**, where P1.1 (`08d9cb5`, including the §3 dispatch fixes) and P1.2 (`b673e70`) are committed. `release` does **not** contain `3f544c1` or the other v1.9 review fixes of that branch. Since P1.13 the work is on **`feature/delivery-integration`**, fast-forwarded to `release` at `cded909`, so it holds all 11 delivery commits (`08d9cb5` → `cded909`). `v1.10-plan.md` is paused.
**Date:** 2026-11-16 (rewritten after the owner chose the split in §1).

---

## 0. Why this release

- Stores ship cash-on-delivery (COD) parcels. The pilot store uses **Maystro**. Its orders are created in a **DZBuild** online store or in the **Maystro app**, never in Pointure. Pointure's Draft Orders dispatch exists but **nobody uses it yet**.
- The owner wants, first, **visibility of every sent order in Pointure**: where each parcel is, which were delivered or returned, and **where the cash is** (with the courier, paid to the store). Then they want to **record payouts picked up at the courier's agency**.
- The solution must **not be tied to one courier**. A store on Yalidine, ZR Express, NOEST or any Ecotrack courier must get the same screens by adding one connector, not by changing the screens.

---

## 1. Architecture (owner decision, 2026-11-16)

Work is split by what each side does well:

| Need | Goes through | Why |
|---|---|---|
| Create a parcel, list stop desks, quote fees, wilaya and commune reference data | **dzship** (DZBuild's free gateway, `https://freeship.dzbuild.com`) | dzship already maps our commune names and desk choices to each courier's own IDs (Maystro numeric communes, ZR territory UUIDs, Yalidine centers). |
| List the account's orders, read one parcel, its history, its **cash/payout status** | **Pointure's own read connectors**, one per courier **platform**, calling the courier directly | dzship has no listing and no money fields. Only the couriers expose them. |
| Credentials | **One set per courier, stored once** in Pointure's delivery settings | dzship forwards the courier's own credentials, so the same keys work for both sides. |

The dzship courier catalogue (`GET /v1/couriers`) connects the two halves. For each of its 100 couriers it gives:
- the `key`;
- the `platform`: 13 platforms, such as `yalidine` (6 couriers), `ecotrack` (83), `maystro`, `noest`, `procolis`, `zrexpressapp`;
- the exact `requiredCredentials`;
- `capabilities`;
- the courier's own API address (`endpoint`), or `requiresBaseUrl` for the generic Ecotrack key.

A read connector is chosen by **platform** and pointed at the courier's **endpoint**. One Ecotrack connector therefore serves all 83 Ecotrack couriers.

```
Settings: courier key + credentials (ProviderConfig)
        │
        ├── writes (phase 2): dzship /v1/orders, /v1/desks, /v1/rates, /v1/communes
        │
        └── reads (phase 1): connector[platform](endpoint, credentials)
                 → list / get / history / cash status → Shipment rows → Shipments screen
                                                                     → Agency payout records
```

---

## 2. Facts this plan relies on (checked 2026-11-16)

| Fact | Source |
|---|---|
| dzship endpoints: `POST /v1/orders`, `POST /v1/track`, `POST /v1/rates`, `POST /v1/desks`, `GET /v1/couriers`, `GET /v1/wilayas`, `GET /v1/communes`, `GET /health`. **No listing, no cancel or label route** (the catalogue lists `cancelShipment` / `label` as capabilities, but no endpoint is documented). No money fields. | [dzship `docs/endpoints.md`](https://github.com/DZBuild-com/dzship/blob/main/docs/endpoints.md), [`openapi.json`](https://github.com/DZBuild-com/dzship/blob/main/docs/openapi.json) |
| Order creation: never retried by dzship; send our own `order.reference`. Errors use `{"error": {"code", "message", "fields"}}`. Limits per IP: 200 orders/hour, 1,000/day, 10/day per recipient phone. | same |
| Catalogue entries, e.g. `maystro`: platform `maystro`, credentials `["apiKey"]`, endpoint `https://backend.maystro-delivery.com/api`. `yalidine`: `["apiId","apiToken"]`, `https://api.yalidine.app`. `noest`: `["apiToken","guid"]`. `zrexpress` (legacy Procolis): `["token","key"]`. New ZR platform key: `zrexpressnew`. Generic `ecotrack`: `["token"]` plus a `*.ecotrack.dz` base URL. | `GET https://freeship.dzbuild.com/v1/couriers` (read 2026-11-16) |
| The hosted dzship service is proprietary, with no SLA. The repository's guides, clients and data are MIT. | [`NOTICE.md`](https://github.com/DZBuild-com/dzship/blob/main/NOTICE.md) |
| **Maystro's new backend** `https://backend-web-app.maystro-delivery.com/api` publishes its OpenAPI at `/api/schema/` ("Orders Management Backend API" 1.0.0). The public GitBook docs describe the **old** host and are out of date. | schema downloaded 2026-11-16 |
| **Maystro "integration v2" API keys** (`ak_…`) go in the **`X-API-KEY`** header. Keys have **types and scopes**, managed by the logged-in store user (`/api/integration/v2/key-types/`, `/scopes/`, `/keys/`, JWT only). The old host and `Authorization: Token` reject them. | live probe 2026-11-16 (status codes and field names only) |
| **What the store's current key can read** (probe 2026-11-16): `/api/stores/hooks/integrations/balance/` (`current_balance`), `/api/store/products/`, `/api/stock/products/`, `/api/external/store-pricing/`, `/api/refunds/`, `/api/base/wilayas/`, `/api/base/communes/`. **Refused**, "not available for API key access": `/api/orders/`, `/api/orders/{id}/`, `/api/orders/history-order/{id}/`, `/api/search-orders/`, `/api/temp-orders/`, and every `/api/payments/…` (list, balance, statement). Webhook management: "your API key does not have the required scope". | same |
| Order schema (`AllFieldOrder`): `id`, `display_id` (tracking), `external_id`, `created_at`, `updated_at`, `status`, customer name and phones, `commune`/`commune_name`, `wilaya`, `product_price`, `price`, `total_price`, `sd_tracking_number`, `delivery_type`, `products`, … The list supports `ordering`, `page_size` and filters (`display_id`, `delivered_date`, `wilaya`, …). **No `paid_by_agent` / `paid_to_store`** in the new schema. | schema |
| Payments: `/api/payments/` rows `{id, payment_date, nb_orders, amount}`; `/api/payments/{id}/statement/` (+ export, disbursement note); `/api/payments/balance/`. **Each payout lists its orders**, so payouts can be matched automatically once a key may read them. | schema |
| Status codes (`Status8a7Enum`): 4 CREATED, 5 PICK_UP_REQUESTED, 6 IN_PROCESS, 8 WAITING_TRANSIT, 9 IN_TRANSIT_TO_BE_SHIPPED, 10 IN_TRANSIT_TO_BE_RETURNED, 11 PENDING, 12 OUT_OF_STOCK, 15 READY_TO_SHIP, 22 ASSIGNED, 31 SHIPPED, 32 ALERTED, **33 READY_FOR_PICKUP** (new), **41 DELIVERED**, 42 POSTPONED, 50 ABORTED, 51 READY_TO_RETURN, **52 TAKEN_BY_STORE**, 53 NOT_RECEIVED. | schema |
| Webhook events: `OrderCreated`, `OrderDelivered`, `DeliveryStatusChange`, `OrderFieldUpdated`, `DeliveryInfoUpdated`, **`StorePayment`**. They need a public HTTPS URL and the right key scope, so they are not used (the app listens on `127.0.0.1`). | schema |
| dzship's catalogue still lists Maystro with `apiKey` on the **old** host. Whether dzship accepts an `ak_` key for order creation is **untested** (testing it means sending the key to DZBuild: owner's call, phase 2). | catalogue 2026-11-16 |
| Other platforms, for later read connectors: Yalidine parcels expose `payment_status` ∈ {`not-ready`, `ready`, `receivable`, `payed`} plus `payment_id`, filterable (quotas 5/s, 50/min, 1,000/h, 10,000/day). ZR Express (new) has treasury endpoints (balance, payouts, per-parcel transactions). Ecotrack statuses carry cash stages (`encaisse_non_paye`, `paiements_prets`, `paye_et_archive`) plus `payment_id`. NOEST puts payout steps in its history. | [Guepex/Yalidine API docs copy](https://github.com/bighadj22/Wocart/blob/main/cod-server/src/carriers/yalidine/guepex-api-docs.md), [ZR Express API](https://docs.zrexpress.app/), dz-delivery `PROVIDERS.md` |

### What exists in the code today (verified)
- **Settings:** `ProviderConfig` has `provider` (choices `yalidine`, `zr_express`, `maystro`, `noest`; `max_length=20`), `api_id`, `api_secret` (write-only, plain text) and `is_active`, unique per `(tenant, provider)`. It is edited in `DeliverySettingsPage.tsx`. **The pilot store has its Maystro key saved here.**
- **Credential mapping:** `DzshipClient.create_order` maps `maystro` → `apiKey` (correct) and `yalidine` → `apiId`/`apiToken` (correct). It maps `zr_express` → `client`/`token` and `noest` → `token`, which **do not match** the catalogue (`token`/`key`; `apiToken`/`guid`). `zr_express` is also not a dzship key.
- **Gating:** the feature is gated by `StoreSettings.enable_delivery_integrations` (`DeliveryIntegrationsGuardMixin`), `PlanRequired("pro_retail")`, and `/deliveries` being a manager prefix in `frontend/src/lib/roleAccess.ts`.
- **Meta/Gemini parsing:** `SocialIntegration`, the `Meta*` views, `services/ai_parser.py`, and a section of `DeliverySettingsPage.tsx`. **To be removed** (DL.10).

---

## 3. State of the existing dispatch code

| # | Defect | Status |
|---|---|---|
| K1 | Dispatch wrote no `StockMovement` | **Fixed 2026-11-16** for new dispatches. Nobody had used dispatch, so there is no past data to repair. |
| K2 | The sale is created `COMPLETED` at dispatch, before delivery; a return is never undone | **Open**: decided in phase 2 (DL.11). |
| K3 | Courier call inside `transaction.atomic()`, no timeout | **Fixed 2026-11-16**: local validation, claim the draft with a conditional update, call outside the transaction (30 s timeout, `reference` = order id), then one short transaction. |
| K4 | `str(e)` returned to clients | **Fixed 2026-11-16** (dispatch and external ingestion). |
| K5 | Unsigned `AllowAny` status webhook, cross-tenant lookup | **Fixed 2026-11-16**: returns 404. Route removed in P1.1. |
| K6 | Credentials stored in plain text | **Deferred** *(owner)*. |
| K7 | Delivery endpoints check login and plan, not role | **Fixed 2026-11-17 (P1.2)**: `RolePermission` (manager or owner) on both viewsets, including `dispatch_order`. Tests: `tests/test_delivery_roles.py` (11 cashier checks failed before the fix). |
| K8 | Wrong credential mapping for ZR and NOEST; `zr_express` is not a dzship key | **P1.4**. |

Tests for the fixes: `backend/apps/delivery_integrations/tests/test_dispatch_order.py` (11 tests; 8 failed against the old view).

---

## 4. Decisions

| ID | Decision | Value |
|---|---|---|
| DL.1 | Split | dzship for **writes that involve geography** (create, desks, fees, reference data). Pointure's own **read connectors** per platform for list, get, history and cash. *(owner)* |
| DL.2 | Access | **Manager and owner only**, enforced on the server for **every** delivery endpoint, including the existing Draft Orders and settings ones, and in `roleAccess.ts`. *(owner)* |
| DL.3 | Till | Shipments, courier cash and payouts **never touch `CashSession`**, X/Z reports or till movements. *(owner)* |
| DL.4 | Discovery | Orders come from the courier's own **list** endpoint, whoever created them (DZBuild, the courier app, Pointure). Import by tracking number only for a platform with no list endpoint (none in phase 1). |
| DL.5 | Freshness | **Event-driven fetch, no background polling.** A sync runs when the Shipments page or a shipment is opened, on the Refresh button, and after a dispatch. *(owner)* |
| DL.6 | Status vocabulary | dzship's canonical set: `created`, `pending_pickup`, `picked_up`, `in_transit`, `at_hub`, `out_for_delivery`, `delivery_attempted`, `delivered`, `on_hold`, `return_in_transit`, `returned`, `cancelled`, `lost`, `unknown`. Each connector maps its courier's raw status, and `raw_status` is always kept. |
| DL.7 | Cash vocabulary | `not_applicable` (no COD, cancelled, returned), `awaiting_delivery`, `held_by_courier` (delivered, not paid to the store), `ready` (only when the courier says the payout is ready), `paid`. `paid` comes from a recorded agency payout (P1.12) **or** from the courier (e.g. Maystro `paid_to_store`, once P1.6 confirms its meaning). A mismatch is flagged, never auto-resolved. |
| DL.8 | Payouts | Picked up **at the agency** and recorded by a manager in Pointure (P1.12), outside the till (DL.3). *(owner)* |
| DL.9 | Delivery and return fees | Out of scope. Later recorded as movements. *(owner)* |
| DL.10 | Meta/Gemini parsing | **Removed** in P1.1. *(owner)* |
| DL.11 | Sales and stock for delivery orders (K2) | Decided **before phase 2**, not needed for phase 1 (which is read-only on sales and stock). |
| DL.12 | Credentials storage | Reuse `ProviderConfig`. It gains the dzship courier key and named credentials (P1.4). Encryption is deferred (K6). |
| DL.13 | Feature gating | Unchanged: `enable_delivery_integrations` plus `PlanRequired("pro_retail")`. |

---

## Phase 1: Visibility, cash status and agency payouts (Maystro first)

### Group A: Clean-up

#### P1.1 Remove the Meta/Gemini order parsing (DL.10)
- **Change:**
  - **Backend:** delete `SocialIntegrationViewSet`, `MetaOAuthURLView`, `MetaOAuthCallbackView`, `MetaWebhookView`, the inert `WebhookReceiverView` and their routes. Delete `SocialIntegrationSerializer`, `services/ai_parser.py`, and the `SocialIntegration` model. The model goes through **one new migration** (`DeleteModel`); existing migrations are never edited. The table holds only dormant page tokens.
  - **Frontend:** remove the social section of `DeliverySettingsPage.tsx`. Remove its keys from **all three** locale files, after checking no other file uses them.
  - **Tests:** update `test_delivery_setting.py` (it asserts the Meta and webhook routes return 404 when the feature is off). The routes no longer exist, so assert 404 for the remaining routes only, and say so in the report.
  - **Kept:** `CustomerOrder.sender_id` and the `messenger`/`instagram` source choices, to avoid a schema change for no gain. `ExternalOrderIngestionView` stays until open question 1 is answered.
  - `google-generativeai` appears only in the inactive server `requirements.txt`, not in `requirements-desktop.txt`. Remove it only if the owner agrees (open question 3).
- **Tests:** the removed routes answer 404, the remaining delivery routes still work, `makemigrations --check` is clean, and the migration applies on a database that has `SocialIntegration` rows.

#### P1.2 Server-side role checks on every delivery endpoint (K7, DL.2)
- **Change:** `permission_classes = [IsAuthenticated, RolePermission, PlanRequired("pro_retail")]` with the default `MANAGER_OR_OWNER`, on `ProviderConfigViewSet` and `CustomerOrderViewSet` (including `dispatch_order`). Open `apps/core/permissions.py` first.
- **Tests:** cashier → 403 on list, create and dispatch; manager → 200.

### Group B: Courier catalogue and credentials

#### P1.3 Courier catalogue snapshot (**done 2026-11-17**, uncommitted)
- **Built as:**
  - `services/catalogue.py`: a JSON file `courier_catalogue.json` in `DATA_DIR`, written atomically. It needs no migration, is shared reference data, can be fetched again at any time, and never takes the SQLite write lock.
  - `GET /api/v1/deliveries/couriers/[?refresh=true]`: managers and owners, feature-gated. It answers from the snapshot at once and refreshes in one background thread when the snapshot is missing, older than 24 h, or `refresh=true` is passed.
  - Entries are validated: slug keys, 1–8 credential names, boolean capabilities, and either an `https` endpoint or `requiresBaseUrl` with `.`-prefixed suffixes. Invalid or duplicate entries are dropped, and a failed or empty refresh keeps the old snapshot.
- **Checked against the live catalogue:** 99 of 100 couriers kept. Only dzship's `sandbox` test courier is dropped (no credentials, no endpoint).
- **Tests:** `tests/test_courier_catalogue.py` (27).
- **Change:**
  - `services/catalogue.py` fetches `GET /v1/couriers` (timeout 10 s) **when the delivery settings page asks for it**, and stores the snapshot. Store it as one JSON file in `DATA_DIR`, or one row in a small model; pick one and justify it in the task report.
  - Offline, or on any error, the last snapshot is served. If none exists yet, the settings page shows the error and the courier list stays empty.
  - The snapshot is reference data, not tenant data.
- **Tests:** fetch and store, offline fallback, malformed response ignored, timeout.

#### P1.4 Named credentials in `ProviderConfig` (K8, DL.12) (**done 2026-11-17**, uncommitted)
- **Built as specified, with these differences:**
  - **Data migration:** copies only certain values. Maystro gets `apiKey` from `api_secret`, or else `api_id` (the old form required only the first field). Yalidine gets `apiId`/`apiToken`. NOEST gets `apiToken` only. ZR Express gets the courier key only. Anything missing shows as "to complete" in settings.
  - **Added: SyncOutbox leak fix.** `serialize_model` copied every field, including `api_secret`, into `SyncOutbox`. Models can now list `SYNC_EXCLUDED_FIELDS`, and migration 0007 scrubs credential keys from existing `ProviderConfig`/`SocialIntegration` outbox rows.
  - `CustomerOrder.provider` now stores the courier key (max 50, no fixed choices). The Draft Orders page offers only active, complete courier accounts.
  - `PUT` removed: `PATCH` merges credentials.
  - **Moved to P1.7: the Test connection button.** It needs a read connector, and dzship has no credential-test endpoint.
- **Tests:**
  - backend `test_provider_config.py` (21), plus K8 cases in `test_dispatch_order.py`. The K8 and outbox tests failed against the old code.
  - frontend `deliveries/__tests__/courierSettings.test.tsx` (6).
  - Migration 0007 checked on a scratch SQLite database with a pilot-style legacy Maystro row.
- **Change:**
  - **New fields:**
    - `courier` (CharField 50, a dzship key, blank by default);
    - `credentials` (JSONField, default `{}`), **write-only** in the API, never returned or logged;
    - `base_url` (blank; only for the generic `ecotrack` key, validated against `*.ecotrack.dz`).
  - **Data migration** (idempotent, reversible with `noop`): fill `courier` and `credentials` from the old columns.
    - `maystro` → `{"apiKey": api_secret}`;
    - `yalidine` → `{"apiId": api_id, "apiToken": api_secret}`;
    - `noest` → `{"apiToken": api_secret, "guid": api_id}`;
    - `zr_express` → courier `zrexpress`, `{"token": api_secret, "key": api_id}`. Flag it for the owner to re-check, since the old mapping was wrong.
    - The pilot's Maystro row must come out working: test this with a synthetic row.
  - The old columns stay for this release; a later migration removes them.
  - **Validation:** the serializer accepts exactly the catalogue's `requiredCredentials` for the chosen courier.
  - **Settings page:** a courier picker from the catalogue and one input per required credential. Saved secrets show as "•••• saved" with a Replace button. `DeliverySettingsPage.tsx` has **no dark-mode classes today** (seen in P1.1), so the rebuild must add them (AGENTS.md §4.9).
  - **Dispatch:** `DzshipClient` reads `credentials` as-is (no more per-courier mapping), which fixes K8.
  - **Uniqueness:** a new constraint `(tenant, courier)` once the data migration has filled `courier`.
  - **Test connection** button: calls the read connector's `test_credentials()` (P1.5) and reports OK / refused / unreachable.
- **Tests:** migration mapping for each old provider (synthetic rows), secrets never in responses, wrong credential names refused, cashier → 403.

### Group C: Read connectors

#### P1.5 Connector contract (**done 2026-11-17**, uncommitted)
- **Built as:** package `services/couriers/`:
  - `vocabulary.py`: `ShipmentStatus` (DL.6), `TERMINAL_STATUSES`, `CashStatus` (DL.7).
  - `base.py`:
    - errors: `ConnectorAuthError` 401, `ConnectorForbidden` 403, `ConnectorNotFound` 404, `ConnectorRateLimited` 429 (with `Retry-After`, capped at 1 h), `ConnectorUnavailable` (timeout, network, 5xx), `ConnectorError`, `ConnectorNotSupported(reason)`;
    - shapes: `ParcelSnapshot`, `TrackingEvent`, `ParcelPage`, `Payout`, `PayoutLine`, `Balance`;
    - parsing helpers `to_decimal` / `to_datetime` (naive = Africa/Algiers) / `to_date`;
    - `CourierReadConnector` with one `_request` (https only, 20 s timeout, no credentials or query values in logs).
  - `registry.py`: `@register` by platform; `get_connector(config)` with reasons `unknown_courier` / `no_connector` / `no_base_url`. Base URL order: store `base_url` → connector `BASE_URL_OVERRIDE` → catalogue endpoint.
- **Added beyond the spec:**
  - `balance()`, `list_payouts()` and `payout_lines()` are in the contract (the Maystro probe showed they exist; P1.7 implements them).
  - An absolute "next page" link from a courier is followed **only on the courier's own host**, since the store's credentials travel with every request.
  - `ParcelSnapshot.store_amount` (what the courier owes the store per parcel) and `updated_at` (the sync cursor).
- **Tests:** `tests/test_courier_connectors.py` (33).
- **Change:** `services/couriers/base.py`:
  - **`CourierReadConnector`:** built from a `ProviderConfig` and the catalogue entry (endpoint). Declares `capabilities` (`list`, `get`, `history`, `cash_status`, `test`) and implements `test_credentials()`, `list_parcels(page_cursor)`, `get_parcel(ref)` and `history(ref)`.
  - **`ParcelSnapshot`** dataclass:
    - identity: `external_id`, `tracking`, `reference`;
    - recipient snapshot: name, phone, wilaya code, commune;
    - money: `cod_amount` and `delivery_fee` (Decimal or None);
    - status: `status`, `raw_status`, `status_at`;
    - cash: `cash_status`, `cash_raw`;
    - `events`.
  - **Registry:** keyed by catalogue `platform`. A courier whose platform has no connector shows "visibility not yet available for this courier".
  - **Errors:** typed (`ConnectorAuthError`, `ConnectorRateLimited(retry_after)`, `ConnectorUnavailable`, `ConnectorError`). Every call has an explicit timeout. Logs carry no credentials and no customer data.
  - No new dependency: `requests` is already in `requirements-desktop.txt`.
- **Tests:** the registry picks the right connector by platform, an unknown platform reports "not supported", and the error types map correctly.

#### P1.6 Maystro key with order and payment access (owner action, **blocks P1.7's order features**)
- **Done 2026-11-16:** a read-only probe with the store's temporary key (§2). It authenticates (`X-API-KEY`) but may read only the balance, products, pricing and reference data. **Orders, history and payments are refused for API-key access.**
- **Confirmed by the owner 2026-11-17** (screenshot of Maystro's key permission picker). The **complete** list of permissions a key can have: Order Create, Order Update, Order Bulk Create (Excel), Order Slip Get, Exchange Create, External Exchange Create, Refund Create/Get/Update, Product Create/Update/List, Product Stock Get, Wilaya List, Commune List, Delivery Price List, Delivery Options Get, Pickup Point List, Details of Pricing group for store. **There is no order read, order history, payment or webhook permission today.**
- **Resolved 2026-11-17: the store token works.** The owner supplied the store's 40-character **store token**, sent as `Authorization: Token <token>` (the credential Maystro's older docs describe, and what dzship's catalogue calls Maystro `apiKey`). It reads **everything** on both hosts: `/api/orders/`, `/api/orders/{id}/`, `/api/orders/history-order/{id}/`, `/api/payments/`, `/api/payments/balance/`, `/api/payments/{id}/statement/`, `/api/payments/statement/`, and the old `/api/stores/orders/`.
  - Probe findings (counts and shapes only, no values printed):
    - `/api/orders/?ordering=-updated_at` really returns the newest changes first, so the sync stops at the first already-seen `updated_at`. The detail view adds only `qr_code`.
    - **COD collected = `total_price`.** It equals `product_price + price` on 192 of 200 orders; on the other 8 it equals `product_price`. Corrected 2026-11-17 (P1.7 live check): these are **zero-value orders** (`total_price` = `product_price` = 0, e.g. exchanges), not free shipping. Their cash status is `not_applicable`.
    - **Delivery fee = `price`** (equals the statement's `delivery_price` on 56 of 58). **Amount owed to the store per order = `product_price`** (equals the statement's `amount` on 58 of 58).
    - History: `[{status, created_at, comment, agent}]`.
    - Payout list rows: `{id, payment_date, nb_orders, amount}` (40 payouts on the account). Statement:
      - `delivered_orders[{display_id_order, external_order_id, product_name, delivery_price, amount, description}]`;
      - `exchanges[…]`;
      - `extra_services[{type, type_label, amount, …}]`;
      - the matching `*_total` fields and `total` (checked consistent on 5 statements).
    - `/api/payments/statement/` (no id): same shape, currently empty. Likely the **next payout being prepared**, i.e. the per-order "ready" stage; confirm when it has rows.
    - Balance: `current_balance`, `payable_balance`, `charges{extra_services,total}`, `orders{awaiting_collection, collected_not_payable, payable, total_unpaid}`, `last_payment{…}`.
  - **Per-order cash mapping (DL.7):**
    - not delivered → `awaiting_delivery`;
    - `41` and in no statement → `held_by_courier`;
    - in the current statement → `ready`;
    - in a past statement → `paid`, linked to the payout id;
    - `52`/`50` → `not_applicable`.
  - The account-level counts (`awaiting_collection`, `collected_not_payable`) are shown as a summary, since there is no per-order field for them.
  - **Security:** this token can do anything the store's account can do, including order and bank-account changes. It is stored like any credential (write-only, never logged), and the connector uses **only GET** with it in phase 1.
- **Earlier options (kept for the record):**
  - **(a) Ask Maystro** to add Order List/Get, Order History and Payments permissions to integration keys. This is the clean route, and their "integration v2" is clearly still growing.
  - **(b) File import** (courier-neutral, works today): the manager downloads Maystro's orders export and payment statement from the Maystro web app and drops them into Pointure. Pointure updates shipments and matches payouts. This also covers any future courier that offers exports.
  - **(c) Log in as a dedicated Maystro team member** (JWT via `/api/auth/v2/login/`), which can read orders and payments. Not recommended without Maystro's agreement: Pointure would store a Maystro password, and it relies on their web app's private API.
  - **Webhooks** (`OrderCreated`, `DeliveryStatusChange`, `StorePayment`) are ruled out: no key permission, and they need a public HTTPS URL.
- **Owner action:** in the Maystro web app's API-key settings, check the available **key types and scopes**, and create a key that may read **orders, order history and payments**. If no such type exists, ask Maystro support for API-key access to `/api/orders/`, `/api/orders/history-order/{id}/`, `/api/payments/` and `/api/payments/{id}/statement/`.
- Once such a key exists, re-run the probe. It is a management command `courier_probe` that prints field names, types and counts only, never values or the key. The output decides:
  - `price` vs `product_price` vs `total_price` (which one is the COD);
  - the payout statement shape;
  - the list's stopping rule (`ordering=-updated_at`).
- **Tests (for the command):** the anonymiser never prints string values (synthetic fixture).

#### P1.7 Maystro read connector (**done 2026-11-17**, uncommitted)
- **Built as:**
  - `services/couriers/maystro.py`, registered for platform `maystro`.
  - A store token reads everything (list, get, history, balance, payouts, the payout being prepared). An `ak_` key reads only the balance; other calls raise `ConnectorNotSupported("key_scope")` without any HTTP call.
  - Pages are requested by page number; Maystro's absolute `next` links are never followed.
  - Order and payment ids are checked before they go into URL paths.
  - Status map: all 19 Maystro codes. 53 NOT_RECEIVED → `on_hold`, so it stays visible.
  - Cash per order: 41 → `held_by_courier`; 10/50/51/52/53 or COD ≤ 0 → `not_applicable`; otherwise `awaiting_delivery`. `paid`/`ready` come from payouts in the sync (P1.9).
  - `pending_payout_lines()` was added to the contract (`/payments/statement/`).
- **Test connection:**
  - `POST /deliveries/provider-configs/{id}/test/`: manager or owner, 10/min per user. It always answers 200 with `result` ∈ ok | refused | forbidden | rate_limited | unreachable | not_supported | error, plus `limited` when the credentials cannot read orders.
  - A card button shows the result, in fr/ar/en.
- **Live check (store token, read-only, aggregates only):**
  - Orders: 100 on page 1, no `unknown` status. All fields filled except `reference` (these orders were not created by Pointure). COD = store + fee on 94 of 100; the 6 others are zero-value orders.
  - History comes back sorted.
  - Balance: the four counts are present.
  - Payouts: 40, all dated. The latest has 13 lines against `nb_orders` 12 (most likely one exchange line). The statement being prepared is empty today.
- **Tests:** backend `test_maystro_connector.py` (57); frontend `courierSettings.test.tsx` (+7).
- **Change:**
  - `services/couriers/maystro.py`: base URL `https://backend-web-app.maystro-delivery.com/api`, which **overrides** the catalogue endpoint (the old host).
  - **Auth:** the store token as `Authorization: Token <token>` (full read, P1.6). An `ak_…` integration key is sent as `X-API-KEY` and only reaches the balance.
  - **Payouts:** statements are matched to shipments by `display_id_order` = tracking. COD = `total_price`, fee = `price`, owed to the store = `product_price` (P1.6).
  - **Capabilities are detected, not assumed:** a 403 "not available for API key access" marks that capability **off**, and the UI says "your Maystro key does not allow reading orders/payments" instead of failing.
  - **Available now:** `test_credentials()` and `balance()` (`current_balance`, shown as "money held by Maystro").
  - **Test connection button** (moved here from P1.4): `POST /deliveries/provider-configs/{id}/test/` (manager or owner, throttled) calls `test_credentials()`. The courier card shows OK / refused / unreachable.
  - **When the key allows it:**
    - `list_parcels` (`/api/orders/?ordering=-updated_at&page_size=…`), `get_parcel`, `history`;
    - **`payouts()`**: `/api/payments/` plus each statement, giving per-order `paid` and **automatic payout matching** (DL.7).
  - **Status map:** codes → DL.6 (table in §2; 31 → `out_for_delivery`, 33 → `out_for_delivery` (desk pickup ready), 41 → `delivered`, 52 → `returned`, 50 → `cancelled`, …). Unknown codes → `unknown`, keeping the code as `raw_status`.
  - **Fixtures:** synthetic, shaped like the schema. Never real data (AGENTS.md §4.11).
- **Tests:** each status code, capability off on a 403, balance parsing, pagination end, 401 → `ConnectorAuthError`, 429 → `ConnectorRateLimited`, timeout.

### Group D: Shipments

#### P1.8 `Shipment` and `ShipmentEvent` models (**done 2026-11-17**, uncommitted)
- **Built as specified, plus:**
  - `store_amount`, `courier_updated_at` (sync cursor), and `courier_payout_ref` / `courier_paid_on` for when the courier itself reports a parcel paid. These are added now so P1.9 needs no migration.
  - `Shipment.apply_snapshot(snapshot)` returns the changed field names and does not save, so callers save only on change (each save writes a SyncOutbox row). A courier order snapshot never moves cash back from `paid`/`ready` to `held_by_courier`, but can still set `not_applicable`.
  - `Shipment.merge_events(events)` inserts only events not stored yet.
  - Values are truncated to the column sizes.
  - Deleting a courier account that has shipments is refused with a 400 ("deactivate it instead"), not a 500 from `PROTECT`.
  - Read-only admin (unfold).
- **Migration 0008:** two new tables plus indexes and constraints only. Applied, reversed and re-applied on the P1.4 scratch database.
- **Tests:** `tests/test_shipment_models.py` (15).
- **Change:**
  - **`Shipment(TenantScopedModel)`:**
    - links: `provider_config` (FK, `PROTECT`), `customer_order` (FK, nullable, `SET_NULL`; set when the `reference` matches a Pointure order);
    - identity: `courier` (key), `external_id`, `tracking_number`, `reference`;
    - recipient snapshot: name, phone, wilaya code, commune (all blank);
    - money: `cod_amount` and `delivery_fee` (Decimal, nullable);
    - status: `status`, `raw_status`, `status_at`, `is_terminal`;
    - cash: `cash_status`, `cash_raw`;
    - sync: `last_synced_at`, `created_at`, `updated_at`.
  - Unique `(tenant, courier, external_id)`. Indexes `(tenant, status)` and `(tenant, cash_status)`.
  - `ShipmentEvent(models.Model)`: child, scoped through `shipment__tenant`, unique `(shipment, occurred_at, raw_status)`.
  - Read-only admin. **One migration**, new tables only.
  - Every save writes a `SyncOutbox` row (§4.3), so **save only on change**.
- **Tests:** uniqueness, tenant scoping, no save when nothing changed.

#### P1.9 Event-driven sync (DL.5) (**done 2026-11-17**, uncommitted)
- **Built as:** `services/sync.py`.
  - **Triggering:** `request_sync(config_id, trigger)` returns `started` / `merged` / `blocked` at once. There is one background thread per courier account; triggers during a run are merged into one follow-up run. The thread closes its own DB connection.
  - **Orders, `sync_courier(config)`:**
    - reads newest changes first and stops at `sync_cursor` − 5 min (first run: 90 days back), at most 40 pages;
    - each page is upserted in one short transaction, saving only changed rows;
    - history is fetched only for **existing** shipments whose status changed (max 30 per run); a new shipment's history loads when it is opened;
    - new shipments are linked to a Pointure `CustomerOrder` of the **same store** by tracking number or by our order id (`reference`).
  - **Payouts:**
    - only statements of payouts from `payout_cursor` − 1 day onward are read (first run: 90 days, max 20 statements); their lines set `paid` + `courier_payout_ref` + `courier_paid_on`;
    - the payout being prepared sets `ready`; a `ready` shipment that leaves it unpaid goes back to `held_by_courier`.
  - **Errors** are recorded in `ProviderConfig.last_sync_error`, never raised: `rate_limited` (blocks new runs until `Retry-After`), `auth_refused`, `forbidden`, `unreachable`, `key_scope`, `unknown_courier`/`no_connector`, `partial` (page or statement cap reached), `error`.
  - **Single shipment:** `sync_shipment(shipment)` re-reads one shipment and its full history.
- **Migration 0009:** four sync-state fields on `ProviderConfig` (`sync_cursor`, `payout_cursor`, `last_synced_at`, `last_sync_error`), written with `.update()` so a sync adds no SyncOutbox row for the config.
- **Live check (store token, throwaway DB deleted afterwards, counts only):**
  - First run, 7 s: 2 pages, 186 shipments, 163 marked paid from payout statements, payout cursor 2026-11-16.
  - Second run, 2 s: 1 page, 0 created or changed.
  - Opening one shipment loaded 6 history events.
- **Tests:** `tests/test_shipment_sync.py` (22), including "no Sale / StockMovement / ClientLedger / CashSession row is ever created".
- **Change:** `services/sync.py`.
  - **`request_sync(tenant, provider_config, trigger)`** starts a background thread and returns at once. There is one run at a time per `(tenant, courier)`, and a trigger during a run is merged into it.
  - **`sync_courier(...)`:**
    - Reads pages from the connector **outside any transaction**.
    - Upserts each page in one short `transaction.atomic()`, saving only changed rows.
    - Fetches history only for shipments whose status changed.
    - Stops by the rule P1.6 decides: e.g. "first page entirely unchanged since `last_synced_at`", or a cap of 25 pages per run.
    - Persists `last_synced_at` per `ProviderConfig`.
  - **First run:** limited to the last 90 days of orders.
  - **Failures:** a rate limit stops the run until `Retry-After`. Any error is logged and recorded on the config (`last_sync_error`, which goes in this task's migration), and never raised into a request.
  - **Never** writes `Sale`, `StockMovement`, `ClientLedger`, `CashSession` or loyalty (DL.3).
  - **Tests:**
    - upsert;
    - change detection;
    - stopping rule and page cap;
    - one run at a time per courier;
    - errors recorded, not raised;
    - no rows created in sales, stock or ledger (counts before and after);
    - the trigger returns before the network calls finish.

#### P1.10 Shipments API (**done 2026-11-17**, uncommitted)
- **Built as:** `ShipmentViewSet` (read-only plus two actions) at `/api/v1/deliveries/shipments/`; managers and owners only, feature-gated, plan-gated.
  - **List:** filters `status` / `cash_status` (comma lists, validated), `courier`, and `date_from` / `date_to` (on the courier's last change, validated); `search` on tracking, reference, name, phone and courier id; `ordering`. Default order: newest courier change first.
  - **Detail:** includes `events` (oldest first) and `refreshing`.
  - **`GET summary/`:** per courier, `total`, `by_status{status: n}` and `by_cash{cash_status: {count, cod_amount, store_amount}}` (SQL aggregates, money as 2-decimal strings), for the date/courier filters; plus `accounts[]` with `last_synced_at`, `last_sync_error` and `syncing`.
  - **`POST refresh/[?courier=]`:** 202 with `{"sync": {courier: started | merged | blocked}}`, throttled to 6/min per user.
- **Freshness:**
  - Opening the list starts a background sync for each active account last synced more than 10 min ago that is not already running.
  - Opening a shipment starts a background refresh of it (`sync.request_shipment_refresh`, one at a time) when it is stale or has no history yet.
  - No request waits on a courier.
- **Tests:** `tests/test_shipments_api.py` (23), with threads mocked.
- **Change:** `ShipmentViewSet` (`TenantScopedViewSetMixin` + `DeliveryIntegrationsGuardMixin`, roles per DL.2, `http_method_names = ["get", "post", "head", "options"]`).
  - **List:** filters by status, cash status, courier, date range and search (tracking, reference, name, phone).
  - **Detail:** includes the events.
  - **`summary`:** counts per status, and COD totals per cash status, per courier. Computed with SQL aggregates.
  - **`POST refresh`:** triggers P1.9. Throttled to 6/min per user.
  - Opening the list or a detail also triggers a sync when `last_synced_at` is older than 10 min.
- **Tests:** scoping, filters, exact summary values, cashier → 403, feature off → 404, throttle.

#### P1.11 Shipments page (**done 2026-11-17**, uncommitted)
- **Built as:**
  - `ShipmentsPage.tsx` (container) at `/deliveries/shipments`. Sidebar entry under **Sales** (`managerOnly`, `pro_retail`); help link `/deliveries` → `#livraisons`.
  - Components: `ShipmentSyncBar` (per-account last update, translated sync error, Refresh), `ShipmentSummaryCards` (in progress, to follow up, held, ready, paid, returned; clicking filters the table, money = `store_amount` summed in cents), `ShipmentFiltersBar`, `ShipmentTable`, `ShipmentDrawer` (details, amounts, payout date, history; Escape closes; RTL-aware), `ShipmentBadges`.
  - Data helpers and queries in `shipments.ts`: summary and list re-read every 3 s while a courier syncs; detail every 2 s while `refreshing`.
  - With no active courier, the page links to Settings.
- **Also fixed:** the "Enable delivery integrations" description in Settings → Policies & Mode still mentioned Meta automations (removed in P1.1). Corrected in fr, ar and en.
- **Translations:** `nav.shipments` + 39 `deliveries.*` + nested `shipment_status` (14), `cash_status` (5), `sync_error` (11); key sets identical in all three locales.
- **Manual:** new owner chapter `manual/src/{fr,ar,en}/owner/16-livraisons.md` (`#livraisons`): turning it on, courier accounts, the page, statuses, cash, update messages. Built and validated by `build-manual.mjs`.
- **Tests:** `deliveries/__tests__/shipments.test.tsx` (9): params, tones, label coverage in all three locales, card totals, card selection.
- **Not done:** a visual check in the running desktop app.
- **Change:**
  - New files under `frontend/src/features/deliveries/` and route `/deliveries/shipments`:
    - summary cards: in transit, out for delivery, delivered with the courier holding the cash, paid, returned;
    - table with filters and status/cash badges;
    - detail drawer with the timeline and `raw_status`;
    - "updating…" state, then a re-read when the sync ends;
    - a "visibility not yet available" notice for couriers without a connector.
  - Sidebar entry with `managerOnly: true` and `minPlan: "pro_retail"`.
  - Labels in **all three** locale files; the dzship FR/AR status labels can be reused.
  - Dark mode, `formatDZD()`, the shared `api` instance. No growth of the monolith pages listed in §4.9.
- **Manual:** a new owner chapter in `manual/src/{fr,ar,en}/owner/` (shipments, statuses, what "held by the courier" means, refresh) plus `helpLinks.ts`.
- **Tests:** badge mapping, summary rendering, empty and not-supported states.

### Group E: Agency payouts

#### P1.12 Record a payout picked up at the agency (DL.8) (**done 2026-11-17**, uncommitted; backend only, the screen is P1.13)
- **Built as:** `CourierPayout` model + `services/payouts.py` + `CourierPayoutViewSet` at `/api/v1/deliveries/payouts/` (list, detail with parcels, create, `void/`, `to-record/`); managers and owners only. Migration 0010 adds the table plus `Shipment.payout` / `payout_previous_cash`. `CourierPayout` is in `AUDITED_MODELS`.
- **Differences from the spec above:**
  - **Expected amount = what the courier owes the store** per parcel: `store_amount`, else `cod_amount − delivery_fee`. The spec said `cod_amount`, but the store receives COD minus the fee, so that would always show a false gap.
  - **Eligible parcels:** `held_by_courier`, `ready`, **and** `paid` when the courier reported it paid but no payout records it yet. For Maystro, the sync already marks parcels paid from statements; recording confirms the cash was received.
  - **Parcel sources:** ids, pasted tracking numbers, and/or `courier_payout_ref` (all parcels of one courier payout). All-or-nothing: unknown tracking numbers are returned in `unknown_trackings`, and ineligible or already-recorded parcels in `refused_trackings`.
  - **Attachment** is a conditional UPDATE whose count must match, so a double click rolls back; `payout_previous_cash` is copied from the old value in the same UPDATE.
  - **Void:** a conditional status update (a second void gives 400). Each parcel goes back to its previous cash status, or `paid` when the courier itself reported it paid.
  - A recorded payout pins the parcel's cash status against later courier order updates (`apply_snapshot`).
  - `to-record/` lists, per courier, the courier-reported payouts not recorded yet (`courier_payout_ref`, date, count, expected) plus the parcels still `held_by_courier` / `ready`.
  - `unconfirmed_count` per payout counts parcels the courier has not reported as paid.
- **Tests:** `tests/test_payouts.py` (20), including "no CashSession / CashMovement / Sale / StockMovement / ClientLedger row" and the audit-log row.
- **Change:**
  - **`CourierPayout(TenantScopedModel)`:**
    - `provider_config`, `picked_up_on` (date, default `timezone.localdate()`);
    - `amount_received` (Decimal), `expected_amount` (Decimal, **server-computed**: sum of the selected shipments' `cod_amount`);
    - `difference` (server-computed), `courier_reference` (blank), `notes`;
    - `recorded_by`, `status` ∈ {`recorded`, `voided`}.
  - `Shipment.payout` (FK, nullable).
  - **`POST /deliveries/payouts/`** (manager or owner): a courier, the amount received, and the shipments (by id, or by tracking numbers scanned or pasted from the agency sheet).
  - In one `transaction.atomic()`: refuse shipments that are not `held_by_courier`/`ready` or are already in a payout, attach them, set `cash_status = paid`, and store the computed totals.
  - A double click or a retry cannot attach a shipment twice: re-check after locking, plus a unique attachment.
  - **`POST /deliveries/payouts/{id}/void/`:** detaches its shipments and restores their previous cash status (a complete reversal, §4.4).
  - **Never touches `CashSession`** (DL.3). The difference is shown as "fees and deductions (not detailed)", per DL.9.
  - **Flags:**
    - a shipment the courier reports as paid but not in any recorded payout;
    - a recorded one the courier still reports unpaid.
- **Tests:**
  - exact totals;
  - refusal of already-paid or not-delivered shipments;
  - idempotent double submit;
  - complete void;
  - cashier → 403;
  - tracking-number input, including unknown numbers reported back;
  - no `CashSession`/`CashMovement` rows created.

#### P1.13 Payouts screen (**done 2026-11-17**, uncommitted, branch `feature/delivery-integration`)
- **Backend addition:** `POST /deliveries/payouts/preview/` is a dry run of recording. It shares `_resolve()` with `record_payout`, so the checks and the expected amount are identical, and it writes nothing. Tests: +3 in `test_payouts.py`.
- **Frontend:**
  - `RecordPayoutModal`:
    - pick a courier-reported payout from `to-record/` and/or paste or scan tracking numbers;
    - **Check** calls the preview, and unknown or refused numbers are listed;
    - the counted amount is prefilled with the expected amount, the difference is shown live in cents (green / red / amber), then **Record the payout**;
    - totals are never sent.
  - `PayoutsPanel`: history (date, courier, parcels, expected, received, difference, status, who), expandable parcel list, "not confirmed by the courier" note, void with confirmation.
  - `ShipmentsPage` gains a "Record a payout" button and Shipments / Payouts tabs. 32 new translation keys (fr/ar/en).
- **Manual:** section G "Recording a payout picked up at the agency" added to chapter 16 (fr/ar/en).
- **Tests:** `deliveries/__tests__/payouts.test.tsx` (5), including the record flow with a mocked API (payload checked, no totals sent) and the unknown-number display.

- **Redesign after the owner's review (2026-11-17)**, of a screenshot of the first version in the running app:
  - **Problems:** the window was clipped under the top bar and taller than the screen; every past Maystro payout was shown as a big button; the selection was hard to see; amounts had no currency; too many steps.
  - **Payouts tab (`PayoutsTab`):**
    - **"Maystro payouts to confirm"** (`PayoutsToConfirm`): compact table with **Confirm** per row, which opens a small `ConfirmPayoutModal` (amount counted prefilled, date, reference, note, live difference). Checkboxes plus **Confirm selected** call the new `POST /deliveries/payouts/confirm-courier-payouts/`: each payout is recorded for its expected amount on its payment date, in its own transaction, and failures are reported without undoing successes (+3 backend tests).
    - **Manual entry (agency sheet)** (`ManualPayoutModal`): only the tracking-number paste, check and amount.
    - **History** (`PayoutsPanel`).
  - The header button and `RecordPayoutModal` were removed. The tab shows a badge with the number of payouts to confirm.
  - Amounts show "DZD" (`formatMoney`) on all delivery screens.
  - **Found while building:** the shared `.modal-backdrop` class in `index.css` cannot be compiled (it `@apply`s `backdrop-blur-xs`, which Tailwind 3.4 does not have). It never failed before because no file used it. The new windows use inline classes like `ManagerPinModal`; the shared class is left as is (follow-up: fix or remove it).

### Phase 1 status (2026-11-17)
All tasks P1.1–P1.13 are done. Not done: a visual check in the running desktop app, and the release checklist below (copy of the pilot DB, test PC, prerelease).
- **Change:**
  - A "Record agency payout" modal from the Shipments page. It is pre-filled with the courier's `held_by_courier`/`ready` shipments, and has a scan/paste box for the agency sheet's tracking numbers and the amount field. It shows expected, received and difference before confirming.
  - A payouts history list with void.
  - Three locales, dark mode. Manual section in the same chapter.
- **Tests:** the totals preview matches the server, and validation messages show.

---

## Phase 2: Create parcels from Pointure (outline; detailed plan after phase 1)

- **K2 decision first (DL.11):** when a delivery order becomes a sale, how stock is reserved, shipped and returned, and how a `returned` shipment reverses it.
- **Dispatch rebuilt on dzship** with `ProviderConfig.credentials`:
  - commune names matched to dzship's `/v1/communes` spelling (cached);
  - a stop-desk picker from `/v1/desks` (cached per courier and wilaya for a day);
  - fee quote from `/v1/rates`;
  - `reference` = our order id;
  - the result becomes a `Shipment` right away, followed by a sync.
- **Cancel and labels** through the read connectors' platforms (dzship documents no route for them), as connector capabilities.

## Phase 3: More read connectors (one task each, each needs a real merchant account to verify)

- Yalidine family (6 couriers): `payment_status` and `payment_id` give `ready`/`paid` directly.
- Ecotrack family (83): one connector, with the endpoint from the catalogue.
- ZR Express new platform: treasury endpoints, so payouts can be matched automatically.
- NOEST: payout steps from the history.

Each task starts with the same probe as P1.6.

---

## Out of scope for phase 1
- Creating, cancelling or labelling parcels through the new connectors; webhooks; any cloud component.
- Any write to sales, stock, client ledger, cash sessions or loyalty.
- Delivery and return fee accounting (DL.9).

## Suggested order
P1.1 → P1.2 → P1.3 → P1.4 → P1.5 → **P1.6 (owner runs the probe)** → P1.7 → P1.8 → P1.9 → P1.10 → P1.11 → P1.12 → P1.13. Stop for review after each task.

## Release checklist
1. Run the full suite and the checks in AGENTS.md §2.1. Apply the migrations on a **copy** of the pilot database (the P1.4 data migration must keep the Maystro key working).
2. On a test PC with the store's key: Test connection → sync → compare 10 orders with the Maystro app → record one payout → void it.
3. Ship as a prerelease. Manual chapter in three languages.

## Owner answers and open items
1. ~~External order intake~~ **Keep dormant** *(owner, 2026-11-16)*.
2. ~~Maystro visibility (P1.6)~~ **Resolved 2026-11-17:** the store token reads orders, history, payouts and balance. The file import (option b) is no longer needed for Maystro; keep it in mind for couriers without a read API.
3. ~~`google-generativeai`~~ **Remove** *(owner, 2026-11-16)*: done in P1.1.
4. **Phase 2:** may we test, through dzship, whether it accepts an `ak_` key for order creation? That sends the key to DZBuild.
