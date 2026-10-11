"""
Production Waitress WSGI server for ShoeDZ Desktop.
"""
import logging
import os
import sys
from pathlib import Path

# Add backend directory to sys.path so config and apps are importable
backend_dir = Path(__file__).resolve().parent.parent.parent.parent / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from .firstrun import ensure_config
from .paths import get_data_dir

logger = logging.getLogger("shodz.desktop")


def run_server(port: int = 8745):
    """Bootstrap Django, run pending migrations, and serve with Waitress."""
    # Ensure config and environment variables are populated
    ensure_config()
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.desktop")

    import django
    django.setup()

    from django.core.management import call_command
    from django.core.wsgi import get_wsgi_application

    print(f"[ShoeDZ] Initializing database in {get_data_dir()}...")
    try:
        call_command("migrate", interactive=False)
        print("[ShoeDZ] Database migrations up to date.")
    except Exception as exc:
        print(f"[ShoeDZ ERR] Database migration failed: {exc}", file=sys.stderr)
        raise

    # Start the in-process background scheduler (license heartbeat, daily tasks)
    from apps.core.desktop.scheduler import start_scheduler
    start_scheduler()

    # Get WSGI application and serve with Waitress
    application = get_wsgi_application()

    try:
        from waitress import serve
    except ImportError:
        print("[ShoeDZ ERR] 'waitress' package is not installed.", file=sys.stderr)
        sys.exit(1)

    print(f"[ShoeDZ] Serving on http://127.0.0.1:{port} (16 worker threads)")
    serve(
        application,
        host="127.0.0.1",
        port=port,
        threads=16,
        channel_timeout=60,
        cleanup_interval=30,
        connection_limit=100,
    )
