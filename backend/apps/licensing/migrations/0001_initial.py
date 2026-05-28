from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="LicenseState",
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
                ("machine_id", models.CharField(blank=True, max_length=64)),
                ("license_key", models.CharField(blank=True, max_length=64)),
                ("plan", models.CharField(blank=True, max_length=50)),
                ("valid", models.BooleanField(default=False)),
                ("expires_at", models.DateTimeField(blank=True, null=True)),
                ("last_check", models.DateTimeField(blank=True, null=True)),
                ("grace_until", models.DateTimeField(blank=True, null=True)),
                ("client_name", models.CharField(blank=True, max_length=200)),
            ],
            options={
                "verbose_name": "License State",
                "verbose_name_plural": "License State",
            },
        ),
    ]
