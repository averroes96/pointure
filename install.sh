#!/usr/bin/env bash
# ── ShoeDZ / Pointure — Self-Hosted Installer ───────────────────────────────
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/averroes96/pointure/main/install.sh | bash
#   — or —
#   chmod +x install.sh && ./install.sh
#
# What this script does:
#   1. Checks prerequisites (Docker, Docker Compose v2, python3)
#   2. Creates .env.local with auto-generated secrets
#   3. Builds and starts all containers
#   4. Runs database migrations & collects static files
#   5. Activates your license key (if provided)
#   6. Optionally creates a Django admin superuser (for /admin/ panel)
#   7. Prints the URL — visit http://localhost/setup to finish in the browser

set -euo pipefail

# ── Portable sed -i (GNU vs BSD) ─────────────────────────────────────────────
# macOS ships BSD sed which requires `sed -i ''`; Linux uses GNU sed (`sed -i`).
sedi() {
    if sed --version >/dev/null 2>&1; then
        # GNU sed
        sed -i "$@"
    else
        # BSD sed (macOS)
        sed -i '' "$@"
    fi
}

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


# ── Download files if running directly via curl ──────────────────────────────
if [[ ! -f "docker-compose.local.yml" || ! -f ".env.local.example" ]]; then
    info "Downloading required setup files..."
    BASE_URL="https://raw.githubusercontent.com/averroes96/pointure/main"
    curl -sSLO "$BASE_URL/docker-compose.local.yml" || error "Failed to download docker-compose.local.yml"
    curl -sSLO "$BASE_URL/.env.local.example" || error "Failed to download .env.local.example"
    mkdir -p nginx && curl -sSL "$BASE_URL/nginx/nginx.local.conf" -o nginx/nginx.local.conf || error "Failed to download nginx.local.conf"
    success "Setup files downloaded."
fi

# ── 1. Prerequisites ─────────────────────────────────────────────────────────
info "Checking prerequisites…"

command -v docker  >/dev/null 2>&1 || error "Docker is not installed. See https://docs.docker.com/get-docker/"

if ! docker compose version >/dev/null 2>&1; then
    error "Docker Compose v2 is required. See https://docs.docker.com/compose/install/"
fi

docker info >/dev/null 2>&1 || error "Docker daemon is not running. Start it and try again."

success "All prerequisites satisfied."

# ── 2. Environment file ──────────────────────────────────────────────────────
if [[ -f "$ENV_FILE" ]]; then
    warn ".env.local already exists — skipping generation. Edit it manually if needed."
else
    info "Generating $ENV_FILE with random secrets…"

    SECRET_KEY=$(openssl rand -hex 50 2>/dev/null || head -c 50 /dev/urandom | xxd -p)
    DB_PASSWORD=$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | xxd -p)
    REDIS_PASSWORD=$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | xxd -p)

    echo ""
    echo -e "${YELLOW}Enter your ShoeDZ license key (format: SHDZ-XXXX-XXXX-XXXX).${NC}"
    echo -e "${YELLOW}Press Enter to skip — you can activate the license later.${NC}"
    read -r -p "License key: " LICENSE_KEY
    echo ""

    echo -e "${YELLOW}Enter the public URL of this server (e.g. http://192.168.1.10 or http://localhost).${NC}"
    echo -e "${YELLOW}Used in password-reset emails. Press Enter for http://localhost.${NC}"
    read -r -p "Frontend URL [http://localhost]: " FRONTEND_URL
    FRONTEND_URL="${FRONTEND_URL:-http://localhost}"
    echo ""

    echo -e "${YELLOW}Allow access from other devices on your local network (LAN)? [y/N]${NC}"
    read -r -p "LAN Access: " LAN_ACCESS
    if [[ "$(echo "$LAN_ACCESS" | tr '[:upper:]' '[:lower:]')" == "y" ]]; then
        BIND_IP="0.0.0.0"
    else
        BIND_IP="127.0.0.1"
    fi
    echo ""

    echo -e "${YELLOW}Which port should the app run on? [80]${NC}"
    read -r -p "Port: " HTTP_PORT
    HTTP_PORT="${HTTP_PORT:-80}"
    echo ""

    if lsof -Pi :$HTTP_PORT -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        error "Port $HTTP_PORT is already in use. Please stop the conflicting service or choose another port."
    fi

    sed \
        -e "s|change-me-generate-with-python-secrets-token-hex-50|${SECRET_KEY}|g" \
        -e "s|change-me-strong-password|${DB_PASSWORD}|g" \
        -e "s|change-me-redis-password|${REDIS_PASSWORD}|g" \
        -e "s|SHDZ-XXXX-XXXX-XXXX|${LICENSE_KEY:-SHDZ-XXXX-XXXX-XXXX}|g" \
        .env.local.example > "$ENV_FILE"

    # Fix DATABASE_URL and REDIS_URL substitutions with actual passwords
    sedi "s|DATABASE_URL=postgres://shodz:.*@db|DATABASE_URL=postgres://shodz:${DB_PASSWORD}@db|g" "$ENV_FILE"
    sedi "s|REDIS_URL=redis://:.*@redis|REDIS_URL=redis://:${REDIS_PASSWORD}@redis|g" "$ENV_FILE"

    # Append extra variables
    echo "FRONTEND_URL=${FRONTEND_URL}" >> "$ENV_FILE"
    echo "BIND_IP=${BIND_IP}" >> "$ENV_FILE"
    echo "HTTP_PORT=${HTTP_PORT}" >> "$ENV_FILE"

    success "$ENV_FILE created."
fi

# ── 3. Build and start containers ────────────────────────────────────────────
info "Building Docker images (this may take several minutes on first run)…"
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
        error "Database did not become ready within ${MAX_WAIT}s. Check: docker compose -f $COMPOSE_FILE logs db"
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
        warn "License activation failed — you can retry later:"
        warn "  docker compose -f $COMPOSE_FILE exec backend python manage.py activate_license <YOUR-KEY>"
    fi
else
    warn "No license key set. Activate after setup:"
    warn "  docker compose -f $COMPOSE_FILE exec backend python manage.py activate_license SHDZ-XXXX-XXXX-XXXX"
fi

# ── 6. Django admin superuser (optional) ─────────────────────────────────────
# NOTE: This creates an account for the /admin/ panel (internal Django admin),
#       NOT the app itself. Your app account is created via the browser wizard
#       at http://localhost/setup after this script finishes.
echo ""
echo -e "${YELLOW}Create a Django admin account for the /admin/ panel? [y/N]${NC}"
echo -e "${YELLOW}(Skip this if you only need the app — the browser wizard creates your app account.)${NC}"
read -r -p "" CREATE_SUPER
if [[ "$(echo "$CREATE_SUPER" | tr '[:upper:]' '[:lower:]')" == "y" ]]; then
    docker compose -f "$COMPOSE_FILE" exec backend python manage.py createsuperuser
fi

# ── 7. Done ──────────────────────────────────────────────────────────────────
FRONTEND_URL_DISPLAY=$(grep '^FRONTEND_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"')
FRONTEND_URL_DISPLAY="${FRONTEND_URL_DISPLAY:-http://localhost}"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✓  ShoeDZ is running!                                       ║${NC}"
echo -e "${GREEN}║                                                              ║${NC}"
echo -e "${GREEN}║  👉 NEXT STEP: open your browser and go to:                  ║${NC}"
echo -e "${GREEN}║                                                              ║${NC}"
echo -e "${GREEN}║     ${FRONTEND_URL_DISPLAY}/setup                                    ║${NC}"
echo -e "${GREEN}║                                                              ║${NC}"
echo -e "${GREEN}║  The setup wizard will ask for your business name and        ║${NC}"
echo -e "${GREEN}║  create your first admin account.                            ║${NC}"
echo -e "${GREEN}║                                                              ║${NC}"
echo -e "${GREEN}║  Django admin panel : ${FRONTEND_URL_DISPLAY}/admin/              ║${NC}"
echo -e "${GREEN}║                                                              ║${NC}"
echo -e "${GREEN}║  Stop  : docker compose -f docker-compose.local.yml down     ║${NC}"
echo -e "${GREEN}║  Logs  : docker compose -f docker-compose.local.yml logs -f  ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
