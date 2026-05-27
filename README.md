# 👟 ShoeDZ — Shoe Retail & Wholesale Management Platform

> Web-first SaaS dashboard for Algerian shoe stores. Django + React.

## Quick Start

```bash
# Bootstrap (builds Docker, migrates DB, seeds demo data)
make setup

# Start all services
make dev
```

- **Frontend**: http://localhost:5173  
- **API Docs**: http://localhost:8000/api/v1/docs/  
- **Django Admin**: http://localhost:8000/admin/  
- **Demo login**: `admin@demo.com` / `demo1234`

## Structure

```
backend/    # Django 5 + DRF + Celery + WeasyPrint (PDF)
frontend/   # React 18 + TypeScript + Tailwind (RTL)
```

## Key Commands

| Command | Description |
|---------|-------------|
| `make setup` | First-time bootstrap |
| `make dev` | Start all services |
| `make test` | Run test suite |
| `make seed` | Reseed demo data |
| `make shell` | Django shell |

## Stack: Django 5 · PostgreSQL 16 · Celery/Redis · React 18 · Tailwind (RTL) · i18next (AR/FR/EN)
