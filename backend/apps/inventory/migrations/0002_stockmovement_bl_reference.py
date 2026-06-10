from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("inventory", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="stockmovement",
            name="bl_reference",
            field=models.CharField(blank=True, max_length=100, verbose_name="BL Reference"),
        ),
    ]
