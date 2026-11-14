"""Génération, évaluation et comparaison de variantes de réseau de triangulation GPS.

Toutes les règles sont celles de `docs/normes-reseau-triangulation-gps.md` (codes N1…N10,
seuils dans `normes.py`). Point d'entrée : `generer_reseau(...)`.

Vocabulaire :
- *ligne de base* = arête du réseau (vecteur GNSS à observer) ;
- *triangle* = 3 lignes de base formant une boucle élémentaire sans autre point à l'intérieur ;
- *variante* = un ensemble de lignes de base sur les mêmes points.
"""
import heapq
import math
from statistics import median

from . import normes as N
from .geometrie import (
    aire_signee, angles_triangle, apex_equilateral, azimut_deg, centre_circonscrit, dans_polygone,
    delaunay, distance, enveloppe_convexe, point_dans_triangle,
)
from .projection import lambert_vers_wgs84

TYPE_ANCIENS = 'anciens'
TYPE_MIXTE = 'mixte'
TYPES_RESEAU = {
    TYPE_ANCIENS: 'Réseau entre points anciens',
    TYPE_MIXTE: 'Réseau points anciens + points nouveaux',
}
STATUT_ANCIEN = 'ancien'
STATUT_NOUVEAU = 'nouveau'
STATUT_SUGGERE = 'suggere'

VARIANTES = {
    'delaunay': {
        'nom': 'Delaunay intégrale',
        'description': "Triangulation de Delaunay de tous les points : elle maximise l'angle "
                       "minimal parmi toutes les triangulations possibles (N1, N2).",
    },
    'delaunay_toleree': {
        'nom': 'Delaunay épurée (tolérances)',
        'description': "Delaunay dont on retire, depuis le pourtour, les triangles défectueux "
                       "(angle < 20° ou > 150°, N1b) ou ayant une ligne trop longue (N7), sans "
                       "jamais isoler un point (N5).",
    },
    'delaunay_stricte': {
        'nom': 'Delaunay épurée (stricte)',
        'description': "Même épluchage du pourtour avec les seuils de conformité stricts "
                       "(angles entre 30° et 120°, N1).",
    },
    'quadrilateres': {
        'nom': 'Quadrilatères renforcés',
        'description': "Delaunay complétée par la seconde diagonale de chaque quadrilatère "
                       "convexe (chaîne de quadrilatères de la triangulation classique) : "
                       "redondance maximale, mais davantage de lignes à observer.",
    },
    'rattachement': {
        'nom': 'Canevas des anciens + rattachement',
        'description': "Canevas épuré des seuls points anciens ; chaque point nouveau est "
                       "relié à ses 3 points anciens les plus proches (N10) et à son voisin "
                       "nouveau le plus proche.",
    },
    'parfaite': {
        'nom': 'Variante parfaite (avec points à rechercher)',
        'description': "Delaunay des points existants et des emplacements suggérés où "
                       "rechercher de nouveaux points anciens pour rendre le réseau conforme.",
    },
}


class ErreurReseau(ValueError):
    """Données d'entrée inexploitables (message destiné à l'utilisateur)."""


# --------------------------------------------------------------------------- outils graphe

def _arete(i, j):
    return (i, j) if i < j else (j, i)


def _aretes_des_triangles(triangles):
    aretes = set()
    for a, b, c in triangles:
        aretes.update((_arete(a, b), _arete(b, c), _arete(a, c)))
    return aretes


def _voisins(n, aretes):
    v = [set() for _ in range(n)]
    for i, j in aretes:
        v[i].add(j)
        v[j].add(i)
    return v


def _composantes(n, aretes, sommets=None):
    """Nombre de composantes connexes parmi `sommets` (tous par défaut)."""
    sommets = set(range(n)) if sommets is None else set(sommets)
    v = _voisins(n, aretes)
    vus, comp = set(), 0
    for s in sommets:
        if s in vus:
            continue
        comp += 1
        pile = [s]
        vus.add(s)
        while pile:
            x = pile.pop()
            for y in v[x]:
                if y in sommets and y not in vus:
                    vus.add(y)
                    pile.append(y)
    return comp


def _ponts(n, aretes):
    """Lignes de base qui n'appartiennent à aucune boucle (ponts, Tarjan itératif)."""
    v = _voisins(n, aretes)
    disc, bas = [-1] * n, [0] * n
    ponts, t = set(), 0
    for racine in range(n):
        if disc[racine] != -1:
            continue
        disc[racine] = bas[racine] = t
        t += 1
        pile = [(racine, -1, iter(v[racine]))]
        while pile:
            u, parent, it = pile[-1]
            avance = False
            for w in it:
                if w == parent:
                    continue
                if disc[w] == -1:
                    disc[w] = bas[w] = t
                    t += 1
                    pile.append((w, u, iter(v[w])))
                    avance = True
                    break
                bas[u] = min(bas[u], disc[w])
            if not avance:
                pile.pop()
                if pile:
                    p = pile[-1][0]
                    bas[p] = min(bas[p], bas[u])
                    if bas[u] > disc[p]:
                        ponts.add(_arete(p, u))
    return ponts


def _triangles_du_graphe(coords, aretes):
    """Boucles triangulaires (3-cliques) sans autre point à l'intérieur."""
    n = len(coords)
    v = _voisins(n, aretes)
    resultat = []
    for i, j in aretes:
        for k in v[i] & v[j]:
            if k <= j:
                continue
            a, b, c = coords[i], coords[j], coords[k]
            xmin, xmax = min(a[0], b[0], c[0]), max(a[0], b[0], c[0])
            ymin, ymax = min(a[1], b[1], c[1]), max(a[1], b[1], c[1])
            vide = True
            for m, p in enumerate(coords):
                if m in (i, j, k) or not (xmin < p[0] < xmax and ymin < p[1] < ymax):
                    continue
                if point_dans_triangle(p, a, b, c):
                    vide = False
                    break
            if vide:
                resultat.append(tuple(sorted((i, j, k))))
    return sorted(set(resultat))


# --------------------------------------------------------------------------- qualité

def _qualite_triangle(coords, t):
    angles = angles_triangle(coords[t[0]], coords[t[1]], coords[t[2]])
    amin, amax = min(angles), max(angles)
    return {
        'angles': angles,
        'min': amin,
        'max': amax,
        'conforme': amin >= N.ANGLE_MIN_CONFORME and amax <= N.ANGLE_MAX_CONFORME,
        'defectueux': amin < N.ANGLE_MIN_TOLERE or amax > N.ANGLE_MAX_TOLERE,
        'ecart': sum(abs(a - N.ANGLE_IDEAL) for a in angles) / 3.0,
    }


def _a_eplucher(coords, t, seuil_min, seuil_max, longueur_max_m):
    q = _qualite_triangle(coords, t)
    a, b, c = (coords[i] for i in t)
    trop_long = max(distance(a, b), distance(b, c), distance(a, c)) > longueur_max_m
    return q['min'] < seuil_min or q['max'] > seuil_max or trop_long


def _eplucher(coords, triangles, seuil_min, seuil_max, longueur_max_m):
    """Retire itérativement, depuis le pourtour, les triangles hors seuils, sans isoler de
    point ni scinder le réseau. Le pire triangle (angle minimal le plus faible) part d'abord."""
    n = len(coords)
    tris = set(triangles)
    while True:
        compte_aretes, compte_sommets = {}, {}
        for t in tris:
            for e in (_arete(t[0], t[1]), _arete(t[1], t[2]), _arete(t[0], t[2])):
                compte_aretes[e] = compte_aretes.get(e, 0) + 1
            for s in t:
                compte_sommets[s] = compte_sommets.get(s, 0) + 1
        candidats = []
        for t in tris:
            aretes_t = (_arete(t[0], t[1]), _arete(t[1], t[2]), _arete(t[0], t[2]))
            au_bord = any(compte_aretes[e] == 1 for e in aretes_t)
            if not au_bord or not _a_eplucher(coords, t, seuil_min, seuil_max, longueur_max_m):
                continue
            if any(compte_sommets[s] <= 1 for s in t):
                continue  # retirer ce triangle isolerait un point (N5)
            candidats.append((_qualite_triangle(coords, t)['min'], t))
        retire = False
        for _, t in sorted(candidats):
            reste = tris - {t}
            sommets = {s for tt in reste for s in tt}
            if _composantes(n, _aretes_des_triangles(reste), sommets) == 1:
                tris = reste
                retire = True
                break
        if not retire:
            return sorted(tris)


# --------------------------------------------------------------------------- variantes

def _variante_delaunay(coords, **_):
    return _aretes_des_triangles(delaunay(coords))


def _variante_toleree(coords, longueur_max_m, **_):
    tris = _eplucher(coords, delaunay(coords), N.ANGLE_MIN_TOLERE, N.ANGLE_MAX_TOLERE,
                     longueur_max_m)
    return _aretes_des_triangles(tris)


def _variante_stricte(coords, longueur_max_m, **_):
    tris = _eplucher(coords, delaunay(coords), N.ANGLE_MIN_CONFORME, N.ANGLE_MAX_CONFORME,
                     longueur_max_m)
    return _aretes_des_triangles(tris)


def _variante_quadrilateres(coords, longueur_max_m, **_):
    tris = delaunay(coords)
    aretes = _aretes_des_triangles(tris)
    opposes = {}
    for t in tris:
        for k in range(3):
            e = _arete(t[k], t[(k + 1) % 3])
            opposes.setdefault(e, []).append(t[(k + 2) % 3])
    for (a, b), opp in opposes.items():
        if len(opp) != 2:
            continue
        c, d = opp
        # Quadrilatère a-c-b-d convexe ⇔ a et b de part et d'autre de la diagonale c-d.
        if aire_signee(coords[c], coords[d], coords[a]) * \
                aire_signee(coords[c], coords[d], coords[b]) >= 0:
            continue
        if distance(coords[c], coords[d]) <= longueur_max_m:
            aretes.add(_arete(c, d))
    return aretes


def _variante_rattachement(coords, statuts, longueur_max_m, **_):
    anciens = [i for i, s in enumerate(statuts) if s == STATUT_ANCIEN]
    nouveaux = [i for i, s in enumerate(statuts) if s == STATUT_NOUVEAU]
    sous = [coords[i] for i in anciens]
    tris = _eplucher(sous, delaunay(sous), N.ANGLE_MIN_TOLERE, N.ANGLE_MAX_TOLERE,
                     longueur_max_m)
    aretes = {_arete(anciens[i], anciens[j]) for i, j in _aretes_des_triangles(tris)}
    for nv in nouveaux:
        proches = sorted(anciens, key=lambda a: distance(coords[nv], coords[a]))
        for a in proches[:N.ANCIENS_PAR_NOUVEAU]:
            aretes.add(_arete(nv, a))
        autres = [x for x in nouveaux if x != nv]
        if autres:
            plus_proche = min(autres, key=lambda x: distance(coords[nv], coords[x]))
            aretes.add(_arete(nv, plus_proche))
    return aretes


CONSTRUCTEURS = {
    'delaunay': _variante_delaunay,
    'delaunay_toleree': _variante_toleree,
    'delaunay_stricte': _variante_stricte,
    'quadrilateres': _variante_quadrilateres,
    'rattachement': _variante_rattachement,
}


def codes_variantes(type_reseau):
    codes = ['delaunay', 'delaunay_toleree', 'delaunay_stricte', 'quadrilateres']
    if type_reseau == TYPE_MIXTE:
        codes.append('rattachement')
    return codes


# --------------------------------------------------------------------------- évaluation

def _violations_stations_voisines(coords, aretes):
    """Paires non reliées dont la distance directe < 20 % du plus court chemin réseau (N8)."""
    n = len(coords)
    v = _voisins(n, aretes)
    violations = []
    for s in range(n):
        dist = [math.inf] * n
        dist[s] = 0.0
        tas = [(0.0, s)]
        while tas:
            d, u = heapq.heappop(tas)
            if d > dist[u]:
                continue
            for w in v[u]:
                nd = d + distance(coords[u], coords[w])
                if nd < dist[w]:
                    dist[w] = nd
                    heapq.heappush(tas, (nd, w))
        for t in range(s + 1, n):
            if t in v[s] or math.isinf(dist[t]):
                continue
            if distance(coords[s], coords[t]) < N.RATIO_STATIONS_VOISINES * dist[t]:
                violations.append((s, t))
    return violations


def _quadrants(centre, points):
    q = set()
    for p in points:
        dx, dy = p[0] - centre[0], p[1] - centre[1]
        if dx == 0 and dy == 0:
            continue
        q.add((dx >= 0, dy >= 0))
    return len(q)


def evaluer(coords, statuts, aretes, longueur_max_m, type_reseau, avec_n8=True):
    """Indicateurs, triangles, contrôles de conformité et score d'un ensemble de lignes."""
    n = len(coords)
    aretes = set(aretes)
    triangles = _triangles_du_graphe(coords, aretes)
    qualites = [_qualite_triangle(coords, t) for t in triangles]
    voisins = _voisins(n, aretes)
    degres = [len(v) for v in voisins]
    longueurs = [distance(coords[i], coords[j]) for i, j in aretes]
    ponts = _ponts(n, aretes)
    connexe = n > 0 and _composantes(n, aretes) == 1
    nb_e = len(aretes)
    nb_t = len(triangles)
    trop_longues = sum(1 for lg in longueurs if lg > longueur_max_m)
    violations_n8 = _violations_stations_voisines(coords, aretes) if avec_n8 else []

    anciens = [i for i, s in enumerate(statuts) if s == STATUT_ANCIEN]
    nouveaux = [i for i, s in enumerate(statuts) if s == STATUT_NOUVEAU]

    ind = {
        'nb_points': n,
        'nb_lignes_base': nb_e,
        'nb_triangles': nb_t,
        'angle_min': round(min((q['min'] for q in qualites), default=0.0), 2),
        'angle_max': round(max((q['max'] for q in qualites), default=0.0), 2),
        'ecart_equilateral_moyen': round(
            sum(q['ecart'] for q in qualites) / nb_t, 2) if nb_t else None,
        'taux_triangles_conformes': round(
            sum(1 for q in qualites if q['conforme']) / nb_t, 4) if nb_t else 0.0,
        'nb_triangles_defectueux': sum(1 for q in qualites if q['defectueux']),
        'degre_min': min(degres) if degres else 0,
        'degre_moyen': round(2 * nb_e / n, 2) if n else 0.0,
        'nb_points_sous_liaisons': sum(1 for d in degres if d < N.LIAISONS_MIN),
        'taux_points_bien_lies': round(
            sum(1 for d in degres if d >= N.LIAISONS_IDEAL) / n, 4) if n else 0.0,
        'redondance': nb_e - (n - 1),
        'taux_lignes_en_boucle': round((nb_e - len(ponts)) / nb_e, 4) if nb_e else 0.0,
        'longueur_max_km': round(max(longueurs, default=0.0) / 1000, 3),
        'longueur_moyenne_km': round(sum(longueurs) / nb_e / 1000, 3) if nb_e else 0.0,
        'longueur_totale_km': round(sum(longueurs) / 1000, 3),
        'nb_lignes_trop_longues': trop_longues,
        'lignes_par_point': round(nb_e / n, 2) if n else 0.0,
        'connexe': connexe,
        'nb_violations_stations_voisines': len(violations_n8),
    }

    controles = []

    def ctrl(code, norme, gravite, ok, message):
        controles.append({'code': code, 'norme': norme, 'gravite': gravite, 'ok': bool(ok),
                          'message': message})

    ctrl('TRIANGLES', 'N1', 'bloquant', nb_t > 0,
         f'{nb_t} triangle(s) formé(s)' if nb_t else
         'Aucun triangle : points alignés ou réseau sans boucle.')
    ctrl('CONNEXE', 'N4/N5', 'bloquant', connexe,
         'Réseau d\'un seul tenant' if connexe else 'Le réseau est scindé en plusieurs parties.')
    ctrl('LIAISONS_MIN', 'N5', 'bloquant', ind['nb_points_sous_liaisons'] == 0,
         'Chaque point a au moins 2 lignes de base' if ind['nb_points_sous_liaisons'] == 0
         else f"{ind['nb_points_sous_liaisons']} point(s) avec moins de 2 lignes de base.")
    if type_reseau == TYPE_MIXTE or anciens:
        ok_anciens = len(anciens) >= N.ANCIENS_MIN
        ctrl('ANCIENS_MIN', 'N10', 'bloquant', ok_anciens,
             f'{len(anciens)} point(s) ancien(s)' + ('' if ok_anciens else
                                                     f' : il en faut au moins {N.ANCIENS_MIN}.'))
    nb_non_conf = nb_t - round(ind['taux_triangles_conformes'] * nb_t)
    ctrl('ANGLES', 'N1', 'majeur', nb_t > 0 and nb_non_conf == 0,
         'Tous les triangles ont leurs angles entre 30° et 120°' if nb_t and not nb_non_conf
         else f'{nb_non_conf} triangle(s) hors de [30° ; 120°].')
    ctrl('DEFECTUEUX', 'N1b', 'majeur', ind['nb_triangles_defectueux'] == 0,
         'Aucun triangle défectueux' if not ind['nb_triangles_defectueux']
         else f"{ind['nb_triangles_defectueux']} triangle(s) avec un angle < 20° ou > 150°.")
    ctrl('BOUCLES', 'N4', 'majeur', nb_e > 0 and not ponts,
         'Toutes les lignes de base sont dans une boucle' if nb_e and not ponts
         else f'{len(ponts)} ligne(s) de base hors boucle.')
    ctrl('LONGUEUR', 'N7', 'majeur', trop_longues == 0,
         f'Toutes les lignes ≤ {longueur_max_m / 1000:g} km' if not trop_longues
         else f'{trop_longues} ligne(s) > {longueur_max_m / 1000:g} km.')
    ctrl('LIAISONS_IDEAL', 'N5', 'mineur', ind['taux_points_bien_lies'] == 1.0,
         'Chaque point a au moins 3 lignes de base' if ind['taux_points_bien_lies'] == 1.0
         else f"{n - round(ind['taux_points_bien_lies'] * n)} point(s) avec moins de 3 lignes.")
    if avec_n8:
        ctrl('STATIONS_VOISINES', 'N8', 'mineur', not violations_n8,
             'Règle des stations voisines respectée' if not violations_n8
             else f'{len(violations_n8)} paire(s) de stations proches non reliées.')

    penalite = min(10.0, 5.0 * max(0.0, ind['lignes_par_point'] - N.LIGNES_PAR_POINT_SANS_PENALITE))
    penalite += min(10.0, 2.0 * len(violations_n8))

    if type_reseau == TYPE_MIXTE and nouveaux:
        centre = (sum(coords[i][0] for i in nouveaux) / len(nouveaux),
                  sum(coords[i][1] for i in nouveaux) / len(nouveaux))
        nb_q = _quadrants(centre, [coords[i] for i in anciens])
        env = [coords[i] for i in enveloppe_convexe([coords[i] for i in anciens])] \
            if len(anciens) >= 3 else []
        # `enveloppe_convexe` renvoie des indices dans la sous-liste des anciens.
        if len(anciens) >= 3:
            sous = [coords[i] for i in anciens]
            env = [sous[i] for i in enveloppe_convexe(sous)]
        hors = [i for i in nouveaux if not env or not dans_polygone(coords[i], env)]
        mal_rattaches = [i for i in nouveaux
                         if sum(1 for w in voisins[i] if statuts[w] == STATUT_ANCIEN) < 2]
        ind.update({'quadrants_anciens': nb_q, 'nb_nouveaux_hors_enveloppe': len(hors),
                    'nb_nouveaux_mal_rattaches': len(mal_rattaches)})
        ctrl('QUADRANTS', 'N9', 'majeur', nb_q >= N.QUADRANTS_MIN,
             f'Points anciens présents dans {nb_q} quadrant(s) autour des nouveaux'
             + ('' if nb_q >= N.QUADRANTS_MIN else f' (minimum {N.QUADRANTS_MIN}).'))
        ctrl('ENVELOPPE', 'N9', 'majeur', not hors,
             'Tous les points nouveaux sont encadrés par les anciens' if not hors
             else f'{len(hors)} point(s) nouveau(x) hors de l\'enveloppe des anciens.')
        ctrl('RATTACHEMENT', 'N10', 'mineur', not mal_rattaches,
             'Chaque point nouveau est relié à au moins 2 anciens' if not mal_rattaches
             else f'{len(mal_rattaches)} point(s) nouveau(x) relié(s) à moins de 2 anciens.')
        if nb_q < N.QUADRANTS_MIN:
            penalite += 5.0
        if hors:
            penalite += 5.0

    ind['score'] = round(score(ind, longueur_max_m, penalite), 2)
    ind['penalite'] = round(penalite, 2)
    admissible = all(c['ok'] for c in controles if c['gravite'] == 'bloquant')

    lignes = []
    for i, j in sorted(aretes):
        lg = distance(coords[i], coords[j])
        lignes.append({
            'de': i, 'a': j,
            'distance_m': round(lg, 3),
            'distance_km': round(lg / 1000, 3),
            'azimut_deg': round(azimut_deg(coords[i], coords[j]), 2),
            'en_boucle': _arete(i, j) not in ponts,
            'trop_longue': lg > longueur_max_m,
        })
    tri_sortie = []
    for t, q in zip(triangles, qualites):
        tri_sortie.append({
            'sommets': list(t),
            'angles_deg': [round(a, 2) for a in q['angles']],
            'angle_min': round(q['min'], 2),
            'angle_max': round(q['max'], 2),
            'conforme': q['conforme'],
            'defectueux': q['defectueux'],
        })
    return {
        'indicateurs': ind,
        'controles': controles,
        'admissible': admissible,
        'lignes': lignes,
        'triangles': tri_sortie,
        'degres': degres,
        'violations_stations_voisines': [list(p) for p in violations_n8],
    }


def score(ind, longueur_max_m, penalite):
    """Score de conformité sur 100 : `30·C + 20·E + 15·A + 15·B + 10·L + 10·R − P`.

    C : part des triangles conformes (N1) ; E : 1 − écart moyen à 60°/30° (N2) ;
    A : angle minimal / 30°, plafonné à 1 (N1) ; B : part des lignes en boucle (N4) ;
    L : part des lignes ≤ longueur max (N7) ; R : part des points à ≥ 3 liaisons (N5) ;
    P : pénalités (coût d'observation, N8, N9).
    """
    if not ind['nb_triangles']:
        return 0.0
    c = ind['taux_triangles_conformes']
    e = max(0.0, 1 - (ind['ecart_equilateral_moyen'] or 0) / 30.0)
    a = min(1.0, ind['angle_min'] / N.ANGLE_MIN_CONFORME)
    b = ind['taux_lignes_en_boucle']
    lg = 1 - ind['nb_lignes_trop_longues'] / ind['nb_lignes_base'] if ind['nb_lignes_base'] else 0
    r = ind['taux_points_bien_lies']
    return max(0.0, 30 * c + 20 * e + 15 * a + 15 * b + 10 * lg + 10 * r - penalite)


# --------------------------------------------------------------------------- recommandation

def recommander(variantes):
    """Code de la meilleure variante admissible (score, puis moins de lignes) ou None."""
    admissibles = [v for v in variantes if v['admissible']]
    if not admissibles:
        return None
    meilleure = max(admissibles, key=lambda v: (v['indicateurs']['score'],
                                                -v['indicateurs']['nb_lignes_base']))
    return meilleure['code']


def _fmt(x, dec=1):
    """Nombre au format français, arrondi « au plus proche » comme l'écran (75,55 → 75,6)."""
    from decimal import ROUND_HALF_UP, Decimal
    q = Decimal(1).scaleb(-dec)
    return str(Decimal(str(x)).quantize(q, rounding=ROUND_HALF_UP)).replace('.', ',')


def justifier(variantes, code):
    """Phrases expliquant le choix de `code` par comparaison aux autres variantes."""
    if code is None:
        raisons = ["Aucune variante n'est recommandable : chacune échoue à un contrôle bloquant."]
        for v in variantes:
            bloq = [c['message'] for c in v['controles'] if c['gravite'] == 'bloquant' and not c['ok']]
            if bloq:
                raisons.append(f"{v['nom']} : {bloq[0]}")
        return raisons
    best = next(v for v in variantes if v['code'] == code)
    autres = [v for v in variantes if v['code'] != code]
    bi = best['indicateurs']
    raisons = []
    suivantes = sorted(autres, key=lambda v: -v['indicateurs']['score'])
    if suivantes:
        s = suivantes[0]
        raisons.append(
            f"Meilleur score de conformité : {_fmt(bi['score'])}/100 "
            f"(suivante : {s['nom']}, {_fmt(s['indicateurs']['score'])}/100).")
    else:
        raisons.append(f"Score de conformité : {_fmt(bi['score'])}/100.")
    non_adm = [v['nom'] for v in autres if not v['admissible']]
    if non_adm:
        raisons.append('Non recommandables (contrôle bloquant en échec) : ' + ', '.join(non_adm) + '.')
    angle_max_autres = max((v['indicateurs']['angle_min'] for v in autres), default=None)
    if angle_max_autres is not None and bi['angle_min'] >= angle_max_autres:
        raisons.append(f"Angle minimal le plus élevé : {_fmt(bi['angle_min'])}° (N1 : ≥ 30°).")
    else:
        raisons.append(f"Angle minimal : {_fmt(bi['angle_min'])}° (N1 : ≥ 30°).")
    raisons.append(
        f"{_fmt(bi['taux_triangles_conformes'] * 100, 0)} % de triangles conformes, "
        f"écart moyen à l'équilatéral {_fmt(bi['ecart_equilateral_moyen'] or 0)}° (N2).")
    raisons.append(
        f"Redondance de {bi['redondance']} boucle(s) indépendante(s), "
        f"{_fmt(bi['taux_lignes_en_boucle'] * 100, 0)} % des lignes en boucle (N4).")
    plus_cheres = [v for v in autres if v['indicateurs']['nb_lignes_base'] > bi['nb_lignes_base']]
    if plus_cheres:
        p = max(plus_cheres, key=lambda v: v['indicateurs']['nb_lignes_base'])
        raisons.append(
            f"{bi['nb_lignes_base']} lignes de base à observer ({_fmt(bi['lignes_par_point'], 2)} "
            f"par point) contre {p['indicateurs']['nb_lignes_base']} pour « {p['nom']} ».")
    raisons.append(
        f"Ligne de base la plus longue : {_fmt(bi['longueur_max_km'], 3)} km (N7).")
    vigilance = [c['message'] for c in best['controles'] if not c['ok']]
    if vigilance:
        raisons.append('Points de vigilance : ' + ' ; '.join(m.rstrip('.') for m in vigilance) + '.')
    return raisons


# --------------------------------------------------------------------------- variante parfaite

def _score_rapide(coords, statuts, longueur_max_m, type_reseau):
    aretes = _aretes_des_triangles(delaunay(coords))
    return evaluer(coords, statuts, aretes, longueur_max_m, type_reseau,
                   avec_n8=False)['indicateurs']['score']


def _noms(points, t):
    return '–'.join(points[i]['nom_point'] or f'P{i + 1}' for i in t)


def _candidats(coords, points, longueur_max_m):
    """Emplacements candidats [(x, y, motif, sommets concernés)] issus du réseau courant."""
    n = len(coords)
    tris = delaunay(coords)
    candidats = []
    if not tris:
        # Points alignés : triangles équilatéraux de part et d'autre de chaque segment.
        if n < 2:
            return []
        ax = max(range(n), key=lambda i: coords[i][0] + coords[i][1])
        ordre = sorted(range(n), key=lambda i: distance(coords[ax], coords[i]))
        for i, j in zip(ordre, ordre[1:]):
            for cote in (1, -1):
                a, b = (coords[i], coords[j]) if cote > 0 else (coords[j], coords[i])
                x, y = apex_equilateral(a, b)
                candidats.append((x, y, f"Sommet d'un triangle équilatéral sur {_noms(points, (i, j))} "
                                        "(points alignés : aucun triangle possible)", (i, j)))
        return candidats
    env = enveloppe_convexe(coords)
    poly = [coords[i] for i in env]
    compte = {}
    for t in tris:
        for e in (_arete(t[0], t[1]), _arete(t[1], t[2]), _arete(t[0], t[2])):
            compte[e] = compte.get(e, 0) + 1
    mauvais = sorted(((_qualite_triangle(coords, t), t) for t in tris
                      if not _qualite_triangle(coords, t)['conforme']),
                     key=lambda qt: qt[0]['min'])
    for q, t in mauvais[:20]:
        a, b, c = (coords[i] for i in t)
        cc = centre_circonscrit(a, b, c)
        if cc and dans_polygone(cc, poly):
            candidats.append((cc[0], cc[1],
                              f"Centre du cercle circonscrit du triangle {_noms(points, t)} "
                              f"(angle min {_fmt(q['min'])}°)", t))
        for k in range(3):
            i, j, o = t[k], t[(k + 1) % 3], t[(k + 2) % 3]
            if compte[_arete(i, j)] == 1:
                x, y = apex_equilateral(coords[i], coords[j], coords[o])
                candidats.append((x, y, f"Sommet équilatéral extérieur sur le côté "
                                        f"{_noms(points, (i, j))} du triangle {_noms(points, t)} "
                                        f"(angle min {_fmt(q['min'])}°)", t))
    for (i, j), _ in compte.items():
        lg = distance(coords[i], coords[j])
        if lg > longueur_max_m:
            candidats.append(((coords[i][0] + coords[j][0]) / 2, (coords[i][1] + coords[j][1]) / 2,
                              f"Milieu de la ligne {_noms(points, (i, j))} "
                              f"({_fmt(lg / 1000, 2)} km > {_fmt(longueur_max_m / 1000, 0)} km)", (i, j)))
    return candidats[:60]


def suggerer_points(points, coords, statuts, longueur_max_m, type_reseau, nb_max):
    """Raffinement glouton (type Ruppert) : ajoute, tant que le score progresse, l'emplacement
    candidat qui l'améliore le plus. Renvoie (points, coords, statuts, suggestions)."""
    pts, crd, sts = list(points), list(coords), list(statuts)
    suggestions = []
    score_courant = _score_rapide(crd, sts, longueur_max_m, type_reseau)
    for _ in range(nb_max):
        if len(crd) >= N.POINTS_MAX:
            break
        aretes = _aretes_des_triangles(delaunay(crd))
        longueurs = [distance(crd[i], crd[j]) for i, j in aretes] or [1.0]
        espacement = median(longueurs)
        meilleur = None
        for x, y, motif, concernes in _candidats(crd, pts, longueur_max_m):
            if min(distance((x, y), p) for p in crd) < 0.1 * espacement:
                continue
            s = _score_rapide(crd + [(x, y)], sts + [STATUT_SUGGERE], longueur_max_m, type_reseau)
            if meilleur is None or s > meilleur[0]:
                meilleur = (s, x, y, motif, concernes)
        if meilleur is None or meilleur[0] - score_courant < 0.5:
            break
        s, x, y, motif, concernes = meilleur
        cotes = [distance(crd[a], crd[b]) for a in concernes for b in concernes if a < b]
        rayon = max(50.0, 0.15 * (median(cotes) if cotes else espacement))
        rang = len(suggestions) + 1
        nom = f'S{rang}'
        pts.append({'id': nom, 'nom_point': nom, 'x_m': x, 'y_m': y, 'reference': '',
                    'nature_materialisation': '', 'nature_signalisation': '',
                    'statut': STATUT_SUGGERE})
        crd.append((x, y))
        sts.append(STATUT_SUGGERE)
        suggestions.append({
            'index': len(crd) - 1,
            'nom_point': nom,
            'x_m': round(x, 3), 'y_m': round(y, 3),
            'rayon_recherche_m': round(rayon, 1),
            'motif': motif,
            'score_avant': round(score_courant, 2),
            'score_apres': round(s, 2),
            'justification': (f"{motif}. Rechercher un point ancien existant dans un rayon "
                              f"d'environ {_fmt(rayon, 0)} m : le score de conformité passe de "
                              f"{_fmt(score_courant)} à {_fmt(s)}/100."),
        })
        score_courant = s
    return pts, crd, sts, suggestions


# --------------------------------------------------------------------------- entrée principale

def _normaliser_points(points, type_reseau):
    retenus = []
    for p in points:
        statut = (p.get('statut') or STATUT_ANCIEN).strip().lower()
        statut = STATUT_NOUVEAU if statut.startswith('nouv') else STATUT_ANCIEN
        if type_reseau == TYPE_ANCIENS and statut != STATUT_ANCIEN:
            continue
        try:
            x, y = float(p['x_m']), float(p['y_m'])
        except (KeyError, TypeError, ValueError):
            raise ErreurReseau(f"Coordonnées invalides pour le point « {p.get('nom_point') or '?'} ».")
        if not (math.isfinite(x) and math.isfinite(y)):
            raise ErreurReseau(f"Coordonnées invalides pour le point « {p.get('nom_point') or '?'} ».")
        retenus.append({
            'id': str(p.get('id') or ''),
            'nom_point': str(p.get('nom_point') or '').strip() or f'P{len(retenus) + 1}',
            'x_m': x, 'y_m': y,
            'reference': str(p.get('reference') or ''),
            'nature_materialisation': str(p.get('nature_materialisation') or ''),
            'nature_signalisation': str(p.get('nature_signalisation') or ''),
            'statut': statut,
        })
    if len(retenus) < N.POINTS_MIN:
        raise ErreurReseau(f'Au moins {N.POINTS_MIN} points sont nécessaires '
                           f'({len(retenus)} retenu(s) pour ce type de réseau).')
    if len(retenus) > N.POINTS_MAX:
        raise ErreurReseau(f'Au plus {N.POINTS_MAX} points par réseau ({len(retenus)} fournis).')
    if type_reseau == TYPE_MIXTE:
        if not any(p['statut'] == STATUT_NOUVEAU for p in retenus):
            raise ErreurReseau('Un réseau mixte demande au moins un point nouveau.')
    doublons = []
    for i in range(len(retenus)):
        for j in range(i + 1, len(retenus)):
            if distance((retenus[i]['x_m'], retenus[i]['y_m']),
                        (retenus[j]['x_m'], retenus[j]['y_m'])) < N.DISTANCE_DOUBLON_M:
                doublons.append(f"{retenus[i]['nom_point']} / {retenus[j]['nom_point']}")
    if doublons:
        raise ErreurReseau('Points confondus : ' + ', '.join(doublons[:5]) + '.')
    return retenus


def _sortie_points(points, coords, degres, zone):
    sortie = []
    for i, p in enumerate(points):
        lat, lon = lambert_vers_wgs84(coords[i][0], coords[i][1], zone)
        sortie.append({**p, 'index': i, 'x_m': round(coords[i][0], 3), 'y_m': round(coords[i][1], 3),
                       'lat': round(lat, 8), 'lon': round(lon, 8),
                       'degre': degres[i] if i < len(degres) else 0})
    return sortie


def generer_reseau(points, type_reseau=TYPE_ANCIENS, zone='nord',
                   longueur_max_km=N.LONGUEUR_MAX_KM_DEFAUT,
                   nb_suggestions_max=N.SUGGESTIONS_MAX_DEFAUT):
    """Calcule toutes les variantes, recommande la meilleure et propose la variante parfaite."""
    if type_reseau not in TYPES_RESEAU:
        raise ErreurReseau('Type de réseau inconnu.')
    pts = _normaliser_points(points, type_reseau)
    coords = [(p['x_m'], p['y_m']) for p in pts]
    statuts = [p['statut'] for p in pts]
    longueur_max_m = float(longueur_max_km) * 1000

    variantes = []
    for code in codes_variantes(type_reseau):
        aretes = CONSTRUCTEURS[code](coords, statuts=statuts, longueur_max_m=longueur_max_m)
        ev = evaluer(coords, statuts, aretes, longueur_max_m, type_reseau)
        variantes.append({'code': code, **VARIANTES[code], **ev})
    code_reco = recommander(variantes)
    for v in variantes:
        v['recommandee'] = v['code'] == code_reco

    pts_p, crd_p, sts_p, suggestions = suggerer_points(
        pts, coords, statuts, longueur_max_m, type_reseau, int(nb_suggestions_max))
    ev_p = evaluer(crd_p, sts_p, _aretes_des_triangles(delaunay(crd_p)), longueur_max_m,
                   type_reseau)
    for s in suggestions:
        s['lat'], s['lon'] = (round(c, 8) for c in lambert_vers_wgs84(s['x_m'], s['y_m'], zone))
    if suggestions:
        conclusion = (f"{len(suggestions)} emplacement(s) suggéré(s) : le score passe de "
                      f"{_fmt(suggestions[0]['score_avant'])} à "
                      f"{_fmt(suggestions[-1]['score_apres'])}/100.")
    else:
        conclusion = ("Aucun emplacement supplémentaire n'améliore sensiblement le réseau : "
                      "sa géométrie est déjà la meilleure atteignable avec ces points.")
    parfaite = {
        'code': 'parfaite', **VARIANTES['parfaite'], **ev_p,
        'points': _sortie_points(pts_p, crd_p, ev_p['degres'], zone),
        'suggestions': suggestions,
        'conclusion': conclusion,
        'recommandee': False,
    }

    from .optimisation import suggerer_suppressions  # import local : dépendance circulaire
    suppressions = suggerer_suppressions(pts, coords, statuts, longueur_max_m, type_reseau)

    degres_reco = next((v['degres'] for v in variantes if v['recommandee']), variantes[0]['degres'])
    return {
        'type_reseau': type_reseau,
        'zone': zone,
        'longueur_max_km': float(longueur_max_km),
        'points': _sortie_points(pts, coords, degres_reco, zone),
        'variantes': variantes,
        'recommandee': code_reco,
        'justification': justifier(variantes, code_reco),
        'parfaite': parfaite,
        'suppressions': suppressions,
    }
