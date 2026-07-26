from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0001_initial'),
        ('delivery_integrations', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='SocialIntegration',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('platform', models.CharField(choices=[('facebook', 'Facebook Messenger'), ('instagram', 'Instagram DM')], max_length=20, verbose_name='Platform')),
                ('page_id', models.CharField(help_text='The Facebook Page ID or Instagram Business Account ID.', max_length=100, verbose_name='Page ID')),
                ('page_name', models.CharField(blank=True, help_text='Friendly name for display purposes.', max_length=200, verbose_name='Page Name')),
                ('access_token', models.CharField(help_text='Long-lived Page Access Token from Meta.', max_length=512, verbose_name='Page Access Token')),
                ('is_active', models.BooleanField(default=True, verbose_name='Active')),
                ('ai_enabled', models.BooleanField(default=True, help_text='When enabled, incoming messages are automatically parsed by AI to extract order details.', verbose_name='AI Parsing Enabled')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='core.tenant')),
            ],
            options={
                'verbose_name': 'Social Integration',
                'verbose_name_plural': 'Social Integrations',
                'unique_together': {('tenant', 'platform', 'page_id')},
            },
        ),
    ]
