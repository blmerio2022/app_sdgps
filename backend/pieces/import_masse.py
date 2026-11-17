"""
Import en masse d'un dossier : reconnaître chaque fichier d'un levé.

L'opérateur dépose tous les fichiers d'un levé (ou le dossier entier) ; l'application
propose un PLAN qu'il corrige puis confirme. L'exécution réutilise les imports unitaires
(`import/`, `import-html/`, `images/`, `compute-rc/`) : mêmes validations, droits et verrou.
Rien n'est persisté par l'analyse.

Reconnaissance (déterministe, sans IA) :

- **tableaux** (CSV, chaque feuille non vide d'un classeur Excel) : part des champs du
  type retrouvés parmi les colonnes × part des colonnes reconnues (libellé ou nom
  technique, sans casse / accents / ponctuation, petite faute de frappe tolérée) ; bonus
  si le code du type (« RDN ») ou un mot-clé (« liste points anciens », « observations »…)
  figure dans le nom du fichier, de la feuille ou du dossier parent. PPA et PPN ont les
  mêmes colonnes : à défaut d'indice dans le nom, les noms de points sont croisés avec la
  LPA (points anciens) ;
- **rapports HTML de Trimble Business Center** : le CONTENU décide — « Résultats de
  fermeture de boucle » → RFB ; ajustement du réseau → nombre de points tenus fixes :
  aucun = détermination libre (RDL), un seul = détermination intermédiaire (RDN, numéro
  tiré du nom), plusieurs = détermination définitive (RDD). Les `.html` de TBC sont des
  pages-cadres : les données sont dans le dossier `<nom>_files` voisin, d'où l'intérêt de
  déposer le dossier entier ; une page-cadre seule est signalée ;
- **images** : un nom de fichier égal à un nom de point (colonne « Fichier Image » ou
  « Nom Point » d'une PPA / PPN, ou point de la LPA) rattache la photo à ce point ; sinon
  la NATURE de l'image décide — photo de terrain (peu de blanc, couleurs saturées) →
  photo de point à rattacher par l'opérateur ; plan sur fond blanc au format paysage →
  canevas (type tiré du nom, sinon le seul canevas applicable à la nature du dossier) ;
  autre document → photo du rapport de consultation (RDC) ; un mot-clé du nom
  (« stabilité », « densification », « levé », « consultation »…) l'emporte.
"""
import difflib
import os
import re
import unicodedata
from collections import Counter

from .catalog import PIECE_CATALOG, effective_champs, natures_applicable
from .parsing import (feuilles_excel, parse_rdl_tbc_html, parse_rfb_tbc_html,
                      parse_uploaded_table)

SEUIL_CONFIANCE = 0.35   # en dessous : aucun type proposé, l'opérateur choisit
BONUS_NOM = 0.5
BONUS_MOT = 0.4
TYPES_SANS_TABLEAU = {'PGSDGPS', 'RDC', 'CCSPA', 'CDC', 'CLC'}
SOURCES_NON_IMPORTABLES = {'calcul', 'ui'}
TYPES_IMAGES = ('PPA', 'PPN', 'CCSPA', 'CDC', 'CLC', 'RDC')
CANEVAS = ('CCSPA', 'CDC', 'CLC')
EXT_TABLEAU = {'.csv', '.xlsx'}
EXT_HTML = {'.html', '.htm'}
EXT_IMAGE = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.heic'}

# Mots-clés (sans accents, en minuscules) cherchés dans le nom du fichier et de son dossier.
MOTS_CLES = {
    'LPA': ['liste points anciens', 'liste des points anciens'],
    'PPA': ['photos points anciens', 'photo points anciens', 'photos des points anciens'],
    'PPN': ['photos points nouveaux', 'photo points nouveaux', 'photos des points nouveaux'],
    'FTR': ['fiche technique', 'recepteur'],
    'ROB': ['observations brutes', 'rapport observations', 'observations'],
    'RTLB': ['traitement', 'lignes de base'],
    'RFB': ['fermeture', 'boucle'],
    'RDL': ['determination libre', 'reseau libre'],
    'RDN': ['intermediaire', 'determination n'],
    'RDIA': ['determinations intermediaires', 'determination intermediaires assemble'],
    'RDD': ['definitive', 'reseau def'],
    'RC': ['rapport controle', 'rapport de controle'],
    'RDC': ['consultation', 'contenance'],
    'CCSPA': ['stabilite'],
    'CDC': ['densification'],
    'CLC': ['canevas leve', 'canevas de leve', 'leve cadastral'],
}


def _norm(texte):
    texte = unicodedata.normalize('NFKD', str(texte or '')).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]', '', texte.lower())


def _mots(texte):
    """« 04-Photos_points anciens/8.jpg » → ' 04 photos points anciens 8 jpg '."""
    texte = unicodedata.normalize('NFKD', str(texte or '')).encode('ascii', 'ignore').decode()
    return ' ' + re.sub(r'[^a-z0-9]+', ' ', texte.lower()).strip() + ' '


def _contexte(chemin):
    """Nom du fichier + dossier parent (pas au-delà : le dossier racine n'informe pas)."""
    parties = [p for p in re.split(r'[\\/]', chemin or '') if p]
    # Séparateur « / » : le NOM du fichier reste isolable (`basename`) — joint par une
    # espace, le dossier « 02-format-n2 » se lisait comme une détermination « n2 ».
    return '/'.join(parties[-2:])


def mots_cles_trouves(texte):
    """Types évoqués par un nom ; un mot-clé vaut aussi pour ses dérivés (« intermediaires »)."""
    t = _mots(texte)
    trouves = {code for code, mots in MOTS_CLES.items() if any(f' {m}' in t for m in mots)}
    # Une détermination numérotée (« determination n3 ») n'est pas le rapport ASSEMBLÉ, même
    # rangée dans le dossier « determinations intermediaires ».
    if re.search(r' determination n ?\d', t):
        trouves.discard('RDIA')
    return trouves


def numero_dans_nom(texte):
    """« …determination-n3 », « Détermination 3 », « RDN 3 » → 3 ; sinon None."""
    t = _mots(texte)
    m = re.search(r' (?:determination|rdn|det) (?:n )?(\d{1,3}) ', t) or re.search(r' n(\d{1,3}) ', t)
    return int(m.group(1)) if m else None


def _code_dans_nom(nom_fichier, code):
    """Le code du type figure-t-il en mot isolé ? Renvoie (trouvé, numéro éventuel)."""
    base = re.sub(r'\.[^.]+$', '', nom_fichier or '')
    m = re.search(rf'(?<![A-Za-z]){re.escape(code)}(?![A-Za-z])[\s_\-.]*(?:n[°o]?\s*)?(\d{{1,3}})?',
                  base, flags=re.IGNORECASE)
    if not m:
        return False, None
    return True, (int(m.group(1)) if m.group(1) else None)


def _nombre_final(nom):
    """« Rapport sur l’ajustement du réseau 7 » → 7."""
    m = re.search(r'(\d{1,3})\s*$', re.sub(r'\.[^.]+$', '', nom or '').strip())
    return int(m.group(1)) if m else None


# Libellés alternatifs rencontrés dans les fichiers réels, par champ cible.
ALIAS = {
    'determination': ['Nom Point Fixe', 'Point Fixe'],
    'nom_point': ['Nom Point Calculé', 'Point', 'ID de point', 'Nom'],
}


def correspondance(columns, champs):
    """{champ: colonne} par libellé OU nom technique normalisés ; une petite faute de
    frappe est tolérée (« Sytème Projection » ↔ « Système Projection »)."""
    par_cle = {}
    for c in columns:
        par_cle.setdefault(_norm(c), c)
    mapping = {}
    for ch in champs:
        trouve = None
        for cle in (_norm(ch.get('label')), _norm(ch.get('name'))):
            if cle and cle in par_cle and par_cle[cle] not in mapping.values():
                trouve = par_cle[cle]
                break
        if trouve is None:
            for alias in ALIAS.get(ch['name'], []):
                k = _norm(alias)
                if k in par_cle and par_cle[k] not in mapping.values():
                    trouve = par_cle[k]
                    break
        if trouve is None:
            cle = _norm(ch.get('label'))
            proches = [k for k in par_cle if par_cle[k] not in mapping.values() and len(cle) >= 6
                       and difflib.SequenceMatcher(None, cle, k).ratio() >= 0.9]
            if proches:
                trouve = par_cle[proches[0]]
        if trouve is not None:
            mapping[ch['name']] = trouve
    return mapping


def evaluer_type(code, columns, contexte, custom_map=None, mots=None):
    champs = [c for c in effective_champs(code, custom_map) if c.get('name') != 'id']
    if not champs:
        return None
    mapping = correspondance(columns, champs)
    part_champs = len(mapping) / len(champs)
    part_colonnes = len(mapping) / max(1, len([c for c in columns if str(c).strip()]))
    score = (2 * part_champs * part_colonnes / (part_champs + part_colonnes)) if mapping else 0.0
    # La colonne « ID » ne compte pas dans le score (tous les types en ont une) mais est
    # importée, comme à l'import unitaire : la page des photos rattache par l'ID de la ligne.
    if mapping:
        ident = [c for c in effective_champs(code, custom_map) if c.get('name') == 'id']
        if ident:
            mapping.update({k: v for k, v in correspondance(
                [c for c in columns if c not in mapping.values()], ident).items()})
    dans_nom, numero = _code_dans_nom(os.path.basename(contexte or ''), code)
    numero = numero or numero_dans_nom(os.path.basename(contexte or ''))
    if dans_nom:
        score += BONUS_NOM
    mot = code in (mots if mots is not None else mots_cles_trouves(contexte))
    if mot and mapping:
        score += BONUS_MOT
    return {'type_piece': code, 'score': round(min(score, 1.9), 3), 'mapping': mapping,
            'champs_reconnus': len([k for k in mapping if k != 'id']), 'champs_total': len(champs),
            'nom_reconnu': dans_nom or mot, 'numero_nom': numero}


def _candidat(code, **extra):
    d = PIECE_CATALOG.get(code, {})
    return {'type_piece': code, 'libelle': d.get('nom', code), 'repetable': bool(d.get('repeatable')),
            'niveau': d.get('niveau', 'ssdgps'), 'score': 1.0, 'champs_reconnus': 0, 'champs_total': 0,
            'nom_reconnu': False, 'mapping': {}, 'numero_nom': None, **extra}


# ----------------------------------------------------------------------------- tableaux

def analyser_tableau(fichier, nature, contexte, custom_map=None, feuille=None):
    """Plan pour un CSV ou UNE feuille d'un classeur."""
    nom_affiche = contexte + (f' › {feuille}' if feuille else '')
    base = {'fichier': nom_affiche, 'mode': 'tableau', 'feuille': feuille}
    try:
        columns, rows = parse_uploaded_table(fichier, feuille)
    except ValueError as exc:
        return {**base, 'lisible': False, 'erreur': str(exc), 'candidats': [],
                'type_piece': None, 'mapping': {}, 'lignes': 0, 'colonnes': []}
    ctx = f'{contexte} {feuille or ""}'
    mots = mots_cles_trouves(ctx)
    candidats = []
    for code, d in PIECE_CATALOG.items():
        # Les pièces CALCULÉES par l'application (RC) ne s'importent pas d'un fichier.
        if code in TYPES_SANS_TABLEAU or d.get('source') in SOURCES_NON_IMPORTABLES \
                or not natures_applicable(code, nature):
            continue
        ev = evaluer_type(code, columns, ctx, custom_map, mots)
        if ev and ev['score'] > 0:
            ev['libelle'] = d.get('nom', code)
            ev['repetable'] = bool(d.get('repeatable'))
            ev['niveau'] = d.get('niveau', 'ssdgps')
            candidats.append(ev)
    candidats.sort(key=lambda c: (-c['score'], c['type_piece']))
    meilleur = candidats[0] if candidats and candidats[0]['score'] >= SEUIL_CONFIANCE else None
    # Ex æquo en tête (ex. RDN / RDD / RDL, ou PPA / PPN, partagent leurs en-têtes) :
    # choisir serait arbitraire ; `departager` tente un indice, sinon l'opérateur tranche.
    ambigu = bool(meilleur and len(candidats) > 1 and candidats[1]['score'] == meilleur['score'])
    if ambigu:
        meilleur = None
    raison = ''
    if 'RC' in mots and (meilleur is None or meilleur['type_piece'] not in mots):
        # Nommé « rapport de contrôle » : c'est le RC (ses premières colonnes ressemblent à
        # celles des déterminations assemblées, d'où ce garde-fou).
        candidats, meilleur, ambigu = [], None, False
        raison = ("Le rapport de contrôle est calculé par l'application à partir de la LPA et des "
                  "déterminations : cochez « Générer le rapport de contrôle ».")
    return {
        **base, 'lisible': True, 'colonnes': columns, 'lignes': len(rows), 'apercu': rows[:3],
        'raison': raison,
        '_rows': rows,
        'candidats': [{k: c[k] for k in ('type_piece', 'libelle', 'score', 'champs_reconnus',
                                         'champs_total', 'nom_reconnu', 'repetable', 'mapping',
                                         'numero_nom', 'niveau')} for c in candidats[:5]],
        'type_piece': meilleur['type_piece'] if meilleur else None,
        'ambigu': ambigu,
        'confiance': (min(1.0, meilleur['score']) if meilleur else 0.0),
        'mapping': meilleur['mapping'] if meilleur else {},
        'numero': (meilleur['numero_nom'] if meilleur and meilleur['repetable'] else None),
    }


def _valeurs(item, champ):
    """Valeurs d'un champ cible dans les lignes d'un tableau analysé (via sa correspondance)."""
    col = (item.get('mapping') or {}).get(champ)
    if not col or col not in (item.get('colonnes') or []):
        return []
    i = item['colonnes'].index(col)
    return [str(r[i]).strip() for r in item.get('_rows') or [] if i < len(r) and str(r[i]).strip()]


def departager_photos(item, noms_lpa):
    """PPA ou PPN pour un tableau de photos aux colonnes identiques."""
    types = {c['type_piece'] for c in item['candidats'][:2]}
    if not item.get('ambigu') or types != {'PPA', 'PPN'}:
        return
    noms = {_norm(n) for n in _valeurs({**item, 'mapping': item['candidats'][0]['mapping']}, 'nom_point')}
    if not noms or not noms_lpa:
        return
    choix = 'PPA' if len(noms & noms_lpa) * 2 >= len(noms) else 'PPN'
    c = next(c for c in item['candidats'] if c['type_piece'] == choix)
    item.update(type_piece=choix, mapping=c['mapping'], ambigu=False, confiance=min(1.0, c['score']),
                raison='Points croisés avec la liste des points anciens')


# ------------------------------------------------------------------------- HTML TBC

def _texte_html(fichier):
    fichier.seek(0)
    brut = fichier.read()
    for enc in ('utf-8-sig', 'utf-8', 'latin-1'):
        try:
            return brut.decode(enc) if isinstance(brut, bytes) else brut
        except UnicodeDecodeError:
            continue
    return ''


def nom_rapport(chemin):
    """Nom lisible d'un rapport TBC : « …/Rapport 7_files/x.html » → « Rapport 7 »."""
    parties = [p for p in re.split(r'[\\/]', chemin or '') if p]
    if len(parties) >= 2 and parties[-2].lower().endswith('_files'):
        return parties[-2][:-len('_files')]
    return re.sub(r'\.[^.]+$', '', parties[-1] if parties else '')


def analyser_html(fichier, nature, chemin):
    """Plan pour un fichier HTML ; None si ce n'est pas un rapport exploitable
    (table des matières, ressource d'un dossier `_files`)."""
    html = _texte_html(fichier)
    nom = nom_rapport(chemin)
    base = {'fichier': chemin, 'nom_rapport': nom, 'mode': 'html', 'colonnes': [], 'mapping': {}}
    if '<frameset' in html.lower():
        return {**base, 'cadre': True, 'lisible': False, 'type_piece': None, 'candidats': [], 'lignes': 0,
                'erreur': f"Page-cadre TBC : ses données sont dans le dossier « {nom}_files ». "
                          "Déposez le dossier entier."}
    texte = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', html[:6000]))
    try:
        if 'fermeture de boucle' in texte.lower():
            rows = parse_rfb_tbc_html(fichier)
            type_, raison = 'RFB', 'Rapport TBC « Résultats de fermeture de boucle »'
        else:
            rows = parse_rdl_tbc_html(fichier)
            fixes = [r['nom_point'] for r in rows if r.get('sigma_x_m') == 'FIXE']
            if not fixes:
                type_, raison = 'RDL', 'Ajustement sans point fixe : détermination libre'
            elif len(fixes) == 1:
                type_, raison = 'RDN', f'Ajustement tenu fixe sur {fixes[0]} : détermination intermédiaire'
            else:
                type_, raison = 'RDD', f'Ajustement tenu fixe sur {len(fixes)} points : détermination définitive'
            base['points_fixes'] = fixes
    except ValueError:
        return None
    candidats = [_candidat(t) for t in ('RFB', 'RDL', 'RDN', 'RDD') if natures_applicable(t, nature)]
    if not natures_applicable(type_, nature):
        return {**base, 'lisible': True, 'lignes': len(rows), 'type_piece': None, 'candidats': candidats,
                'raison': f'{raison}, mais ce type ne s’applique pas à un {nature}.'}
    return {**base, 'lisible': True, 'lignes': len(rows), 'type_piece': type_, 'candidats': candidats,
            'confiance': 1.0, 'raison': raison, '_det_rows': rows,
            'numero': _nombre_final(nom) if type_ == 'RDN' else None}


# --------------------------------------------------------------------------- images

def nature_image(fichier):
    """'photo' (photo de terrain), 'plan' (fond blanc, paysage) ou 'document' (fond blanc)."""
    from PIL import Image
    try:
        fichier.seek(0)
        im = Image.open(fichier)
        largeur, hauteur = im.size
        mini = im.convert('RGB')
        mini.thumbnail((160, 160))
        pixels = list(mini.getdata())
        sat = list(mini.convert('HSV').getdata())
    except Exception:  # noqa: BLE001 — format non lu par Pillow (HEIC…)
        return 'photo'
    n = max(1, len(pixels))
    blanc = sum(1 for r, g, b in pixels if r > 235 and g > 235 and b > 235) / n
    saturation = sum(p[1] for p in sat) / n
    if blanc >= 0.55:
        return 'plan' if largeur >= 1.2 * hauteur else 'document'
    if saturation >= 15 or blanc < 0.3:
        return 'photo'
    return 'document'


def analyser_image(fichier, nature, chemin, points):
    """`points` : {nom normalisé: (type PPA|PPN, nom du point)}."""
    nom = os.path.basename(chemin or getattr(fichier, 'name', '') or '')
    base_nom = _norm(re.sub(r'\.[^.]+$', '', nom))
    item = {'fichier': chemin, 'mode': 'image', 'point': '', 'point_ref': '', 'type_piece': None, 'raison': ''}
    sorte = nature_image(fichier)
    item['nature_image'] = sorte
    mots = {t for t in mots_cles_trouves(_contexte(chemin)) if t in TYPES_IMAGES}
    applicables = [t for t in TYPES_IMAGES if natures_applicable(t, nature)]

    if base_nom in points:
        t, point, cle = points[base_nom]
        if natures_applicable(t, nature):
            item.update(type_piece=t, point=point, point_ref=cle, raison=f'Nom du fichier = point « {point} »')
            return item
    choix = [t for t in mots if t in applicables]
    if len(choix) == 1:
        item.update(type_piece=choix[0], raison='Nom du fichier ou du dossier')
        return item
    if sorte == 'photo':
        item['candidats'] = [t for t in ('PPA', 'PPN') if t in applicables]
        if len(item['candidats']) == 1:
            item['type_piece'] = item['candidats'][0]
        item['raison'] = 'Photo de terrain : choisissez le point (aucun point de ce nom)'
        return item
    if sorte == 'plan':
        canevas = [t for t in CANEVAS if t in applicables]
        item['candidats'] = canevas + ['RDC']
        if len(canevas) == 1:
            item.update(type_piece=canevas[0], raison='Plan sur fond blanc : canevas du dossier')
        else:
            item['raison'] = 'Plan sur fond blanc : précisez le canevas'
        return item
    item.update(type_piece='RDC', candidats=applicables,
                raison='Document non rattaché : photo du rapport de consultation')
    return item


# ---------------------------------------------------------------------------- lot

def _categorie(nom):
    ext = os.path.splitext(nom or '')[1].lower()
    if ext in EXT_TABLEAU:
        return 'tableau'
    if ext in EXT_HTML:
        return 'html'
    if ext in EXT_IMAGE:
        return 'image'
    return None


def _dans_dossier_files(chemin):
    return any(p.lower().endswith('_files') for p in re.split(r'[\\/]', chemin or '')[:-1])


def lignes_mappees(item):
    """Lignes d'un tableau analysé, en dicts {champ cible: valeur} (via sa correspondance)."""
    mapping = item.get('mapping') or {}
    colonnes = item.get('colonnes') or []
    index = {champ: colonnes.index(col) for champ, col in mapping.items() if col in colonnes}
    return [{champ: (str(r[i]).strip() if i < len(r) and r[i] is not None else '') for champ, i in index.items()}
            for r in item.get('_rows') or []]


def cle_point(ligne):
    """Clé d'un point, COMME la page des photos : l'ID de la ligne s'il existe, sinon le nom.
    C'est cette clé que porte `point_ref` ; un nom à la place d'un ID rattachait la photo à
    une autre ligne (le point « 8 » sous la ligne d'ID 8) ou à aucune."""
    ident = ligne.get('id')
    return str(ident).strip() if ident not in (None, '') else str(ligne.get('nom_point') or '').strip()


def _sans_extension(nom):
    return os.path.splitext(str(nom or ''))[0]


def points_connus(ssdgps, plan):
    """{nom normalisé: (type, nom, clé)} des points des PPA / PPN (par nom et par fichier
    image), puis des points de la LPA (photo de point ancien sans ligne PPA : clé = nom)."""
    from .models import Piece

    points, noms_lpa = {}, set()

    def inscrire(type_, ligne, ecraser):
        nom = str(ligne.get('nom_point') or '').strip()
        if not nom:
            return
        entree = (type_, nom, cle_point(ligne))
        for cle in (nom, _sans_extension(ligne.get('fichier_image'))):
            if cle and (ecraser or _norm(cle) not in points):
                points[_norm(cle)] = entree

    # Pièces déjà en base d'abord, puis celles du lot (prioritaires : elles seront créées).
    for p in Piece.objects.filter(ssdgps=ssdgps, is_deleted=False, type_piece__in=('PPA', 'PPN', 'LPA')):
        for r in (p.payload or {}).get('rows') or []:
            if not isinstance(r, dict):
                continue
            if p.type_piece == 'LPA':
                noms_lpa.add(_norm(r.get('nom_point')))
            else:
                inscrire(p.type_piece, r, ecraser=False)
    for item in plan:
        if item.get('type_piece') == 'LPA' and item.get('mode') == 'tableau':
            noms_lpa |= {_norm(r.get('nom_point')) for r in lignes_mappees(item)}
    for item in plan:
        if item.get('type_piece') in ('PPA', 'PPN') and item.get('mode') == 'tableau' and item.get('action', 'creer') != 'ignorer':
            for r in lignes_mappees(item):
                inscrire(item['type_piece'], r, ecraser=True)
    for n in noms_lpa:
        if n and n not in points:
            points[n] = ('PPA', n, n)
    return points, noms_lpa


def analyser_lot(fichiers, chemins, ssdgps, custom_map=None):
    """Plan complet d'un lot : pièces (tableaux, HTML), images, fichiers écartés."""
    nature = ssdgps.nature_ssdgps
    plan, images, ecartes = [], [], []
    a_traiter_images = []
    for index, f in enumerate(fichiers):
        chemin = chemins[index] if index < len(chemins) and chemins[index] else f.name
        cat = _categorie(f.name)
        if cat == 'tableau':
            if _dans_dossier_files(chemin):
                continue
            feuilles = [None]
            if f.name.lower().endswith('.xlsx'):
                try:
                    feuilles = feuilles_excel(f) or [None]
                except ValueError:
                    feuilles = [None]
            for feuille in feuilles:
                item = analyser_tableau(f, nature, _contexte(chemin), custom_map,
                                        feuille if len(feuilles) > 1 else None)
                item['fichier'] = chemin + (f' › {feuille}' if feuille and len(feuilles) > 1 else '')
                item.update(index=index, feuille=feuille if len(feuilles) > 1 else None)
                plan.append(item)
        elif cat == 'html':
            item = analyser_html(f, nature, chemin)
            if item is None:
                continue          # table des matières, ressource d'un dossier _files
            item['index'] = index
            plan.append(item)
        elif cat == 'image':
            if _dans_dossier_files(chemin):
                continue
            a_traiter_images.append((index, f, chemin))
        else:
            ecartes.append({'fichier': chemin, 'raison': 'Format non pris en charge'})

    # Pages-cadres dont le contenu a été déposé : inutiles.
    contenus = {_norm(i.get('nom_rapport')) for i in plan if i.get('mode') == 'html' and not i.get('cadre')}
    retenus = []
    for i in plan:
        if i.get('cadre') and _norm(i.get('nom_rapport')) in contenus:
            ecartes.append({'fichier': i['fichier'], 'raison': 'Page-cadre TBC : contenu repris de son dossier _files'})
        else:
            retenus.append(i)
    plan = retenus

    # Un dossier `_files` peut contenir plusieurs rapports (copie d'une autre étude) : pour
    # une pièce unique, on garde celui dont le nombre de points est le plus courant.
    tailles = Counter(i['lignes'] for i in plan if i.get('mode') == 'html' and i.get('type_piece') in ('RDL', 'RDN', 'RDD'))
    courant = tailles.most_common(1)[0][0] if tailles else None
    # Plusieurs sources pour une même pièce (dossier rangé par pièce : CSV + rapports V1, V2) :
    # le rapport HTML d'ORIGINE l'emporte sur un CSV extrait, la version la plus récente sur
    # les précédentes ; les autres restent au plan comme doublons, à reprendre au besoin.
    plan.sort(key=priorite_source(courant))

    points, noms_lpa = points_connus(ssdgps, plan)
    for item in plan:
        if item.get('mode') == 'tableau':
            departager_photos(item, noms_lpa)
    points, _ = points_connus(ssdgps, plan)
    for index, f, chemin in a_traiter_images:
        img = analyser_image(f, nature, chemin, points)
        img['index'] = index
        images.append(img)

    completer_plan(plan, ssdgps)
    for item in plan:
        # Lignes des déterminations (libre, n°k) : de quoi assembler une RDIA sans créer les
        # pièces séparées, si l'opérateur choisit « assemblées ».
        if item.get('type_piece') in ('RDL', 'RDN'):
            item['donnees'] = item.get('_det_rows') or lignes_mappees(item)
        item.pop('_det_rows', None)
        item.pop('_rows', None)
    # Affichage : tableaux, puis rapports dans l'ordre du dossier (RFB, RDL, RDN n°1…n, RDD).
    rang = {'RFB': 0, 'RDL': 1, 'RDN': 2, 'RDD': 3}
    plan.sort(key=lambda i: (i.get('mode') != 'tableau', rang.get(i.get('type_piece'), 9),
                             i.get('numero') or 0, i.get('action') == 'ignorer'))
    # Points proposés à l'opérateur pour une photo non rattachée : nom affiché + clé.
    noms_points = {t: sorted(({'nom': v[1], 'cle': v[2]} for v in set(points.values()) if v[0] == t),
                             key=lambda p: p['nom'].lower()) for t in ('PPA', 'PPN')}
    types_apres = {i['type_piece'] for i in plan if i.get('action') != 'ignorer' and i.get('type_piece')}
    from .models import Piece
    vivantes = list(Piece.objects.filter(ssdgps=ssdgps, is_deleted=False).order_by('ordre')
                    .values_list('type_piece', 'id'))
    existants = {t for t, _ in vivantes}
    # Pièces à images et RC déjà présentes : les images s'y ajoutent, le RC est recalculé.
    pieces_existantes = {}
    for t, pk in vivantes:
        if t in TYPES_IMAGES + ('RC', 'RDIA'):
            pieces_existantes.setdefault(t, str(pk))
    tous = types_apres | existants
    return {
        'plan': plan, 'images': images, 'ecartes': ecartes, 'points': noms_points,
        # Le rapport de contrôle se calcule dès que la LPA et des déterminations existent.
        'rc_possible': 'LPA' in tous and bool({'RDN', 'RDIA'} & tous) and natures_applicable('RC', nature),
        'rc_existant': 'RC' in existants,
        'pieces_existantes': pieces_existantes,
    }


def _version(item):
    m = re.search(r'(?:^|[\s_\-.])v ?(\d{1,3})(?!\d)', item.get('nom_rapport') or os.path.basename(item.get('fichier') or ''),
                  flags=re.IGNORECASE)
    return int(m.group(1)) if m else 0


def priorite_source(courant):
    def cle(item):
        html = item.get('mode') == 'html'
        return (not html,                                                # HTML d'origine d'abord
                (item.get('lignes') != courant) if html else False,      # rapport de l'étude principale
                -_version(item),                                         # V2 avant V1
                item.get('fichier') or '')
    return cle


def completer_plan(plan, ssdgps):
    """Numéros manquants des pièces répétables + pièce existante à remplacer."""
    from .models import Piece

    existantes = {}
    for p in Piece.objects.filter(ssdgps=ssdgps, is_deleted=False).only('id', 'type_piece', 'numero', 'session_id'):
        existantes.setdefault((p.type_piece, p.numero), p)
    pris = {}
    for (t, n) in existantes:
        if n:
            pris.setdefault(t, set()).add(n)
    uniques_vus, dans_le_lot = set(), set()
    for item in plan:
        t = item.get('type_piece')
        item['doublon'] = False
        if not t:
            item['action'] = 'ignorer'
            continue
        repetable = bool(PIECE_CATALOG.get(t, {}).get('repeatable'))
        if not repetable:
            if t in uniques_vus:
                # Deux fichiers pour une pièce unique : le second n'est pas importé d'office.
                item['doublon'] = True
                item['action'] = 'ignorer'
                item['piece_existante'] = None
                continue
            uniques_vus.add(t)
        if repetable and item.get('numero') and (t, item['numero']) in dans_le_lot:
            # Même détermination déjà fournie par une source prioritaire (rapport HTML) :
            # doublon, et non une détermination supplémentaire.
            item.update(doublon=True, action='ignorer', piece_existante=None)
            continue
        if repetable and item.get('numero') in pris.get(t, set()) and (t, item['numero']) not in existantes:
            item['numero'] = None     # numéro déjà pris en base : on en attribue un libre
        if repetable and not item.get('numero'):
            n = 1
            while n in pris.get(t, set()):
                n += 1
            item['numero'] = n
        if repetable:
            pris.setdefault(t, set()).add(item['numero'])
            dans_le_lot.add((t, item['numero']))
        cle = (t, item.get('numero') if repetable else None)
        existante = existantes.get(cle)
        item['piece_existante'] = str(existante.id) if existante else None
        item['action'] = 'remplacer' if existante else 'creer'
    return plan
