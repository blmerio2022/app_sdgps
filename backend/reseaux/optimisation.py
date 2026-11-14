"""Optimisation du réseau de contrôle : points anciens dont l'abandon est conseillé.

Deux motifs, chacun justifié :
- **points quasi confondus** : deux points plus proches que le seuil de proximité créent
  des triangles aplatis et une ligne de base trop courte pour être utile ; on propose
  d'écarter celui des deux dont le retrait améliore le plus le score ;
- **point pénalisant** : le retrait du point fait progresser le score de conformité d'au
  moins `GAIN_MIN` (triangles plus proches de l'équilatéral, angles conformes, N1/N2).

Le réseau garde toujours au moins `ANCIENS_MIN` points anciens (N10). Les propositions
restent des propositions : c'est l'opérateur qui écarte un point.
"""
from statistics import median

from . import normes as N
from .generation import (
    STATUT_ANCIEN, _aretes_des_triangles, _fmt, _variante_stricte, _variante_toleree, evaluer,
)
from .geometrie import delaunay, distance

GAIN_MIN = 1.0
PROXIMITE_RELATIVE = 0.15   # fraction de la longueur médiane des lignes de base
PROXIMITE_MIN_M = 50.0
POINTS_MAX_ANALYSE = 150


def _score(coords, statuts, longueur_max_m, type_reseau):
    """Score du meilleur des réseaux épurés (tolérances / strict) : le même que celui de la
    variante recommandée dans la très grande majorité des cas, pour que les chiffres
    annoncés à l'opérateur se correspondent."""
    if len(coords) < 3:
        return 0.0, None
    meilleur = None
    for construire in (_variante_toleree, _variante_stricte):
        aretes = construire(coords, longueur_max_m=longueur_max_m)
        ev = evaluer(coords, statuts, aretes, longueur_max_m, type_reseau, avec_n8=False)
        if meilleur is None or ev['indicateurs']['score'] > meilleur['score']:
            meilleur = ev['indicateurs']
    return meilleur['score'], meilleur


def seuil_proximite_m(coords):
    aretes = _aretes_des_triangles(delaunay(coords))
    if not aretes:
        return PROXIMITE_MIN_M
    return max(PROXIMITE_MIN_M, PROXIMITE_RELATIVE * median(
        distance(coords[i], coords[j]) for i, j in aretes))


def suggerer_suppressions(points, coords, statuts, longueur_max_m, type_reseau):
    """Liste de propositions [{index, nom_point, motif, score_avant, score_apres, ...}]."""
    n = len(coords)
    anciens = [i for i, s in enumerate(statuts) if s == STATUT_ANCIEN]
    if len(anciens) <= N.ANCIENS_MIN or n > POINTS_MAX_ANALYSE:
        return []
    base, ind_base = _score(coords, statuts, longueur_max_m, type_reseau)
    seuil = seuil_proximite_m(coords)

    def sans(i):
        c = [p for k, p in enumerate(coords) if k != i]
        s = [x for k, x in enumerate(statuts) if k != i]
        return _score(c, s, longueur_max_m, type_reseau)

    scores = {i: sans(i) for i in anciens}
    propositions = {}

    # 1) Points quasi confondus.
    for a_pos, i in enumerate(anciens):
        for j in anciens[a_pos + 1:]:
            d = distance(coords[i], coords[j])
            if d >= seuil:
                continue
            k = i if scores[i][0] >= scores[j][0] else j
            autre = j if k == i else i
            s, ind = scores[k]
            propositions[k] = {
                'index': k, 'nom_point': points[k]['nom_point'], 'type': 'proximite',
                'score_avant': round(base, 2), 'score_apres': round(s, 2),
                'motif': (f"À {_fmt(d, 0)} m de {points[autre]['nom_point']} (seuil "
                          f"{_fmt(seuil, 0)} m) : les deux points font double emploi et créent "
                          f"des triangles aplatis (N1)."),
            }

    # 2) Points dont le retrait améliore nettement le score.
    for i in anciens:
        s, ind = scores[i]
        if i in propositions or s - base < GAIN_MIN:
            continue
        details = []
        if ind and ind_base:
            if ind['angle_min'] > ind_base['angle_min']:
                details.append(f"angle minimal {_fmt(ind_base['angle_min'])}° → {_fmt(ind['angle_min'])}°")
            if ind['taux_triangles_conformes'] > ind_base['taux_triangles_conformes']:
                details.append(
                    f"triangles conformes {_fmt(ind_base['taux_triangles_conformes'] * 100, 0)} % → "
                    f"{_fmt(ind['taux_triangles_conformes'] * 100, 0)} %")
        propositions[i] = {
            'index': i, 'nom_point': points[i]['nom_point'], 'type': 'penalisant',
            'score_avant': round(base, 2), 'score_apres': round(s, 2),
            'motif': ("Sans ce point, le réseau est mieux conformé (N1/N2)"
                      + (f" : {', '.join(details)}" if details else '') + '.'),
        }

    sortie = sorted(propositions.values(), key=lambda p: -(p['score_apres'] - p['score_avant']))
    # On ne propose jamais de descendre sous le minimum d'anciens.
    sortie = sortie[:max(0, len(anciens) - N.ANCIENS_MIN)]
    for p in sortie:
        p['justification'] = (f"{p['motif']} Score de conformité : {_fmt(p['score_avant'])} → "
                              f"{_fmt(p['score_apres'])}/100 si le point est écarté.")
    return sortie
