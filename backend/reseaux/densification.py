"""Densification : emplacement des points nouveaux à partir des points anciens homogènes.

Deux exigences guident le placement (cf. docs/normes-reseau-triangulation-gps.md) :
- le réseau anciens homogènes + nouveaux doit être le mieux conformé possible (N1…N10) ;
- **N11 — couverture du lever de détail** : tout point de la zone intérieure au réseau doit
  se trouver à moins de `rayon_km` (5 km par défaut) d'au moins `points_min` (3) points de
  densification, depuis lesquels les points de détail sont levés (stop and go / RTK).

La zone est l'enveloppe convexe des points anciens homogènes. Elle est échantillonnée sur
une grille ; la couverture est la part des échantillons qui voient au moins `points_min`
points dans le rayon.

Score de densification (sur 100) = 0,8 × score du réseau + 20 × taux de couverture : un
réseau parfait qui laisse des zones sans appui n'atteint pas 100.

Placement automatique : ajout glouton du candidat qui améliore le plus ce score (grille de
la zone, centres des triangles mal conformés, zones non couvertes), puis passes de
déplacement local de chaque point proposé. Les points nouveaux placés par l'opérateur sont
conservés tels quels.
"""
import math

from . import normes as N
from .generation import (
    STATUT_ANCIEN, STATUT_NOUVEAU, TYPE_MIXTE, _fmt, _qualite_triangle, _sortie_points,
    _variante_toleree, evaluer,
)
from .geometrie import centre_circonscrit, dans_polygone, delaunay, distance, enveloppe_convexe
from .projection import lambert_vers_wgs84

RAYON_KM_DEFAUT = 5.0
POINTS_MIN_DEFAUT = 3
NOUVEAUX_MAX = 50
ECHANTILLONS_CIBLE = 500
CANDIDATS_GRILLE_CIBLE = 140
POIDS_RESEAU = 0.8
CANDIDATS_EVALUES = 25
DEPLACEMENTS_MAX_POINTS = 15
POIDS_COUVERTURE = 20.0


class ErreurDensification(ValueError):
    """Données inexploitables (message destiné à l'utilisateur)."""


def _grille(poly, cible):
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    xmin, xmax, ymin, ymax = min(xs), max(xs), min(ys), max(ys)
    aire = max((xmax - xmin) * (ymax - ymin), 1.0)
    pas = math.sqrt(aire / cible)
    pts = []
    y = ymin + pas / 2
    while y < ymax:
        x = xmin + pas / 2
        while x < xmax:
            if dans_polygone((x, y), poly):
                pts.append((x, y))
            x += pas
        y += pas
    return pts, pas


def couverture(echantillons, coords, rayon_m, points_min):
    """(taux strict, indices des échantillons non couverts, taux progressif).

    Le taux progressif crédite chaque échantillon de min(n, points_min) / points_min : il
    guide l'optimisation (un point seul n'améliore pas le taux strict, qui exige
    `points_min` points à la fois)."""
    if not echantillons:
        return 1.0, [], 1.0
    r2 = rayon_m * rayon_m
    non, credit = [], 0.0
    for k, e in enumerate(echantillons):
        n = 0
        for p in coords:
            if (p[0] - e[0]) ** 2 + (p[1] - e[1]) ** 2 <= r2:
                n += 1
                if n >= points_min:
                    break
        credit += n / points_min
        if n < points_min:
            non.append(k)
    return 1 - len(non) / len(echantillons), non, credit / len(echantillons)


def _evaluer(coords, statuts, longueur_max_m, echantillons, rayon_m, points_min, avec_n8=False):
    aretes = _variante_toleree(coords, longueur_max_m=longueur_max_m)
    ev = evaluer(coords, statuts, aretes, longueur_max_m, TYPE_MIXTE, avec_n8=avec_n8)
    taux, non, progressif = couverture(echantillons, coords, rayon_m, points_min)
    s = POIDS_RESEAU * ev['indicateurs']['score'] + POIDS_COUVERTURE * taux
    return s, ev, taux, non, progressif


def _objectif(r):
    """Critère d'optimisation : score affiché + crédit de couverture progressive."""
    s, _, _, _, progressif = r
    return s + POIDS_COUVERTURE * progressif


def _candidats(coords, poly, grille, echantillons, non_couverts, espacement_min, rayon_m, points_min):
    """Candidats à évaluer complètement : centres des triangles mal conformés (qualité du
    réseau) + les candidats au meilleur gain de couverture (pré-filtre rapide)."""
    def libre(c):
        return min(distance(c, p) for p in coords) >= espacement_min

    qualite = []
    for t in delaunay(coords):
        if not _qualite_triangle(coords, t)['conforme']:
            cc = centre_circonscrit(*(coords[i] for i in t))
            if cc and dans_polygone(cc, poly) and libre(cc):
                qualite.append(cc)
    pas = max(1, len(non_couverts) // 40)
    pool = [c for c in list(grille) + [echantillons[k] for k in non_couverts[::pas]] if libre(c)]
    if non_couverts and pool:
        r2 = rayon_m * rayon_m
        manque = {}
        for k in non_couverts:
            e = echantillons[k]
            n = sum(1 for p in coords if (p[0] - e[0]) ** 2 + (p[1] - e[1]) ** 2 <= r2)
            manque[k] = n
        def gain(c):
            return sum(1 for k, n in manque.items() if n < points_min and
                       (echantillons[k][0] - c[0]) ** 2 + (echantillons[k][1] - c[1]) ** 2 <= r2)
        pool = sorted(pool, key=gain, reverse=True)[:CANDIDATS_EVALUES]
    else:
        pool = pool[:CANDIDATS_EVALUES]
    return qualite[:15] + pool


def densifier(anciens, nouveaux_fixes=(), nb_nouveaux=0, zone='nord',
              longueur_max_km=N.LONGUEUR_MAX_KM_DEFAUT, rayon_km=RAYON_KM_DEFAUT,
              points_min=POINTS_MIN_DEFAUT, proposer=True):
    """Propose (ou seulement évalue) les points nouveaux.

    `anciens` / `nouveaux_fixes` : dicts au format LPA (x_m, y_m, nom_point…).
    `nb_nouveaux` : nombre de points à proposer EN PLUS des points fixés ; 0 = automatique
    (jusqu'à couverture complète et tant que le score progresse).
    """
    anc = [{**p, 'statut': STATUT_ANCIEN} for p in anciens]
    nouv = [{**p, 'statut': STATUT_NOUVEAU, 'origine': p.get('origine') or 'manuel'}
            for p in nouveaux_fixes]
    if len(anc) < N.ANCIENS_MIN:
        raise ErreurDensification(f'Au moins {N.ANCIENS_MIN} points anciens homogènes sont nécessaires.')
    pts = anc + nouv
    for p in pts:
        try:
            p['x_m'], p['y_m'] = float(p['x_m']), float(p['y_m'])
        except (KeyError, TypeError, ValueError):
            raise ErreurDensification(f"Coordonnées invalides pour « {p.get('nom_point') or '?'} ».")
        p['nom_point'] = str(p.get('nom_point') or '').strip() or 'P'
    coords = [(p['x_m'], p['y_m']) for p in pts]
    statuts = [p['statut'] for p in pts]
    sous = [coords[i] for i in range(len(anc))]
    env = enveloppe_convexe(sous)
    if len(env) < 3:
        raise ErreurDensification('Les points anciens homogènes sont alignés : aucune zone à densifier.')
    poly = [sous[i] for i in env]
    longueur_max_m = float(longueur_max_km) * 1000
    rayon_m = float(rayon_km) * 1000
    points_min = int(points_min)
    echantillons, pas_ech = _grille(poly, ECHANTILLONS_CIBLE)
    grille, pas_grille = _grille(poly, CANDIDATS_GRILLE_CIBLE)
    espacement_min = max(50.0, 0.35 * pas_grille)

    def evaluation(c):
        return _evaluer(c, statuts + [STATUT_NOUVEAU] * (len(c) - len(statuts)), longueur_max_m,
                        echantillons, rayon_m, points_min)

    courant = evaluation(coords)
    score_initial, taux_initial = courant[0], courant[2]
    proposes = []
    if proposer:
        cible = int(nb_nouveaux)
        auto = cible <= 0
        limite = NOUVEAUX_MAX if auto else min(cible, NOUVEAUX_MAX)
        while len(proposes) < limite and len(coords) < N.POINTS_MAX:
            meilleur = None
            for c in _candidats(coords, poly, grille, echantillons, courant[3], espacement_min,
                                rayon_m, points_min):
                r = evaluation(coords + [c])
                if meilleur is None or _objectif(r) > _objectif(meilleur[0]):
                    meilleur = (r, c)
            if meilleur is None:
                break
            r, c = meilleur
            # Mode automatique : on s'arrête quand la zone est couverte et que le score
            # ne progresse plus sensiblement.
            if auto and courant[2] >= 1.0 and r[0] - courant[0] < 0.5:
                break
            coords.append(c)
            statuts.append(STATUT_NOUVEAU)
            proposes.append(len(coords) - 1)
            courant = r
        # Déplacements locaux : chaque point proposé glisse vers un voisinage meilleur
        # (limité aux petites densifications : le coût croît avec le nombre de points).
        pas_deplacement = (pas_grille / 2, pas_grille / 4) if len(proposes) <= DEPLACEMENTS_MAX_POINTS else ()
        for pas in pas_deplacement:
            for idx in proposes:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
                    x0, y0 = coords[idx]
                    c = (x0 + dx * pas, y0 + dy * pas)
                    if not dans_polygone(c, poly):
                        continue
                    if min(distance(c, p) for k, p in enumerate(coords) if k != idx) < espacement_min:
                        continue
                    essai = list(coords)
                    essai[idx] = c
                    r = evaluation(essai)
                    if _objectif(r) > _objectif(courant) + 1e-6:
                        coords, courant = essai, r

    score, ev, taux, non, _ = _evaluer(coords, statuts, longueur_max_m, echantillons, rayon_m,
                                       points_min, avec_n8=True)
    for rang, idx in enumerate(proposes, start=1):
        nom = f'PN{len(nouv) + rang}'
        pts.append({'id': nom, 'nom_point': nom, 'x_m': coords[idx][0], 'y_m': coords[idx][1],
                    'reference': '', 'nature_materialisation': '', 'nature_signalisation': '',
                    'statut': STATUT_NOUVEAU, 'origine': 'propose'})
    for k, p in enumerate(pts):
        p['x_m'], p['y_m'] = coords[k]

    ok_couv = taux >= 1.0
    ev['controles'].append({
        'code': 'COUVERTURE', 'norme': 'N11', 'gravite': 'majeur', 'ok': ok_couv,
        'message': (f'Toute la zone est à moins de {_fmt(rayon_km, 0)} km de {points_min} points'
                    if ok_couv else
                    f'{_fmt((1 - taux) * 100, 0)} % de la zone à plus de {_fmt(rayon_km, 0)} km '
                    f'de {points_min} points de densification.'),
    })
    zone_ll = [list(lambert_vers_wgs84(x, y, zone)) for x, y in poly]
    pas_aff = max(1, len(non) // 400)
    non_couverts = [list(lambert_vers_wgs84(*echantillons[k], zone)) for k in non[::pas_aff]]
    sortie_points = _sortie_points(pts, coords, ev['degres'], zone)
    nb_prop = len(proposes)
    if proposer and nb_prop:
        conclusion = (f"{nb_prop} point(s) nouveau(x) proposé(s) : score de densification "
                      f"{_fmt(score_initial)} → {_fmt(score)}/100, couverture N11 "
                      f"{_fmt(taux_initial * 100, 0)} % → {_fmt(taux * 100, 0)} %.")
    elif proposer:
        conclusion = "Aucun emplacement supplémentaire n'améliore le réseau."
    else:
        conclusion = (f"Score de densification {_fmt(score)}/100, couverture N11 "
                      f"{_fmt(taux * 100, 0)} %.")
    return {
        'zone': zone,
        'points': sortie_points,
        'proposes': [len(anc) + len(nouv) + k for k in range(nb_prop)],
        'reseau': {k: ev[k] for k in ('indicateurs', 'controles', 'admissible', 'lignes', 'triangles',
                                      'violations_stations_voisines')},
        'score_reseau': ev['indicateurs']['score'],
        'score': round(score, 2),
        'couverture': {
            'taux': round(taux, 4), 'rayon_km': float(rayon_km), 'points_min': points_min,
            'nb_echantillons': len(echantillons), 'pas_m': round(pas_ech, 1),
            'non_couverts': non_couverts,
        },
        'zone_polygone': zone_ll,
        'conclusion': conclusion,
    }
