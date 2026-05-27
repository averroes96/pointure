.PHONY: setup dev stop migrate test shell frontend lint seed build logs ps clean

# ──────────────────────────────────────────────
# Bootstrap
# ──────────────────────────────────────────────

setup: ## Build containers, run migrations, create superuser, seed demo data
	docker compose build
	docker compose up -d db redis
	sleep 3
	docker compose run --rm backend python manage.py migrate
	docker compose run --rm backend python manage.py collectstatic --no-input
	docker compose run --rm backend python manage.py createsuperuser --noinput \
		--email admin@shodz.dz || true
	docker compose run --rm backend python manage.py seed_demo
	@echo "\n✅  Setup complete! Run 'make dev' to start all services."

# ──────────────────────────────────────────────
# Development
# ──────────────────────────────────────────────

dev: ## Start all services in foreground (Ctrl+C to stop)
	docker compose up

dev-bg: ## Start all services in background
	docker compose up -d

stop: ## Stop all services
	docker compose down

restart: ## Restart backend only
	docker compose restart backend celery celery-beat

# ──────────────────────────────────────────────
# Database
# ──────────────────────────────────────────────

migrate: ## Run Django migrations
	docker compose run --rm backend python manage.py migrate

migrations: ## Create new migrations (pass app=<app_name> for specific app)
	docker compose run --rm backend python manage.py makemigrations $(app)

showmigrations: ## Show migration status
	docker compose run --rm backend python manage.py showmigrations

# ──────────────────────────────────────────────
# Testing
# ──────────────────────────────────────────────

test: ## Run full test suite with coverage
	docker compose run --rm backend pytest --cov=apps --cov-report=term-missing --cov-report=html -v

test-fast: ## Run tests without coverage (faster)
	docker compose run --rm backend pytest -v -x

test-app: ## Run tests for specific app (make test-app app=core)
	docker compose run --rm backend pytest apps/$(app)/ -v

# ──────────────────────────────────────────────
# Shells & Debug
# ──────────────────────────────────────────────

shell: ## Django shell_plus
	docker compose run --rm backend python manage.py shell_plus

shell-db: ## Connect to PostgreSQL
	docker compose exec db psql -U shodz -d shodz

shell-redis: ## Connect to Redis CLI
	docker compose exec redis redis-cli

bash: ## Bash into backend container
	docker compose exec backend bash

# ──────────────────────────────────────────────
# Frontend
# ──────────────────────────────────────────────

frontend: ## Start frontend dev server only
	cd frontend && npm run dev

frontend-install: ## Install frontend dependencies
	cd frontend && npm install

frontend-build: ## Build frontend for production
	cd frontend && npm run build

frontend-lint: ## Lint frontend code
	cd frontend && npm run lint

frontend-typecheck: ## TypeScript type check
	cd frontend && npm run typecheck

# ──────────────────────────────────────────────
# Code Quality
# ──────────────────────────────────────────────

lint: ## Run all linters (backend + frontend)
	docker compose run --rm backend ruff check apps/ config/
	docker compose run --rm backend mypy apps/ config/
	cd frontend && npm run lint

format: ## Auto-format backend code
	docker compose run --rm backend ruff format apps/ config/

# ──────────────────────────────────────────────
# Seed & Fixtures
# ──────────────────────────────────────────────

seed: ## Load demo data
	docker compose run --rm backend python manage.py seed_demo

seed-reset: ## Reset DB and reseed
	docker compose run --rm backend python manage.py flush --no-input
	docker compose run --rm backend python manage.py migrate
	docker compose run --rm backend python manage.py seed_demo

# ──────────────────────────────────────────────
# Production
# ──────────────────────────────────────────────

build-prod: ## Build production images
	docker compose -f docker-compose.prod.yml build

deploy: ## Deploy to production (ensure .env.prod exists)
	docker compose -f docker-compose.prod.yml pull
	docker compose -f docker-compose.prod.yml up -d --remove-orphans
	docker compose -f docker-compose.prod.yml run --rm backend python manage.py migrate
	docker compose -f docker-compose.prod.yml run --rm backend python manage.py collectstatic --no-input

# ──────────────────────────────────────────────
# Utilities
# ──────────────────────────────────────────────

logs: ## Tail logs (make logs service=backend)
	docker compose logs -f $(service)

ps: ## Show running containers
	docker compose ps

clean: ## Remove containers, volumes, and orphans
	docker compose down -v --remove-orphans

openapi: ## Generate OpenAPI schema
	docker compose run --rm backend python manage.py spectacular --color --file schema.yml

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'
