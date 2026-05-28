from django.apps import AppConfig


class LicensingConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.licensing"
    verbose_name = "Licensing"

    def ready(self):
        """
        Validate the local license on startup (self-hosted mode only).

        In cloud mode (DEPLOYMENT_MODE=cloud or unset) this is a no-op.
        On startup we check the cached state so there is no network call
        blocking the server boot — the Celery Beat heartbeat keeps the
        cache fresh at runtime.
        """
        from django.conf import settings

        if getattr(settings, "DEPLOYMENT_MODE", "cloud") != "local":
            return

        # Deferred import to avoid circular imports and DB access before
        # Django's application registry is fully initialised.
        from .startup import check_license_on_startup

        check_license_on_startup()
