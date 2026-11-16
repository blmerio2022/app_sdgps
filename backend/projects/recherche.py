"""
Recherche globale (Ctrl+K) : retrouver un projet, une propriété, une affaire, un SDGPS ou
un nom de point sans descendre la hiérarchie projet › propriété › affaire › SDGPS.

Tout passe par `scope_queryset` : on ne trouve que ce qu'on a le droit de voir. Les
éléments en corbeille (ou sous un parent en corbeille) sont exclus. Chaque résultat porte
un `lien` RELATIF que le front préfixe (`/admin/` selon la zone).
"""
import re

from django.db.models import Q, TextField
from django.db.models.functions import Cast

from .models import Affaire, Projet, Propriete, Ssdgps

PAR_GROUPE = 6
LONGUEUR_MIN = 2
TYPES_POINTS = ('LPA', 'PPA', 'PPN')
CHAMPS_NOM_POINT = ('nom_point', 'point', 'nom', 'nom_borne')


def _nombre(q):
    m = re.fullmatch(r'(?:sd|n°|no|n|sdgps|ssdgps)?\s*[°.]?\s*(\d{1,6})', q.strip(), flags=re.IGNORECASE)
    return int(m.group(1)) if m else None


def _projets(user, q):
    from .views import scope_queryset
    qs = scope_queryset(Projet.objects.filter(is_deleted=False), user, 'organization_id')
    qs = qs.filter(Q(code_projet__icontains=q) | Q(nom_projet__icontains=q)).order_by('code_projet')[:PAR_GROUPE]
    return [{'type': 'projet', 'id': str(p.id), 'titre': f'{p.code_projet} — {p.nom_projet}',
             'sous_titre': getattr(p.organization, 'name', '') if p.organization_id else '',
             'lien': f'projets/{p.id}'} for p in qs.select_related('organization')]


def _proprietes(user, q):
    from .views import scope_queryset
    qs = scope_queryset(Propriete.objects.filter(is_deleted=False, projet__is_deleted=False),
                        user, 'projet__organization_id')
    qs = qs.filter(Q(nom_propriete__icontains=q) | Q(id_titre__icontains=q) | Q(id_requisition__icontains=q))
    out = []
    for p in qs.select_related('projet').order_by('nom_propriete')[:PAR_GROUPE]:
        ref = ' · '.join(x for x in [f'titre {p.id_titre}' if p.id_titre else '',
                                     f'réquisition {p.id_requisition}' if p.id_requisition else ''] if x)
        out.append({'type': 'propriete', 'id': str(p.id), 'titre': p.nom_propriete,
                    'sous_titre': ' · '.join(x for x in [p.projet.code_projet, ref] if x),
                    'lien': f'projets/{p.projet_id}?proprieteId={p.id}'})
    return out


def _affaires(user, q):
    from .views import scope_queryset
    n = _nombre(q)
    if n is None:
        return []
    qs = scope_queryset(Affaire.objects.filter(is_deleted=False, propriete__is_deleted=False,
                                               propriete__projet__is_deleted=False, numero_sd_affaire=n),
                        user, 'propriete__projet__organization_id')
    return [{'type': 'affaire', 'id': str(a.id), 'titre': f'SD {a.numero_sd_affaire} — {a.nature_affaire}',
             'sous_titre': f'{a.propriete.projet.code_projet} · {a.propriete.nom_propriete}',
             'lien': f'projets/{a.propriete.projet_id}?proprieteId={a.propriete_id}&affaireId={a.id}'}
            for a in qs.select_related('propriete__projet')[:PAR_GROUPE]]


def _ssdgps(user, q):
    from .views import scope_queryset
    n = _nombre(q)
    filtre = Q(nature_ssdgps__icontains=q)
    if n is not None:
        filtre |= Q(numero_ssdgps=n)
    qs = scope_queryset(Ssdgps.objects.filter(is_deleted=False, affaire__is_deleted=False,
                                              affaire__propriete__is_deleted=False,
                                              affaire__propriete__projet__is_deleted=False).filter(filtre),
                        user, 'affaire__propriete__projet__organization_id')
    return [{'type': 'ssdgps', 'id': str(s.id),
             'titre': f'SDGPS n°{s.numero_ssdgps} — {s.nature_ssdgps}',
             'sous_titre': (f'{s.affaire.propriete.projet.code_projet} · {s.affaire.propriete.nom_propriete} · '
                            f'SD {s.affaire.numero_sd_affaire} · {s.get_statut_display()}'),
             'lien': f'projets/{s.affaire.propriete.projet_id}/pieces/{s.id}'}
            for s in qs.select_related('affaire__propriete__projet').order_by('numero_ssdgps')[:PAR_GROUPE]]


def _points(user, q):
    """Noms de points dans les pièces LPA / PPA / PPN (recherche dans le contenu JSON)."""
    from pieces.models import Piece
    from .views import scope_queryset

    qs = (Piece.objects.filter(is_deleted=False, type_piece__in=TYPES_POINTS, ssdgps__is_deleted=False,
                               ssdgps__affaire__propriete__projet__is_deleted=False)
          .annotate(texte=Cast('payload', TextField())).filter(texte__icontains=q))
    qs = scope_queryset(qs, user, 'ssdgps__affaire__propriete__projet__organization_id')
    out, vus = [], set()
    ql = q.lower()
    for p in qs.select_related('ssdgps__affaire__propriete__projet')[:40]:
        for row in (p.payload or {}).get('rows') or []:
            if not isinstance(row, dict):
                continue
            nom = next((str(row[c]) for c in CHAMPS_NOM_POINT if row.get(c)), '')
            if not nom or ql not in nom.lower():
                continue
            cle = (nom.lower(), p.ssdgps_id)
            if cle in vus:
                continue
            vus.add(cle)
            s = p.ssdgps
            out.append({'type': 'point', 'id': f'{p.id}:{nom}', 'titre': nom,
                        'sous_titre': (f'{p.type_piece} · SDGPS n°{s.numero_ssdgps} · '
                                       f'{s.affaire.propriete.projet.code_projet} · {s.affaire.propriete.nom_propriete}'),
                        'lien': f'projets/{s.affaire.propriete.projet_id}/pieces/{s.id}/piece/{p.id}'})
            if len(out) >= PAR_GROUPE:
                return out
    return out


GROUPES = [('ssdgps', 'SDGPS', _ssdgps), ('projet', 'Projets', _projets),
           ('propriete', 'Propriétés', _proprietes), ('affaire', 'Affaires', _affaires),
           ('point', 'Points', _points)]


def rechercher(user, q):
    q = (q or '').strip()[:80]
    if len(q) < LONGUEUR_MIN:
        return {'q': q, 'groupes': [], 'total': 0}
    groupes = []
    for cle, libelle, fn in GROUPES:
        res = fn(user, q)
        if res:
            groupes.append({'type': cle, 'libelle': libelle, 'resultats': res})
    return {'q': q, 'groupes': groupes, 'total': sum(len(g['resultats']) for g in groupes)}
