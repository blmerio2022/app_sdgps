"""
Calcul automatique du tableau de la pièce « Rapport de contrôle » (RC).

Le RC croise deux pièces sources :
- « Liste des points anciens » (LPA)   → coordonnées FIXES (vraies) des points anciens ;
- « Rapports de la détermination N°k » (RDN, une par détermination intermédiaire nk)
  → coordonnées CALCULÉES des points dans chaque détermination.

Points de contrôle = **tous les points anciens de la LPA recalculés dans au moins une
détermination**. Pour chaque détermination ni (tenue fixe sur F_i) et chaque point de
contrôle P (Nom Point Calculé), on compare la coordonnée LPA de P (fixe) à sa coordonnée
calculée dans ni :
    ΔX = X_fixe − X_calculé,  ΔY = Y_fixe − Y_calculé,  ΔD = √(ΔX² + ΔY²)
Pour la ligne où P est tenu fixe dans ni, les écarts valent « -- ».

⚠️ Les points de contrôle étaient naguère limités aux points anciens **tenus fixes** dans
une détermination. Un point ancien recalculé mais jamais tenu fixe disparaissait alors du
tableau : sur un PDC réel, 5 points anciens sur 15 manquaient à chaque point fixe, avec
des écarts de 2 à 21 cm — donc certains hors tolérance (15 cm). Or c'est exactement ce
que le rapport de contrôle existe pour montrer, et ce dont la recherche des points
homogènes (norme N12) a besoin.
"""
import math

DASH = '--'
_SPACES = (' ', ' ', ' ', ' ')  # nbsp, narrow-nbsp, thin space, espace


def _to_float(value):
    """« 353 108.16 » / « 353 108,16 » → 353108.16 ; None si non numérique."""
    if value is None:
        return None
    t = str(value)
    for sp in _SPACES:
        t = t.replace(sp, '')
    t = t.replace(',', '.').strip()
    if t in ('', DASH, '?'):
        return None
    try:
        return float(t)
    except ValueError:
        return None


def _cle(nom):
    """Clé de RAPPROCHEMENT d'un nom de point entre deux pièces importées séparément.

    La LPA et les déterminations viennent de sources différentes (saisie, export TBC) :
    « CTB 26 », « ctb26 » et « CTB26 » désignent le même point ancien. Rapprocher à la
    casse et à l'espace près faisait disparaître le point du rapport, sans un mot.
    Le nom AFFICHÉ reste celui de la LPA, référence officielle du point ancien.
    """
    t = str(nom or '')
    for sp in _SPACES:
        t = t.replace(sp, '')
    return t.replace(' ', '').strip().casefold()


def _est_fixe(row):
    """Le point de cette ligne est-il tenu fixe (σx ou σy == « FIXE ») ?"""
    return (str(row.get('sigma_x_m', '')).strip().upper() == 'FIXE'
            or str(row.get('sigma_y_m', '')).strip().upper() == 'FIXE')


def _fixed_points(det_rows):
    """Noms des points tenus fixes dans une détermination, dans l'ordre d'apparition.

    Une détermination peut en tenir PLUSIEURS (cf. `compute_ecarts_vs_definitive`) : n'en
    retenir qu'un écartait les autres des points de contrôle.
    """
    noms = []
    for r in det_rows:
        if _est_fixe(r):
            n = str(r.get('nom_point', '')).strip()
            if n and n not in noms:
                noms.append(n)
    return noms


def _fixed_point(det_rows):
    """Premier point tenu fixe — c'est lui qui nomme la détermination dans le tableau."""
    noms = _fixed_points(det_rows)
    return noms[0] if noms else None


def compute_ecarts_vs_definitive(piece_rows, rdd_rows):
    """
    Deuxième version « écarts » d'une pièce RDL / RDN.

    Pour chaque point P de la pièce (version brute), compare sa coordonnée définitive
    (RDD, « supposée vraie » → Fixe) à sa coordonnée calculée dans la pièce (Calculé) :
        ΔX = X_fixe − X_calculé,  ΔY = Y_fixe − Y_calculé,  ΔD = √(ΔX² + ΔY²)
    piece_rows / rdd_rows : list[dict] (clés `nom_point`, `x_m`, `y_m`, `sigma_x_m`,
    `sigma_y_m`). Retourne list[dict] au schéma _ECARTS_CHAMPS (catalog.py). Les points
    absents du RDD sont ignorés.

    `nom_point_fixe` = nom(s) du/des point(s) tenu(s) FIXE dans la détermination courante
    (constant pour toutes les lignes) : vide pour une détermination libre (RDL, aucun point
    fixe), un ou plusieurs noms pour une détermination intermédiaire (RDN).
    """
    rdd = {}
    for r in rdd_rows:
        n = str(r.get('nom_point', '')).strip()
        if n and n not in rdd:
            rdd[n] = (r.get('x_m'), r.get('y_m'))

    # Point(s) fixe(s) de la détermination : σx ou σy == « FIXE » (ordre d'apparition).
    fixes = []
    for r in piece_rows:
        sx = str(r.get('sigma_x_m', '')).strip().upper()
        sy = str(r.get('sigma_y_m', '')).strip().upper()
        if sx == 'FIXE' or sy == 'FIXE':
            n = str(r.get('nom_point', '')).strip()
            if n and n not in fixes:
                fixes.append(n)
    fixes_label = ', '.join(fixes)

    out = []
    idx = 1
    for r in piece_rows:
        p = str(r.get('nom_point', '')).strip()
        if not p or p not in rdd:
            continue
        fx, fy = rdd[p]
        cx, cy = r.get('x_m'), r.get('y_m')
        fxv, fyv, cxv, cyv = _to_float(fx), _to_float(fy), _to_float(cx), _to_float(cy)
        if None in (fxv, fyv, cxv, cyv):
            dx = dy = dd = ''
        else:
            ddx, ddy = fxv - cxv, fyv - cyv
            dx = f'{ddx:.2f}'
            dy = f'{ddy:.2f}'
            dd = f'{math.hypot(ddx, ddy):.2f}'
        out.append({
            'id': str(idx),
            'nom_point_fixe': fixes_label,
            'nom_point_calcule': p,
            'x_m_fixe': fx, 'y_m_fixe': fy,
            'x_m_calcule': cx, 'y_m_calcule': cy,
            'delta_x_m': dx, 'delta_y_m': dy, 'delta_d_m': dd,
        })
        idx += 1
    return out


def assemble_determinations(sources):
    """
    Assemble plusieurs déterminations (RDL + RDNₖ) en un tableau brut unique (RDIA).
    sources : list ordonnée de {'label': str, 'rows': list[dict]} — `label` = « Libre »,
    « N°1 », « N°2 »… `rows` = payload brut de chaque détermination.
    Retourne list[dict] au schéma _RDIA_BRUT_CHAMPS (colonne `determination`, `id` global).
    """
    out = []
    idx = 1
    for src in sources:
        label = src.get('label', '')
        for r in src.get('rows') or []:
            out.append({
                'id': str(idx),
                'determination': label,
                'nom_point': r.get('nom_point', ''),
                'x_m': r.get('x_m', ''),
                'sigma_x_m': r.get('sigma_x_m', ''),
                'y_m': r.get('y_m', ''),
                'sigma_y_m': r.get('sigma_y_m', ''),
            })
            idx += 1
    return out


def compute_ecarts_assembled(brut_rows, rdd_rows):
    """
    Version « écarts » d'une pièce assemblée (RDIA) : calcule les écarts vs RDD
    détermination PAR détermination (bloc `determination`), en conservant l'ordre des
    blocs et la colonne `determination`. Réutilise compute_ecarts_vs_definitive par bloc.
    Retourne list[dict] au schéma _RDIA_ECARTS_CHAMPS.
    """
    groups = []  # [(label, [rows])] dans l'ordre d'apparition
    pos = {}
    for r in brut_rows:
        label = str(r.get('determination', '')).strip()
        if label not in pos:
            pos[label] = len(groups)
            groups.append((label, []))
        groups[pos[label]][1].append(r)

    out = []
    idx = 1
    for label, rows in groups:
        for b in compute_ecarts_vs_definitive(rows, rdd_rows):
            row = {'id': str(idx), 'determination': label}
            for k, v in b.items():
                if k != 'id':
                    row[k] = v
            out.append(row)
            idx += 1
    return out


def determinations_from_rdia(rdia_rows):
    """
    Reconstruit une liste de déterminations (au même format que les RDN) à partir des lignes
    BRUTES assemblées d'une pièce RDIA (schéma _RDIA_BRUT_CHAMPS : colonne `determination`).

    Chaque bloc `determination` (« Libre », « N°1 », « N°2 »…) devient une détermination
    {'numero': <label>, 'rows': [...]} dont les lignes portent les clés attendues par
    `compute_rapport_controle` / `_fixed_point` (`nom_point`, `x_m`, `y_m`, `sigma_x_m`,
    `sigma_y_m`). L'ordre d'apparition des blocs est préservé. Le bloc « Libre » (RDL, sans
    point fixe) est conservé mais sera naturellement ignoré au calcul (aucun point tenu fixe).
    """
    groups = []  # [(label, [rows])] dans l'ordre d'apparition
    pos = {}
    for r in rdia_rows or []:
        label = str(r.get('determination', '')).strip()
        if label not in pos:
            pos[label] = len(groups)
            groups.append((label, []))
        groups[pos[label]][1].append({
            'nom_point': r.get('nom_point', ''),
            'x_m': r.get('x_m', ''),
            'y_m': r.get('y_m', ''),
            'sigma_x_m': r.get('sigma_x_m', ''),
            'sigma_y_m': r.get('sigma_y_m', ''),
        })
    return [{'numero': label, 'rows': rows} for label, rows in groups]


def compute_rapport_controle(lpa_rows, determinations):
    """
    lpa_rows : list[dict] du LPA (clés `nom_point`, `x_m`, `y_m`).
    determinations : list[dict] {'numero', 'rows'} des RDN (triées par numéro) OU issues d'une
    pièce RDIA via `determinations_from_rdia`.
    Retourne list[dict] au schéma RC (_RC_CHAMPS de catalog.py).
    """
    # Points anciens, indexés par clé de rapprochement ; l'ordre de la LPA fixe l'ordre
    # des colonnes « Nom Point Calculé » du tableau.
    lpa = {}
    for r in lpa_rows:
        name = str(r.get('nom_point', '')).strip()
        cle = _cle(name)
        if cle and cle not in lpa:
            lpa[cle] = (name, r.get('x_m'), r.get('y_m'))

    # Détermination → (nom du point fixe, clés tenues fixes, {clé: (x, y) calculés}).
    det_info = []
    control = []        # clés des points de contrôle, dans l'ordre de la LPA
    recalcules = set()  # points anciens recalculés dans au moins une détermination
    for det in determinations:
        rows = det.get('rows') or []
        fixes = _fixed_points(rows)
        fname = fixes[0] if fixes else None
        cles_fixes = {_cle(n) for n in fixes}
        calc = {}
        for r in rows:
            cle = _cle(r.get('nom_point', ''))
            if cle and cle not in calc:
                calc[cle] = (r.get('x_m'), r.get('y_m'))
        det_info.append((fname, cles_fixes, calc))
        recalcules |= calc.keys() & lpa.keys()

    # Points de contrôle : TOUS les points anciens recalculés quelque part — pas seulement
    # ceux tenus fixes. Un point ancien recalculé porte un contrôle réel ; l'omettre le
    # perdait en silence. Un point ancien jamais recalculé n'a, lui, rien à contrôler.
    control = [cle for cle in lpa if cle in recalcules]

    out = []
    idx = 1
    for fname, cles_fixes, calc in det_info:
        # Détermination libre (aucun point fixe) ou tenue fixe sur un point hors LPA :
        # rien à contrôler, la colonne « Nom Point Fixe » n'aurait pas de sens.
        if not fname or _cle(fname) not in lpa:
            continue
        libelle_fixe = lpa[_cle(fname)][0]
        for pj in control:
            nom_affiche, fx, fy = lpa[pj]
            calc_xy = calc.get(pj)
            if pj in cles_fixes:
                # Point tenu fixe dans CETTE détermination : il ne se contrôle pas
                # contre lui-même (vrai aussi des points fixes secondaires).
                cx = cy = ''
                if calc_xy is not None:
                    cx, cy = calc_xy
                dx = dy = dd = DASH
            elif calc_xy is None:
                # Point ancien absent de cette détermination : la ligne reste, vide. Un
                # trou qui se voit vaut mieux qu'un tableau qui rétrécit sans rien dire.
                cx = cy = ''
                dx = dy = dd = ''
            else:
                cx, cy = calc_xy
                fxv, fyv, cxv, cyv = _to_float(fx), _to_float(fy), _to_float(cx), _to_float(cy)
                if None in (fxv, fyv, cxv, cyv):
                    dx = dy = dd = ''
                else:
                    ddx, ddy = fxv - cxv, fyv - cyv
                    dx = f'{ddx:.2f}'
                    dy = f'{ddy:.2f}'
                    dd = f'{math.hypot(ddx, ddy):.2f}'
            out.append({
                'id': str(idx),
                'nom_point_fixe': libelle_fixe,
                'nom_point_calcule': nom_affiche,
                'x_m_fixe': fx, 'y_m_fixe': fy,
                'x_m_calcule': cx, 'y_m_calcule': cy,
                'delta_x_m': dx, 'delta_y_m': dy, 'delta_d_m': dd,
            })
            idx += 1
    return out
