"""Connect push notifications to the in-app Notification model via signals.

Using a signal keeps the notification tasks generic — they create Notification
records and the mobile app hooks in here without coupling the two apps.
"""
from django.db.models.signals import post_save
from django.dispatch import receiver


@receiver(post_save, sender="notifications.Notification")
def on_notification_created(sender, instance, created, **kwargs):
    """Fire a push notification whenever a new in-app notification is created."""
    if not created:
        return

    from apps.mobile.tasks import send_push_to_user

    send_push_to_user.delay(
        instance.user_id,
        instance.title,
        instance.body,
        {
            "type": instance.type,
            "object_type": instance.related_object_type or "",
            "object_id": instance.related_object_id or "",
        },
    )
