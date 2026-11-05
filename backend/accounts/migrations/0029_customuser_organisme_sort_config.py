# Tri MULTI-NIVEAUX des listes d'organismes (niveau 1 et niveau 2) — miroir de 0028.

import accounts.piece_defaults
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0028_customuser_org_sort_config'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='organisme_niveau1_sort_config',
            field=models.JSONField(blank=True, default=accounts.piece_defaults.default_organisme_niveau1_sort_config, help_text='Niveaux de tri (champ + sens) par défaut du tableau des organismes de premier niveau.', verbose_name='Tri multi-niveaux des organismes de premier niveau'),
        ),
        migrations.AddField(
            model_name='customuser',
            name='organisme_niveau2_sort_config',
            field=models.JSONField(blank=True, default=accounts.piece_defaults.default_organisme_niveau2_sort_config, help_text='Niveaux de tri (champ + sens) par défaut du tableau des organismes de deuxième niveau.', verbose_name='Tri multi-niveaux des organismes de deuxième niveau'),
        ),
    ]
