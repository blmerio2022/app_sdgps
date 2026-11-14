"""Analyse des écarts du rapport de contrôle (RC) et détection des points anciens homogènes.

Structure d'un RC (cf. `pieces/rc.py::compute_rapport_controle`) : pour chaque
détermination tenue fixe sur un point ancien F (`nom_point_fixe`), une ligne par point de
contrôle P (`nom_point_calcule`) avec l'écart ΔD entre les coordonnées connues de P et
celles calculées depuis F. Un ΔD ≤ tolérance (15 cm par défaut au cadastre) signifie que
F et P sont **cohérents entre eux**.

Les points homogènes sont donc l'ensemble le plus grand de points deux à deux cohérents :
une **clique maximale** du graphe de compatibilité (Bron–Kerbosch avec pivot ; quelques
dizaines de points au plus). À taille égale, la clique à la plus faible somme d'écarts
l'emporte.
"""
import math

from pieces.rc import _to_float

TOLERANCE_DEFAUT_M = 0.15
TOLERANCE_MIN_M = 0.001
TOLERANCE_MAX_M = 100.0


class ErreurEcarts(ValueError):
    """Rapport de contrôle inexploitable (message destiné à l'utilisateur)."""


def _nom(v):
    return str(v or '').strip()


def lire_lignes_rc(lignes):
    """Lignes normalisées {fixe, calcule, dx, dy, dd} ; ΔD recalculé s'il manque."""
    sortie = []
    for r in lignes or []:
        fixe, calcule = _nom(r.get('nom_point_fixe')), _nom(r.get('nom_point_calcule'))
        if not fixe or not calcule or fixe == calcule:
            continue  # ligne du point fixe lui-même (« -- ») ou incomplète
        dx, dy, dd = (_to_float(r.get(k)) for k in ('delta_x_m', 'delta_y_m', 'delta_d_m'))
        if dx is None or dy is None:
            xf, yf, xc, yc = (_to_float(r.get(k)) for k in
                              ('x_m_fixe', 'y_m_fixe', 'x_m_calcule', 'y_m_calcule'))
            if None not in (xf, yf, xc, yc):
                dx, dy = xf - xc, yf - yc
        if dd is None and dx is not None and dy is not None:
            dd = math.hypot(dx, dy)
        if dd is None:
            continue
        sortie.append({'fixe': fixe, 'calcule': calcule, 'dx': dx, 'dy': dy, 'dd': abs(dd)})
    return sortie


def _cliques_maximales(sommets, voisins):
    """Toutes les cliques maximales (Bron–Kerbosch avec pivot, itératif)."""
    resultat = []
    pile = [(set(), set(sommets), set())]
    while pile:
        r, p, x = pile.pop()
        if not p and not x:
            resultat.append(r)
            continue
        pivot = max(p | x, key=lambda u: len(voisins[u] & p))
        for v in list(p - voisins[pivot]):
            pile.append((r | {v}, p & voisins[v], x & voisins[v]))
            p = p - {v}
            x = x | {v}
    return resultat


def analyser_ecarts(lignes, tolerance_m=TOLERANCE_DEFAUT_M, noms_reseau=None):
    """Analyse un RC. `noms_reseau` (facultatif) : points anciens du réseau, pour signaler
    ceux que le RC ne contrôle pas."""
    tol = float(tolerance_m)
    rows = lire_lignes_rc(lignes)
    if not rows:
        raise ErreurEcarts("Aucune ligne d'écart exploitable : colonnes nom_point_fixe, "
                           "nom_point_calcule et ΔD (ou coordonnées fixes/calculées) attendues.")
    noms = sorted({r['fixe'] for r in rows} | {r['calcule'] for r in rows})
    # Écart retenu par paire : le pire des deux sens quand les deux existent.
    paires = {}
    for r in rows:
        cle = tuple(sorted((r['fixe'], r['calcule'])))
        paires[cle] = max(paires.get(cle, 0.0), r['dd'])
    voisins = {n: set() for n in noms}
    for (a, b), dd in paires.items():
        if dd <= tol:
            voisins[a].add(b)
            voisins[b].add(a)

    def somme(c):
        return sum(paires.get(tuple(sorted((a, b))), 0.0) for a in c for b in c if a < b)

    cliques = _cliques_maximales(noms, voisins)
    meilleure = max(cliques, key=lambda c: (len(c), -somme(c), sorted(c))) if cliques else set()

    par_point = []
    for n in noms:
        ecarts = [dd for (a, b), dd in paires.items() if n in (a, b)]
        hors = [(b if a == n else a, dd) for (a, b), dd in paires.items() if n in (a, b) and dd > tol]
        par_point.append({
            'nom_point': n,
            'nb_controles': len(ecarts),
            'ecart_max_m': round(max(ecarts), 4) if ecarts else None,
            'ecart_moyen_m': round(sum(ecarts) / len(ecarts), 4) if ecarts else None,
            'nb_hors_tolerance': len(hors),
            'incompatible_avec': sorted(x for x, _ in hors),
            'homogene': n in meilleure,
        })
    lignes_sortie = [{
        'nom_point_fixe': r['fixe'], 'nom_point_calcule': r['calcule'],
        'delta_x_m': None if r['dx'] is None else round(r['dx'], 4),
        'delta_y_m': None if r['dy'] is None else round(r['dy'], 4),
        'delta_d_m': round(r['dd'], 4),
        'hors_tolerance': r['dd'] > tol,
    } for r in rows]
    non_controles = sorted(set(noms_reseau or []) - set(noms))
    nb_hors = sum(1 for r in rows if r['dd'] > tol)
    homogenes = sorted(meilleure)
    ecartes = [n for n in noms if n not in meilleure]
    if not ecartes:
        conclusion = (f"Les {len(homogenes)} points contrôlés sont homogènes entre eux "
                      f"(tous les écarts ≤ {tol * 100:g} cm).")
    else:
        pluriel = len(ecartes) > 1
        conclusion = (f"{len(homogenes)} point(s) homogène(s) sur {len(noms)} : "
                      f"{', '.join(ecartes)} {'présentent' if pluriel else 'présente'} des écarts "
                      f"> {tol * 100:g} cm avec le groupe et "
                      f"{'ne sont pas retenus comme points' if pluriel else 'n’est pas retenu comme point'}"
                      f" d'appui.")
    return {
        'tolerance_m': tol,
        'lignes': lignes_sortie,
        'points': par_point,
        'homogenes': homogenes,
        'non_homogenes': ecartes,
        'non_controles': non_controles,
        'nb_lignes': len(rows),
        'nb_hors_tolerance': nb_hors,
        'conclusion': conclusion,
    }
