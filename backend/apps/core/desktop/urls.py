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
    diagnostics_bundle_view,
)
from .telegram_views import (
    telegram_link_view,
    telegram_poll_view,
    telegram_status_view,
    telegram_test_view,
    telegram_token_view,
    telegram_unlink_view,
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
    path("diagnostics/", diagnostics_bundle_view, name="desktop-diagnostics"),
    path("telegram/", telegram_status_view, name="desktop-telegram-status"),
    path("telegram/token/", telegram_token_view, name="desktop-telegram-token"),
    path("telegram/link/", telegram_link_view, name="desktop-telegram-link"),
    path("telegram/poll/", telegram_poll_view, name="desktop-telegram-poll"),
    path("telegram/chats/<str:chat_id>/test/", telegram_test_view, name="desktop-telegram-test"),
    path("telegram/chats/<str:chat_id>/", telegram_unlink_view, name="desktop-telegram-unlink"),
]
