"""DLC : les déterminations intermédiaires passent aux types communs RDN / RDIA.

L'ancien type « RDI » (première version du catalogue, réservé au DLC) n'est plus proposé.
Dans les modèles de SDGPS et dans la liste de contrôle des dossiers ENCORE MODIFIABLES qui ne
contiennent aucune pièce RDI, l'entrée RDI est remplacée — à sa place — par « RDN n°1 » puis
« RDIA » (même caractère obligatoire), sans doublon. Les dossiers soumis / validés / clos et
ceux qui portent déjà une pièce RDI ne bougent pas."""
from django.db import migrations

VERROUILLES = ('soumis', 'valide', 'clos')


def remplacer(pieces):
    if not isinstance(pieces, list) or not any(isinstance(p, dict) and p.get('type_piece') == 'RDI' for p in pieces):
        return None
    presents = {(p.get('type_piece'), p.get('numero')) for p in pieces if isinstance(p, dict)}
    types = {t for t, _ in presents}
    out = []
    for p in pieces:
        if isinstance(p, dict) and p.get('type_piece') == 'RDI':
            obligatoire = p.get('obligatoire', True)
            if 'RDN' not in types:
                out.append({'type_piece': 'RDN', 'numero': 1, 'obligatoire': obligatoire})
            if 'RDIA' not in types:
                out.append({'type_piece': 'RDIA', 'numero': None, 'obligatoire': obligatoire})
        else:
            out.append(p)
    return out


def migrer(apps, schema_editor):
    Modele = apps.get_model('projects', 'ModeleSsdgps')
    Ssdgps = apps.get_model('projects', 'Ssdgps')
    Piece = apps.get_model('pieces', 'Piece')
    for m in Modele.objects.all():
        nouvelles = remplacer(m.pieces)
        if nouvelles is not None:
            m.pieces = nouvelles
            m.save(update_fields=['pieces'])
    avec_rdi = set(Piece.objects.filter(type_piece='RDI', is_deleted=False).values_list('ssdgps_id', flat=True))
    for s in Ssdgps.objects.exclude(statut__in=VERROUILLES).exclude(pk__in=avec_rdi):
        nouvelles = remplacer(s.pieces_prevues)
        if nouvelles is not None:
            s.pieces_prevues = nouvelles
            s.save(update_fields=['pieces_prevues'])


class Migration(migrations.Migration):
    dependencies = [('projects', '0010_identifiants_lettre_facultative'), ('pieces', '0021_meta_fabricant_antenne')]
    operations = [migrations.RunPython(migrer, migrations.RunPython.noop)]
