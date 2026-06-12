import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("core", "0003_storesettings"),
    ]

    operations = [
        migrations.CreateModel(
            name="WebhookEndpoint",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=200)),
                ("url", models.URLField(max_length=500)),
                ("secret", models.CharField(max_length=200)),
                ("events", models.JSONField(default=list)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("tenant", models.ForeignKey(
                    editable=False,
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="+",
                    to="core.tenant",
                )),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="WebhookDelivery",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("idempotency_key", models.UUIDField(default=uuid.uuid4, unique=True, editable=False)),
                ("event_type", models.CharField(max_length=50)),
                ("payload", models.JSONField()),
                ("status", models.CharField(
                    choices=[
                        ("pending", "En attente"),
                        ("delivered", "Livré"),
                        ("failed", "Échoué"),
                        ("abandoned", "Abandonné"),
                    ],
                    db_index=True,
                    default="pending",
                    max_length=20,
                )),
                ("attempts", models.PositiveSmallIntegerField(default=0)),
                ("next_attempt_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("response_status", models.SmallIntegerField(blank=True, null=True)),
                ("response_body", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("delivered_at", models.DateTimeField(blank=True, null=True)),
                ("endpoint", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="deliveries",
                    to="webhooks.webhookendpoint",
                )),
                ("tenant", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="webhook_deliveries",
                    to="core.tenant",
                )),
            ],
            options={"ordering": ["-created_at"]},
        ),
    ]
