"""Lecture des fichiers CSV/Excel uploadés — aucune dépendance front (pas de papaparse/xlsx JS)."""
import csv
import io
import os
import re

from django.conf import settings

# .xls (legacy) volontairement hors scope v1 : openpyxl ne le lit pas, et xlrd ne
# supporte plus xlsx — dépendance supplémentaire pour un format en voie de disparition.
SUPPORTED_EXTENSIONS = {'.csv', '.xlsx'}


def parse_uploaded_table(file_obj, feuille=None):
    """
    Retourne (columns: list[str], rows: list[list[str]]).
    `feuille` : nom de la feuille d'un classeur Excel (défaut : la feuille active).
    Lève ValueError si le format n'est pas supporté ou si le fichier est vide/corrompu.
    """
    ext = os.path.splitext(file_obj.name)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Format « {ext} » non supporté. Utilisez un fichier .csv ou .xlsx.")
    if ext == '.csv':
        return _parse_csv(file_obj)
    return _parse_xlsx(file_obj, feuille)


def feuilles_excel(file_obj):
    """Noms des feuilles NON VIDES d'un classeur .xlsx, dans l'ordre du classeur."""
    import openpyxl
    file_obj.seek(0)
    try:
        wb = openpyxl.load_workbook(file_obj, read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001 — fichier corrompu ou non xlsx
        raise ValueError(f"Classeur Excel illisible : {exc}")
    noms = []
    for ws in wb.worksheets:
        if any(any(c is not None and str(c).strip() for c in row)
               for row in ws.iter_rows(max_row=5, values_only=True)):
            noms.append(ws.title)
    return noms


def _parse_csv(file_obj):
    file_obj.seek(0)
    raw = file_obj.read()
    text = None
    for encoding in ('utf-8-sig', 'utf-8', 'latin-1'):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise ValueError("Encodage du fichier CSV non reconnu.")
    sample = text[:2048]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=';,\t')
    except csv.Error:
        dialect = csv.excel
        dialect.delimiter = ';'
    reader = csv.reader(io.StringIO(text), dialect)
    all_rows = [row for row in reader if any(cell.strip() for cell in row)]
    if not all_rows:
        raise ValueError("Fichier CSV vide.")
    return all_rows[0], all_rows[1:]


def _parse_xlsx(file_obj, feuille=None):
    import openpyxl
    file_obj.seek(0)
    wb = openpyxl.load_workbook(file_obj, read_only=True, data_only=True)
    if feuille:
        if feuille not in wb.sheetnames:
            raise ValueError(f"Feuille « {feuille} » introuvable dans le classeur.")
        ws = wb[feuille]
    else:
        ws = wb.active
    # L'en-tête est la première ligne non vide (une feuille peut commencer plus bas).
    rows_iter = (r for r in ws.iter_rows(values_only=True)
                 if any(c is not None and str(c).strip() for c in r))
    try:
        header_row = next(rows_iter)
    except StopIteration:
        raise ValueError("Fichier Excel vide.")
    header = [str(c) if c is not None else '' for c in header_row]
    data_rows = []
    max_rows = getattr(settings, 'PIECE_IMPORT_MAX_ROWS', 5000)
    for i, row in enumerate(rows_iter):
        if i >= max_rows:
            raise ValueError(f"Fichier trop volumineux (> {max_rows} lignes).")
        if any(c is not None for c in row):
            data_rows.append(['' if c is None else str(c) for c in row])
    return header, data_rows


def parse_rfb_tbc_html(file_obj):
    """
    Rapport HTML « Résultats de fermeture de boucle GNSS » de Trimble Business Center →
    lignes RFB (dicts clés = noms de champs du catalogue RFB). Génère les 13 colonnes.

    - `nom_boucle` : dernière section « Boucle : <stations> » précédant le bloc.
    - `id_boucle`  : lien PV du bloc de fermeture.
    - valeurs numériques : depuis les libellés « Longueur/ΔHoriz/ΔVert/PPM/Δ3D/ΔX/ΔY/ΔZ = X ».
    - `tolerance_m` : 0.1 si longueur ≤ 10 km, sinon L(km)/100.
    - `tolerable`   : « oui » si Δ3D ≤ tolerance, sinon « non ».
    Lève ValueError si le fichier ne contient pas de données (ex. page-cadre TBC).
    """
    file_obj.seek(0)
    raw = file_obj.read()
    html = None
    for encoding in ('utf-8-sig', 'utf-8', 'latin-1'):
        try:
            html = raw.decode(encoding) if isinstance(raw, bytes) else raw
            break
        except UnicodeDecodeError:
            continue
    if html is None:
        raise ValueError("Encodage du fichier HTML non reconnu.")

    # Un bloc de fermeture : lien PV puis les 8 valeurs étiquetées, dans l'ordre.
    block_re = re.compile(
        r'>(PV[0-9]+(?:-PV[0-9]+)+)</a>'
        r'.*?Longueur[^0-9=]*=[^0-9.\-]*(-?[0-9.]+)'
        r'.*?ΔHoriz[^0-9=]*=[^0-9.\-]*(-?[0-9.]+)'
        r'.*?ΔVert[^0-9=]*=[^0-9.\-]*(-?[0-9.]+)'
        r'.*?PPM[^0-9=]*=[^0-9.\-]*(-?[0-9.]+)'
        r'.*?Δ3D[^0-9=]*=[^0-9.\-]*(-?[0-9.]+)'
        r'.*?ΔX[^0-9=]*=[^0-9.\-]*(-?[0-9.]+)'
        r'.*?ΔY[^0-9=]*=[^0-9.\-]*(-?[0-9.]+)'
        r'.*?ΔZ[^0-9=]*=[^0-9.\-]*(-?[0-9.]+)',
        re.DOTALL,
    )
    # Sections « Boucle : <stations> » sur le HTML BRUT (mêmes offsets que les blocs).
    # `_GAP` absorbe balises / &nbsp; / espaces entre « Boucle », « : » et le nom.
    _GAP = r'(?:</?[a-z][^>]*>|&nbsp;|\s)*'
    nom_positions = [(m.start(), m.group(1)) for m in re.finditer(
        r'Boucle' + _GAP + r':' + _GAP + r'([A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)', html)]

    def nom_for(pos):
        current = ''
        for start, nom in nom_positions:
            if start <= pos:
                current = nom
            else:
                break
        return current

    rows = []
    for i, m in enumerate(block_re.finditer(html), start=1):
        id_boucle, longueur, dh, dv, ppm, d3d, dx, dy, dz = m.groups()
        try:
            l_m = float(longueur)
        except (TypeError, ValueError):
            l_m = 0.0
        l_km = l_m / 1000.0
        tolerance = 0.1 if l_km <= 10 else l_km / 100.0
        try:
            tolerable = 'oui' if float(d3d) <= tolerance else 'non'
        except (TypeError, ValueError):
            tolerable = ''
        rows.append({
            'id': str(i),
            'id_boucle': id_boucle,
            'nom_boucle': nom_for(m.start()),
            'longueur_3d_m': longueur,
            'delta_x_m': dx,
            'delta_y_m': dy,
            'delta_z_m': dz,
            'delta_h_m': dh,
            'delta_v_m': dv,
            'ppm': ppm,
            'delta_3d_m': d3d,
            'tolerance_m': f'{tolerance:.5f}'.rstrip('0').rstrip('.'),
            'tolerable': tolerable,
        })

    if not rows:
        if '<frameset' in html.lower():
            raise ValueError(
                "Ce fichier est une page-cadre TBC : il ne contient pas les données. "
                "Uploadez le fichier de contenu du rapport (dossier « _files ») ou un rapport HTML autonome."
            )
        raise ValueError("Aucune fermeture de boucle détectée dans ce fichier HTML.")
    return rows


def _decode_html(file_obj):
    file_obj.seek(0)
    raw = file_obj.read()
    for encoding in ('utf-8-sig', 'utf-8', 'latin-1'):
        try:
            return raw.decode(encoding) if isinstance(raw, bytes) else raw
        except UnicodeDecodeError:
            continue
    raise ValueError("Encodage du fichier HTML non reconnu.")


def _no_data_error(html, label):
    if '<frameset' in html.lower():
        raise ValueError(
            "Ce fichier est une page-cadre TBC : il ne contient pas les données. "
            "Uploadez le fichier de contenu du rapport (dossier « _files ») ou un rapport HTML autonome."
        )
    raise ValueError(f"Aucune donnée « {label} » détectée dans ce fichier HTML.")


def parse_rdl_tbc_html(file_obj):
    """
    Rapport HTML « Ajustement du réseau (libre) » de TBC → lignes RDL.
    Source : table « Coordonnées ajustées (quadrillage) », en-têtes
    « ID de point / Abscisse / Abscisse Erreur / Nord / Nord Erreur ».
    Mapping : nom_point=ID de point, x_m=Abscisse, sigma_x_m=Abscisse Erreur,
    y_m=Nord, sigma_y_m=Nord Erreur ; id séquentiel.
    """
    html = _decode_html(file_obj)

    def strip(s):
        return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', s)).replace('\xa0', ' ') \
                 .replace('&nbsp;', ' ').strip()

    rows_out = []
    for tb in re.findall(r'<table[^>]*>.*?</table>', html, re.S):
        heads = [strip(h) for h in re.findall(r'<th[^>]*>(.*?)</th>', tb, re.S)]
        if not (any(h.startswith('Abscisse') and 'Erreur' not in h for h in heads)
                and any(h.startswith('Abscisse') and 'Erreur' in h for h in heads)
                and any(h.startswith('Nord') and 'Erreur' not in h for h in heads)):
            continue
        for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', tb, re.S):
            cells = [strip(c) for c in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
            if len(cells) >= 5 and cells[0]:
                # « ? » dans les colonnes d'erreur = point fixe/contraint → « FIXE ».
                sx = 'FIXE' if cells[2] == '?' else cells[2]
                sy = 'FIXE' if cells[4] == '?' else cells[4]
                rows_out.append({
                    'id': str(len(rows_out) + 1),
                    'nom_point': cells[0],
                    'x_m': cells[1],
                    'sigma_x_m': sx,
                    'y_m': cells[3],
                    'sigma_y_m': sy,
                })
        if rows_out:
            break

    if not rows_out:
        _no_data_error(html, "coordonnées ajustées")
    return rows_out


# Parseurs de rapports HTML TBC par type de pièce (cf. catalog `html_import`).
# RDL/RDN/RDD partagent le même format « ajustement du réseau » (table des coordonnées
# ajustées) et le même schéma de champs (_RDX_CHAMPS) → même parseur.
TBC_HTML_PARSERS = {
    'RFB': parse_rfb_tbc_html,
    'RDL': parse_rdl_tbc_html,
    'RDN': parse_rdl_tbc_html,
    'RDD': parse_rdl_tbc_html,
}


def _norm_header(s):
    return re.sub(r'\s+', '', str(s or '')).strip().lower()


def auto_map_columns(columns, champs):
    """
    Mappe des colonnes de fichier vers les champs cibles par libellé normalisé (espaces
    ignorés) : {nom_champ: nom_colonne}. Utilisé pour l'import auto des fichiers de
    déterminations (schéma standard « Nom Point / X (m) / σx (m) / … »).
    """
    by_norm = {}
    for c in columns:
        by_norm.setdefault(_norm_header(c), c)
    mapping = {}
    for ch in champs:
        key = _norm_header(ch.get('label'))
        if key in by_norm:
            mapping[ch['name']] = by_norm[key]
    return mapping


def apply_mapping(columns, rows, mapping):
    """
    mapping: {target_field: source_column_name}. Colonnes source absentes du mapping
    sont ignorées ; champs cibles absents du mapping reçoivent None.
    Retourne list[dict] indexé par nom de champ cible.
    """
    index_by_col = {name: i for i, name in enumerate(columns)}
    out = []
    for row in rows:
        entry = {}
        for target_field, source_col in mapping.items():
            idx = index_by_col.get(source_col)
            entry[target_field] = row[idx] if idx is not None and idx < len(row) else None
        out.append(entry)
    return out
