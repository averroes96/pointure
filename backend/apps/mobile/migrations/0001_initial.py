from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("core", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="DeviceToken",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("token", models.TextField(verbose_name="FCM / APNs Token")),
                ("platform", models.CharField(
                    choices=[("android", "Android"), ("ios", "iOS")],
                    max_length=10,
                    verbose_name="Platform",
                )),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("tenant", models.ForeignKey(
                    editable=False,
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="+",
                    to="core.tenant",
                )),
                ("user", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="device_tokens",
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                "verbose_name": "Device Token",
                "verbose_name_plural": "Device Tokens",
                "unique_together": {("user", "token")},
            },
        ),
    ]
