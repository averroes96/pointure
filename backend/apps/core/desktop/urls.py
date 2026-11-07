"""Desktop URL patterns."""
from django.urls import path
from .views import (
    desktop_meta,
    desktop_shutdown,
    list_backups_view,
    create_backup_view,
    download_backup_view,
    delete_backup_view,
    restore_backup_view,
    update_backup_config_view,
    factory_reset_view,
)

urlpatterns = [
    path("meta/", desktop_meta, name="desktop-meta"),
    path("shutdown/", desktop_shutdown, name="desktop-shutdown"),
    path("backups/", list_backups_view, name="desktop-backups-list"),
    path("backups/config/", update_backup_config_view, name="desktop-backups-config"),
    path("backups/create/", create_backup_view, name="desktop-backups-create"),
    path("backups/restore/", restore_backup_view, name="desktop-backups-restore"),
    path("backups/<str:filename>/download/", download_backup_view, name="desktop-backups-download"),
    path("backups/<str:filename>/", delete_backup_view, name="desktop-backups-delete"),
    path("reset/", factory_reset_view, name="desktop-factory-reset"),
]
