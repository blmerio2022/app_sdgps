"""Primitives géométriques planes (coordonnées Lambert, mètres) et triangulation de Delaunay.

Delaunay par l'algorithme de Bowyer-Watson, en Python pur : O(n²) au pire, largement
suffisant pour les quelques dizaines à centaines de points d'un canevas cadastral. Les
coordonnées sont recentrées et normalisées avant calcul (des X de l'ordre de 500 000 m
dégradent sinon le test du cercle circonscrit).
"""
import math


def distance(a, b):
    return math.hypot(b[0] - a[0], b[1] - a[1])


def azimut_deg(a, b):
    """Gisement (quadrillage Lambert) de a vers b, en degrés, compté depuis le Nord vers l'Est."""
    return (math.degrees(math.atan2(b[0] - a[0], b[1] - a[1])) + 360.0) % 360.0


def aire_signee(a, b, c):
    return ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2.0


def angles_triangle(a, b, c):
    """Angles (degrés) aux sommets a, b, c."""
    la, lb, lc = distance(b, c), distance(a, c), distance(a, b)

    def _angle(opp, s1, s2):
        if s1 == 0 or s2 == 0:
            return 0.0
        v = (s1 * s1 + s2 * s2 - opp * opp) / (2 * s1 * s2)
        return math.degrees(math.acos(max(-1.0, min(1.0, v))))

    return _angle(la, lb, lc), _angle(lb, la, lc), _angle(lc, la, lb)


def centre_circonscrit(a, b, c):
    d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
    if abs(d) < 1e-12:
        return None
    a2, b2, c2 = a[0] ** 2 + a[1] ** 2, b[0] ** 2 + b[1] ** 2, c[0] ** 2 + c[1] ** 2
    ux = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d
    uy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d
    return ux, uy


def apex_equilateral(a, b, cote_oppose=None):
    """Sommet du triangle équilatéral bâti sur [a, b], du côté OPPOSÉ au point `cote_oppose`
    (s'il est donné) ; sinon à gauche de a→b."""
    mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    dx, dy = b[0] - a[0], b[1] - a[1]
    h = math.sqrt(3) / 2
    p1 = (mx - dy * h, my + dx * h)
    p2 = (mx + dy * h, my - dx * h)
    if cote_oppose is None:
        return p1
    s_ref = aire_signee(a, b, cote_oppose)
    return p1 if aire_signee(a, b, p1) * s_ref < 0 else p2


def point_dans_triangle(p, a, b, c, marge=1e-9):
    """Strictement intérieur (les sommets et côtés ne comptent pas)."""
    d1, d2, d3 = aire_signee(p, a, b), aire_signee(p, b, c), aire_signee(p, c, a)
    seuil = max(abs(aire_signee(a, b, c)), 1e-12) * marge
    return (d1 > seuil and d2 > seuil and d3 > seuil) or \
        (d1 < -seuil and d2 < -seuil and d3 < -seuil)


def enveloppe_convexe(points):
    """Indices des sommets de l'enveloppe convexe (chaîne monotone d'Andrew), sens direct."""
    idx = sorted(range(len(points)), key=lambda i: (points[i][0], points[i][1]))
    if len(idx) < 3:
        return idx

    def croix(o, a, b):
        return (points[a][0] - points[o][0]) * (points[b][1] - points[o][1]) - \
            (points[a][1] - points[o][1]) * (points[b][0] - points[o][0])

    bas, haut = [], []
    for i in idx:
        while len(bas) >= 2 and croix(bas[-2], bas[-1], i) <= 0:
            bas.pop()
        bas.append(i)
    for i in reversed(idx):
        while len(haut) >= 2 and croix(haut[-2], haut[-1], i) <= 0:
            haut.pop()
        haut.append(i)
    return bas[:-1] + haut[:-1]


def dans_polygone(p, polygone):
    """Point dans un polygone (lancer de rayon)."""
    dedans = False
    n = len(polygone)
    for i in range(n):
        a, b = polygone[i], polygone[(i + 1) % n]
        if (a[1] > p[1]) != (b[1] > p[1]):
            x = a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if p[0] < x:
                dedans = not dedans
    return dedans


def delaunay(points):
    """Triangles de Delaunay [(i, j, k), …] (indices dans `points`), sens direct.

    Les triangles dégénérés (points alignés) sont écartés : un semis entièrement aligné
    renvoie une liste vide.
    """
    n = len(points)
    if n < 3:
        return []
    cx = sum(p[0] for p in points) / n
    cy = sum(p[1] for p in points) / n
    echelle = max(max(abs(p[0] - cx), abs(p[1] - cy)) for p in points) or 1.0
    pts = [((p[0] - cx) / echelle, (p[1] - cy) / echelle) for p in points]
    # Super-triangle englobant (coordonnées normalisées dans [-1, 1]).
    pts += [(-100.0, -100.0), (100.0, -100.0), (0.0, 100.0)]
    s0, s1, s2 = n, n + 1, n + 2

    def cercle(t):
        a, b, c = pts[t[0]], pts[t[1]], pts[t[2]]
        cc = centre_circonscrit(a, b, c)
        if cc is None:
            return (0.0, 0.0, float('inf'))
        return (cc[0], cc[1], (a[0] - cc[0]) ** 2 + (a[1] - cc[1]) ** 2)

    triangles = {(s0, s1, s2): cercle((s0, s1, s2))}
    for i in range(n):
        p = pts[i]
        mauvais = [t for t, (ux, uy, r2) in triangles.items()
                   if (p[0] - ux) ** 2 + (p[1] - uy) ** 2 < r2 * (1 + 1e-12)]
        compte = {}
        for t in mauvais:
            for e in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
                cle = tuple(sorted(e))
                compte[cle] = compte.get(cle, 0) + 1
        for t in mauvais:
            triangles.pop(t, None)
        for t in mauvais:
            for e in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
                if compte[tuple(sorted(e))] == 1:
                    nt = (e[0], e[1], i)
                    if aire_signee(pts[nt[0]], pts[nt[1]], pts[nt[2]]) < 0:
                        nt = (e[1], e[0], i)
                    triangles[nt] = cercle(nt)
    resultat = []
    for t in triangles:
        if max(t) >= n:
            continue
        a, b, c = points[t[0]], points[t[1]], points[t[2]]
        aire = abs(aire_signee(a, b, c))
        lmax = max(distance(a, b), distance(b, c), distance(a, c))
        if lmax == 0 or aire / (lmax * lmax) < 1e-9:
            continue
        resultat.append(tuple(sorted(t)))
    return sorted(set(resultat))
