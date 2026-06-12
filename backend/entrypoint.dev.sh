#!/bin/sh
set -e

echo "==> Waiting for database..."
# db healthcheck already passed, but give Django a moment
sleep 1

echo "==> Creating migrations..."
python manage.py makemigrations core inventory sales clients invoicing notifications reports suppliers loyalty promotions webhooks --no-input

echo "==> Applying migrations..."
python manage.py migrate --no-input

echo "==> Starting server: $@"
exec "$@"
