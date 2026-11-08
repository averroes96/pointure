from django.db import migrations, models


def backfill_client_price_tier(apps, schema_editor):
    Client = apps.get_model("clients", "Client")
    Client.objects.filter(client_type="wholesale", price_tier="detail").update(price_tier="gros")


class Migration(migrations.Migration):

    dependencies = [
        ("clients", "0002_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="client",
            name="price_tier",
            field=models.CharField(
                choices=[("detail", "Détail"), ("demi_gros", "Demi-Gros"), ("gros", "Gros")],
                db_index=True,
                default="detail",
                max_length=15,
                verbose_name="Price Tier",
            ),
        ),
        migrations.RunPython(backfill_client_price_tier, migrations.RunPython.noop),
    ]

