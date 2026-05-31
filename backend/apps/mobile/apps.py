from django.apps import AppConfig


class MobileConfig(AppConfig):
    name = "apps.mobile"
    verbose_name = "Mobile API"

    def ready(self):
        import apps.mobile.signals  # noqa: F401 — connects post_save on Notification
