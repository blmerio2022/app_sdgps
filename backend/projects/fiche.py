"""
Fiche d'un élément de la hiérarchie (projet, propriété, affaire, SDGPS, session, pièce) —
affichée au SURVOL d'un élément du fil d'Ariane.

Une seule forme pour tous les types, déjà mise en mots (le front n'a qu'à afficher) :
`{type, libelle_type, titre, sous_titre, statut, statut_display, champs[{label, valeur}],
compteurs[{label, valeur}], audit{cree_par, cree_le, modifie_par, modifie_le}}`.
Portée RBAC (`scope_queryset`), éléments en corbeille exclus (404).
"""
from django.db.models import Count, Q
from django.http import Http404

from .models import Affaire, Projet, Propriete, Session, Ssdgps

LIBELLES = {'projet': 'Projet', 'propriete': 'Propriété', 'affaire': 'Affaire',
            'ssdgps': 'SDGPS', 'session': 'Session', 'piece': 'Pièce'}
ORG = {'projet': 'organization_id', 'propriete': 'projet__organization_id',
       'affaire': 'propriete__projet__organization_id',
       'ssdgps': 'affaire__propriete__projet__organization_id',
       'session': 'ssdgps__affaire__propriete__projet__organization_id',
       'piece': 'ssdgps__affaire__propriete__projet__organization_id'}


def _nom(user):
    return (user.get_full_name() or user.email) if user else None


def _date(d, heure=False):
    if not d:
        return None
    return d.strftime('%d/%m/%Y %H:%M') if heure else d.strftime('%d/%m/%Y')


def _champs(*paires):
    return [{'label': l, 'valeur': str(v)} for l, v in paires if v not in (None, '')]


def _objet(type_, pk, user):
    from pieces.models import Piece

    from .views import scope_queryset
    modele = {'projet': Projet, 'propriete': Propriete, 'affaire': Affaire, 'ssdgps': Ssdgps,
              'session': Session, 'piece': Piece}.get(type_)
    if modele is None:
        raise Http404
    obj = scope_queryset(modele.objects.filter(pk=pk, is_deleted=False), user, ORG[type_]).first()
    if obj is None:
        raise Http404
    return obj


def fiche(type_, pk, user) -> dict:
    from pieces.models import Piece, RemarqueValidation

    obj = _objet(type_, pk, user)
    out = {'type': type_, 'libelle_type': LIBELLES[type_], 'statut': None, 'statut_display': None,
           'champs': [], 'compteurs': [],
           'audit': {'cree_par': _nom(getattr(obj, 'created_by', None)),
                     'cree_le': _date(getattr(obj, 'created_at', None), True),
                     'modifie_par': _nom(getattr(obj, 'updated_by', None)),
                     'modifie_le': _date(getattr(obj, 'updated_at', None), True)}}
    vivant = Q(is_deleted=False)

    if type_ == 'projet':
        out.update(titre=obj.nom_projet, sous_titre=obj.code_projet,
                   statut=obj.statut, statut_display=obj.get_statut_display())
        out['champs'] = _champs(('Code', obj.code_projet), ('Organisation', getattr(obj.organization, 'name', '')),
                                ('Description', (obj.description_projet or '')[:180]))
        ss = Ssdgps.objects.filter(vivant, affaire__propriete__projet=obj, affaire__is_deleted=False,
                                   affaire__propriete__is_deleted=False)
        out['compteurs'] = [
            {'label': 'Propriétés', 'valeur': obj.proprietes.filter(vivant).count()},
            {'label': 'Affaires', 'valeur': Affaire.objects.filter(vivant, propriete__projet=obj,
                                                                   propriete__is_deleted=False).count()},
            {'label': 'SDGPS', 'valeur': ss.count()},
            {'label': 'Pièces', 'valeur': Piece.objects.filter(vivant, ssdgps__in=ss).count()},
        ]
    elif type_ == 'propriete':
        out.update(titre=obj.id_titre or obj.id_requisition or obj.nom_propriete, sous_titre=obj.nom_propriete)
        out['champs'] = _champs(('Propriété-dite', obj.nom_propriete), ('Titre foncier', obj.id_titre),
                                ('Réquisition', obj.id_requisition),
                                ('Organisme', getattr(obj.organisme_niveau1, 'nom', '')),
                                ('Service', getattr(obj.organisme_niveau2, 'nom', '')),
                                ('Projet', f'{obj.projet.code_projet} — {obj.projet.nom_projet}'))
        out['compteurs'] = [
            {'label': 'Affaires', 'valeur': obj.affaires.filter(vivant).count()},
            {'label': 'SDGPS', 'valeur': Ssdgps.objects.filter(vivant, affaire__propriete=obj,
                                                               affaire__is_deleted=False).count()},
        ]
    elif type_ == 'affaire':
        p = obj.propriete
        out.update(titre=f'SD {obj.numero_sd_affaire}', sous_titre=obj.get_nature_affaire_display()
                   if hasattr(obj, 'get_nature_affaire_display') else obj.nature_affaire)
        procedure = (obj.get_nature_procedure_affaire_display()
                     if hasattr(obj, 'get_nature_procedure_affaire_display') else obj.nature_procedure_affaire)
        out['champs'] = _champs(('N° SD', obj.numero_sd_affaire), ('Procédure', procedure),
                                ('Nature', obj.nature_affaire), ('Date de bornage', _date(obj.date_bornage)),
                                ('Propriété', p.id_titre or p.id_requisition or p.nom_propriete))
        out['compteurs'] = [{'label': 'SDGPS', 'valeur': obj.ssdgps_set.filter(vivant).count()}]
    elif type_ == 'ssdgps':
        out.update(titre=f'SDGPS n°{obj.numero_ssdgps}', sous_titre=obj.nature_ssdgps,
                   statut=obj.statut, statut_display=obj.get_statut_display())
        a = obj.affaire
        out['champs'] = _champs(('Nature', obj.nature_ssdgps),
                                ('Type', 'Multi-session' if obj.type_ssdgps == 'multi-session' else 'Mono-session'),
                                ('Affaire', f'SD {a.numero_sd_affaire} — {a.nature_affaire}'),
                                ('Modèle', getattr(getattr(obj, 'modele', None), 'nom', '')),
                                ('Statut changé le', _date(obj.statut_change_at, True)),
                                ('Par', _nom(obj.statut_change_by)),
                                ('Motif', obj.motif_statut))
        pieces = Piece.objects.filter(vivant, ssdgps=obj).aggregate(
            total=Count('id'), validees=Count('id', filter=Q(statut='valide')))
        compteurs = [{'label': 'Pièces', 'valeur': pieces['total']},
                     {'label': 'Validées', 'valeur': pieces['validees']}]
        if obj.type_ssdgps == 'multi-session':
            compteurs.insert(0, {'label': 'Sessions', 'valeur': obj.sessions.filter(vivant).count()})
        ouvertes = RemarqueValidation.objects.filter(ssdgps=obj, statut='ouverte').count()
        if ouvertes:
            compteurs.append({'label': 'Remarques à corriger', 'valeur': ouvertes})
        out['compteurs'] = compteurs
    elif type_ == 'session':
        out.update(titre=f'Session n°{obj.numero_session}', sous_titre=f'SDGPS n°{obj.ssdgps.numero_ssdgps}')
        out['champs'] = _champs(('Date de session', _date(getattr(obj, 'date_session', None))),
                                ('SDGPS', f'n°{obj.ssdgps.numero_ssdgps} — {obj.ssdgps.nature_ssdgps}'))
        out['compteurs'] = [{'label': 'Pièces', 'valeur': obj.pieces.filter(vivant).count()}]
    elif type_ == 'piece':
        titre = obj.get_type_piece_display() + (f' n°{obj.numero}' if obj.numero else '')
        out.update(titre=titre, sous_titre=obj.type_piece, statut=obj.statut, statut_display=obj.get_statut_display())
        out['champs'] = _champs(('Source', obj.get_source_saisie_display() if hasattr(obj, 'get_source_saisie_display')
                                 else obj.source_saisie),
                                ('Session', f'n°{obj.session.numero_session}' if obj.session_id else ''),
                                ('Observation', (obj.commentaire or '')[:180]))
        out['compteurs'] = [{'label': 'Lignes', 'valeur': len((obj.payload or {}).get('rows') or [])},
                            {'label': 'Images', 'valeur': obj.images.count()}]
    return out
