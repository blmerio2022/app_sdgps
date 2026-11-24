"""
Génération d'un réseau GNSS pour une ZONE donnée (dessinée ou importée), à partir de la liste
des points anciens disponibles (tous les points actifs, ou la seule sélection de l'opérateur).

1. **Candidats** : points anciens dans la zone ou à moins de `rayon_recherche_km` de son
   contour ; les autres sont écartés (« trop loin de la zone »).
2. **Encadrement (N9)** : dans chacun des quatre quadrants autour du centre de la zone, le
   candidat extérieur le plus proche du contour est retenu — la zone doit être entourée de
   points d'appui, pas seulement couverte d'un côté. S'y ajoutent les points DANS la zone.
3. **Optimisation gloutonne** : on ajoute, tant que l'objectif progresse d'au moins
   `GAIN_MIN`, le candidat qui l'améliore le plus (au plus `anciens_max`), puis on retire
   ceux dont l'abandon l'améliore (jamais sous 3 points, N10). Objectif = score de
   conformité du meilleur réseau épuré (N1…N8) + `POIDS_ENVELOPPE` × part de la zone située
   dans l'enveloppe des points retenus.
4. **Réseau** :
   - `triangulation` : variantes, recommandation et variante parfaite sur les points retenus
     (`generation.generer_reseau`) ;
   - `densification` : points nouveaux placés dans la zone, couverture N11 contrôlée sur la
     zone (`densification.densifier`).

Chaque point candidat reçoit un motif (retenu / écarté) affiché à l'opérateur.
"""
import math

from . import normes as N
from .densification import ErreurDensification, Region, _grille, densifier
from .generation import ErreurReseau, _fmt, generer_reseau
from .geometrie import dans_polygone, distance, enveloppe_convexe
from .optimisation import _score as score_reseau

MODES = ('triangulation', 'densification')
RAYON_RECHERCHE_KM_DEFAUT = 5.0
ANCIENS_MAX_DEFAUT = 12
ANCIENS_MAX_LIMITE = 40
CANDIDATS_MAX = 60
GAIN_MIN = 0.5
POIDS_ENVELOPPE = 20.0
QUADRANTS = ('nord-est', 'nord-ouest', 'sud-ouest', 'sud-est')


def _dist_segment(p, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    long2 = dx * dx + dy * dy
    t = 0.0 if long2 == 0 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / long2))
    return math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy))


def distance_a_la_zone(p, region):
    """0 dans la zone, sinon distance (m) au contour le plus proche."""
    if region.contient(p):
        return 0.0
    return min(_dist_segment(p, a[i], a[(i + 1) % len(a)])
               for poly in region.polygones for a in poly for i in range(len(a)))


def centre_zone(region):
    """Centre de gravité des surfaces extérieures (repli : centre de l'emprise)."""
    sx = sy = aire_totale = 0.0
    for poly in region.polygones:
        a = poly[0]
        for i in range(len(a)):
            (x1, y1), (x2, y2) = a[i], a[(i + 1) % len(a)]
            c = x1 * y2 - x2 * y1
            aire_totale += c
            sx += (x1 + x2) * c
            sy += (y1 + y2) * c
    if abs(aire_totale) < 1e-9:
        xmin, xmax, ymin, ymax = region.bbox
        return ((xmin + xmax) / 2, (ymin + ymax) / 2)
    return (sx / (3 * aire_totale), sy / (3 * aire_totale))


def quadrant(p, centre):
    dx, dy = p[0] - centre[0], p[1] - centre[1]
    if dx >= 0 and dy >= 0:
        return 'nord-est'
    if dx < 0 <= dy:
        return 'nord-ouest'
    if dx < 0 and dy < 0:
        return 'sud-ouest'
    return 'sud-est'


def _part_dans_enveloppe(coords, echantillons):
    if len(coords) < 3 or not echantillons:
        return 0.0
    env = enveloppe_convexe(coords)
    if len(env) < 3:
        return 0.0
    poly = [coords[i] for i in env]
    return sum(1 for e in echantillons if dans_polygone(e, poly)) / len(echantillons)


def _normaliser(anciens):
    pts, ignores = [], []
    for p in anciens:
        try:
            x, y = float(p['x_m']), float(p['y_m'])
        except (KeyError, TypeError, ValueError):
            ignores.append(str(p.get('nom_point') or '?'))
            continue
        if not (math.isfinite(x) and math.isfinite(y)):
            ignores.append(str(p.get('nom_point') or '?'))
            continue
        pts.append({**p, 'x_m': x, 'y_m': y, 'statut': 'ancien',
                    'nom_point': str(p.get('nom_point') or '').strip() or f'P{len(pts) + 1}'})
    return pts, ignores


def generer_pour_zone(anciens, zones, mode='densification', zone='nord',
                      rayon_recherche_km=RAYON_RECHERCHE_KM_DEFAUT, anciens_max=ANCIENS_MAX_DEFAUT,
                      longueur_max_km=N.LONGUEUR_MAX_KM_DEFAUT, rayon_couverture_km=5.0, points_min=3,
                      nb_nouveaux=0, nb_suggestions_max=N.SUGGESTIONS_MAX_DEFAUT, nom_zone=''):
    if mode not in MODES:
        raise ErreurReseau('Type de réseau inconnu (triangulation ou densification).')
    if not zones:
        raise ErreurReseau('Aucune zone : dessinez ou importez la zone à traiter.')
    try:
        region = Region(zones)
    except ErreurDensification as exc:
        raise ErreurReseau(str(exc))
    pts, ignores = _normaliser(anciens)
    longueur_max_m = float(longueur_max_km) * 1000
    rayon_m = float(rayon_recherche_km) * 1000
    anciens_max = max(N.ANCIENS_MIN, min(int(anciens_max), ANCIENS_MAX_LIMITE))
    centre = centre_zone(region)
    details = {p['nom_point']: {'nom_point': p['nom_point'], 'retenu': False, 'motif': '',
                                'distance_zone_m': round(distance_a_la_zone((p['x_m'], p['y_m']), region), 1)}
               for p in pts}
    for d in details.values():
        d['dans_zone'] = d['distance_zone_m'] == 0
    proches = sorted((p for p in pts if details[p['nom_point']]['distance_zone_m'] <= rayon_m),
                     key=lambda p: details[p['nom_point']]['distance_zone_m'])
    for p in pts:
        if details[p['nom_point']]['distance_zone_m'] > rayon_m:
            details[p['nom_point']]['motif'] = (f"À {_fmt(details[p['nom_point']]['distance_zone_m'] / 1000, 2)} km "
                                                f"de la zone (au-delà du rayon de recherche de {_fmt(rayon_recherche_km, 1)} km).")
    candidats = proches[:CANDIDATS_MAX]
    for p in proches[CANDIDATS_MAX:]:
        details[p['nom_point']]['motif'] = f'Au-delà des {CANDIDATS_MAX} points les plus proches de la zone.'
    if len(candidats) < N.ANCIENS_MIN:
        raise ErreurReseau(f'{len(candidats)} point(s) ancien(s) seulement dans la zone ou à moins de '
                           f'{_fmt(rayon_recherche_km, 1)} km : il en faut au moins {N.ANCIENS_MIN}. '
                           'Élargissez le rayon de recherche ou importez d\'autres points.')

    echantillons, _ = _grille(region, 300)
    xy = {p['nom_point']: (p['x_m'], p['y_m']) for p in candidats}

    def objectif(noms):
        coords = [xy[n] for n in noms]
        if len(coords) < 3:
            return -1.0, 0.0, 0.0
        s, _ = score_reseau(coords, ['ancien'] * len(coords), longueur_max_m, 'anciens')
        part = _part_dans_enveloppe(coords, echantillons)
        return s + POIDS_ENVELOPPE * part, s, part

    # 2. Encadrement + points dans la zone.
    retenus, raisons = [], {}
    for p in candidats:
        if details[p['nom_point']]['dans_zone']:
            retenus.append(p['nom_point'])
            raisons[p['nom_point']] = 'Dans la zone.'
    for q in QUADRANTS:
        dehors = [p for p in candidats if not details[p['nom_point']]['dans_zone']
                  and quadrant((p['x_m'], p['y_m']), centre) == q and p['nom_point'] not in retenus]
        if dehors:
            n = dehors[0]['nom_point']          # candidats triés par distance à la zone
            retenus.append(n)
            raisons[n] = f"Encadre la zone au {q} (à {_fmt(details[n]['distance_zone_m'] / 1000, 2)} km du contour)."
    for p in candidats:
        if len(retenus) >= N.ANCIENS_MIN:
            break
        if p['nom_point'] not in retenus:
            retenus.append(p['nom_point'])
            raisons[p['nom_point']] = 'Complète le minimum de 3 points anciens (N10).'
    retenus = retenus[:anciens_max] if len(retenus) > anciens_max else retenus

    # 3. Ajouts puis retraits gloutons.
    courant = objectif(retenus)
    while len(retenus) < anciens_max:
        meilleur = None
        for p in candidats:
            n = p['nom_point']
            if n in retenus:
                continue
            o = objectif(retenus + [n])
            if meilleur is None or o[0] > meilleur[1][0]:
                meilleur = (n, o)
        if meilleur is None or meilleur[1][0] - courant[0] < GAIN_MIN:
            break
        n, o = meilleur
        raisons[n] = f'Améliore le réseau : objectif {_fmt(courant[0])} → {_fmt(o[0])}.'
        retenus.append(n)
        courant = o
    retire = True
    while retire and len(retenus) > N.ANCIENS_MIN:
        retire = False
        for n in list(retenus):
            reste = [m for m in retenus if m != n]
            o = objectif(reste)
            if o[0] - courant[0] >= GAIN_MIN:
                details[n]['motif'] = f'Retiré : pénalise le réseau (objectif {_fmt(courant[0])} → {_fmt(o[0])} sans lui).'
                raisons.pop(n, None)
                retenus, courant, retire = reste, o, True
                break
    for p in candidats:
        n = p['nom_point']
        if n in retenus:
            details[n].update(retenu=True, motif=raisons.get(n, 'Retenu.'))
        elif not details[n]['motif']:
            details[n]['motif'] = "N'améliore pas le réseau de la zone."

    par_nom = {p['nom_point']: p for p in pts}
    choisis = [par_nom[n] for n in retenus]
    quadrants = {quadrant((p['x_m'], p['y_m']), centre) for p in choisis if not details[p['nom_point']]['dans_zone']}
    _, score_anciens, part = courant
    sortie = {
        'mode': mode, 'nom_zone': nom_zone, 'anciens_retenus': retenus,
        'details': sorted(details.values(), key=lambda d: (not d['retenu'], d['distance_zone_m'])),
        'nb_candidats': len(candidats), 'ignores': ignores,
        'quadrants': sorted(quadrants), 'part_zone_encadree': round(part, 4),
        'score_anciens': round(score_anciens, 2),
    }
    if mode == 'triangulation':
        r = generer_reseau(choisis, type_reseau='anciens', zone=zone, longueur_max_km=longueur_max_km,
                           nb_suggestions_max=nb_suggestions_max)
        sortie['reseau'] = r
        reco = next((v for v in r['variantes'] if v['recommandee']), r['variantes'][0])
        sortie['score'] = reco['indicateurs']['score']
        sortie['conclusion'] = (f"{len(retenus)} point(s) ancien(s) retenu(s) sur {len(candidats)} candidat(s) ; "
                                f"{_fmt(part * 100, 0)} % de la zone encadrée ({len(quadrants)} quadrant(s)) ; "
                                f"réseau recommandé « {reco['nom']} » : {_fmt(reco['indicateurs']['score'])}/100.")
    else:
        try:
            d = densifier(choisis, nb_nouveaux=nb_nouveaux, zone=zone, longueur_max_km=longueur_max_km,
                          rayon_km=rayon_couverture_km, points_min=points_min,
                          zones_densification=zones, zones_levee=zones)
        except ErreurDensification as exc:
            raise ErreurReseau(str(exc))
        sortie['densification'] = d
        sortie['score'] = d['score']
        nb_nouv = len([p for p in d['points'] if p['statut'] == 'nouveau'])
        sortie['conclusion'] = (f"{len(retenus)} point(s) ancien(s) retenu(s) sur {len(candidats)} candidat(s) "
                                f"et {nb_nouv} point(s) nouveau(x) dans la zone : score de densification "
                                f"{_fmt(d['score'])}/100, couverture N11 {_fmt(d['couverture']['taux'] * 100, 0)} %.")
    return sortie
