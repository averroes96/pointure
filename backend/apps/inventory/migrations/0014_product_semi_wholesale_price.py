from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("inventory", "0013_product_is_demo"),
    ]

    operations = [
        migrations.AddField(
            model_name="product",
            name="semi_wholesale_price",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                max_digits=12,
                null=True,
                verbose_name="Semi-Wholesale Price (DZD)",
            ),
        ),
    ]

