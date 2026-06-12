#!/bin/sh
set -e

echo "==> Running migrations..."
python manage.py migrate --no-input

# Create superuser from env vars — idempotent, skips if already exists.
# Set DJANGO_SUPERUSER_EMAIL and DJANGO_SUPERUSER_PASSWORD in Render dashboard.
if [ -n "$DJANGO_SUPERUSER_EMAIL" ] && [ -n "$DJANGO_SUPERUSER_PASSWORD" ]; then
    echo "==> Creating superuser ($DJANGO_SUPERUSER_EMAIL)..."
    python manage.py createsuperuser --no-input || echo "   Superuser already exists, skipping."
fi

# Seed demo data only on first deploy — guards against duplicate sales on re-deploy.
SEEDED=$(python manage.py shell -c "
from apps.core.models import Tenant
print('yes' if Tenant.objects.filter(name='ShoeDZ Demo Store').exists() else 'no')
" 2>/dev/null)

if [ "$SEEDED" = "no" ]; then
    echo "==> Seeding demo data in background (server starts immediately)..."
    python manage.py seed_demo &
else
    echo "==> Demo data already present, skipping."
fi

echo "==> Starting gunicorn (uvicorn ASGI workers)..."
exec gunicorn config.asgi:application \
    -k uvicorn.workers.UvicornWorker \
    --bind "0.0.0.0:${PORT:-8000}" \
    --workers 2 \
    --timeout 120
