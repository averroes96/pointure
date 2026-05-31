from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"
    verbose_name = "Core"

    def ready(self):
        import apps.core.signals  # noqa: F401

        # Replace the default AdminSite singleton with our custom subclass.
        # This preserves all existing model registrations while giving us
        # a custom index view, branding, and KPI dashboard.
        from django.contrib import admin
        from apps.core.admin_site import ShoeDZAdminSite
        admin.site.__class__ = ShoeDZAdminSite
