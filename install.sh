#!/usr/bin/env bash
# ── ShoeDZ / Pointure — Self-Hosted Installer ───────────────────────────────
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/averroes96/pointure/main/install.sh | bash
#   — or —
#   chmod +x install.sh && ./install.sh
#
# What this script does:
#   1. Checks prerequisites (Docker, Docker Compose v2, git)
#   2. Creates .env.local with auto-generated secrets
#   3. Builds and starts all containers
#   4. Runs database migrations
#   5. Prompts to create a Django superuser
#   6. Prints the URL and next steps

set -euo pipefail

# ── Colour helpers ───────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERR]${NC}  $*" >&2; exit 1; }

COMPOSE_FILE="docker-compose.local.yml"
ENV_FILE=".env.local"

# ── Banner ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║          ShoeDZ / Pointure — Self-Hosted Setup       ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Prerequisites ─────────────────────────────────────────────────────────
info "Checking prerequisites…"

command -v docker  >/dev/null 2>&1 || error "Docker is not installed. Install it from https://docs.docker.com/get-docker/"
command -v git     >/dev/null 2>&1 || error "Git is not installed."

# Docker Compose v2 (docker compose) is required
if ! docker compose version >/dev/null 2>&1; then
    error "Docker Compose v2 is required. Install it from https://docs.docker.com/compose/install/"
fi

# Check Docker daemon is running
docker info >/dev/null 2>&1 || error "Docker daemon is not running. Start it and try again."

success "All prerequisites satisfied."

# ── 2. Environment file ──────────────────────────────────────────────────────
if [[ -f "$ENV_FILE" ]]; then
    warn ".env.local already exists — skipping generation. Edit it manually if needed."
else
    info "Generating $ENV_FILE with random secrets…"

    # Generate secrets using Python (available in most Linux distros)
    SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(50))")
    DB_PASSWORD=$(python3 -c "import secrets; print(secrets.token_hex(16))")
    REDIS_PASSWORD=$(python3 -c "import secrets; print(secrets.token_hex(16))")

    # Prompt for license key
    echo ""
    echo -e "${YELLOW}Enter your ShoeDZ license key (format: SHDZ-XXXX-XXXX-XXXX):${NC}"
    read -r -p "License key: " LICENSE_KEY
    echo ""

    sed \
        -e "s|change-me-generate-with-python-secrets-token-hex-50|${SECRET_KEY}|g" \
        -e "s|change-me-strong-password|${DB_PASSWORD}|g" \
        -e "s|change-me-redis-password|${REDIS_PASSWORD}|g" \
        -e "s|DATABASE_URL=postgres://shodz:${DB_PASSWORD}@db:5432/shodz|DATABASE_URL=postgres://shodz:${DB_PASSWORD}@db:5432/shodz|g" \
        -e "s|REDIS_URL=redis://:change-me-redis-password@redis:6379/0|REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0|g" \
        -e "s|SHDZ-XXXX-XXXX-XXXX|${LICENSE_KEY}|g" \
        .env.local.example > "$ENV_FILE"

    # Fix DATABASE_URL and REDIS_URL with the actual generated passwords
    sed -i "s|DATABASE_URL=postgres://shodz:.*@db|DATABASE_URL=postgres://shodz:${DB_PASSWORD}@db|g" "$ENV_FILE"
    sed -i "s|REDIS_URL=redis://:.*@redis|REDIS_URL=redis://:${REDIS_PASSWORD}@redis|g" "$ENV_FILE"

    success "$ENV_FILE created."
fi

# ── 3. Build and start containers ────────────────────────────────────────────
info "Building Docker images (this may take a few minutes on first run)…"
docker compose -f "$COMPOSE_FILE" pull --quiet db redis nginx 2>/dev/null || true
docker compose -f "$COMPOSE_FILE" build --quiet

info "Starting services…"
docker compose -f "$COMPOSE_FILE" up -d

# Wait for the database to be ready
info "Waiting for the database to be ready…"
MAX_WAIT=60
WAITED=0
until docker compose -f "$COMPOSE_FILE" exec -T db pg_isready -U "${DB_USER:-shodz}" >/dev/null 2>&1; do
    if [[ $WAITED -ge $MAX_WAIT ]]; then
        error "Database did not become ready within ${MAX_WAIT}s. Check logs: docker compose -f $COMPOSE_FILE logs db"
    fi
    sleep 2
    WAITED=$((WAITED + 2))
done
success "Database is ready."

# ── 4. Migrations & static files ─────────────────────────────────────────────
info "Running database migrations…"
docker compose -f "$COMPOSE_FILE" exec -T backend python manage.py migrate --noinput

info "Collecting static files…"
docker compose -f "$COMPOSE_FILE" exec -T backend python manage.py collectstatic --noinput --clear >/dev/null

success "Migrations and static files done."

# ── 5. License activation ─────────────────────────────────────────────────────
LICENSE_KEY_IN_ENV=$(grep '^LICENSE_KEY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"')
if [[ -n "$LICENSE_KEY_IN_ENV" && "$LICENSE_KEY_IN_ENV" != "SHDZ-XXXX-XXXX-XXXX" ]]; then
    info "Activating license key…"
    if docker compose -f "$COMPOSE_FILE" exec -T backend python manage.py activate_license "$LICENSE_KEY_IN_ENV"; then
        success "License activated."
    else
        warn "License activation failed. Run manually: docker compose -f $COMPOSE_FILE exec backend python manage.py activate_license <YOUR-KEY>"
    fi
else
    warn "No license key set. Run: docker compose -f $COMPOSE_FILE exec backend python manage.py activate_license <YOUR-KEY>"
fi

# ── 6. Superuser ─────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Would you like to create an admin superuser now? [y/N]${NC}"
read -r -p "" CREATE_SUPER
if [[ "${CREATE_SUPER,,}" == "y" ]]; then
    docker compose -f "$COMPOSE_FILE" exec backend python manage.py createsuperuser
fi

# ── 7. Done ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✓  ShoeDZ is running!                               ║${NC}"
echo -e "${GREEN}║                                                      ║${NC}"
echo -e "${GREEN}║  App   : http://localhost                            ║${NC}"
echo -e "${GREEN}║  Admin : http://localhost/admin/                     ║${NC}"
echo -e "${GREEN}║                                                      ║${NC}"
echo -e "${GREEN}║  Stop  : docker compose -f docker-compose.local.yml up -d  ║${NC}"
echo -e "${GREEN}║  Logs  : docker compose -f docker-compose.local.yml logs -f ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
