from django.db import migrations, models
import django.db.models.deletion
import apps.licenses.models


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="License",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "key",
                    models.CharField(
                        default=apps.licenses.models.generate_license_key,
                        help_text="License key shown to client, e.g. SHDZ-XXXX-XXXX-XXXX",
                        max_length=64,
                        unique=True,
                    ),
                ),
                ("email", models.EmailField(max_length=254)),
                ("client_name", models.CharField(max_length=200)),
                (
                    "plan",
                    models.CharField(
                        choices=[
                            ("free", "Free"),
                            ("pro_retail", "Pro Retail"),
                            ("pro_wholesale", "Pro Wholesale"),
                            ("enterprise", "Enterprise"),
                        ],
                        default="pro_retail",
                        max_length=20,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("active", "Active"),
                            ("suspended", "Suspended"),
                            ("expired", "Expired"),
                        ],
                        default="active",
                        max_length=20,
                    ),
                ),
                (
                    "expires_at",
                    models.DateTimeField(
                        blank=True,
                        help_text="Leave blank for a perpetual license (never expires).",
                        null=True,
                    ),
                ),
                (
                    "max_machines",
                    models.IntegerField(
                        default=1,
                        help_text="Maximum number of machines that can activate this license simultaneously.",
                    ),
                ),
                ("notes", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "License",
                "verbose_name_plural": "Licenses",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="MachineActivation",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "license",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="activations",
                        to="licenses.license",
                    ),
                ),
                (
                    "machine_id",
                    models.CharField(
                        help_text="UUID generated and stored on the client machine.",
                        max_length=64,
                    ),
                ),
                ("hostname", models.CharField(blank=True, max_length=200)),
                ("app_version", models.CharField(blank=True, max_length=20)),
                ("first_activated", models.DateTimeField(auto_now_add=True)),
                ("last_heartbeat", models.DateTimeField(auto_now=True)),
                ("is_active", models.BooleanField(default=True)),
            ],
            options={
                "verbose_name": "Machine Activation",
                "verbose_name_plural": "Machine Activations",
                "ordering": ["-last_heartbeat"],
                "unique_together": {("license", "machine_id")},
            },
        ),
    ]
