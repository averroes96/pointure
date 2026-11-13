import django.db.models.deletion
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0013_storesettings_invoice_legal_mentions_and_more"),
        ("notifications", "0002_alter_notification_type"),
    ]

    operations = [
        migrations.CreateModel(
            name="OutboundMessage",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("channel", models.CharField(choices=[("telegram", "Telegram"), ("email", "Email")], max_length=20)),
                ("recipient", models.CharField(max_length=255)),
                ("kind", models.CharField(max_length=50)),
                ("text", models.TextField(blank=True, default="")),
                ("subject", models.CharField(blank=True, default="", max_length=200)),
                ("body", models.TextField(blank=True, default="")),
                (
                    "status",
                    models.CharField(
                        choices=[("pending", "Pending"), ("sent", "Sent"), ("failed", "Failed")],
                        db_index=True,
                        default="pending",
                        max_length=20,
                    ),
                ),
                ("attempts", models.PositiveIntegerField(default=0)),
                ("next_attempt_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("last_error", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("sent_at", models.DateTimeField(blank=True, null=True)),
                (
                    "tenant",
                    models.ForeignKey(
                        editable=False,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="+",
                        to="core.tenant",
                    ),
                ),
            ],
            options={
                "ordering": ["created_at"],
                "indexes": [
                    models.Index(fields=["status", "next_attempt_at"], name="notif_outbox_due_idx"),
                ],
            },
        ),
    ]
