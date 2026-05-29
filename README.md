# 👟 ShoeDZ / Pointure

> Multi-tenant ERP for Algerian shoe retailers — inventory, sales, invoicing, reporting, and supplier management in one web dashboard.

**Stack:** Django 5 · PostgreSQL 16 · Celery/Redis · React 18 · TypeScript · Tailwind CSS (RTL) · i18next (AR/FR/EN)

---

## Features

| Module | Highlights |
|---|---|
| **Dashboard** | Daily revenue KPI, outstanding debt, low-stock alert, cheque due count, 30-day revenue chart, top 5 sellers |
| **Sales POS** | Cart-based POS, multiple payment methods (cash, CCP, virement, chèque), receipt lookup |
| **Invoicing** | Draft → Sent → Paid workflow, TVA toggle (19%), per-line discounts, credit limit enforcement, PDF generation |
| **Delivery notes** | Linked to invoices, PDF export |
| **Credit notes** | Client credit, linked to original invoice |
| **Inventory** | Products + variants (EU size, colour, barcode), stock levels per branch, adjustments, transfers |
| **Low stock** | Real-time alert list for SKUs below their alert threshold |
| **Barcode labels** | PDF label sheets with CODE-128C barcodes, generated via WeasyPrint |
| **Clients** | Ledger, balance, payment recording, cheque tracking (deposited/bounced) |
| **Debt ageing** | Per-client bucket breakdown (current / 30 / 60 / 90+ days), CSV export |
| **Suppliers** | Balance, payment recording, purchase orders (draft → sent → received) |
| **Reports** | Daily report (CSV/print), sales analytics with P&L margins, stock report (CSV + PDF), all with branch filter |
| **Multi-branch** | Branch selector in topbar; sales and reports filtered per branch |
| **Settings** | Tenant configuration, user management with RBAC (Owner / Manager / Cashier), audit log |
| **Password reset** | Email-based reset flow via Celery |
| **First-run wizard** | Browser setup wizard creates tenant + first admin on self-hosted installs |
| **Licensing** | Offline-tolerant license validation with 7-day grace period and Celery heartbeat |

---

## Deployment options

### A) Self-hosted (one command)

For clients who run the app on their own machine or server.

```bash
curl -sSL https://raw.githubusercontent.com/averroes96/pointure/main/install.sh | bash
```

The script:
1. Checks Docker + Docker Compose v2 prerequisites
2. Generates `.env.local` with random secrets (asks for license key + public URL)
3. Builds and starts all containers
4. Runs migrations and collects static files
5. Activates the license key against the license server
6. Optionally creates a Django admin superuser
7. Prints the URL — visit `http://localhost/setup` to finish in the browser

**Requirements:** Docker Desktop (Mac/Windows) or Docker Engine + Compose v2 (Linux). No other dependencies needed.

```bash
# Stop
docker compose -f docker-compose.local.yml down

# Logs
docker compose -f docker-compose.local.yml logs -f

# Upgrade (re-run after pulling new image)
docker compose -f docker-compose.local.yml pull && docker compose -f docker-compose.local.yml up -d
docker compose -f docker-compose.local.yml exec -T backend python manage.py migrate
```

**License management:**
```bash
# Activate / re-activate
docker compose -f docker-compose.local.yml exec backend python manage.py activate_license SHDZ-XXXX-XXXX-XXXX

# Check status
docker compose -f docker-compose.local.yml exec backend python manage.py shell -c \
  "from apps.licensing.models import LicenseState; print(LicenseState.load())"
```

### B) SaaS / Cloud deployment

Multi-tenant cloud hosting (one instance serves all tenants).

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
├── frontend/                   # React 18 + TypeScript
│   ├── src/
│   │   ├── features/           # One folder per domain (auth, inventory, sales, …)
│   │   ├── components/         # Shared UI (layout, modals, plan gates)
│   │   ├── lib/                # api.ts (axios), csvExport.ts, utils.ts
│   │   └── types/              # Shared TypeScript interfaces
│   ├── Dockerfile.prod         # Multi-stage build → nginx:alpine
│   └── nginx.spa.conf
│
├── nginx/
│   ├── nginx.conf              # Production (SSL, HTTP→HTTPS redirect)
│   └── nginx.local.conf        # Self-hosted (HTTP only, loopback bind)
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
