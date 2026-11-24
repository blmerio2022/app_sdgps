"""
Contrôle CROISÉ des points entre les pièces d'un SDGPS.

Le contrôle de cohérence (`coherence.py`) vérifie la PRÉSENCE des pièces ; celui-ci vérifie
que leur CONTENU concorde. Un point présent dans la LPA mais absent de la détermination
définitive, une photo rattachée à aucun point, un point écrit « GPS 1 » ici et « GPS1 » là :
ces défauts passaient jusqu'au contrôleur et faisaient rejeter le dossier.

Sources de noms de points (rapprochés sans casse ni espaces, comme le RC — `rc._cle`) :
- points anciens : LPA (`nom_point`) ; fiches photo : PPA / PPN (`nom_point`, photos par
  `point_ref` = clé de ligne) ;
- observations : ROB (`point`) et RTLB (`de`, `vers`) ;
- détermination définitive : RDD ; déterminations : RDL, RDN, RDIA (`nom_point`).

Chaque contrôle ne s'applique que si les pièces qu'il compare sont présentes (un dossier
en cours est légitimement incomplet : l'absence d'une pièce relève de `coherence.py`).
Gravités : `erreur` (le dossier serait faux) / `avertissement` (à vérifier). Rien n'est
modifié ; le contrôle ne bloque rien.
"""
from collections import OrderedDict, defaultdict

from .rc import _cle, _squelette

ERREUR, AVERTISSEMENT = 'erreur', 'avertissement'

CHAMPS_POINTS = {
    'LPA': ('nom_point',), 'PPA': ('nom_point',), 'PPN': ('nom_point',),
    'ROB': ('point',), 'RTLB': ('de', 'vers'),
    'RDD': ('nom_point',), 'RDL': ('nom_point',), 'RDN': ('nom_point',), 'RDIA': ('nom_point',),
}
DETERMINATIONS = ('RDL', 'RDN', 'RDIA')
OBSERVATIONS = ('ROB', 'RTLB')


class _Source:
    """Points d'un type de pièce (toutes les pièces de ce type dans la portée)."""

    def __init__(self):
        self.pieces = []                      # [piece]
        self.noms = OrderedDict()             # clé → nom affiché (premier rencontré)
        self.graphies = defaultdict(set)      # clé → graphies brutes
        self.occurrences = defaultdict(int)   # clé → nb de lignes (par pièce de référence)

    def __bool__(self):
        return bool(self.pieces)

    def cles(self):
        return set(self.noms)


def _ref(piece):
    return {'id': str(piece.id), 'type_piece': piece.type_piece,
            'libelle': piece.get_type_piece_display() + (f' n°{piece.numero}' if piece.numero else '')}


def _charger(pieces):
    sources = defaultdict(_Source)
    for p in pieces:
        champs = CHAMPS_POINTS.get(p.type_piece)
        if not champs:
            continue
        src = sources[p.type_piece]
        src.pieces.append(p)
        vus_piece = defaultdict(int)
        for row in (p.payload or {}).get('rows') or []:
            for champ in champs:
                brut = str(row.get(champ) or '').strip()
                cle = _cle(brut)
                if not cle:
                    continue
                src.noms.setdefault(cle, brut)
                src.graphies[cle].add(brut)
                vus_piece[cle] += 1
        for cle, n in vus_piece.items():
            src.occurrences[cle] = max(src.occurrences[cle], n)
    return sources


def _union(sources, types):
    out = OrderedDict()
    for t in types:
        if t in sources:
            for cle, nom in sources[t].noms.items():
                out.setdefault(cle, nom)
    return out


def _pieces(sources, types):
    return [_ref(p) for t in types if t in sources for p in sources[t].pieces]


def analyser_controle_croise(pieces, tolerances_config=None):
    """`pieces` : pièces VIVANTES de la portée (SDGPS, ou une session + pièces communes).
    `tolerances_config` : tolérances de l'appelant (seuils des contrôles de valeurs)."""
    pieces = list(pieces)
    sources = _charger(pieces)
    controles = []

    def ajouter(code, gravite, titre, message, noms, types):
        noms = sorted(set(noms), key=lambda n: (len(n), n))
        if noms:
            controles.append({'code': code, 'gravite': gravite, 'titre': titre, 'message': message,
                              'points': noms, 'nombre': len(noms), 'pieces': _pieces(sources, types)})

    lpa, ppa, ppn, rdd = (sources.get(t) for t in ('LPA', 'PPA', 'PPN', 'RDD'))
    anciens = lpa.cles() if lpa else set()
    nouveaux = ppn.cles() if ppn else set()
    connus = _union(sources, ('LPA', 'PPN', 'PPA'))

    # 1. Doublons dans les pièces de référence.
    for t in ('LPA', 'PPA', 'PPN', 'RDD'):
        src = sources.get(t)
        if src:
            ajouter(f'doublon_{t.lower()}', ERREUR, f'Points en double — {t}',
                    'Un même point figure plusieurs fois dans la pièce.',
                    [src.noms[c] for c, n in src.occurrences.items() if n > 1], (t,))

    # 2. Détermination définitive : tous les points anciens et nouveaux, rien d'inconnu.
    if rdd:
        if lpa:
            ajouter('lpa_hors_rdd', ERREUR, 'Points anciens absents de la détermination définitive',
                    'Point de la LPA sans coordonnées définitives (RDD).',
                    [lpa.noms[c] for c in anciens - rdd.cles()], ('LPA', 'RDD'))
        if ppn:
            ajouter('ppn_hors_rdd', ERREUR, 'Points nouveaux absents de la détermination définitive',
                    'Point nouveau (PPN) sans coordonnées définitives (RDD).',
                    [ppn.noms[c] for c in nouveaux - rdd.cles()], ('PPN', 'RDD'))
        if lpa or ppn:
            ajouter('rdd_inconnu', AVERTISSEMENT, 'Points de la détermination définitive non répertoriés',
                    'Point du RDD qui n’est ni dans la LPA ni dans les photos des points nouveaux.',
                    [rdd.noms[c] for c in rdd.cles() - anciens - nouveaux - (ppa.cles() if ppa else set())],
                    ('RDD', 'LPA', 'PPN'))

    # 3. Fiches photo des points anciens.
    if lpa and ppa:
        ajouter('lpa_sans_ppa', AVERTISSEMENT, 'Points anciens sans fiche photo',
                'Point de la LPA absent des photos des points anciens (PPA).',
                [lpa.noms[c] for c in anciens - ppa.cles()], ('LPA', 'PPA'))
        ajouter('ppa_hors_lpa', AVERTISSEMENT, 'Fiches photo de points anciens hors LPA',
                'Point des PPA absent de la liste des points anciens.',
                [ppa.noms[c] for c in ppa.cles() - anciens], ('PPA', 'LPA'))

    # 4. Observations.
    observes = _union(sources, OBSERVATIONS)
    if observes:
        if lpa:
            ajouter('lpa_non_observe', AVERTISSEMENT, 'Points anciens non observés',
                    'Point de la LPA qui ne figure dans aucune observation (ROB, lignes de base).',
                    [lpa.noms[c] for c in anciens - set(observes)], ('LPA',) + OBSERVATIONS)
        if ppn:
            ajouter('ppn_non_observe', ERREUR, 'Points nouveaux non observés',
                    'Point nouveau qui ne figure dans aucune observation : il ne peut pas être déterminé.',
                    [ppn.noms[c] for c in nouveaux - set(observes)], ('PPN',) + OBSERVATIONS)
        if connus:
            ajouter('observe_inconnu', AVERTISSEMENT, 'Points observés non répertoriés',
                    'Point observé qui n’est ni dans la LPA ni dans les fiches photo.',
                    [nom for c, nom in observes.items() if c not in connus and not (rdd and c in rdd.cles())],
                    OBSERVATIONS + ('LPA', 'PPN'))

    # 5. Déterminations intermédiaires.
    dets = _union(sources, DETERMINATIONS)
    reference = set(connus) | (rdd.cles() if rdd else set())
    if dets and reference:
        ajouter('determination_inconnu', AVERTISSEMENT, 'Points des déterminations non répertoriés',
                'Point d’une détermination absent de la LPA, des fiches photo et du RDD.',
                [nom for c, nom in dets.items() if c not in reference], DETERMINATIONS)

    # 6. Photos ↔ lignes des fiches (PPA / PPN).
    for t in ('PPA', 'PPN'):
        src = sources.get(t)
        if not src:
            continue
        sans_photo, orphelines = [], []
        for p in src.pieces:
            lignes = (p.payload or {}).get('rows') or []
            cles_lignes = {}
            for row in lignes:
                ident = row.get('id')
                cle = str(ident).strip() if ident not in (None, '') else str(row.get('nom_point') or '').strip()
                if cle:
                    cles_lignes[cle] = str(row.get('nom_point') or cle)
            refs = [str(r or '').strip() for r in p.images.values_list('point_ref', flat=True)]
            sans_photo += [nom for cle, nom in cles_lignes.items() if cle not in refs]
            orphelines += [ref for ref in refs if ref and ref not in cles_lignes]
        ajouter(f'{t.lower()}_sans_photo', AVERTISSEMENT, f'Points sans photo — {t}',
                'Ligne de la fiche à laquelle aucune photo n’est rattachée.', sans_photo, (t,))
        ajouter(f'{t.lower()}_photo_orpheline', AVERTISSEMENT, f'Photos rattachées à aucun point — {t}',
                'Photo dont le point de rattachement ne correspond à aucune ligne de la fiche.',
                orphelines, (t,))

    # 7. Orthographe divergente d'un même point entre les pièces.
    graphies = defaultdict(set)
    for src in sources.values():
        for cle, g in src.graphies.items():
            graphies[cle] |= g
    ajouter('orthographe', AVERTISSEMENT, 'Même point écrit de plusieurs façons',
            'Le rapprochement les associe, mais la graphie diffère d’une pièce à l’autre.',
            [' / '.join(sorted(g)) for g in graphies.values() if len(g) > 1], tuple(sources))

    # 8. Noms qui ne diffèrent que par des caractères qui se confondent (« AXI6 » /
    # « AXl6 » / « AX16 », « O » / « 0 ») : presque toujours une faute de saisie. Le RC
    # les rapproche quand c'est sans ambiguïté ; l'opérateur doit pouvoir la corriger.
    par_squelette = defaultdict(set)
    for cle, g in graphies.items():
        par_squelette[_squelette(cle)].add(sorted(g)[0])
    ajouter('confusion', AVERTISSEMENT, 'Noms de points presque identiques',
            'Ces noms ne diffèrent que par des caractères qui se confondent (I / l / 1, '
            'O / 0) : vérifiez la saisie, il s’agit sans doute du même point.',
            [' / '.join(sorted(g)) for g in par_squelette.values() if len(g) > 1],
            tuple(sources))

    # Contrôles des VALEURS (coordonnées, vecteurs, boucles, observations, RC) : même format.
    from .controle_valeurs import controler_valeurs
    from .tolerances import effectives
    controles += controler_valeurs(pieces, effectives(tolerances_config))

    erreurs = sum(1 for c in controles if c['gravite'] == ERREUR)
    controles.sort(key=lambda c: (c['gravite'] != ERREUR, c['titre']))
    return {
        'ok': not controles,
        'erreurs': erreurs,
        'avertissements': len(controles) - erreurs,
        'controles': controles,
        'sources': {t: {'pieces': len(s.pieces), 'points': len(s.noms)} for t, s in sources.items()},
    }
