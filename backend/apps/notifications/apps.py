from django.apps import AppConfig

class NotificationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.notifications"
    verbose_name = "Notifications"
    
    def ready(self):
        pass  # Register celery beat schedule via Django admin or fixtures
