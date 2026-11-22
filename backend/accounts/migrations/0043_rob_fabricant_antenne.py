"""ROB : nouveau champ « Fabricant antenne » inséré après « Antenne » dans les configurations
de champs DÉJÀ enregistrées (vues import / app / pdf, version brute).

Une configuration ne mémorise que les champs activés : sans cette migration, le champ ajouté
au catalogue resterait invisible pour tout opérateur ayant déjà réglé ses champs du ROB.
Il y apparaît ; chacun peut ensuite le masquer dans « Champs par défaut »."""
from django.db import migrations

CHAMP, APRES, TYPE = 'fabricant_antenne', 'antenne', 'ROB'


def ajouter(apps, schema_editor):
    User = apps.get_model('accounts', 'CustomUser')
    for user in User.objects.exclude(piece_fields_config={}).exclude(piece_fields_config__isnull=True):
        cfg = user.piece_fields_config or {}
        rob = cfg.get(TYPE)
        if not isinstance(rob, dict):
            continue
        modifie = False
        for vue in ('import', 'app', 'pdf'):
            noms = ((rob.get(vue) or {}).get('brut'))
            if not isinstance(noms, list) or CHAMP in noms:
                continue
            pos = noms.index(APRES) + 1 if APRES in noms else len(noms)
            noms.insert(pos, CHAMP)
            modifie = True
        if modifie:
            user.piece_fields_config = cfg
            user.save(update_fields=['piece_fields_config'])


def retirer(apps, schema_editor):
    User = apps.get_model('accounts', 'CustomUser')
    for user in User.objects.exclude(piece_fields_config={}).exclude(piece_fields_config__isnull=True):
        cfg = user.piece_fields_config or {}
        rob = cfg.get(TYPE)
        if not isinstance(rob, dict):
            continue
        for vue in ('import', 'app', 'pdf'):
            noms = (rob.get(vue) or {}).get('brut')
            if isinstance(noms, list) and CHAMP in noms:
                noms.remove(CHAMP)
        user.piece_fields_config = cfg
        user.save(update_fields=['piece_fields_config'])


class Migration(migrations.Migration):
    dependencies = [('accounts', '0042_journal_suppressions')]
    operations = [migrations.RunPython(ajouter, retirer)]
