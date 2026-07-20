"""Celery application configuration."""
import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")

app = Celery("shodz")

# Read config from Django settings with CELERY_ prefix
app.config_from_object("django.conf:settings", namespace="CELERY")

# Auto-discover tasks in all installed apps
app.autodiscover_tasks()


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    print(f"Request: {self.request!r}")

app.conf.beat_schedule = {
    'sync-with-cloud-every-5-minutes': {
        'task': 'apps.core.tasks.sync_with_cloud_server',
        'schedule': 300.0,  # 5 minutes in seconds
    },
}
