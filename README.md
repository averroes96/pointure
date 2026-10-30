# 👟 ShoeDZ / Pointure

> Comprehensive retail & wholesale ERP designed specifically for Algerian shoe stores — available as a **standalone Windows desktop application**, a **self-hosted Docker suite**, or a **multi-tenant cloud platform**.

**Desktop Stack:** Electron 32 · Embedded Python (Waitress WSGI + Django 5) · SQLite / PostgreSQL · Chromium PDF Bridge · React 18 · TypeScript · Tailwind CSS (RTL/LTR) · i18next (AR/FR/EN)

---

## Features

| Module | Highlights |
|---|---|
| **Windows Desktop App** | Standalone `.exe` installer (NSIS), embedded Python backend, local SQLite database, zero Docker or cloud dependency, automatic GitHub releases updates, low-spec (4GB RAM) hardware optimization. |
| **Hardware & Thermal Printing** | Direct ESC/POS silent ticket printing (58mm & 80mm), A4 invoices/delivery notes, barcode label printer spooler (CODE-128C with size presets), in-app test prints. |
| **Keyboard Shortcuts & Kiosk** | Full Windows cashier hotkeys (`F1` new sale, `F2` scan/search, `F10` / `.` cash out, `F11` fullscreen kiosk, `F12` shortcuts guide, `Alt+V` versement, `Alt+M` cash movement). |
| **Automated Local Backups** | Daily local database rotation, snapshot retention (configurable max copies), one-click download/restore, open backups folder in Windows Explorer. |
| **Clock Guard & Offline License** | Monotonic high-water mark tamper defense protecting offline licensing and sales against CMOS battery failure; one-click Windows Time sync (`w32tm /resync`). |
| **Legacy DBF & Excel Import** | One-click FoxPro / DBase (`.DBF`) migration for shoe stores (`FOURNIS.DBF`, `CLIENTS.DBF`, `ARTICLES.DBF`) with Simple Mode vs Extended Sizes, plus bulk Excel/CSV import wizard. |
| **Dark, Light & Auto Themes** | High-contrast dark mode tailored for long cashier shifts, synchronized automatically with Windows system theme preference. |
| **Dashboard** | Daily revenue KPI, outstanding debt, low-stock alert, cheque due count, 30-day revenue chart, top 5 sellers. |
| **Sales POS** | Cart-based POS, multi-payment (cash, CCP, bank transfer, cheque), cashier shift reconciliation (X/Z reports), customer layaway / versement. |
| **Invoicing & Documents** | Draft → Sent → Paid workflow, TVA toggle (19%), per-line discounts, credit limit enforcement, PDF generation, Delivery Notes (BL) and Credit Notes (Avoirs). |
| **Inventory & Matrix** | Products + variants (EU shoe sizes, colours, barcodes), stock per branch, stocktakes (inventaire tournant), stock movements, branch transfers. |
| **Low stock & Alerts** | Real-time threshold alerts, quick restock modal, carton calculation. |
| **Clients & Cheques** | Ledger, balance, payment recording, cheque tracking (pending, deposited, bounced) with due-date countdowns. |
| **Debt Ageing** | Per-client bucket breakdown (current / 30 / 60 / 90+ days), CSV export. |
| **Suppliers & Purchasing** | Supplier balance, purchase orders (draft → sent → received), carton packing calculators, payables overview. |
| **Reports & Analytics** | Daily report (print/CSV), sales analytics with P&L gross margins, stock valuation reports, custom Report Builder. |
| **Loyalty Program** | Bronze, Silver, Gold tiers with multiplier rules, point redemption at POS, printable loyalty cards, top-20 leaderboard. |
| **Multi-branch & RBAC** | Multi-branch selector; roles: Owner, Manager, Cashier with granular permission controls and supervisor PIN overrides. |

---

## Deployment Options

### A) Windows Desktop Application (Recommended for Retail Stores)

The standalone Windows desktop installer is the fastest and easiest way to run ShoeDZ in physical boutiques. It requires **no Docker, no command-line tools, and no internet connection** to operate.

1. Download the latest installer: `ShoeDZ-Setup-x.x.x.exe` from GitHub Releases.
2. Run the installer (administrator privileges requested automatically).
3. The installer creates shortcuts on the Desktop and Start Menu, pre-configures data directories at `%ProgramData%\ShoeDZ`, and sets up Windows user permissions.
4. Launch **ShoeDZ** from the desktop shortcut. On first launch, the app automatically initializes the database, loads the 58 Algerian Wilayas, and creates the primary headquarters store branch.

**Building the Desktop Installer from Source:**
```bash
# 1. Build the production React frontend
cd frontend
npm install
npm run build
cd ..

# 2. Package the Electron Windows installer
cd desktop
npm install
npm run build
# The resulting installer is generated in desktop/dist/ShoeDZ-Setup-1.x.x-x64.exe
```

---

### B) Self-Hosted Docker (One Command)

For servers, central back-offices, or multi-terminal networked setups:

```bash
curl -sSL https://raw.githubusercontent.com/averroes96/pointure/main/install.sh | bash
```

The script:
1. Checks Docker + Docker Compose v2 prerequisites
2. Generates `.env.local` with random secrets
3. Builds and starts all containers (PostgreSQL 16, Redis, Gunicorn, Celery, Nginx)
4. Runs migrations and collects static files
5. Activates the license key against the license server
6. Prints the URL — visit `http://localhost/setup` to finish in the browser

```bash
# Stop
docker compose -f docker-compose.local.yml down

# Logs
docker compose -f docker-compose.local.yml logs -f

# Upgrade
docker compose -f docker-compose.local.yml pull && docker compose -f docker-compose.local.yml up -d
docker compose -f docker-compose.local.yml exec -T backend python manage.py migrate
```

---

### C) SaaS / Cloud Deployment

Multi-tenant cloud hosting (one instance serves multiple tenant organizations):

```bash
cp .env.prod.example .env.prod
# Edit .env.prod — fill DATABASE_URL, REDIS_URL, SECRET_KEY, ALLOWED_HOSTS, …
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml exec backend python manage.py migrate
docker compose -f docker-compose.prod.yml exec backend python manage.py collectstatic --noinput
```

Nginx config at `nginx/nginx.conf` handles SSL termination and static/media serving. Point your DNS to the server and set `ALLOWED_HOSTS` accordingly.

---

## Development setup

### Prerequisites

- Docker Desktop (or Docker Engine + Compose v2)
- `make` (optional but recommended)

```bash
# First-time bootstrap
make setup

# Start all services (hot-reload on both frontend and backend)
make dev
```

| URL | Service |
|---|---|
| http://localhost:5173 | React frontend (Vite dev server) |
| http://localhost:8000/api/v1/docs/ | DRF Swagger / ReDoc |
| http://localhost:8000/admin/ | Django admin |

Demo credentials created by `make setup`: `admin@shodz.dz` / *(set during `createsuperuser`)*

### Makefile reference

| Command | What it does |
|---|---|
| `make setup` | Build images, migrate, collect static, create superuser, seed demo data |
| `make dev` | Start all services with live reload |
| `make dev-bg` | Start all services in background |
| `make stop` | `docker compose down` |
| `make migrate` | Run pending migrations |
| `make migrations app=<app>` | `makemigrations` for a specific app |
| `make test` | Full pytest suite with coverage |
| `make test-fast` | pytest without coverage (faster) |
| `make test-app app=<app>` | Tests for a single Django app |
| `make shell` | Django shell |
| `make seed` | Re-seed demo data |
| `make logs` | Follow all container logs |
| `make build` | Rebuild images |
| `make clean` | Remove volumes and containers |

---

## Project structure

```
pointure/
├── backend/                    # Django 5 monolith
│   ├── apps/
│   │   ├── core/               # Tenants, users, branches, RBAC, audit log
│   │   ├── inventory/          # Products, variants, stock movements, transfers
│   │   ├── sales/              # Sales, payments, receipts
│   │   ├── invoicing/          # Invoices, delivery notes, credit notes
│   │   ├── clients/            # Client ledger, cheques, debt ageing
│   │   ├── suppliers/          # Suppliers, purchase orders
│   │   ├── reports/            # Dashboard, analytics, stock report
│   │   └── licensing/          # Offline-tolerant license validation
│   ├── config/
│   │   ├── settings/
│   │   │   ├── base.py         # Shared settings
│   │   │   ├── local.py        # Self-hosted overrides (DEPLOYMENT_MODE=local)
│   │   │   └── production.py   # SaaS/cloud settings
│   │   └── urls.py
│   └── Dockerfile
│
├── desktop/                    # Windows Electron standalone wrapper
│   ├── main.js                 # Electron main process & supervisor
│   ├── preload.js              # IPC bridge (printing, updates, clock)
│   ├── installer.nsh           # NSIS installer & permission script
│   ├── pdf-bridge.js           # Headless Chromium PDF renderer
│   ├── splash.html             # Boot splash with live migration feedback
│   └── package.json            # electron-builder packaging config
│
├── frontend/                   # React 18 + TypeScript (Vite)
│   ├── src/
│   │   ├── features/           # Domain modules (sales, inventory, clients, ...)
│   │   ├── components/         # Shared UI, layout, modals, import wizard
│   │   ├── lib/                # api.ts, printerConfig.ts, time.ts, utils.ts
│   │   └── types/              # TypeScript definitions
│   ├── Dockerfile.prod         # Multi-stage build → nginx:alpine
│   └── nginx.spa.conf
│
├── nginx/
│   ├── nginx.conf              # Production (SSL, HTTP→HTTPS redirect)
│   └── nginx.local.conf        # Self-hosted (HTTP only, loopback bind)
│
├── manual/                     # Comprehensive User Manuals (HTML)
│   ├── fr.html                 # Manuel utilisateur en français
│   ├── ar.html                 # دليل المستخدم باللغة العربية
│   └── en.html                 # User manual in English
│
├── license-server/             # Separate Django app (SQLite) for key validation
│
├── docker-compose.yml          # Development
├── docker-compose.local.yml    # Self-hosted production
├── docker-compose.prod.yml     # SaaS/cloud production
├── install.sh                  # One-command self-hosted installer
└── Makefile
```

---

## Architecture

### 1. Windows Desktop Architecture (Standalone)

```
┌────────────────────────────────────────────────────────┐
│                   Electron 32 Window                   │
│   (React 18 SPA + POS Hotkeys + Hardware Print Spool)  │
└───────────────▲────────────────────────▲───────────────┘
                │                        │
       IPC (preload.js)          HTTP (127.0.0.1:8745)
                │                        │
┌───────────────▼─────────┐    ┌─────────▼───────────────┐
│   Electron Main Process │    │    Embedded Waitress    │
│  - Chromium PDF Bridge  │    │     (Django 5 Monolith) │
│  - ESC/POS Print Spool  │    │  - SQLite Engine        │
│  - Auto-Updater         │    │  - DBF / Excel Importer │
│  - Anti-Tamper Guard    │    │  - Local Backups Engine │
└─────────────────────────┘    └─────────────────────────┘
```

### 2. Docker & Cloud Architecture (Client / Server)

```
Browser
  │
  ▼
Nginx (reverse proxy)
  ├─► /api/v1/  ──► Gunicorn (Django)
  │                   ├─ apps/* (DRF ViewSets)
  │                   ├─ WeasyPrint (PDF generation)
  │                   └─ Celery tasks (email, PDF, license heartbeat)
  │                          │
  │                        Redis (broker + cache)
  │                          │
  │                        Celery worker + Beat
  │
  └─► /*        ──► React SPA (served as static files)

PostgreSQL (tenant data)
SQLite (license server — separate service)
```

### Multi-tenancy

Each client organisation is a `Tenant` record. All models carry a `tenant` FK. `TenantScopedViewSetMixin` enforces it on every query — cross-tenant data leakage is structurally impossible.

### Plan gating

Three plans: `free`, `pro_retail`, `pro_wholesale`. Features gate on `PlanRequired("pro_retail")()` permission class. The frontend mirrors this with `<PlanGate min="pro_retail">`.

### Licensing (self-hosted)

A `LicenseState` singleton is stored in the database. A Celery Beat task runs every 30 minutes to phone home to the license server. If the server is unreachable, a 7-day grace period applies before the app goes read-only.

---

## Environment variables

See `.env.local.example` (self-hosted) or `.env.prod.example` (cloud) for the full list.

Key variables:

| Variable | Description |
|---|---|
| `SECRET_KEY` | Django secret key (generate with `python -c "import secrets; print(secrets.token_hex(50))"`) |
| `DATABASE_URL` | `postgres://user:pass@host/db` |
| `REDIS_URL` | `redis://:pass@host:6379/0` |
| `DEPLOYMENT_MODE` | `local` (self-hosted) or `saas` (cloud) |
| `LICENSE_KEY` | `SHDZ-XXXX-XXXX-XXXX` |
| `LICENSE_SERVER_URL` | URL of the license validation server |
| `FRONTEND_URL` | Public URL used in password-reset emails |
| `ALLOWED_HOSTS` | Comma-separated list of allowed hosts |
| `EMAIL_*` | SMTP settings for transactional email |

---

## Tests

```bash
# Backend (pytest + coverage)
make test

# Frontend (vitest)
cd frontend && npm run test
```

Backend test coverage: tenant isolation, plan gating, sales workflow, invoicing RBAC, credit limits, P&L calculations, supplier balance, report accuracy.

---

## License

Proprietary — ShoeDZ. All rights reserved.  
Self-hosted use requires a valid license key (`SHDZ-XXXX-XXXX-XXXX`).
