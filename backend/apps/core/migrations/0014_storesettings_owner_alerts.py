from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0013_storesettings_invoice_legal_mentions_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="storesettings",
            name="telegram_digest_time",
            field=models.TimeField(default="21:00", verbose_name="Heure du résumé Telegram"),
        ),
        migrations.AddField(
            model_name="storesettings",
            name="alert_cash_gap_enabled",
            field=models.BooleanField(default=True, verbose_name="Alerte écart de caisse"),
        ),
        migrations.AddField(
            model_name="storesettings",
            name="alert_cash_gap_amount",
            field=models.DecimalField(
                decimal_places=2, default=Decimal("1000.00"), max_digits=12,
                verbose_name="Seuil écart de caisse (DZD)",
            ),
        ),
        migrations.AddField(
            model_name="storesettings",
            name="alert_cancel_enabled",
            field=models.BooleanField(default=True, verbose_name="Alerte vente annulée"),
        ),
        migrations.AddField(
            model_name="storesettings",
            name="alert_refund_enabled",
            field=models.BooleanField(default=True, verbose_name="Alerte remboursement"),
        ),
        migrations.AddField(
            model_name="storesettings",
            name="alert_refund_amount",
            field=models.DecimalField(
                decimal_places=2, default=Decimal("1000.00"), max_digits=12,
                verbose_name="Seuil remboursement (DZD)",
            ),
        ),
        migrations.AddField(
            model_name="storesettings",
            name="alert_discount_enabled",
            field=models.BooleanField(default=True, verbose_name="Alerte remise approuvée"),
        ),
        migrations.AddField(
            model_name="storesettings",
            name="alert_discount_pct",
            field=models.PositiveSmallIntegerField(default=10, verbose_name="Seuil remise (%)"),
        ),
        migrations.AddField(
            model_name="storesettings",
            name="alert_year_open_enabled",
            field=models.BooleanField(default=True, verbose_name="Alerte exercice non clôturé"),
        ),
        migrations.AddField(
            model_name="storesettings",
            name="alert_backup_stale_enabled",
            field=models.BooleanField(default=True, verbose_name="Alerte sauvegarde externe"),
        ),
    ]
