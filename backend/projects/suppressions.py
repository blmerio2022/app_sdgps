"""
Suppressions TRACÉES et corbeille générale (projets, propriétés, affaires, SDGPS, sessions,
pièces).

Pourquoi : la mise en corbeille, la restauration et la suppression définitive de ces
éléments ne laissaient AUCUNE trace dans le journal d'audit. Le 18/11/2026, il a fallu lire
les journaux HTTP de l'hébergeur pour retrouver ce qu'un opérateur avait supprimé. Chaque
opération est désormais journalisée (qui, quoi, quand, où dans la hiérarchie) ; une
suppression définitive consigne en plus un INSTANTANÉ de ce qu'elle emporte (descendants
compris, puisque la base les supprime en cascade).

Tout passe par `journaliser` (ne lève jamais : un journal en panne ne bloque pas l'action).
"""
from django.db.models import Q
from django.utils import timezone

from accounts.audit import journaliser
from accounts.models import AuditEvent

from .models import Affaire, Projet, Propriete, Session, Ssdgps

# Ordre de purge : les feuilles d'abord (un parent n'est purgeable que vide).
NIVEAUX = ('piece', 'session', 'ssdgps', 'affaire', 'propriete', 'projet')
LIBELLES = {'projet': 'Projet', 'propriete': 'Propriété', 'affaire': 'Affaire',
            'ssdgps': 'SDGPS', 'session': 'Session', 'piece': 'Pièce'}


def modele_de(type_):
    from pieces.models import Piece
    return {'projet': Projet, 'propriete': Propriete, 'affaire': Affaire,
            'ssdgps': Ssdgps, 'session': Session, 'piece': Piece}[type_]


def type_de(obj):
    return {'Projet': 'projet', 'Propriete': 'propriete', 'Affaire': 'affaire',
            'Ssdgps': 'ssdgps', 'Session': 'session', 'Piece': 'piece'}.get(type(obj).__name__, '')


ORG_LOOKUP = {
    'projet': 'organization_id', 'propriete': 'projet__organization_id',
    'affaire': 'propriete__projet__organization_id',
    'ssdgps': 'affaire__propriete__projet__organization_id',
    'session': 'ssdgps__affaire__propriete__projet__organization_id',
    'piece': 'ssdgps__affaire__propriete__projet__organization_id',
}
ENFANTS = {'projet': ('proprietes',), 'propriete': ('affaires',), 'affaire': ('ssdgps_set',),
           'ssdgps': ('sessions', 'pieces'), 'session': ('pieces',), 'piece': ()}


def titre(obj) -> str:
    t = type_de(obj)
    if t == 'projet':
        return f'{obj.code_projet} — {obj.nom_projet}'
    if t == 'propriete':
        return obj.nom_propriete
    if t == 'affaire':
        return f'SD {obj.numero_sd_affaire} — {obj.nature_affaire}'
    if t == 'ssdgps':
        return f'SDGPS n°{obj.numero_ssdgps} — {obj.nature_ssdgps}'
    if t == 'session':
        return f'Session n°{obj.numero_session}'
    if t == 'piece':
        return obj.get_type_piece_display() + (f' n°{obj.numero}' if obj.numero else '')
    return str(obj)


def chaine_parents(obj) -> list:
    """[(type, id, titre)] du projet jusqu'au parent direct."""
    t = type_de(obj)
    chaine = []
    try:
        if t == 'piece':
            ss = obj.ssdgps
            if obj.session_id:
                chaine.insert(0, ('session', str(obj.session_id), titre(obj.session)))
            chaine = chaine_parents(ss) + [('ssdgps', str(ss.id), titre(ss))] + chaine
        elif t == 'session':
            ss = obj.ssdgps
            chaine = chaine_parents(ss) + [('ssdgps', str(ss.id), titre(ss))]
        elif t == 'ssdgps':
            a = obj.affaire
            chaine = chaine_parents(a) + [('affaire', str(a.id), titre(a))]
        elif t == 'affaire':
            p = obj.propriete
            chaine = chaine_parents(p) + [('propriete', str(p.id), titre(p))]
        elif t == 'propriete':
            chaine = [('projet', str(obj.projet_id), titre(obj.projet))]
    except Exception:  # noqa: BLE001 — un parent déjà purgé ne doit pas empêcher la trace
        pass
    return chaine


def contexte(obj) -> str:
    return ' › '.join(t for _, _, t in chaine_parents(obj))


def instantane(obj) -> dict:
    """Ce qu'emporte une suppression définitive : l'élément et le nombre de descendants
    (corbeille comprise), supprimés en cascade par la base."""
    from pieces.models import Piece, PieceImage
    t = type_de(obj)
    filtres = {
        'projet': {'proprietes': Q(projet=obj), 'affaires': Q(propriete__projet=obj),
                   'ssdgps': Q(affaire__propriete__projet=obj)},
        'propriete': {'affaires': Q(propriete=obj), 'ssdgps': Q(affaire__propriete=obj)},
        'affaire': {'ssdgps': Q(affaire=obj)},
    }.get(t, {})
    comptes = {}
    if 'proprietes' in filtres:
        comptes['proprietes'] = Propriete.objects.filter(filtres['proprietes']).count()
    if 'affaires' in filtres:
        comptes['affaires'] = Affaire.objects.filter(filtres['affaires']).count()
    ss_ids = None
    if 'ssdgps' in filtres:
        ss_ids = list(Ssdgps.objects.filter(filtres['ssdgps']).values_list('id', flat=True))
        comptes['ssdgps'] = len(ss_ids)
    elif t == 'ssdgps':
        ss_ids = [obj.id]
    if ss_ids is not None:
        comptes['sessions'] = Session.objects.filter(ssdgps_id__in=ss_ids).count()
        comptes['pieces'] = Piece.objects.filter(ssdgps_id__in=ss_ids).count()
        comptes['images'] = PieceImage.objects.filter(piece__ssdgps_id__in=ss_ids).count()
    elif t == 'session':
        comptes['pieces'] = Piece.objects.filter(session=obj).count()
    elif t == 'piece':
        comptes['images'] = obj.images.count()
        comptes['lignes'] = len((obj.payload or {}).get('rows') or [])
    return {k: v for k, v in comptes.items() if v}


def _details(obj, **extra):
    return {'type_element': type_de(obj), 'libelle_type': LIBELLES.get(type_de(obj), ''),
            'contexte': contexte(obj), **extra}


def tracer_corbeille(request, obj):
    journaliser(AuditEvent.ACTION_ELEMENT_SUPPRIME, request=request, cible=obj,
                cible_libelle=titre(obj), **_details(obj))


def tracer_restauration(request, obj):
    journaliser(AuditEvent.ACTION_ELEMENT_RESTAURE, request=request, cible=obj,
                cible_libelle=titre(obj), **_details(obj))


def tracer_definitive(request, obj):
    """À appeler AVANT `obj.delete()` (l'instantané lit les descendants)."""
    journaliser(AuditEvent.ACTION_SUPPRESSION_DEFINITIVE, request=request, cible=obj,
                cible_libelle=titre(obj), **_details(obj, emporte=instantane(obj)))


# --------------------------------------------------------------------------- corbeille

def _scope(qs, user, type_):
    from .views import scope_queryset
    return scope_queryset(qs, user, ORG_LOOKUP[type_])


def enfants_actifs(obj) -> int:
    return sum(getattr(obj, rel).filter(is_deleted=False).count() for rel in ENFANTS[type_de(obj)])


def _parent_en_corbeille(obj) -> bool:
    t = type_de(obj)
    try:
        if t == 'propriete':
            return obj.projet.is_deleted
        if t == 'affaire':
            return obj.propriete.is_deleted or obj.propriete.projet.is_deleted
        if t in ('ssdgps',):
            a = obj.affaire
            return a.is_deleted or a.propriete.is_deleted or a.propriete.projet.is_deleted
        if t in ('session', 'piece'):
            ss = obj.ssdgps
            return ss.is_deleted or _parent_en_corbeille(ss) or (
                t == 'piece' and obj.session_id is not None and obj.session.is_deleted)
    except Exception:  # noqa: BLE001
        return False
    return False


def lister(user) -> list:
    """Tout ce qui est en corbeille et visible de l'utilisateur, du plus récent au plus ancien."""
    from pieces.models import Piece
    selects = {'propriete': ('projet',), 'affaire': ('propriete__projet',),
               'ssdgps': ('affaire__propriete__projet',), 'session': ('ssdgps__affaire__propriete__projet',),
               'piece': ('ssdgps__affaire__propriete__projet', 'session')}
    out = []
    for type_ in NIVEAUX[::-1]:
        modele = Piece if type_ == 'piece' else modele_de(type_)
        qs = _scope(modele.objects.filter(is_deleted=True), user, type_)
        qs = qs.select_related('deleted_by', *selects.get(type_, ()))
        for obj in qs:
            auteur = obj.deleted_by
            out.append({
                'type': type_, 'libelle_type': LIBELLES[type_], 'id': str(obj.pk),
                'titre': titre(obj), 'contexte': contexte(obj),
                'deleted_at': obj.deleted_at,
                'deleted_by': (auteur.get_full_name() or auteur.email) if auteur else '',
                'enfants_actifs': enfants_actifs(obj),
                'parent_en_corbeille': _parent_en_corbeille(obj),
                'verrouille': type_ == 'piece' and obj.ssdgps.est_verrouille(),
            })
    out.sort(key=lambda e: e['deleted_at'] or timezone.now(), reverse=True)
    return out


def _objets(user, elements):
    """Résout [{type, id}] en objets EN CORBEILLE visibles de l'utilisateur."""
    trouves, erreurs = [], []
    for e in elements or []:
        type_, id_ = (e or {}).get('type'), (e or {}).get('id')
        if type_ not in ORG_LOOKUP or not id_:
            erreurs.append({'type': type_, 'id': id_, 'detail': 'Élément invalide.'})
            continue
        obj = _scope(modele_de(type_).objects.filter(pk=id_, is_deleted=True), user, type_).first()
        if obj is None:
            erreurs.append({'type': type_, 'id': id_, 'detail': 'Introuvable dans la corbeille.'})
            continue
        trouves.append(obj)
    return trouves, erreurs


def restaurer(request, elements) -> dict:
    objets, erreurs = _objets(request.user, elements)
    faits = 0
    for obj in objets:
        if type_de(obj) == 'piece' and obj.ssdgps.est_verrouille():
            erreurs.append({'type': 'piece', 'id': str(obj.pk), 'detail': 'Dossier figé : pièce non modifiable.'})
            continue
        obj.is_deleted, obj.deleted_at, obj.deleted_by = False, None, None
        obj.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by'])
        tracer_restauration(request, obj)
        faits += 1
    return {'restaures': faits, 'erreurs': erreurs}


def purger(request, elements) -> dict:
    """Suppression DÉFINITIVE, des feuilles vers les parents : un parent n'est purgé que s'il
    n'a plus d'enfant actif (même règle que les écrans de chaque niveau)."""
    objets, erreurs = _objets(request.user, elements)
    objets.sort(key=lambda o: NIVEAUX.index(type_de(o)))
    faits = 0
    for obj in objets:
        t = type_de(obj)
        if t == 'piece' and obj.ssdgps.est_verrouille():
            erreurs.append({'type': t, 'id': str(obj.pk), 'detail': 'Dossier figé : pièce non modifiable.'})
            continue
        bloquants = enfants_actifs(obj)
        if bloquants:
            erreurs.append({'type': t, 'id': str(obj.pk),
                            'detail': f'{bloquants} sous-élément(s) actif(s) : supprimez-les d’abord.'})
            continue
        tracer_definitive(request, obj)
        obj.delete()
        faits += 1
    return {'supprimes': faits, 'erreurs': erreurs}
