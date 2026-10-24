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


# ── Backup Management Endpoints ───────────────────────────────────────────────
from datetime import datetime
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.http import FileResponse, Http404


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_backups_view(request):
    """List available local database backups."""
    if getattr(request.user, "role", "") not in ("owner", "manager"):
        return Response({"detail": "Permission refusée."}, status=status.HTTP_403_FORBIDDEN)

    from .backup import get_backups_dir, list_backup_files, MAX_BACKUP_COPIES
    backups = list_backup_files()
    backups_dir = get_backups_dir()
    db_name = str(settings.DATABASES["default"]["NAME"])

    return Response({
        "backups": backups,
        "total_count": len(backups),
        "backups_dir": str(backups_dir),
        "db_path": db_name,
        "max_copies": MAX_BACKUP_COPIES,
        "last_backup": backups[0]["created_at"] if backups else None,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_backup_view(request):
    """Trigger an immediate manual online database backup."""
    if getattr(request.user, "role", "") not in ("owner", "manager"):
        return Response({"detail": "Permission refusée."}, status=status.HTTP_403_FORBIDDEN)

    from .backup import perform_database_backup, _format_size
    backup_file = perform_database_backup()
    if not backup_file or not backup_file.exists():
        return Response(
            {"detail": "La sauvegarde de la base de données a échoué. Vérifiez l'intégrité de la base de données."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    stat = backup_file.stat()
    file_info = {
        "filename": backup_file.name,
        "size_bytes": stat.st_size,
        "size_human": _format_size(stat.st_size),
        "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
    }
    return Response({
        "status": "ok",
        "message": f"Sauvegarde {backup_file.name} créée avec succès.",
        "file": file_info,
    }, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def download_backup_view(request, filename):
    """Download a specific .sqlite3 backup file safely."""
    if getattr(request.user, "role", "") not in ("owner", "manager"):
        return Response({"detail": "Permission refusée."}, status=status.HTTP_403_FORBIDDEN)

    # Sanitize filename: no directory traversal
    safe_name = os.path.basename(filename)
    if not safe_name.endswith(".sqlite3") or safe_name != filename:
        return Response({"detail": "Nom de fichier invalide."}, status=status.HTTP_400_BAD_REQUEST)

    from .backup import get_backups_dir
    backups_dir = get_backups_dir()
    target_path = (backups_dir / safe_name).resolve()

    # Ensure path is strictly inside backups_dir
    try:
        target_path.relative_to(backups_dir.resolve())
    except ValueError:
        return Response({"detail": "Accès non autorisé."}, status=status.HTTP_403_FORBIDDEN)

    if not target_path.exists() or not target_path.is_file():
        raise Http404("Sauvegarde introuvable.")

    return FileResponse(
        open(target_path, "rb"),
        as_attachment=True,
        filename=safe_name,
        content_type="application/x-sqlite3",
    )


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def delete_backup_view(request, filename):
    """Delete a specific backup file."""
    if getattr(request.user, "role", "") not in ("owner", "manager"):
        return Response({"detail": "Permission refusée."}, status=status.HTTP_403_FORBIDDEN)

    from .backup import delete_backup_file
    success = delete_backup_file(filename)
    if not success:
        return Response({"detail": "Fichier introuvable ou suppression impossible."}, status=status.HTTP_404_NOT_FOUND)

    return Response({"status": "ok", "message": f"Sauvegarde {filename} supprimée."})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def factory_reset_view(request):
    """
    Executes an in-app database wipe (Factory Reset or Operational Purge).
    Requires:
      - Owner role
      - Correct owner password
      - Explicit confirmation string ("REINITIALISER")
    Always performs an automated safety backup prior to data deletion.
    """
    user = request.user
    if getattr(user, "role", "") != "owner":
        return Response(
            {"detail": "Seul le propriétaire (Owner) peut réinitialiser la base de données."},
            status=status.HTTP_403_FORBIDDEN,
        )

    password = request.data.get("password", "")
    if not password or not user.check_password(password):
        return Response(
            {"detail": "Mot de passe propriétaire incorrect. Opération refusée."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    confirmation = (request.data.get("confirmation") or "").strip().upper()
    if confirmation not in ("REINITIALISER", "CONFIRMER", "RESET"):
        return Response(
            {"detail": "Confirmation invalide. Veuillez taper 'REINITIALISER'."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    mode = request.data.get("mode", "all")
    if mode not in ("all", "transactions_only"):
        mode = "all"

    from .backup import perform_database_backup
    from .reset import perform_database_wipe

    # 1. Automatic safety backup before wipe
    backup_file = perform_database_backup(prefix="db_backup_pre_reset")

    # 2. Execute wipe
    try:
        result = perform_database_wipe(mode=mode)
    except Exception as exc:
        return Response(
            {"detail": f"Erreur lors de la réinitialisation : {str(exc)}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    return Response({
        "status": "ok",
        "mode": mode,
        "message": (
            "Remise à zéro complète effectuée. Vous allez être redirigé vers l'assistant de configuration."
            if mode == "all"
            else "Opérations et transactions purgées avec succès. Le catalogue de produits et les utilisateurs sont conservés."
        ),
        "backup_created": backup_file.name if backup_file else None,
        "cleared_tables_count": result.get("cleared_tables_count", 0),
    })
