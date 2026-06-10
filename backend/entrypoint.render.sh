#!/bin/sh
set -e

echo "==> Running migrations..."
python manage.py migrate --no-input

echo "==> Starting gunicorn..."
exec gunicorn config.wsgi:application --bind "0.0.0.0:${PORT:-8000}" --workers 2 --timeout 120
