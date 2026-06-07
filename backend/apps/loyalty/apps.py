from django.apps import AppConfig


class LoyaltyConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.loyalty"
    verbose_name = "Fidélité"

    def ready(self):
        import apps.loyalty.signals  # noqa: F401
