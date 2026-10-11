"""
Task runner utility for dual Desktop/Server compatibility.

In desktop mode (or when Celery broker is unavailable), tasks execute synchronously
in-process without requiring a separate Celery worker daemon.
"""
import logging

from django.conf import settings

logger = logging.getLogger(__name__)


def run_task(task_func, *args, **kwargs):
    """
    Run a task function. In desktop mode, executes synchronously in-process.
    In server mode, dispatches via Celery's .delay().
    """
    if getattr(settings, "DESKTOP_MODE", False):
        try:
            if hasattr(task_func, "run"):
                return task_func.run(*args, **kwargs)
            else:
                return task_func(*args, **kwargs)
        except Exception:
            logger.exception("Synchronous task execution failed: %s", getattr(task_func, "__name__", str(task_func)))
            return None
    else:
        return task_func.delay(*args, **kwargs)
