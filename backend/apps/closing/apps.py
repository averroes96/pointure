from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class ClosingConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.closing"
    verbose_name = _("Year-End Closing")

