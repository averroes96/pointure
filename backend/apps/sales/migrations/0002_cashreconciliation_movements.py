from decimal import Decimal
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('sales', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='cashreconciliation',
            name='opening_float',
            field=models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=12, verbose_name='Opening Cash Float'),
        ),
        migrations.AddField(
            model_name='cashreconciliation',
            name='expenses',
            field=models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=12, verbose_name='Petty Cash Expenses'),
        ),
        migrations.AddField(
            model_name='cashreconciliation',
            name='cash_drops',
            field=models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=12, verbose_name='Cash Drops / Safe Deposit'),
        ),
    ]
