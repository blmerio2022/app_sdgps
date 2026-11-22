"""Description du champ ROB « Fabricant antenne » (aide de la correspondance des colonnes et
des paramètres de champs). Création seule : une description saisie n'est jamais écrasée."""
from django.db import migrations


def creer(apps, schema_editor):
    Meta = apps.get_model('pieces', 'PieceFieldMeta')
    Meta.objects.get_or_create(
        type_piece='ROB', field_name='fabricant_antenne',
        defaults={'description': "Fabricant (marque) de l'antenne GNSS de la station : CHC, Trimble, "
                                 "Leica, Topcon…",
                  'tooltip': "Fabricant de l'antenne (colonne « Fabricant ant. » des exports).",
                  'required': False})


def supprimer(apps, schema_editor):
    apps.get_model('pieces', 'PieceFieldMeta').objects.filter(
        type_piece='ROB', field_name='fabricant_antenne').delete()


class Migration(migrations.Migration):
    dependencies = [('pieces', '0020_remarques_validation')]
    operations = [migrations.RunPython(creer, supprimer)]
