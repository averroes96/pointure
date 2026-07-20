"""Celery tasks for the core app: email notifications and database backups."""
import logging

from celery import shared_task
from django.core.mail import send_mail
from django.conf import settings

logger = logging.getLogger(__name__)


@shared_task(name="core.send_password_reset_email", ignore_result=True)
def send_password_reset_email(user_pk: int, uid: str, token: str):
    from apps.core.models import User
    try:
        user = User.objects.get(pk=user_pk)
    except User.DoesNotExist:
        return

    frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost")
    reset_url = f"{frontend_url}/reset-password?uid={uid}&token={token}"

    send_mail(
        subject="Réinitialisation de votre mot de passe ShoeDZ",
        message=f"""Bonjour {user.first_name or user.email},

Vous avez demandé la réinitialisation de votre mot de passe.

Cliquez sur le lien ci-dessous pour choisir un nouveau mot de passe :
{reset_url}

Ce lien expire dans 24 heures.

Si vous n'avez pas fait cette demande, ignorez cet email.

— L'équipe ShoeDZ""",
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=True,
    )


@shared_task(name="core.send_welcome_email", ignore_result=True)
def send_welcome_email(user_pk: int, temp_password: str, tenant_name: str):
    from apps.core.models import User
    try:
        user = User.objects.get(pk=user_pk)
    except User.DoesNotExist:
        return

    frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost")

    send_mail(
        subject=f"Bienvenue sur ShoeDZ — {tenant_name}",
        message=f"""Bonjour {user.first_name or user.email},

Un compte a été créé pour vous sur ShoeDZ ({tenant_name}).

Email    : {user.email}
Mot de passe temporaire : {temp_password}

Connectez-vous ici : {frontend_url}/login

Pensez à changer votre mot de passe après la première connexion.

— L'équipe ShoeDZ""",
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=True,
    )


@shared_task(name="apps.core.tasks.backup_database", ignore_result=True)
def backup_database():
    """
    Nightly pg_dump → gzip → upload to S3-compatible storage.

    Skips silently when BACKUP_ENABLED=false so the Beat schedule entry is
    always present but a no-op until the operator configures credentials.

    Supported providers via BACKUP_ENDPOINT_URL:
      AWS S3        — leave BACKUP_ENDPOINT_URL empty
      Cloudflare R2 — https://{account_id}.r2.cloudflarestorage.com
      Backblaze B2  — https://s3.{region}.backblazeb2.com
      GCS interop   — https://storage.googleapis.com
    """
    if not getattr(settings, "BACKUP_ENABLED", False):
        logger.info("Database backup skipped: BACKUP_ENABLED is false.")
        return

    import gzip
    import os
    import subprocess
    import tempfile
    from datetime import datetime, timezone

    import boto3
    from botocore.exceptions import BotoCoreError, ClientError

    db = settings.DATABASES["default"]
    timestamp = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d_%H-%M-%S")
    object_key = f"backups/db_{timestamp}.sql.gz"

    # ── 1. pg_dump ───────────────────────────────────────────────────────────
    env = os.environ.copy()
    env["PGPASSWORD"] = db.get("PASSWORD", "")

    result = subprocess.run(
        [
            "pg_dump",
            "--no-password",
            "-h", db.get("HOST", "db"),
            "-p", str(db.get("PORT", 5432)),
            "-U", db.get("USER", "postgres"),
            "-d", db.get("NAME", ""),
            "--format=plain",
        ],
        env=env,
        capture_output=True,
    )
    if result.returncode != 0:
        err = result.stderr.decode(errors="replace")
        logger.error("pg_dump failed: %s", err)
        raise RuntimeError(f"pg_dump failed: {err}")

    # ── 2. Gzip in a temp file ───────────────────────────────────────────────
    with tempfile.NamedTemporaryFile(suffix=".sql.gz", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        with gzip.open(tmp_path, "wb") as gz:
            gz.write(result.stdout)

        logger.info("Backup compressed: %.2f MB", os.path.getsize(tmp_path) / 1_048_576)

        # ── 3. Upload ────────────────────────────────────────────────────────
        s3 = boto3.client(
            "s3",
            aws_access_key_id=settings.BACKUP_ACCESS_KEY,
            aws_secret_access_key=settings.BACKUP_SECRET_KEY,
            region_name=settings.BACKUP_REGION,
            endpoint_url=settings.BACKUP_ENDPOINT_URL,
        )
        s3.upload_file(tmp_path, settings.BACKUP_BUCKET, object_key)
        logger.info("Backup uploaded → s3://%s/%s", settings.BACKUP_BUCKET, object_key)

        # ── 4. Prune old backups ─────────────────────────────────────────────
        _prune_old_backups(s3, settings.BACKUP_BUCKET, settings.BACKUP_RETENTION_DAYS)

    except (BotoCoreError, ClientError) as exc:
        logger.error("Backup upload failed: %s", exc)
        raise
    finally:
        os.unlink(tmp_path)


def _prune_old_backups(s3_client, bucket: str, retention_days: int) -> None:
    """Delete backups older than retention_days from the backup bucket."""
    from datetime import datetime, timedelta, timezone

    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=retention_days)
    paginator = s3_client.get_paginator("list_objects_v2")
    deleted = 0

    for page in paginator.paginate(Bucket=bucket, Prefix="backups/"):
        for obj in page.get("Contents", []):
            if obj["LastModified"] < cutoff:
                s3_client.delete_object(Bucket=bucket, Key=obj["Key"])
                deleted += 1

    if deleted:
        logger.info("Pruned %d backup(s) older than %d days.", deleted, retention_days)


import requests
from django.conf import settings
from .models import SyncOutbox
from celery import shared_task
import logging

logger = logging.getLogger(__name__)

@shared_task
def sync_with_cloud_server():
    """
    Pushes local SyncOutbox events to the centralized cloud server.
    """
    cloud_api_url = getattr(settings, "CLOUD_API_URL", None)
    if not cloud_api_url:
        logger.warning("CLOUD_API_URL not set. Skipping sync.")
        return

    # Get unsynced events in order
    outbox_events = SyncOutbox.objects.filter(synced=False).order_by("timestamp")
    if not outbox_events.exists():
        return

    payload = []
    for event in outbox_events:
        payload.append({
            "id": str(event.id),
            "tenant_id": str(event.tenant_id),
            "model_name": event.model_name,
            "object_id": event.object_id,
            "action": event.action,
            "payload": event.payload,
            "timestamp": event.timestamp.isoformat()
        })

    try:
        response = requests.post(
            f"{cloud_api_url}/api/v1/sync/push/",
            json={"events": payload},
            headers={"Authorization": f"Bearer {getattr(settings, 'NODE_API_KEY', '')}"},
            timeout=30
        )
        response.raise_for_status()
        
        # If successful, mark as synced
        outbox_events.update(synced=True)
        logger.info(f"Successfully synced {len(payload)} events to cloud.")
        
    except requests.RequestException as e:
        logger.error(f"Failed to sync with cloud: {e}")

