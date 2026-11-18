"""
Contrôle des VALEURS des pièces — complément du contrôle croisé des noms
(`controle_croise.py`), qui l'appelle et fusionne les résultats.

Le contrôle des noms ne voit pas un point tenu fixe sur des coordonnées fausses, un
rapport de contrôle périmé, un vecteur flottant ou observé sans simultanéité, une boucle
manquante. Cinq familles, chacune activable et réglable dans *Paramètres › Tolérances*
(`tolerances.DEFAUTS`, clés `cc_*`) :

1. `cc_points_fixes` — points tenus FIXES (σ = « FIXE ») dans RDN / RDIA / RDD : présents
   dans la LPA et aux MÊMES coordonnées (écart ≤ `max_m`) ; aucun point fixe dans une
   détermination libre (RDL) ; détermination intermédiaire sans point fixe signalée.
2. `cc_rc_rdd` — RC recalculé depuis la LPA et les déterminations actuelles, comparé au RC
   enregistré (RC périmé) ; points fixes du RDD = points anciens HOMOGÈNES de l'analyse
   N12 du RC (`reseaux.ecarts`), au moins 3 homogènes.
   `cc_sigmas` — σx / σy des points calculés sous `sigma_max_m` (RDL, RDN, RDIA, RDD).
3. `cc_vecteurs` — solution fixée ; précisions H / V et RMS ; longueur (N5) ; au moins
   2 vecteurs par station (N4) ; SIMULTANÉITÉ : les deux extrémités observées en même
   temps dans le ROB pendant au moins la durée du vecteur (les heures des vecteurs TBC ne
   sont pas exploitables, les fenêtres d'observation du ROB le sont).
4. `cc_boucles` — chaque vecteur dans au moins une boucle (N3, `id_boucle` liste les
   vecteurs) ; boucles citant un vecteur inconnu ; ppm.
5. `cc_observations` — ROB : fin après début, durée = fin − début, complétude (époques ×
   cadence / durée), hauteur d'antenne plausible, même fichier pour deux points.
"""
import math
from collections import defaultdict
from datetime import datetime

from .rc import _cle, compute_rapport_controle, determinations_from_rdia
from .tolerances import duree_secondes, nombre

ERREUR, AVERTISSEMENT = 'erreur', 'avertissement'
FORMATS_DATE = ('%d/%m/%Y %H:%M:%S', '%d/%m/%Y %H:%M', '%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S',
                '%m/%d/%Y %H:%M:%S')


def _date(v):
    texte = str(v or '').strip()
    for fmt in FORMATS_DATE:
        try:
            return datetime.strptime(texte, fmt)
        except ValueError:
            continue
    return None


def _fixe(r):
    return any(str(r.get(k, '')).strip().upper() == 'FIXE' for k in ('sigma_x_m', 'sigma_y_m'))


def _fr(v, fmt='g'):
    """Nombre au format français (virgule décimale), sans toucher au texte qui l'entoure."""
    return format(v, fmt).replace('.', ',')


def _cm(m):
    return f'{m * 100:.1f}'.replace('.', ',') + ' cm'


def _rows(p):
    return (p.payload or {}).get('rows') or []


def _ref(p):
    return {'id': str(p.id), 'type_piece': p.type_piece,
            'libelle': p.get_type_piece_display() + (f' n°{p.numero}' if p.numero else '')}


class _Collecte:
    def __init__(self):
        self.controles = []

    def ajouter(self, code, gravite, titre, message, points, pieces):
        points = list(dict.fromkeys(p for p in points if p))
        if points:
            self.controles.append({'code': code, 'gravite': gravite, 'titre': titre, 'message': message,
                                   'points': points, 'nombre': len(points),
                                   'pieces': [_ref(p) for p in pieces]})


def _par_type(pieces):
    out = defaultdict(list)
    for p in pieces:
        out[p.type_piece].append(p)
    return out


def _lpa_coords(pieces_lpa):
    coords = {}
    for p in pieces_lpa:
        for r in _rows(p):
            x, y = nombre(r.get('x_m')), nombre(r.get('y_m'))
            cle = _cle(r.get('nom_point'))
            if cle and x is not None and y is not None:
                coords.setdefault(cle, (str(r.get('nom_point')).strip(), x, y))
    return coords


def _blocs_determinations(t, pieces):
    """[(libellé, pièce, lignes)] : une détermination par pièce RDN / RDL / RDD, un bloc par
    valeur de `determination` pour une RDIA."""
    blocs = []
    for p in pieces.get(t, []):
        if t == 'RDIA':
            for d in determinations_from_rdia(_rows(p)):
                blocs.append((f"RDIA {d['numero']}", p, d['rows'], d['numero']))
        else:
            libelle = p.get_type_piece_display() if t != 'RDN' else f'Détermination N°{p.numero or "?"}'
            blocs.append((libelle, p, _rows(p), str(p.numero or '')))
    return blocs


# ---------------------------------------------------------------- 1. points fixes / σ

def _points_fixes(c, pieces, lpa, regle):
    max_m = float(regle.get('max_m', 0.01))
    for t in ('RDN', 'RDIA', 'RDD'):
        ecarts, hors_lpa, sans_fixe, concernees = [], [], [], set()
        for libelle, p, rows, numero in _blocs_determinations(t, pieces):
            fixes = [r for r in rows if _fixe(r)]
            if not fixes and t != 'RDD' and str(numero).strip().lower() not in ('libre', ''):
                sans_fixe.append(libelle)
                concernees.add(p)
            for r in fixes:
                cle = _cle(r.get('nom_point'))
                nom = str(r.get('nom_point') or '').strip()
                if not lpa:
                    continue
                if cle not in lpa:
                    hors_lpa.append(f'{libelle} : {nom}')
                    concernees.add(p)
                    continue
                x, y = nombre(r.get('x_m')), nombre(r.get('y_m'))
                if x is None or y is None:
                    continue
                d = math.hypot(x - lpa[cle][1], y - lpa[cle][2])
                if d > max_m:
                    ecarts.append(f'{libelle} : {nom} (Δ {_cm(d)})')
                    concernees.add(p)
        lpa_pieces = pieces.get('LPA', [])
        c.ajouter(f'fixe_coord_{t.lower()}', ERREUR, f'Points fixes aux coordonnées différentes de la LPA — {t}',
                  f'Un point tenu fixe doit l’être sur ses coordonnées connues (écart > {_cm(max_m)}).',
                  ecarts, list(concernees) + lpa_pieces)
        c.ajouter(f'fixe_hors_lpa_{t.lower()}', ERREUR, f'Points fixes absents de la LPA — {t}',
                  'Seul un point ancien (LPA) peut être tenu fixe.', hors_lpa, list(concernees) + lpa_pieces)
        c.ajouter(f'sans_fixe_{t.lower()}', AVERTISSEMENT, f'Déterminations sans point fixe — {t}',
                  'Une détermination intermédiaire est tenue fixe sur un point ancien.', sans_fixe, list(concernees))
    libres = [f"{p.get_type_piece_display()} : {str(r.get('nom_point') or '').strip()}"
              for p in pieces.get('RDL', []) for r in _rows(p) if _fixe(r)]
    c.ajouter('fixe_rdl', ERREUR, 'Point fixe dans la détermination libre',
              'La détermination libre ne tient aucun point fixe.', libres, pieces.get('RDL', []))


def _sigmas(c, pieces, regle):
    seuil = float(regle.get('sigma_max_m', 0.05))
    for t in ('RDL', 'RDN', 'RDIA', 'RDD'):
        hors, concernees = [], set()
        for libelle, p, rows, _ in _blocs_determinations(t, pieces):
            for r in rows:
                if _fixe(r):
                    continue
                sigmas = [nombre(r.get(k)) for k in ('sigma_x_m', 'sigma_y_m')]
                pire = max((s for s in sigmas if s is not None), default=None)
                if pire is not None and pire > seuil:
                    hors.append(f"{libelle} : {str(r.get('nom_point') or '').strip()} (σ {_cm(pire)})")
                    concernees.add(p)
        c.ajouter(f'sigma_{t.lower()}', AVERTISSEMENT, f'Précision insuffisante (σ) — {t}',
                  f'σx ou σy supérieur à {_cm(seuil)}.', hors, list(concernees))


# ---------------------------------------------------------------- 2. RC à jour, RC ↔ RDD

def _signature_rc(rows):
    out = {}
    for r in rows:
        cle = (_cle(r.get('nom_point_fixe')), _cle(r.get('nom_point_calcule')))
        dd = nombre(r.get('delta_d_m'))
        out[cle] = None if dd is None else round(dd, 2)
    return out


def _rc_rdd(c, pieces, regle_rc_max):
    rcs = pieces.get('RC', [])
    lpa_rows = [r for p in pieces.get('LPA', []) for r in _rows(p)]
    if rcs and lpa_rows:
        rc = rcs[0]
        attendu = _signature_rc(_rows(rc))
        candidats = []
        if pieces.get('RDIA'):
            candidats.append(determinations_from_rdia(_rows(pieces['RDIA'][0])))
        if pieces.get('RDN'):
            rdn = sorted(pieces['RDN'], key=lambda p: p.numero or 0)
            candidats.append([{'numero': p.numero, 'rows': _rows(p)} for p in rdn])
        if candidats:
            differences = None
            for dets in candidats:
                recalcule = _signature_rc(compute_rapport_controle(lpa_rows, dets))
                diff = [f'{a} → {b}' for (a, b) in sorted(set(attendu) | set(recalcule))
                        if attendu.get((a, b)) != recalcule.get((a, b))]
                if differences is None or len(diff) < len(differences):
                    differences = diff
            sources = pieces.get('RDIA', []) + pieces.get('RDN', []) + pieces.get('LPA', [])
            c.ajouter('rc_perime', ERREUR, 'Rapport de contrôle périmé',
                      'Le RC enregistré ne correspond plus à la LPA et aux déterminations actuelles '
                      '(pièce modifiée après sa génération) : régénérez-le.',
                      [f'Ligne {d}' for d in (differences or [])][:200], [rc] + sources)

    if rcs and pieces.get('RDD'):
        from reseaux.ecarts import ErreurEcarts, analyser_ecarts
        try:
            analyse = analyser_ecarts(_rows(rcs[0]), tolerance_m=regle_rc_max)
        except ErreurEcarts:
            return
        homogenes = {_cle(n) for n in analyse.get('homogenes', [])}
        if not homogenes:
            homogenes = {_cle(p['nom_point']) for p in analyse.get('points', []) if p.get('homogene')}
        fixes_rdd = [str(r.get('nom_point') or '').strip() for p in pieces['RDD'] for r in _rows(p) if _fixe(r)]
        c.ajouter('rdd_fixe_non_homogene', ERREUR, 'Points fixes du RDD non homogènes (N12)',
                  f'Point ancien tenu fixe dans la définitive alors que le RC le met hors tolérance '
                  f'(> {_cm(regle_rc_max)}) avec le groupe homogène.',
                  [n for n in fixes_rdd if _cle(n) not in homogenes], rcs + pieces['RDD'])
        if 0 < len(homogenes) < 3:
            c.ajouter('n12_moins_de_3', ERREUR, 'Moins de 3 points anciens homogènes (N12)',
                      'La détermination définitive doit s’appuyer sur au moins 3 points anciens homogènes.',
                      sorted(analyse.get('homogenes', [])) or ['—'], rcs)


# ---------------------------------------------------------------- 3. vecteurs

def _fenetres(pieces_rob):
    """{clé point: [(début, fin)]} depuis le ROB."""
    out = defaultdict(list)
    for p in pieces_rob:
        for r in _rows(p):
            debut, fin = _date(r.get('heure_debut')), _date(r.get('heure_fin'))
            cle = _cle(r.get('point'))
            if cle and debut and fin and fin > debut:
                out[cle].append((debut, fin))
    return out


def _recouvrement(a, b):
    meilleur = 0.0
    for d1, f1 in a:
        for d2, f2 in b:
            meilleur = max(meilleur, (min(f1, f2) - max(d1, d2)).total_seconds())
    return meilleur


def _vecteurs(c, pieces, regle):
    rtlb = pieces.get('RTLB', [])
    if not rtlb:
        return
    lignes = [r for p in rtlb for r in _rows(p)]
    nom = lambda r: (str(r.get('id_vec') or '').strip() or f"{r.get('de')}→{r.get('vers')}")
    libelle = lambda r: f"{nom(r)} ({str(r.get('de') or '').strip()} → {str(r.get('vers') or '').strip()})"

    flottants = [libelle(r) for r in lignes
                 if r.get('solution') not in (None, '') and 'fix' not in str(r.get('solution')).lower()]
    c.ajouter('vecteur_non_fixe', ERREUR, 'Vecteurs non fixés',
              'Solution flottante ou non résolue : ambiguïtés non fixées.', flottants, rtlb)

    for champ, cle_seuil, titre in (('prec_horiz_m', 'prec_h_max_m', 'Précision horizontale insuffisante'),
                                     ('prec_vert_m', 'prec_v_max_m', 'Précision verticale insuffisante'),
                                     ('rms_m', 'rms_max_m', 'RMS trop élevé')):
        seuil = float(regle.get(cle_seuil, 1))
        hors = [f'{libelle(r)} : {_cm(v)}' for r in lignes
                if (v := nombre(r.get(champ))) is not None and v > seuil]
        c.ajouter(f'vecteur_{champ}', AVERTISSEMENT, f'{titre} — vecteurs', f'Supérieure à {_cm(seuil)}.', hors, rtlb)

    max_km = float(regle.get('longueur_max_km', 15))
    longs = [f"{libelle(r)} : {_fr(v / 1000, '.2f')} km" for r in lignes
             if (v := nombre(r.get('longueur_m'))) is not None and v > max_km * 1000]
    c.ajouter('vecteur_longueur', AVERTISSEMENT, 'Vecteurs trop longs (N5)',
              f'Longueur supérieure à {_fr(max_km)} km.', longs, rtlb)

    # N4 : au moins 2 vecteurs par station.
    liaisons = defaultdict(int)
    noms = {}
    for r in lignes:
        for k in ('de', 'vers'):
            cle = _cle(r.get(k))
            if cle:
                liaisons[cle] += 1
                noms.setdefault(cle, str(r.get(k)).strip())
    c.ajouter('station_une_liaison', AVERTISSEMENT, 'Stations reliées par un seul vecteur (N4)',
              'Chaque station doit être reliée par au moins 2 vecteurs.',
              [noms[k] for k, n in liaisons.items() if n < 2], rtlb)

    # Simultanéité avec le ROB.
    fenetres = _fenetres(pieces.get('ROB', []))
    if fenetres:
        marge = float(regle.get('marge_simultaneite_s', 60))
        sans = []
        for r in lignes:
            a, b = fenetres.get(_cle(r.get('de'))), fenetres.get(_cle(r.get('vers')))
            duree = duree_secondes(r.get('duree'))
            if not a or not b or duree is None:
                continue                     # point non observé : signalé par le contrôle des noms
            commun = _recouvrement(a, b)
            if commun + marge < duree:
                sans.append(f'{libelle(r)} : {int(duree // 60)} min de vecteur, '
                            f'{max(0, int(commun // 60))} min d’observation commune')
        c.ajouter('vecteur_simultaneite', ERREUR, 'Vecteurs sans observation simultanée suffisante',
                  'Les deux extrémités doivent avoir été observées en même temps (ROB) pendant la durée du vecteur.',
                  sans, rtlb + pieces.get('ROB', []))


# ---------------------------------------------------------------- 4. boucles

def _boucles(c, pieces, regle):
    rfb, rtlb = pieces.get('RFB', []), pieces.get('RTLB', [])
    if not rfb:
        return
    boucles = [r for p in rfb for r in _rows(p)]
    max_ppm = float(regle.get('max_ppm', 20))
    hors = [f"{str(r.get('nom_boucle') or r.get('id_boucle') or '').strip()} : {_fr(v)} ppm"
            for r in boucles if (v := nombre(r.get('ppm'))) is not None and v > max_ppm]
    c.ajouter('boucle_ppm', AVERTISSEMENT, 'Fermetures de boucles au-delà du seuil (ppm)',
              f'Erreur de fermeture supérieure à {max_ppm:g} ppm.', hors, rfb)
    if not rtlb:
        return
    vecteurs = {str(r.get('id_vec') or '').strip().upper(): r for p in rtlb for r in _rows(p)
                if str(r.get('id_vec') or '').strip()}
    if not vecteurs:
        return
    cites = set()
    inconnus = []
    for r in boucles:
        ids = [t.strip().upper() for t in str(r.get('id_boucle') or '').replace(',', '-').replace(' ', '-').split('-')
               if t.strip()]
        cites |= set(ids)
        inconnus += [f"{i} (boucle {str(r.get('nom_boucle') or '').strip()})" for i in ids if i not in vecteurs]
    hors_boucle = [f"{v.get('id_vec')} ({str(v.get('de') or '').strip()} → {str(v.get('vers') or '').strip()})"
                   for k, v in vecteurs.items() if k not in cites]
    c.ajouter('vecteur_hors_boucle', ERREUR, 'Vecteurs hors boucle (N3)',
              '100 % des lignes de base doivent appartenir à au moins une boucle.', hors_boucle, rfb + rtlb)
    c.ajouter('boucle_vecteur_inconnu', AVERTISSEMENT, 'Boucles citant un vecteur inconnu',
              'Vecteur cité dans une boucle mais absent des lignes de base.', inconnus, rfb + rtlb)


# ---------------------------------------------------------------- 5. observations

def _observations(c, pieces, regle):
    rob = pieces.get('ROB', [])
    if not rob:
        return
    lignes = [r for p in rob for r in _rows(p)]
    lib = lambda r: f"{str(r.get('point') or '').strip()} ({str(r.get('fichier') or '').strip() or 'sans fichier'})"
    inversees, durees, incompletes, hauteurs = [], [], [], []
    hmin, hmax = float(regle.get('hauteur_min_m', 0.2)), float(regle.get('hauteur_max_m', 3.0))
    pct_min = float(regle.get('completude_min_pct', 80))
    tol_duree = float(regle.get('ecart_duree_s', 60))
    for r in lignes:
        debut, fin = _date(r.get('heure_debut')), _date(r.get('heure_fin'))
        duree = duree_secondes(r.get('duree'))
        if debut and fin:
            if fin <= debut:
                inversees.append(lib(r))
            elif duree is not None and abs((fin - debut).total_seconds() - duree) > tol_duree:
                durees.append(f'{lib(r)} : {r.get("duree")} annoncée, {int((fin - debut).total_seconds() // 60)} min entre début et fin')
        cadence, epoques = duree_secondes(r.get('cadence')), nombre(r.get('epoques'))
        if duree and cadence and epoques:
            attendues = duree / cadence + 1
            pct = 100 * epoques / attendues
            if pct < pct_min:
                incompletes.append(f'{lib(r)} : {pct:.0f} %')
        h = nombre(r.get('haut_ant_m'))
        if h is not None and not hmin <= h <= hmax:
            hauteurs.append(f"{lib(r)} : {_fr(h, '.3f')} m")
    par_fichier = defaultdict(set)
    for r in lignes:
        f = str(r.get('fichier') or '').strip().upper()
        if f:
            par_fichier[f].add(str(r.get('point') or '').strip())
    doublons = [f"{f} : {', '.join(sorted(pts))}" for f, pts in par_fichier.items() if len(pts) > 1]
    c.ajouter('obs_fin_avant_debut', ERREUR, 'Observations terminées avant d’avoir commencé',
              'Heure de fin antérieure ou égale à l’heure de début.', inversees, rob)
    c.ajouter('obs_fichier_partage', ERREUR, 'Même fichier d’observation pour plusieurs points',
              'Un fichier brut correspond à une seule station.', doublons, rob)
    c.ajouter('obs_duree', AVERTISSEMENT, 'Durée incohérente avec les heures de début et de fin',
              f'Écart supérieur à {tol_duree:g} s.', durees, rob)
    c.ajouter('obs_completude', AVERTISSEMENT, 'Observations incomplètes',
              f'Époques reçues inférieures à {pct_min:g} % des époques attendues (durée ÷ cadence).', incompletes, rob)
    c.ajouter('obs_hauteur', AVERTISSEMENT, "Hauteurs d'antenne inhabituelles",
              f'Hors de l’intervalle {_fr(hmin)} – {_fr(hmax)} m.', hauteurs, rob)


# ---------------------------------------------------------------- point d'entrée

def controler_valeurs(pieces, config):
    """Contrôles de valeurs (liste au format de `controle_croise`), selon la configuration
    EFFECTIVE des tolérances de l'appelant (`tolerances.effectives`)."""
    par_type = _par_type(pieces)
    c = _Collecte()
    lpa = _lpa_coords(par_type.get('LPA', []))
    if config['cc_points_fixes']['actif']:
        _points_fixes(c, par_type, lpa, config['cc_points_fixes'])
    if config['cc_sigmas']['actif']:
        _sigmas(c, par_type, config['cc_sigmas'])
    if config['cc_rc_rdd']['actif']:
        _rc_rdd(c, par_type, float(config['rc_ecarts'].get('max_m', 0.15)))
    if config['cc_vecteurs']['actif']:
        _vecteurs(c, par_type, config['cc_vecteurs'])
    if config['cc_boucles']['actif']:
        _boucles(c, par_type, config['cc_boucles'])
    if config['cc_observations']['actif']:
        _observations(c, par_type, config['cc_observations'])
    return c.controles
