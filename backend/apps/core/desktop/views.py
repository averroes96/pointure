"""
ShoeDZ Desktop endpoints: health check, metadata, shutdown, and SPA serving.
"""
import os
import signal
import threading
from pathlib import Path

from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt


def health_check(request):
    """Simple health check endpoint polled by Electron during startup."""
    return JsonResponse({
        "status": "ok",
        "version": getattr(settings, "APP_VERSION", "1.0.0"),
        "desktop_mode": True,
    })


def desktop_meta(request):
    """
    Returns deployment mode and available features for the frontend.
    Allows frontend to dynamically hide cloud-only features in desktop mode.
    """
    return JsonResponse({
        "deployment_mode": "local",
        "desktop_mode": True,
        "features": {
            "mobile": False,
            "webhooks": False,
            "cloud_backup": False,
            "delivery_ai": False,
            "email_reset": bool(getattr(settings, "EMAIL_HOST_USER", "")),
        },
        "version": getattr(settings, "APP_VERSION", "1.0.0"),
    })


@csrf_exempt
def desktop_shutdown(request):
    """
    Gracefully shuts down the backend process.
    Requires matching SHUTDOWN_TOKEN for security.
    """
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    expected_token = os.environ.get("SHUTDOWN_TOKEN", "")
    token = request.headers.get("X-Shutdown-Token") or request.GET.get("token") or ""

    if expected_token and token != expected_token:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    def _terminate():
        # Small delay to allow response to complete
        import time
        time.sleep(0.5)
        os.kill(os.getpid(), signal.SIGTERM)

    threading.Thread(target=_terminate, daemon=True).start()
    return JsonResponse({"status": "shutting_down"})


def spa_index(request):
    """
    Catch-all view serving the React Single Page Application (SPA).
    Serves index.html with cache prevention for smooth upgrades.
    """
    # 1. Look in static/spa/index.html (bundled frontend)
    spa_path = getattr(settings, "BASE_DIR", Path(".")) / "static" / "spa" / "index.html"
    if not spa_path.exists():
        # Fallback to staticfiles/spa or static/index.html
        spa_path = getattr(settings, "STATIC_ROOT", Path(".")) / "spa" / "index.html"

    if spa_path.exists():
        content = spa_path.read_text(encoding="utf-8")
        response = HttpResponse(content, content_type="text/html; charset=utf-8")
        response["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return response

    return HttpResponse(
        "<h1>ShoeDZ Desktop Server</h1>"
        "<p>Backend is active. Frontend build not yet bundled into static/spa/index.html.</p>",
        content_type="text/html",
        status=200,
    )
