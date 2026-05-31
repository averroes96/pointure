"""Push notification delivery via Firebase Cloud Messaging."""
import logging

from celery import shared_task

logger = logging.getLogger(__name__)

_firebase_app = None


def _get_firebase():
    """Lazily initialise Firebase Admin SDK (once per Celery worker process)."""
    global _firebase_app
    if _firebase_app is not None:
        return _firebase_app

    import base64
    import json

    import firebase_admin
    from django.conf import settings
    from firebase_admin import credentials

    creds_b64 = getattr(settings, "FIREBASE_CREDENTIALS_BASE64", "")
    creds_file = getattr(settings, "FIREBASE_CREDENTIALS_JSON", "")

    if creds_b64:
        creds_dict = json.loads(base64.b64decode(creds_b64).decode())
        cred = credentials.Certificate(creds_dict)
    elif creds_file:
        cred = credentials.Certificate(creds_file)
    else:
        logger.warning("Firebase credentials not configured — push notifications disabled.")
        return None

    _firebase_app = firebase_admin.initialize_app(cred)
    return _firebase_app


@shared_task(queue="notifications", bind=True, max_retries=3, default_retry_delay=30)
def send_push_to_user(self, user_id: int, title: str, body: str, data: dict = None):
    """
    Send a push notification to all registered devices for a user.
    Stale tokens (unregistered / invalid) are automatically cleaned up.
    """
    app = _get_firebase()
    if app is None:
        return

    from firebase_admin import messaging
    from apps.mobile.models import DeviceToken

    tokens = list(
        DeviceToken.objects.filter(user_id=user_id).values_list("token", flat=True)
    )
    if not tokens:
        return

    safe_data = {k: str(v) for k, v in (data or {}).items()}

    message = messaging.MulticastMessage(
        notification=messaging.Notification(title=title, body=body),
        data=safe_data,
        tokens=tokens,
        android=messaging.AndroidConfig(priority="high"),
        apns=messaging.APNSConfig(
            payload=messaging.APNSPayload(
                aps=messaging.Aps(sound="default", badge=1)
            )
        ),
    )

    try:
        response = messaging.send_each_for_multicast(message)
    except Exception as exc:
        logger.exception("FCM multicast failed for user %s: %s", user_id, exc)
        raise self.retry(exc=exc)

    # Remove tokens that are no longer registered
    stale_codes = {"registration-token-not-registered", "invalid-registration-token"}
    for token, result in zip(tokens, response.responses):
        if not result.success:
            code = getattr(result.exception, "code", "") or ""
            if code in stale_codes:
                DeviceToken.objects.filter(token=token).delete()
                logger.info("Removed stale device token …%s", token[-8:])

    logger.info(
        "Push sent to user %s: %d/%d delivered",
        user_id,
        response.success_count,
        len(tokens),
    )
