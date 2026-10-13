"""
Production Waitress WSGI server for ShoeDZ Desktop.

Startup phases are printed with a "[ShoeDZ]" prefix (shown on the splash
screen by Electron) and logged with timings to %ProgramData%\\ShoeDZ\\logs.
"""
import faulthandler
import io
import logging
import os
import sys
import threading
import time
from pathlib import Path

# Add backend directory to sys.path so config and apps are importable
backend_dir = Path(__file__).resolve().parent.parent.parent.parent / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from .firstrun import ensure_config
from .paths import get_data_dir, get_logs_dir

logger = logging.getLogger("shodz.desktop")

_fault_file = None


def status(msg: str) -> None:
    """Emit a splash-screen status line (and log it)."""
    print(f"[ShoeDZ] {msg}", flush=True)
    logger.info(msg)


def _install_crash_handlers() -> None:
    """Make sure every crash leaves a trace in the logs directory."""
    global _fault_file
    logs_dir = get_logs_dir()

    # Hard crashes (segfaults, deadlock dumps) → python-faults.log
    _fault_file = open(logs_dir / "python-faults.log", "a", encoding="utf-8")
    _fault_file.write(f"\n=== Backend start {time.strftime('%Y-%m-%d %H:%M:%S')} pid={os.getpid()} ===\n")
    _fault_file.flush()
    faulthandler.enable(file=_fault_file, all_threads=True)

    def _excepthook(exc_type, exc, tb):
        logger.critical("Uncaught exception", exc_info=(exc_type, exc, tb))
        sys.__excepthook__(exc_type, exc, tb)

    def _thread_excepthook(args):
        logger.critical(
            "Uncaught exception in thread %s",
            getattr(args.thread, "name", "?"),
            exc_info=(args.exc_type, args.exc_value, args.exc_traceback),
        )

    sys.excepthook = _excepthook
    threading.excepthook = _thread_excepthook


class _MigrationProgress(io.TextIOBase):
    """
    stdout replacement for `migrate` that turns "Applying app.0001_x... OK"
    lines into numbered splash-screen progress updates.
    """

    def __init__(self, total: int):
        self.total = total
        self.done = 0
        self.started = time.monotonic()
        self.current_started = self.started
        self.current = None

    def writable(self):
        return True

    def isatty(self):
        return False

    def write(self, s):
        for raw in s.splitlines():
            line = raw.strip()
            if not line:
                continue
            if line.startswith("Applying "):
                self.done += 1
                self.current = line[len("Applying "):].rstrip(".").strip()
                self.current_started = time.monotonic()
                status(f"Mise à jour de la base de données ({self.done}/{self.total}) : {self.current}")
            elif line == "OK" or line.endswith(" OK"):
                elapsed = time.monotonic() - self.current_started
                if elapsed > 2:
                    logger.info("Migration %s took %.1fs", self.current, elapsed)
            else:
                logger.info("[migrate] %s", line)
        return len(s)


def _run_migrations() -> None:
    from django.core.management import call_command
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor

    executor = MigrationExecutor(connection)
    plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
    total = len(plan)

    if total == 0:
        status("Base de données à jour.")
        return

    status(f"Préparation de la base de données ({total} migrations)...")
    t0 = time.monotonic()
    progress = _MigrationProgress(total)
    call_command("migrate", interactive=False, verbosity=1, stdout=progress)
    status(f"Base de données prête ({total} migrations en {time.monotonic() - t0:.0f}s).")


def run_server(port: int = 8745):
    """Bootstrap Django, run pending migrations, and serve with Waitress."""
    t_start = time.monotonic()
    ensure_config()
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.desktop")

    status("Chargement des modules...")
    import django
    django.setup()  # configures LOGGING → logs/shodz.log

    _install_crash_handlers()
    logger.info(
        "Backend starting: python=%s exe=%s data_dir=%s port=%s pid=%s",
        sys.version.split()[0], sys.executable, get_data_dir(), port, os.getpid(),
    )
    logger.info("Django setup done in %.1fs", time.monotonic() - t_start)

    status(f"Initialisation de la base de données dans {get_data_dir()}...")
    try:
        _run_migrations()
    except Exception:
        logger.exception("Database migration failed")
        print("[ShoeDZ ERR] Database migration failed (see logs/shodz.log)", file=sys.stderr, flush=True)
        raise

    # Start the in-process background scheduler (license heartbeat, daily tasks)
    from apps.core.desktop.scheduler import start_scheduler
    start_scheduler()

    from django.core.wsgi import get_wsgi_application
    application = get_wsgi_application()

    try:
        from waitress import serve
    except ImportError:
        logger.critical("'waitress' package is not installed.")
        print("[ShoeDZ ERR] 'waitress' package is not installed.", file=sys.stderr, flush=True)
        sys.exit(1)

    logger.info("Backend ready in %.1fs total", time.monotonic() - t_start)
    status(f"Serveur prêt sur http://127.0.0.1:{port}")
    serve(
        application,
        host="127.0.0.1",
        port=port,
        threads=16,
        channel_timeout=60,
        cleanup_interval=30,
        connection_limit=100,
        ident="ShoeDZ",
    )
