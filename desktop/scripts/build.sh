#!/usr/bin/env bash
# ShoeDZ Desktop Distribution Build Script (macOS / Linux Development Testing)

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DESKTOP_DIR="$PROJECT_ROOT/desktop"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

echo "=========================================================="
echo "    ShoeDZ Desktop Distribution Builder (Dev Test)        "
echo "=========================================================="

echo -e "\n[1/3] Building React Frontend..."
cd "$FRONTEND_DIR"
if [ ! -d "node_modules" ]; then
    npm ci
fi
npm run build

SPA_DEST="$BACKEND_DIR/static/spa"
rm -rf "$SPA_DEST"
mkdir -p "$SPA_DEST"
cp -r dist/* "$SPA_DEST"
echo "Frontend build copied to: $SPA_DEST"

echo -e "\n[2/3] Checking Desktop Backend Configuration..."
cd "$BACKEND_DIR"
PYTHONPATH="$DESKTOP_DIR/python:$BACKEND_DIR" python3 -c "
import os
os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings.desktop'
import django
django.setup()
print('[OK] Django desktop profile initialized successfully.')
"

echo -e "\n[3/3] Preparing Electron Shell..."
cd "$DESKTOP_DIR"
if [ ! -d "node_modules" ]; then
    npm ci
fi

echo "=========================================================="
echo " Dev build prepared successfully!"
echo " Run 'npm start' inside the 'desktop' folder to test."
echo "=========================================================="
