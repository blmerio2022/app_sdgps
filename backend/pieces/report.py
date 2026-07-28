"""
Génération du rapport PDF d'un SSDGPS (Phase 6 — §7.3 du plan de dev).

Assemble en un seul PDF, à l'image du modèle métier mono-session
(`docs/exemples-ssdgps/.../RAPPORTS_SDGPS_PDC.pdf`) :

1. une **page de garde** listant toutes les pièces valides du rapport
   (N° d'ordre, désignation, nombre, observations) ;
2. pour **chaque pièce valide**, une page-séparateur « PIÈCE N°k : … » suivie de
   son contenu — tableau de données (LPA, ROB, RDL/RDN/RDD, RC…), galerie d'images
   (RDC, canevas…) ou photos de points (PPA/PPN).

Le rendu HTML→PDF est confié à WeasyPrint (import différé : le module reste
importable même sans les bibliothèques natives GTK, l'erreur n'apparaît qu'à la
génération effective). Seules les pièces `statut == 'valide'` et non supprimées
sont incluses, dans l'ordre `ordre` du rapport.
"""
import re
from datetime import datetime, timezone as dt_timezone
from pathlib import Path

from django.template.loader import render_to_string
from django.utils import timezone

from .catalog import get_piece_def, catalog_orientation, effective_champs, import_effective_champs

# Types à base d'images pleine page (galerie plate, sans point rattaché).
IMAGE_TYPES = {'RDC', 'CCSPA', 'CDC', 'CLC'}
# Types « photos de points » (chaque point porte ses clichés + métadonnées).
PHOTO_TYPES = {'PPA', 'PPN'}
# La page de garde est générée par le rapport lui-même : on n'inclut jamais une
# éventuelle pièce PGSDGPS comme pièce numérotée distincte.
EXCLUDED_TYPES = {'PGSDGPS'}

# --- Orientation du contenu des pièces (portrait / paysage) --------------------
# Au-delà de ce nombre de colonnes visibles, le contenu tabulaire passe en paysage
# (Option 2 — calcul automatique par largeur). Ajustable.
ORIENTATION_COLUMN_THRESHOLD = 10
# Types dont l'orientation automatique est TOUJOURS le paysage, indépendamment du
# nombre de colonnes ou de leur nature (image / tableau) : canevas et LPA, plus les
# rapports d'observations/traitement/déterminations/contrôle (RDL/RDN/RDD forcés en
# paysage même sans la version « écarts »).
AUTO_LANDSCAPE_TYPES = {
    'LPA', 'CCSPA', 'CDC', 'CLC',
    'ROB', 'RTLB', 'RFB', 'RDL', 'RDN', 'RDI', 'RDD', 'RC',
}
# Option 1 (règle catalogue par type × nature) : désactivée par défaut. Passer à True
# pour que `catalog.ORIENTATION_CATALOG` l'emporte sur le calcul automatique.
USE_CATALOG_ORIENTATION = False


def _content_column_count(piece) -> int:
    """Nombre de colonnes visibles du contenu tabulaire d'une pièce (tient compte de
    la version « écarts », plus large, quand elle est présente sur CETTE pièce)."""
    d = get_piece_def(piece.type_piece)
    # Champs effectifs (statiques + personnalisés App Admin) : l'orientation auto tient
    # compte des colonnes réellement rendues.
    cols = len(effective_champs(piece.type_piece))
    if (piece.payload or {}).get('rows_ecarts') and d.get('ecarts_champs'):
        cols = max(cols, len(d['ecarts_champs']))
    return cols


def auto_orientation(piece) -> str:
    """Option 2 — orientation déduite de la largeur des données : types « toujours
    paysage » d'abord (LPA, canevas), puis images/photos en portrait, puis tableaux en
    paysage au-delà du seuil de colonnes, portrait sinon."""
    if piece.type_piece in AUTO_LANDSCAPE_TYPES:
        return 'paysage'
    if piece.type_piece in IMAGE_TYPES or piece.type_piece in PHOTO_TYPES:
        return 'portrait'
    return 'paysage' if _content_column_count(piece) >= ORIENTATION_COLUMN_THRESHOLD else 'portrait'


def default_orientation(piece, ssdgps) -> str:
    """Orientation par défaut (quand la pièce est en mode 'auto') : règle catalogue si
    activée (Option 1), sinon calcul automatique par largeur (Option 2)."""
    if USE_CATALOG_ORIENTATION:
        catalog_val = catalog_orientation(piece.type_piece, ssdgps.nature_ssdgps)
        if catalog_val:
            return catalog_val
    return auto_orientation(piece)


def resolve_orientation(piece, ssdgps) -> str:
    """Orientation effective du CONTENU d'une pièce : override manuel s'il est posé
    ('portrait'/'paysage'), sinon l'orientation par défaut calculée."""
    if piece.orientation in ('portrait', 'paysage'):
        return piece.orientation
    return default_orientation(piece, ssdgps)


def _fmt_date(value) -> str:
    """Formate une date SANS heure : ``jj/mm/aaaa``.

    N'est utilisée que pour `date_bornage` (affaires) et `date_session` (sessions), les deux
    seules dates de l'app dépourvues d'heure — le rapport doit afficher le même format que
    l'interface (cf. `frontend/src/app/shared/utils/date-format.util.ts`).

    Ces dates sont enregistrées à **minuit UTC** (`TIME_ZONE = 'UTC'`, saisie via
    ``<input type="date">``). On formate donc les composantes **UTC** : passer par l'heure
    locale ferait basculer l'affichage au jour précédent sur un fuseau à décalage négatif.
    Accepte aussi un simple `date` (sans fuseau).
    """
    if not value:
        return ''
    if hasattr(value, 'hour'):
        if timezone.is_aware(value):
            value = value.astimezone(dt_timezone.utc)
        return value.strftime('%d/%m/%Y')
    return value.strftime('%d/%m/%Y')


def _slug(value) -> str:
    """Nettoie un segment de nom de fichier : les caractères non alphanumériques
    (dont les « / » de « R19000/55 » ou « PDC/GPS ») deviennent des tirets."""
    return re.sub(r'[^0-9A-Za-z._-]+', '-', str(value or '').strip()).strip('-')


def report_filename(ssdgps, session=None) -> str:
    """Nom du fichier PDF du rapport, au format :
    ``RAPPORT_SDGPS_<titre|réquisition>_SD<n>_SDGPS-N<i>_<nature>[_SESSION-N<j>]_<horodatage>.pdf``.
    Le titre foncier prime sur la réquisition ; le suffixe SESSION n'est ajouté que
    pour un rapport ciblant une session précise. L'horodatage de génération
    (`_AAAA-MM-JJ-hh-mm-ss-ffff`, heure locale) est ajouté à la fin pour que chaque
    génération produise un fichier unique."""
    affaire = ssdgps.affaire
    propriete = affaire.propriete
    parts = ['RAPPORT_SDGPS']
    ident = _slug(propriete.id_titre or propriete.id_requisition)
    if ident:
        parts.append(ident)
    parts.append(f'SD{affaire.numero_sd_affaire}')
    parts.append(f'SDGPS-N{ssdgps.numero_ssdgps}')
    parts.append(_slug(ssdgps.nature_ssdgps))
    if session is not None:
        parts.append(f'SESSION-N{session.numero_session}')
    # Horodatage AAAA-MM-JJ-hh-mm-ss-ffff (heure locale) ; `ffff` = 4 premiers chiffres des
    # microsecondes (résolution 100 µs), pour garantir l'unicité du nom de fichier.
    now = datetime.now()
    parts.append(now.strftime('%Y-%m-%d-%H-%M-%S-') + now.strftime('%f')[:4])
    return '_'.join(p for p in parts if p) + '.pdf'


def piece_designation(piece) -> str:
    """Libellé métier d'une pièce pour la page de garde et le séparateur."""
    piece_def = get_piece_def(piece.type_piece)
    nom = piece_def['nom']
    if piece.type_piece == 'RDN' and piece.numero:
        return f"Rapport de la détermination N°{piece.numero}"
    if piece_def.get('repeatable') and piece.numero:
        return f"{nom} n°{piece.numero}"
    return nom


def _file_uri(image) -> str | None:
    """URI ``file://`` absolue exploitable par WeasyPrint ; préfère l'aperçu PNG
    (formats non affichables nativement, ex. TIFF) puis le fichier d'origine."""
    for field in (image.apercu, image.fichier):
        if not field:
            continue
        try:
            path = Path(field.path)
        except (ValueError, NotImplementedError):
            continue
        if path.exists():
            return path.as_uri()
    return None


# Champs en mètres formatés à 2 décimales : coordonnées X/Y (et variantes fixe/calculé)
# et écarts ΔX/ΔY/ΔD. Tous les autres champs en mètres (σx, longueurs, RMS, précisions,
# ΔZ/ΔH/ΔV/Δ3D, tolérance…) sont formatés à 3 décimales. Clé par NOM de champ (le libellé
# est ambigu : « σx(m) » contient « x(m) »).
_TWO_DECIMAL_FIELDS = {
    'x_m', 'y_m',
    'x_m_fixe', 'y_m_fixe', 'x_m_calcule', 'y_m_calcule',
    'delta_x_m', 'delta_y_m', 'delta_d_m',
}


def _meter_decimals(champ) -> int | None:
    """Nombre de décimales à imposer pour une colonne en mètres, ou None si la colonne
    n'est pas en unité mètre (libellé sans « (m) »)."""
    if '(m)' not in (champ.get('label') or '').replace(' ', '').lower():
        return None
    return 2 if champ['name'] in _TWO_DECIMAL_FIELDS else 3


def _format_meters(value, decimals: int):
    """Formate une valeur en mètres avec `decimals` décimales (séparateur décimal « . »,
    milliers séparés par une espace). Les valeurs non numériques (« -- », « Fixe », vide)
    sont renvoyées telles quelles."""
    s = str(value).strip()
    if s == '':
        return value
    cleaned = re.sub(r'\s', '', s)  # retire toutes les espaces (dont insécables) servant de séparateur de milliers
    if ',' in cleaned and '.' not in cleaned:   # virgule décimale « à la française »
        cleaned = cleaned.replace(',', '.')
    else:
        cleaned = cleaned.replace(',', '')
    try:
        num = float(cleaned)
    except ValueError:
        return value
    return f"{num:,.{decimals}f}".replace(',', ' ')


def _merge_fields(type_piece, version):
    """Colonnes à fusionner verticalement (cellules de valeurs consécutives identiques,
    par groupe tenu sur une même page) selon la pièce et la version du tableau
    ('brut' = tableau principal, 'ecarts')."""
    if version == 'brut':
        if type_piece == 'RDIA':
            return ('determination',)
        if type_piece == 'RC':
            return ('nom_point_fixe',)
    elif version == 'ecarts':
        if type_piece == 'RDN':
            return ('nom_point_fixe',)
        if type_piece == 'RDIA':
            return ('determination', 'nom_point_fixe')
    return ()


def _table_cells(champs, rows, sort_levels=None, visible=None):
    """Colonnes gardées (colonnes entièrement vides retirées) + lignes de cellules
    formatées (valeurs en mètres arrondies via `_meter_decimals`). Ne fait aucune
    fusion ni pagination : c'est la base commune aux deux passes de rendu.

    `sort_levels` (niveaux de tri effectifs de la version) annote chaque colonne triée
    d'un sens (`sort_dir`) et d'un rang de priorité (`sort_rank`, 1 = niveau prioritaire ;
    présent même pour un tri mono-colonne) → repère (flèche + n°) dans l'en-tête du rapport PDF.

    `visible` (liste ordonnée de noms de champs, préférences opérateur pour la vue PDF)
    filtre et réordonne les colonnes AVANT le retrait des colonnes vides. `None` = toutes
    les colonnes du catalogue (ordre du catalogue) ; liste VIDE `[]` = AUCUNE colonne
    (l'opérateur a désactivé toutes les colonnes → tableau masqué)."""
    def _nonempty(v):
        return v is not None and str(v).strip() != ''

    if visible is not None:
        by_name = {c['name']: c for c in champs}
        champs = [by_name[n] for n in visible if n in by_name]
        if not champs:
            return [], []  # toutes les colonnes désactivées : aucun tableau à rendre

    kept = [c for c in champs if any(_nonempty(row.get(c['name'])) for row in rows)] or list(champs)
    # Rang (1..n) et sens de chaque champ trié ; seuls les champs réellement affichés comptent.
    kept_names = {c['name'] for c in kept}
    rank_by_field = {}
    rank = 0
    for lv in (sort_levels or []):
        f = lv.get('field')
        if f in kept_names and f not in rank_by_field:
            rank += 1
            rank_by_field[f] = (rank, lv.get('dir'))
    columns = [{'name': c['name'], 'label': c['label'], 'num': c.get('type') == 'number',
                'sort_rank': rank_by_field.get(c['name'], (None, None))[0],
                'sort_dir': rank_by_field.get(c['name'], (None, None))[1]}
               for c in kept]
    decimals = {c['name']: _meter_decimals(c) for c in kept}
    flat = []
    for row in rows:
        cells = []
        for c in kept:
            value = row.get(c['name'], '')
            if decimals[c['name']] is not None:
                value = _format_meters(value, decimals[c['name']])
            cells.append({'value': value, 'num': c.get('type') == 'number', 'name': c['name']})
        flat.append(cells)
    return columns, flat


def _cellval(cells, field):
    for c in cells:
        if c['name'] == field:
            return str(c['value'])
    return ''


def flat_blocks(tables):
    """Blocs « à plat » : un bloc par tableau, TOUTES les lignes, sans fusion ni saut de
    page. Chaque ligne porte un `rid` (index global) → utilisé (1) pour la passe de sonde
    qui découvre la pagination naturelle, (2) comme rendu final des pièces non fusionnées."""
    blocks, rid = [], 0
    for tbl in tables:
        rows = []
        for cells in tbl['flat']:
            rows.append({'zebra': 'z%d' % (rid % 2), 'rid': rid, 'cells': cells})
            rid += 1
        # Le saut de page entre versions est porté par le conteneur `.version-wrap`
        # (cf. _group_versions / template), pas par le bloc lui-même.
        blocks.append({'title': tbl['title'], 'columns': tbl['columns'], 'merged': False,
                       'break_before': False, 'groups': [{'rows': rows}],
                       'vidx': tbl.get('vidx', 0), 'mention': tbl.get('mention', '')})
    return blocks


def _group_versions(blocks):
    """Regroupe les blocs par version (`vidx`) en préservant l'ordre. Chaque version est
    rendue dans un conteneur `.version-wrap` (saut de page avant les versions suivantes) →
    l'en-tête « running » de chaque version est associé aux BONNES pages (pas de débordement
    de la mention « écarts » sur la dernière page de la version brute)."""
    from itertools import groupby
    versions = []
    for _vidx, grp in groupby(blocks, key=lambda b: b.get('vidx', 0)):
        grp = list(grp)
        versions.append({'mention': grp[0].get('mention', ''), 'blocks': grp})
    return versions


def paged_blocks(tables, row_pages):
    """Blocs finaux à partir de la pagination réelle `row_pages` (rid → n° de page trouvé
    par la sonde). Chaque tableau est redécoupé par PAGE ; dans chaque segment de page les
    `merge_fields` sont fusionnés (rowspan). Saut de page uniquement au changement de page
    → les pages se remplissent naturellement (brut et écarts peuvent partager une page).
    Le zébrage des lignes suit l'index global ; les cellules fusionnées alternent leur
    teinte par groupe (`mz0`/`mz1`)."""
    from itertools import groupby
    blocks, rid, gcount = [], 0, 0
    for tbl in tables:
        vidx = tbl.get('vidx', 0)
        mention = tbl.get('mention', '')
        # `prev_page` est réinitialisé par version : le saut de page ENTRE versions est géré
        # par le conteneur `.version-wrap`, pas par le `break_before` du bloc (sinon double
        # saut). À l'intérieur d'une version, on saute bien à chaque changement de page.
        prev_page = None
        merge = [f for f in tbl['merge'] if f in {c['name'] for c in tbl['columns']}]
        trows = []
        for cells in tbl['flat']:
            trows.append({'rid': rid, 'page': row_pages.get(rid, 0), 'cells': cells})
            rid += 1
        first_seg = True
        for page, seg in groupby(trows, key=lambda r: r['page']):
            seg = list(seg)
            groups = []
            if merge:
                for _, grp in groupby(seg, key=lambda r: tuple(_cellval(r['cells'], f) for f in merge)):
                    grp = list(grp)
                    mz = 'mz%d' % (gcount % 2)
                    gcount += 1
                    grows = []
                    for i, row in enumerate(grp):
                        cells = []
                        for cell in row['cells']:
                            c = dict(cell)
                            if cell['name'] in merge:
                                if i == 0:
                                    c['rowspan'] = len(grp)
                                    c['merged'] = True
                                    c['mz'] = mz
                                else:
                                    c['skip'] = True
                            cells.append(c)
                        grows.append({'zebra': 'z%d' % (row['rid'] % 2), 'rid': row['rid'], 'cells': cells})
                    groups.append({'rows': grows})
            else:
                groups = [{'rows': [{'zebra': 'z%d' % (r['rid'] % 2), 'rid': r['rid'], 'cells': r['cells']}
                                    for r in seg]}]
            blocks.append({
                'title': tbl['title'] if first_seg else '',
                'columns': tbl['columns'], 'merged': bool(merge),
                'break_before': prev_page is not None and page != prev_page,
                'groups': groups,
                'vidx': vidx, 'mention': mention,
            })
            prev_page, first_seg = page, False
    return blocks


_EMPTY_SORT_TOKENS = {'', '--', '?', '—'}


def _sort_numeric(value):
    """Parse tolérant en nombre (espaces = séparateur de milliers, virgule décimale) ; None si
    non numérique. Même tolérance que `_format_meters` et que le comparateur frontend."""
    s = str(value).strip()
    if s in _EMPTY_SORT_TOKENS:
        return None
    cleaned = re.sub(r'\s', '', s)
    if ',' in cleaned and '.' not in cleaned:
        cleaned = cleaned.replace(',', '.')
    else:
        cleaned = cleaned.replace(',', '')
    try:
        return float(cleaned)
    except ValueError:
        return None


def _natural_key(value):
    """Clé de tri « naturel » d'une chaîne (« CTB26 » < « CTB157 ») : chunks texte/nombre,
    typés pour rester comparables entre eux."""
    parts = re.split(r'(\d+)', str(value).lower())
    return [(0, int(t)) if t.isdigit() else (1, t) for t in parts if t != '']


def _normalize_sort_levels(sort):
    """Normalise la config de tri d'un type en liste de niveaux [{'field','dir'}]. Accepte
    une liste (nouvelle forme), un objet unique {'field','dir'} (ancienne) ou None."""
    if not sort:
        return []
    raw = sort if isinstance(sort, list) else [sort]
    levels = []
    for lv in raw:
        if isinstance(lv, dict) and lv.get('field'):
            levels.append({'field': lv['field'],
                           'dir': 'desc' if lv.get('dir') == 'desc' else 'asc'})
    return levels


def sort_versions(entry):
    """Normalise une entrée de tri (config d'un type OU tri propre d'une pièce) en deux jeux de
    niveaux : `{'brut': [...], 'ecarts': [...]}`. Accepte :
    - une liste de niveaux (= version brute uniquement) ;
    - un objet `{'brut': [...], 'ecarts': [...]}` (pièces RDL/RDN/RDIA à deux versions) ;
    - un objet unique `{'field', 'dir'}` (ancienne forme, = brut) ; ou None."""
    if isinstance(entry, dict) and ('brut' in entry or 'ecarts' in entry):
        return {'brut': _normalize_sort_levels(entry.get('brut')),
                'ecarts': _normalize_sort_levels(entry.get('ecarts'))}
    return {'brut': _normalize_sort_levels(entry), 'ecarts': []}


def _sorted_only(rows, sort):
    """Trie `rows` selon PLUSIEURS niveaux `sort=[{'field','dir'}, …]` (niveau 1 prioritaire,
    niveau 2 en cas d'égalité, etc.). Par niveau : numérique si toute la colonne l'est, sinon
    ordre naturel ; valeurs vides toujours en fin, quel que soit le sens. NE renumérote PAS
    l'`id` — utile pour PPA/PPN, où les photos sont rattachées aux points par leur id d'origine.
    Sans tri valide, conserve l'ordre reçu."""
    from functools import cmp_to_key
    rows = list(rows or [])
    levels = _normalize_sort_levels(sort)

    def is_empty(v):
        return v is None or str(v).strip() in _EMPTY_SORT_TOKENS

    # Nature (numérique/naturel) détectée par niveau sur les valeurs non vides.
    for lv in levels:
        f = lv['field']
        nonempty = [r.get(f) for r in rows if not is_empty(r.get(f))]
        lv['numeric'] = bool(nonempty) and all(_sort_numeric(v) is not None for v in nonempty)
        lv['sign'] = -1 if lv['dir'] == 'desc' else 1

    if levels and rows:
        def cmp(ra, rb):
            for lv in levels:
                a, b = ra.get(lv['field']), rb.get(lv['field'])
                ea, eb = is_empty(a), is_empty(b)
                if ea and eb:
                    continue
                if ea:
                    return 1
                if eb:
                    return -1
                if lv['numeric']:
                    na, nb = _sort_numeric(a), _sort_numeric(b)
                    c = (na > nb) - (na < nb)
                else:
                    ka, kb = _natural_key(a), _natural_key(b)
                    c = (ka > kb) - (ka < kb)
                if c != 0:
                    return lv['sign'] * c
            return 0

        rows.sort(key=cmp_to_key(cmp))
    return rows


def _sorted_renumbered(rows, sort):
    """Comme `_sorted_only`, mais renvoie des COPIES avec `id` = position 1..n (pour les tableaux
    où la colonne ID doit suivre l'ordre d'affichage). Ne PAS utiliser pour PPA/PPN."""
    return [{**r, 'id': i + 1} for i, r in enumerate(_sorted_only(rows, sort))]


def _piece_content(piece, landscape=False, sort_config=None, fields_config=None):
    """Modèle de rendu du contenu d'une pièce : tableaux (liste `tables` « à plat », la
    pagination/fusion est décidée ensuite par `flat_blocks`/`paged_blocks`), images, photos.

    `landscape` (orientation effective du contenu) sert à dimensionner les photos
    complémentaires des points PPA/PPN. Tri effectif des lignes : le tri PROPRE à la pièce
    (`payload['sort']`, dernier tri appliqué à sa table — manuel ou tri par défaut appliqué)
    prime ; à défaut, le tri par défaut opérateur pour ce type (`sort_config[type]`). Ordonne
    les lignes des tableaux et renumérote la colonne ID (1..n) selon l'ordre d'affichage.

    `fields_config` (préférences opérateur de colonnes, cf. CustomUser.piece_fields_config) :
    la vue 'pdf' filtre/réordonne les colonnes des tableaux du rapport."""
    piece_def = get_piece_def(piece.type_piece)
    payload = piece.payload or {}
    content = {'tables': [], 'images': [], 'photos': [], 'kind': 'empty'}
    # Tri effectif, par version (brute / écarts) : tri propre à la pièce (`payload['sort']`,
    # dernier tri appliqué) d'abord, sinon tri par défaut du type (opérateur). L'écarts, s'il
    # n'a pas de tri propre, retombe sur le tri de la version brute (comportement historique).
    own = sort_versions(payload.get('sort'))
    cfg = sort_versions((sort_config or {}).get(piece.type_piece))
    sort_brut = own['brut'] or cfg['brut']
    sort_ecarts = own['ecarts'] or cfg['ecarts'] or sort_brut
    # Colonnes visibles (vue PDF) par version : None = toutes (ordre catalogue).
    pdf_view = ((fields_config or {}).get(piece.type_piece) or {}).get('pdf') or {}
    visible_brut = pdf_view.get('brut')
    visible_ecarts = pdf_view.get('ecarts')

    if piece.type_piece in PHOTO_TYPES:
        # Modèle métier : UNE entrée par POINT (pas par photo). La 1re photo du point
        # s'affiche en page pleine avec l'encadré de métadonnées (nom, date, projection,
        # système, coordonnées) ; CHAQUE photo suivante occupe SA PROPRE page entière (autant
        # de pages complémentaires que de photos complémentaires). Chaque photo porte un badge
        # `n/N` (uniquement si le point a plus d'une photo). `content['photos']` est donc une
        # liste d'entrées-point.
        content['kind'] = 'photos'
        # Hauteur utile (mm) d'une photo complémentaire = hauteur de contenu (A4 − marges
        # 43 mm haut / 10 mm bas) moins l'en-tête « Photos complémentaires » (~14 mm). Chaque
        # photo étant seule sur sa page, elle occupe toute cette hauteur.
        extra_region_mm = 143 if landscape else 230
        # Ordonne les POINTS selon le tri opérateur (PPA/PPN) sans renuméroter l'`id`
        # (les photos sont rattachées aux points par leur id d'origine).
        rows = _sorted_only(payload.get('rows') or [], sort_brut)
        images = list(piece.images.all())

        # `PieceImage.point_ref` = l'ID de la ligne du point (cf. models.py). On rattache
        # CHAQUE image à UNE seule ligne : par ID d'abord (sémantique officielle), puis, en
        # repli, par nom du point. Indispensable : le nom d'un point peut coïncider avec l'ID
        # d'un autre (ex. point id=1 nommé « 8 » vs point id=8) — matcher par nom en même
        # temps que par ID volerait la photo du second au premier.
        by_id, by_nom = {}, {}
        for i, row in enumerate(rows):
            rid = str(row.get('id', '')).strip()
            nom = str(row.get('nom_point', '')).strip()
            if rid:
                by_id.setdefault(rid, i)
            if nom:
                by_nom.setdefault(nom, i)
        row_pics = {i: [] for i in range(len(rows))}
        orphans = []
        for img in images:
            ref = (img.point_ref or '').strip()
            idx = by_id.get(ref, by_nom.get(ref))
            (row_pics[idx] if idx is not None else orphans).append(img)

        def _entry(nom_point, uris, **meta):
            """Entrée-point : métadonnées + photo principale (page pleine) + photos
            complémentaires (une page entière chacune). `main_label` (badge de la photo
            principale) et `extra[n].label` = « n/N » si le point a plus d'une photo (sinon
            vide : pas de « 1/1 » parasite). `extra_h` = hauteur (mm) de chaque photo
            complémentaire (elle occupe toute la hauteur utile de sa page)."""
            total = len(uris)
            numbered = total > 1
            return {
                'nom_point': nom_point,
                'date_visite': meta.get('date_visite', ''),
                'projection': meta.get('projection', ''),
                'systeme': meta.get('systeme', ''),
                'x_m': meta.get('x_m', ''),
                'y_m': meta.get('y_m', ''),
                'total': total,
                'main': uris[0] if uris else None,
                'main_label': ('1/%d' % total) if numbered else '',
                'extra': [{'uri': u, 'label': '%d/%d' % (n, total)}
                          for n, u in enumerate(uris[1:], start=2)],
                'extra_h': extra_region_mm,
            }

        for i, row in enumerate(rows):
            uris = [u for u in (_file_uri(img) for img in row_pics[i]) if u]
            content['photos'].append(_entry(
                row.get('nom_point', '') or row.get('id', ''), uris,
                date_visite=row.get('date_visite', ''),
                projection=row.get('systeme_projection', ''),
                systeme=row.get('zone_projection', ''),
                x_m=_format_meters(row.get('x_m', ''), 2),
                y_m=_format_meters(row.get('y_m', ''), 2)))

        # Photos dont le point_ref ne correspond à aucun point : une page chacune (pas de
        # regroupement possible sans point cible, donc pas de numérotation).
        for img in orphans:
            u = _file_uri(img)
            if u:
                content['photos'].append(
                    _entry((img.point_ref or '').strip() or '—', [u]))
        return content

    if piece.type_piece in IMAGE_TYPES:
        content['kind'] = 'images'
        content['images'] = [u for u in (_file_uri(i) for i in piece.images.all()) if u]
        return content

    # Pièces tabulaires : tableau brut (principal) + éventuel tableau « écarts ». Les
    # tableaux sont préparés « à plat » ; la fusion et la pagination sont appliquées
    # ensuite (flat_blocks / paged_blocks) — la mise en pages fusionnée nécessite une
    # passe de sonde pour connaître les sauts de page réels (cf. render_report_pdf).
    # Tri des lignes selon les préférences de l'opérateur pour ce type, puis renumérotation de
    # la colonne ID (1..n = ordre d'affichage). Sans préférence : ordre d'import conservé, ID
    # renuméroté 1..n (identique à l'ordre stocké).
    rows = _sorted_renumbered(payload.get('rows') or [], sort_brut)
    rows_ecarts = _sorted_renumbered(payload.get('rows_ecarts') or [], sort_ecarts)

    # `columns` vide = l'opérateur a désactivé toutes les colonnes de cette vue/version
    # (visible == []) → aucun tableau rendu pour cette version.
    # Colonnes brutes = FILTRE-MAÎTRE « import » de l'opérateur (un champ non importé n'est
    # jamais imprimé), puis restriction par la vue PDF (`visible_brut`).
    brut = None
    brut_champs = import_effective_champs(piece.type_piece, fields_config)
    if rows and brut_champs:
        columns, flat = _table_cells(brut_champs, rows, sort_brut, visible_brut)
        if columns:
            brut = {'title': '', 'columns': columns, 'flat': flat,
                    'merge': _merge_fields(piece.type_piece, 'brut')}
    ecarts = None
    if rows_ecarts and piece_def.get('ecarts_champs'):
        columns, flat = _table_cells(piece_def['ecarts_champs'], rows_ecarts, sort_ecarts, visible_ecarts)
        if columns:
            ecarts = {'title': 'Écarts par rapport à la détermination définitive',
                      'columns': columns, 'flat': flat,
                      'merge': _merge_fields(piece.type_piece, 'ecarts')}

    # Choix de la/des version(s) à afficher (types RDL/RDN/RDIA). Repli sur ce qui existe
    # si le choix ne correspond à aucune donnée disponible.
    choix = piece.versions_rapport
    sel = []
    if choix in ('brut', 'both') and brut:
        sel.append(('brut', brut))
    if choix in ('ecarts', 'both') and ecarts:
        sel.append(('ecarts', ecarts))
    if not sel:
        if brut:
            sel.append(('brut', brut))
        elif ecarts:
            sel.append(('ecarts', ecarts))

    # Mention entre parenthèses dans l'en-tête de contenu, UNIQUEMENT si les deux versions
    # sont affichées (pour distinguer les pages de chaque version).
    both = len(sel) == 2
    mentions = {'brut': 'Version brute des données',
                'ecarts': 'version des écarts par rapport à la détermination définitive'}
    for vidx, (vkey, tbl) in enumerate(sel):
        # En mode « les deux », la mention dans l'en-tête suffit : on retire le titre-légende
        # « Écarts par rapport à la détermination définitive » affiché au-dessus du tableau.
        content['tables'].append({**tbl, 'title': '' if both else tbl['title'],
                                  'merged': bool(tbl['merge']), 'vidx': vidx,
                                  'mention': mentions[vkey] if both else ''})
    if content['tables']:
        content['kind'] = 'table'
        content['first_mention'] = content['tables'][0]['mention']
    return content


def build_report_context(ssdgps, session, pieces, sort_config=None, fields_config=None):
    """Assemble le contexte de rendu du template `pieces/report.html`. `sort_config` =
    préférences de tri de l'opérateur ({ type_piece: {field, dir} }). `fields_config` =
    préférences de colonnes de l'opérateur (vue PDF), cf. CustomUser.piece_fields_config."""
    affaire = ssdgps.affaire
    propriete = affaire.propriete
    projet = propriete.projet
    organization = projet.organization

    nature_affaire = affaire.nature_affaire or ''
    if affaire.date_bornage:
        nature_affaire = f"{nature_affaire} du {_fmt_date(affaire.date_bornage)}".strip()

    # Organismes de l'en-tête : UNIQUEMENT ceux choisis sur la propriété (obligatoires).
    # Aucun repli sur un libellé codé en dur ni sur l'organisation du projet.
    n1, n2 = propriete.organisme_niveau1, propriete.organisme_niveau2
    organisme_niveau1 = n1.nom if n1 else ''
    organisme_niveau2 = n2.nom if n2 else ''

    header = {
        'organization': (organization.name if organization else '').upper(),
        'organisme_niveau1': (organisme_niveau1 or '').upper(),
        'organisme_niveau2': (organisme_niveau2 or '').upper(),
        'propriete': propriete.nom_propriete or '',
        'requisition': propriete.id_requisition or '',
        'titre': propriete.id_titre or '',
        'nature_affaire': nature_affaire,
        'nature_ssdgps': ssdgps.nature_ssdgps or '',
        'numero_ssdgps': ssdgps.numero_ssdgps,
        'session_numero': session.numero_session if session else None,
        'session_date': _fmt_date(session.date_session) if session else '',
        'projet': f"{projet.code_projet} — {projet.nom_projet}",
    }

    cover_rows, rendered = [], []
    for index, piece in enumerate(pieces, start=1):
        designation = piece_designation(piece)
        cover_rows.append({
            'ordre': index,
            'designation': designation,
            'nombre': 1,
            'observations': (piece.commentaire or '').strip(),
        })
        landscape = resolve_orientation(piece, ssdgps) == 'paysage'
        rendered.append({
            'index': index,
            'title': designation.upper(),
            'code': piece.type_piece,
            'content': _piece_content(piece, landscape, sort_config, fields_config),
            'content_landscape': landscape,
        })

    return {
        'header': header,
        'cover_rows': cover_rows,
        'total': len(cover_rows),
        'pieces': rendered,
    }


def render_report_pdf(ssdgps, session, pieces, sort_config=None, fields_config=None,
                      duplex=False):
    """Rend le rapport en PDF (bytes). Lève `RuntimeError` si WeasyPrint (ou ses
    bibliothèques natives) n'est pas disponible sur l'environnement d'exécution.

    Chaque « unité » (page de garde, séparateur de pièce, contenu de pièce) est rendue
    comme un document WeasyPrint indépendant, puis les pages sont fusionnées en un seul
    PDF. Ce découpage est indispensable pour que la numérotation « PAGE N°k » du bas de
    page reparte de 1 au contenu de chaque pièce (le compteur `page` de WeasyPrint est
    global à un document et ne peut être réinitialisé par `counter-reset`).

    `duplex` (recto-verso) : chaque page de garde de pièce est calée sur une page DROITE
    (impaire) par insertion d'une page blanche si nécessaire ; l'identification du pied de
    page bascule côté extérieur via `@page :left/:right`. La pagination globale « Page i/n »
    est superposée après fusion (le compteur global n'existe pas en CSS entre documents)."""
    try:
        from weasyprint import HTML
    except (ImportError, OSError) as exc:  # OSError : bibliothèques GTK absentes
        raise RuntimeError(
            "La génération PDF requiert WeasyPrint et ses bibliothèques natives "
            f"(GTK/Pango/Cairo). Détail : {exc}"
        ) from exc

    context = build_report_context(ssdgps, session, pieces, sort_config, fields_config)
    base = {'header': context['header']}

    # Préfixe commun du pied de page : « <titre|réquisition> SD<n> SDGPS N°<i> ».
    propriete = ssdgps.affaire.propriete
    ident = (propriete.id_titre or propriete.id_requisition or '').strip()
    foot_base = ' '.join(p for p in (
        ident, f'SD{ssdgps.affaire.numero_sd_affaire}', f'SDGPS N°{ssdgps.numero_ssdgps}',
    ) if p)

    def _render(mode, foot_prefix, extra):
        html = render_to_string('pieces/report.html',
                                {**base, 'mode': mode, 'foot_prefix': foot_prefix,
                                 'duplex': duplex, **extra})
        return HTML(string=html).render()

    def _probe_row_pages(doc):
        """Associe chaque ligne de tableau (attribut data-row) à son n° de page réel,
        en parcourant l'arbre de boîtes de la mise en pages WeasyPrint."""
        row_pages = {}

        def walk(box):
            yield box
            for child in getattr(box, 'children', ()) or ():
                yield from walk(child)

        for pnum, page in enumerate(doc.pages):
            for box in walk(page._page_box):
                el = getattr(box, 'element', None)
                if el is not None and getattr(el, 'tag', None) == 'tr':
                    rid = el.get('data-row')
                    if rid not in (None, ''):
                        row_pages.setdefault(int(rid), pnum)
        return row_pages

    def _piece_doc(piece, foot_prefix):
        """Rend le contenu d'une pièce. Si elle comporte un tableau fusionné, on rend
        d'abord une passe « à plat » (sonde) pour connaître la pagination naturelle, puis
        la passe finale où la fusion est recalculée par page réelle → pages bien remplies."""
        content = piece['content']
        tables = content.get('tables') or []

        def _wrap(blocks):
            return {**content, 'blocks': blocks, 'versions': _group_versions(blocks)}

        if content.get('kind') == 'table' and any(t['merged'] for t in tables):
            probe = _render('piece', foot_prefix,
                            {'piece': {**piece, 'content': _wrap(flat_blocks(tables))}})
            blocks = paged_blocks(tables, _probe_row_pages(probe))
        else:
            blocks = flat_blocks(tables)
        return _render('piece', foot_prefix,
                       {'piece': {**piece, 'content': _wrap(blocks)}})

    # (1) Page de garde du SDGPS — pied sans « PIÈCE N° ».
    documents = [_render('cover', foot_base,
                         {'cover_rows': context['cover_rows'], 'total': context['total']})]
    # (2) Une pièce = un document (séparateur + contenu) → PAGE N°k/n numérote la pièce.
    for piece in context['pieces']:
        foot_prefix = f"{foot_base} PIÈCE N°{piece['index']}"
        documents.append(_piece_doc(piece, foot_prefix))

    # Assemblage final. En recto-verso, on cale chaque UNITÉ « pièce » (séparateur + contenu)
    # sur une page DROITE (impaire) : si le cumul courant est impair, on insère une page
    # blanche. La page de garde du SDGPS (unité 0) démarre naturellement page 1 (droite).
    # Chaque sous-document démarrant alors sur une page globale impaire, sa parité interne
    # (page 1 = right) coïncide avec la parité globale → le `@page :left/:right` du template
    # place l'identification du bon côté sur toutes les pages.
    final_pages, pages_meta = [], []

    def _add(page, blank=False):
        final_pages.append(page)
        pages_meta.append({'blank': blank, 'width': page.width, 'height': page.height})

    def _blank_page():
        return HTML(string='<style>@page{size:A4;margin:0}</style><body></body>').render().pages[0]

    for page in documents[0].pages:          # unité 0 : page de garde du SDGPS
        _add(page)
    for doc in documents[1:]:                 # unités « pièce »
        if duplex and len(final_pages) % 2 == 1:
            _add(_blank_page(), blank=True)
        for page in doc.pages:
            _add(page)

    pdf_bytes = documents[0].copy(final_pages).write_pdf()
    return _overlay_global_pagination(pdf_bytes, pages_meta, duplex)


# Conversion pixels CSS (96 dpi, unité des boîtes WeasyPrint) → points PDF (72 dpi).
_PX_TO_PT = 72.0 / 96.0
_MM_TO_PT = 72.0 / 25.4

# Police de la pagination globale : résolue paresseusement (cf. _pagination_font).
_PAGINATION_FONT = None


def _pagination_font():
    """Nom de police reportlab pour le numéro global « Page i/n ». Embarque URW Bookman
    Demi (le « gras » de Bookman, exactement la police du reste du rapport PDF) depuis les
    fichiers Type1 du système, afin d'harmoniser la pagination avec l'identification du pied
    de page. Repli sur Times-Bold si les fichiers de police sont introuvables. Enregistrement
    effectué une seule fois (cache module)."""
    global _PAGINATION_FONT
    if _PAGINATION_FONT is not None:
        return _PAGINATION_FONT
    import os
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.pdfmetrics import EmbeddedType1Face, registerTypeFace, Font
    afm = '/usr/share/fonts/type1/urw-base35/URWBookman-Demi.afm'
    for pfb in ('/usr/share/fonts/X11/Type1/URWBookman-Demi.pfb',
                '/usr/share/fonts/type1/urw-base35/URWBookman-Demi.t1'):
        if os.path.exists(afm) and os.path.exists(pfb):
            try:
                face = EmbeddedType1Face(afm, pfb)
                registerTypeFace(face)
                pdfmetrics.registerFont(Font('ReportBookman', face.name, 'WinAnsiEncoding'))
                _PAGINATION_FONT = 'ReportBookman'
                return _PAGINATION_FONT
            except Exception:
                break
    _PAGINATION_FONT = 'Times-Bold'
    return _PAGINATION_FONT


def _overlay_global_pagination(pdf_bytes, pages_meta, duplex):
    """Superpose « Page i/n » (pagination GLOBALE du rapport) au bas de chaque page non
    blanche, du côté OPPOSÉ à l'identification :
    - recto seul   : identification à droite → pagination à GAUCHE ;
    - recto-verso  : identification côté extérieur → pagination côté intérieur, soit à
      DROITE sur une page gauche (i pair) et à GAUCHE sur une page droite (i impair).
    `n` = nombre total de pages finales (blanches comprises) ; sur une page blanche de
    calage, aucun numéro n'est imprimé (convention d'impression recto-verso)."""
    from io import BytesIO
    from pypdf import PdfReader, PdfWriter
    from reportlab.pdfgen import canvas

    n = len(pages_meta)
    reader = PdfReader(BytesIO(pdf_bytes))
    writer = PdfWriter()

    for idx, meta in enumerate(pages_meta):
        page = reader.pages[idx]
        if meta['blank']:
            writer.add_page(page)
            continue

        # Normalise une éventuelle rotation dans le contenu (dimensions visuelles = mediabox).
        if page.rotation:
            page.transfer_rotation_to_content()
        w_pt = float(page.mediabox.width)
        h_pt = float(page.mediabox.height)

        i = idx + 1
        # Côté de la pagination (voir docstring). Recto seul → gauche.
        on_left_page = duplex and i % 2 == 0      # page gauche = page paire
        side_left = (not on_left_page) if duplex else True

        buf = BytesIO()
        c = canvas.Canvas(buf, pagesize=(w_pt, h_pt))
        c.setFont(_pagination_font(), 8)
        text = f"Page {i}/{n}"
        x_margin = 10 * _MM_TO_PT
        y = 5 * _MM_TO_PT                          # ~5 mm du bord bas, aligné sur le pied
        if side_left:
            c.drawString(x_margin, y, text)
        else:
            c.drawRightString(w_pt - x_margin, y, text)
        c.showPage()
        c.save()
        buf.seek(0)

        # Le tampon (CTM propre) sert de BASE, la page du rapport est fusionnée PAR-DESSUS :
        # le fond des pages WeasyPrint est transparent → le numéro reste visible, et on évite
        # que le CTM résiduel du flux de contenu WeasyPrint ne déplace le tampon (bug observé :
        # numéro projeté en (0,0) sur les pages de contenu).
        stamp = PdfReader(buf).pages[0]
        stamp.merge_page(page)
        writer.add_page(stamp)

    out = BytesIO()
    writer.write(out)
    return out.getvalue()
