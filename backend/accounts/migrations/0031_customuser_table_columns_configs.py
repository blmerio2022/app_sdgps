from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0030_customuser_table_sort_configs'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='table_columns_configs',
            field=models.JSONField(blank=True, default=dict, help_text="Colonnes affichées/masquées et leur ordre, par tableau, propres à l'utilisateur.", verbose_name='Colonnes par tableau (générique)'),
        ),
    ]
