"""
Zones du réseau GNSS importées d'un fichier SIG : SHAPEFILE (fichiers .shp / .dbf / .shx /
.prj / .cpg, ou archive .zip) ou GEOPACKAGE (.gpkg). Lecture en Python pur — l'image de
production n'a ni GDAL ni Fiona — puis conversion en WGS84 (latitude, longitude).

Une zone = un objet polygonal (Polygon / MultiPolygon, Z et M ignorés), avec :
- `nom` : premier attribut parlant (nom, name, libelle, designation, zone…), sinon
  « <couche> n°k » ;
- `type` : `levee` (zone levée — lever de détail à couvrir) ou `densification` (zone où
  placer les points nouveaux), déduit d'un attribut (type, nature, categorie, usage…) ou du
  nom de la couche ; à défaut, le type par défaut choisi par l'opérateur (`type_deduit`
  faux : à vérifier) ;
- `attributs` : les autres attributs, en texte (au plus `ATTRIBUTS_MAX`) ;
- `polygones` : liste de polygones, chacun = anneau extérieur puis trous, en [lat, lon].

Projection : lue dans le .prj (WKT) ou dans `gpkg_spatial_ref_sys` — WGS84, Lambert Maroc
(zones I à IV, EPSG 26191/26192/26194/26195, reconnues aussi par leur latitude d'origine) ou
Web Mercator. Inconnue : coordonnées en degrés → WGS84, sinon Lambert de la zone choisie
par l'opérateur (signalé : `projection.supposee`).
"""
import io
import math
import os
import re
import sqlite3
import struct
import tempfile
import zipfile

from .projection import ZONES, lambert_vers_wgs84

TYPE_LEVEE = 'levee'
TYPE_DENSIFICATION = 'densification'
TYPES_ZONE = (TYPE_LEVEE, TYPE_DENSIFICATION)

TAILLE_MAX = 30 * 1024 * 1024
ZONES_MAX = 200
SOMMETS_MAX = 50_000
ATTRIBUTS_MAX = 30

CHAMPS_NOM = ('nom', 'name', 'libelle', 'label', 'designation', 'intitule', 'titre', 'zone', 'nom_zone', 'id')
CHAMPS_TYPE = ('type', 'type_zone', 'nature', 'categorie', 'category', 'classe', 'usage', 'objet')


class ErreurZones(ValueError):
    """Fichier inexploitable (message destiné à l'utilisateur)."""


# ------------------------------------------------------------------ projection

def _sans_accents(s):
    import unicodedata
    return ''.join(c for c in unicodedata.normalize('NFD', str(s)) if unicodedata.category(c) != 'Mn').lower()


LAT_ORIGINE = {33.3: 'nord', 29.7: 'sud', 26.1: 'sahara_nord', 22.5: 'sahara_sud'}
EPSG_ZONES = {z['epsg']: code for code, z in ZONES.items()}


def projection_du_wkt(wkt):
    """Code de projection (`wgs84`, `mercator` ou une zone Lambert) d'un WKT, ou None."""
    if not wkt:
        return None
    s = _sans_accents(wkt)
    m = re.search(r'authority\["epsg",\s*"?(\d+)"?\]\s*\]\s*$', s)
    if m:
        code = projection_epsg(int(m.group(1)))
        if code:
            return code
    if 'mercator' in s and ('pseudo' in s or 'web' in s or '3857' in s or 'auxiliary' in s):
        return 'mercator'
    if s.lstrip().startswith(('geogcs', 'geogcrs')) and 'projcs' not in s:
        return 'wgs84'
    if 'maroc' in s or 'merchich' in s or 'morocco' in s or 'sahara' in s:
        lat = re.search(r'latitude_of_origin"?\s*,\s*(-?\d+(?:\.\d+)?)', s)
        if lat:
            for valeur, code in LAT_ORIGINE.items():
                if abs(float(lat.group(1)) - valeur) < 0.05:
                    return code
        if 'sahara' in s:
            return 'sahara_sud' if 'sud' in s else 'sahara_nord'
        if 'sud' in s:
            return 'sud'
        if 'nord' in s:
            return 'nord'
    return None


def projection_epsg(code):
    if code in (4326, 4258, 4269):
        return 'wgs84'
    if code in (3857, 900913, 102100):
        return 'mercator'
    return EPSG_ZONES.get(code)


def _convertisseur(projection):
    if projection == 'wgs84':
        return lambda x, y: (y, x)
    if projection == 'mercator':
        r = 6378137.0
        return lambda x, y: (math.degrees(2 * math.atan(math.exp(y / r)) - math.pi / 2), math.degrees(x / r))
    return lambda x, y: lambert_vers_wgs84(x, y, projection)


def libelle_projection(code):
    if code == 'wgs84':
        return 'WGS84 (degrés)'
    if code == 'mercator':
        return 'Web Mercator (EPSG:3857)'
    z = ZONES.get(code)
    return f"{z['libelle']} — EPSG:{z['epsg']}" if z else code


# ------------------------------------------------------------------ attributs → nom / type

def type_de_valeur(valeur):
    s = _sans_accents(valeur)
    if not s:
        return None
    if 'dens' in s:
        return TYPE_DENSIFICATION
    if 'lev' in s or 'survey' in s or 'detail' in s:
        return TYPE_LEVEE
    return None


def _nom_et_type(attributs, couche, rang):
    cles = {_sans_accents(k): k for k in attributs}
    nom = next((str(attributs[cles[c]]).strip() for c in CHAMPS_NOM
                if c in cles and str(attributs[cles[c]]).strip()), '')
    type_ = next((t for c in CHAMPS_TYPE if c in cles for t in [type_de_valeur(attributs[cles[c]])] if t), None)
    return nom or f'{couche} n°{rang}', type_


# ------------------------------------------------------------------ géométrie

def _aire_signee(anneau):
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(anneau, anneau[1:] + anneau[:1])) / 2


def _dans(p, anneau):
    x, y = p
    dedans = False
    for (x1, y1), (x2, y2) in zip(anneau, anneau[1:] + anneau[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-300) + x1:
            dedans = not dedans
    return dedans


def _assembler_anneaux(anneaux):
    """Anneaux d'un polygone shapefile (extérieurs horaires, trous anti-horaires) →
    polygones [extérieur, trous…]. Un trou rejoint l'extérieur qui le contient."""
    exterieurs, trous = [], []
    for a in anneaux:
        if len(a) < 3:
            continue
        (exterieurs if _aire_signee(a) <= 0 else trous).append(a)
    if not exterieurs:                      # orientation non respectée : tout est extérieur
        exterieurs, trous = trous, []
    polygones = [[e] for e in exterieurs]
    for t in trous:
        hote = next((p for p in polygones if _dans(t[0], p[0])), None)
        if hote:
            hote.append(t)
    return polygones


def _fermer(anneau):
    """Anneau sans le dernier sommet s'il répète le premier."""
    return anneau[:-1] if len(anneau) > 1 and anneau[0] == anneau[-1] else anneau


# ------------------------------------------------------------------ shapefile

def lire_dbf(donnees, encodage=None):
    if len(donnees) < 32:
        return []
    nb, entete, taille = struct.unpack('<IHH', donnees[4:12])
    champs, pos = [], 32
    while pos + 32 <= entete and donnees[pos] != 0x0D:
        nom = donnees[pos:pos + 11].split(b'\x00')[0].decode('latin-1').strip()
        champs.append((nom, chr(donnees[pos + 11]), donnees[pos + 16]))
        pos += 32
    encodages = [encodage] if encodage else []
    encodages += ['utf-8', 'cp1252']
    lignes = []
    for k in range(nb):
        debut = entete + k * taille
        brut = donnees[debut:debut + taille]
        if len(brut) < taille or brut[:1] == b'*':
            lignes.append(None)
            continue
        valeurs, p = {}, 1
        for nom, type_, longueur in champs:
            cellule = brut[p:p + longueur]
            p += longueur
            texte = None
            for enc in encodages:
                try:
                    texte = cellule.decode(enc)
                    break
                except (UnicodeDecodeError, LookupError):
                    continue
            texte = (texte if texte is not None else cellule.decode('latin-1')).strip()
            if type_ in 'NF' and texte:
                try:
                    f = float(texte)
                    texte = str(int(f)) if f.is_integer() else str(f)
                except ValueError:
                    pass
            valeurs[nom] = texte
        lignes.append(valeurs)
    return lignes


def lire_shp(donnees):
    """Polygones d'un .shp : liste (par enregistrement) de listes d'anneaux [(x, y)…], ou None."""
    if len(donnees) < 100 or struct.unpack('>i', donnees[0:4])[0] != 9994:
        raise ErreurZones("Le fichier .shp n'est pas un shapefile valide.")
    type_fichier = struct.unpack('<i', donnees[32:36])[0]
    if type_fichier not in (0, 5, 15, 25):
        raise ErreurZones('Le shapefile ne contient pas de polygones (points ou lignes) : '
                          'une zone doit être une surface.')
    pos, enregistrements = 100, []
    while pos + 8 <= len(donnees):
        longueur = struct.unpack('>i', donnees[pos + 4:pos + 8])[0] * 2
        contenu = donnees[pos + 8:pos + 8 + longueur]
        pos += 8 + longueur
        if len(contenu) < 4:
            break
        type_forme = struct.unpack('<i', contenu[:4])[0]
        if type_forme == 0:
            enregistrements.append(None)
            continue
        if type_forme not in (5, 15, 25):
            enregistrements.append(None)
            continue
        nb_parties, nb_points = struct.unpack('<ii', contenu[36:44])
        parties = list(struct.unpack(f'<{nb_parties}i', contenu[44:44 + 4 * nb_parties]))
        debut_pts = 44 + 4 * nb_parties
        pts = [struct.unpack('<dd', contenu[debut_pts + 16 * i:debut_pts + 16 * i + 16]) for i in range(nb_points)]
        anneaux = [_fermer(pts[d:f]) for d, f in zip(parties, parties[1:] + [nb_points])]
        enregistrements.append(anneaux)
    return enregistrements


def _zones_shapefile(fichiers_par_ext, couche, zone_lambert):
    shp = fichiers_par_ext.get('.shp')
    if shp is None:
        raise ErreurZones('Shapefile incomplet : le fichier .shp manque (déposez .shp, .dbf, .shx et .prj, '
                          'ou une archive .zip qui les contient).')
    avertissements = []
    prj = fichiers_par_ext.get('.prj')
    projection = projection_du_wkt(prj.decode('latin-1', 'ignore')) if prj else None
    if prj is None:
        avertissements.append(f'« {couche} » : pas de fichier .prj, projection déduite des coordonnées.')
    cpg = fichiers_par_ext.get('.cpg')
    encodage = cpg.decode('latin-1').strip() if cpg else None
    if encodage and encodage.isdigit():
        encodage = f'cp{encodage}'
    geometries = lire_shp(shp)
    attributs = lire_dbf(fichiers_par_ext['.dbf'], encodage) if '.dbf' in fichiers_par_ext else []
    objets = []
    for k, anneaux in enumerate(geometries):
        if not anneaux:
            continue
        objets.append((attributs[k] if k < len(attributs) and attributs[k] else {}, _assembler_anneaux(anneaux)))
    return objets, projection, avertissements


# ------------------------------------------------------------------ GeoPackage

def _wkb_polygones(donnees, pos=0):
    """Polygones d'une géométrie WKB (Polygon / MultiPolygon, Z / M tolérés) → (polygones, pos)."""
    ordre = '<' if donnees[pos] == 1 else '>'
    type_brut = struct.unpack(ordre + 'I', donnees[pos + 1:pos + 5])[0]
    pos += 5
    dims = 2
    if type_brut & 0x80000000:
        dims += 1
    if type_brut & 0x40000000:
        dims += 1
    if type_brut & 0x20000000:      # SRID EWKB
        pos += 4
    type_brut &= 0x0FFFFFFF
    base, millier = type_brut % 1000, type_brut // 1000
    dims += {1: 1, 2: 1, 3: 2}.get(millier, 0)
    if base == 3:
        nb_anneaux = struct.unpack(ordre + 'I', donnees[pos:pos + 4])[0]
        pos += 4
        anneaux = []
        for _ in range(nb_anneaux):
            n = struct.unpack(ordre + 'I', donnees[pos:pos + 4])[0]
            pos += 4
            pts = [struct.unpack(ordre + 'dd', donnees[pos + 8 * dims * i:pos + 8 * dims * i + 16]) for i in range(n)]
            pos += 8 * dims * n
            anneaux.append(_fermer(pts))
        return ([anneaux] if anneaux and len(anneaux[0]) >= 3 else []), pos
    if base == 6:
        n = struct.unpack(ordre + 'I', donnees[pos:pos + 4])[0]
        pos += 4
        polygones = []
        for _ in range(n):
            p, pos = _wkb_polygones(donnees, pos)
            polygones += p
        return polygones, pos
    return None, pos


def wkb_gpkg(blob):
    """Géométrie d'un blob GeoPackage (en-tête « GP » + WKB) → polygones, ou None."""
    if not blob or len(blob) < 8 or blob[:2] != b'GP':
        return None
    drapeaux = blob[3]
    if drapeaux & 0x10:                               # géométrie vide
        return None
    enveloppe = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}.get((drapeaux >> 1) & 0x07, 0)
    polygones, _ = _wkb_polygones(blob, 8 + enveloppe)
    return polygones


def _ident(nom):
    return '"' + str(nom).replace('"', '""') + '"'


def _zones_geopackage(donnees, nom_fichier):
    with tempfile.NamedTemporaryFile(suffix='.gpkg', delete=False) as tmp:
        tmp.write(donnees)
        chemin = tmp.name
    try:
        try:
            cx = sqlite3.connect(f'file:{chemin}?mode=ro', uri=True)
            couches = cx.execute(
                "SELECT c.table_name, g.column_name, c.srs_id FROM gpkg_contents c "
                "JOIN gpkg_geometry_columns g ON g.table_name = c.table_name "
                "WHERE c.data_type = 'features'").fetchall()
        except sqlite3.DatabaseError:
            raise ErreurZones(f'« {nom_fichier} » n\'est pas un GeoPackage lisible.')
        resultats, avertissements = [], []
        for table, colonne, srs in couches:
            ligne = cx.execute('SELECT organization, organization_coordsys_id, definition FROM gpkg_spatial_ref_sys '
                               'WHERE srs_id = ?', (srs,)).fetchone()
            projection = None
            if ligne:
                if str(ligne[0] or '').upper() == 'EPSG':
                    projection = projection_epsg(int(ligne[1]))
                projection = projection or projection_du_wkt(ligne[2])
            curseur = cx.execute(f'SELECT * FROM {_ident(table)}')
            noms = [d[0] for d in curseur.description]
            objets = []
            for valeurs in curseur:
                ligne_attr = dict(zip(noms, valeurs))
                polygones = wkb_gpkg(ligne_attr.pop(colonne, None))
                if polygones is None:
                    continue
                if not polygones:
                    continue
                attributs = {k: ('' if v is None else str(v)) for k, v in ligne_attr.items()
                             if not isinstance(v, (bytes, memoryview))}
                objets.append((attributs, polygones))
            if not objets:
                avertissements.append(f'Couche « {table} » ignorée : aucune surface.')
                continue
            resultats.append((table, objets, projection))
        cx.close()
        return resultats, avertissements
    finally:
        try:
            os.unlink(chemin)
        except OSError:
            pass


# ------------------------------------------------------------------ point d'entrée

def _regrouper(fichiers):
    """(nom, octets) → {« base »: {ext: octets}} pour les shapefiles, + liste des GeoPackages."""
    shapes, gpkg = {}, []

    def ajouter(nom, octets):
        base, ext = os.path.splitext(os.path.basename(nom))
        ext = ext.lower()
        if ext == '.gpkg':
            gpkg.append((os.path.basename(nom), octets))
        elif ext in ('.shp', '.dbf', '.shx', '.prj', '.cpg'):
            shapes.setdefault(base, {})[ext] = octets

    for nom, octets in fichiers:
        if nom.lower().endswith('.zip'):
            try:
                with zipfile.ZipFile(io.BytesIO(octets)) as z:
                    total = 0
                    for info in z.infolist():
                        if info.is_dir() or '__MACOSX' in info.filename:
                            continue
                        total += info.file_size
                        if total > TAILLE_MAX * 3:
                            raise ErreurZones('Archive trop volumineuse une fois décompressée.')
                        ajouter(info.filename, z.read(info))
            except zipfile.BadZipFile:
                raise ErreurZones(f'« {nom} » n\'est pas une archive ZIP valide.')
        else:
            ajouter(nom, octets)
    return shapes, gpkg


def importer_zones(fichiers, zone_lambert='nord', type_defaut=None):
    """Zones contenues dans les fichiers déposés (`[(nom, octets)]`).

    Returns: `{zones, projections, avertissements}` ; lève `ErreurZones`."""
    if zone_lambert not in ZONES:
        zone_lambert = 'nord'
    if type_defaut not in TYPES_ZONE:
        type_defaut = None
    shapes, gpkg = _regrouper(fichiers)
    if not shapes and not gpkg:
        raise ErreurZones('Aucun fichier exploitable : déposez un shapefile (.shp + .dbf + .shx + .prj, '
                          'ou un .zip) ou un GeoPackage (.gpkg).')
    couches, avertissements = [], []
    for base, par_ext in shapes.items():
        if '.shp' not in par_ext:
            avertissements.append(f'« {base} » ignoré : le fichier .shp manque.')
            continue
        objets, projection, avert = _zones_shapefile(par_ext, base, zone_lambert)
        avertissements += avert
        couches.append((base, f'{base}.shp', objets, projection))
    for nom, octets in gpkg:
        resultats, avert = _zones_geopackage(octets, nom)
        avertissements += avert
        couches += [(table, nom, objets, projection) for table, objets, projection in resultats]

    zones, projections, sommets = [], [], 0
    for couche, fichier, objets, projection in couches:
        supposee = projection is None
        if supposee:
            tous = [pt for _, polys in objets for poly in polys for anneau in poly for pt in anneau]
            degres = tous and all(abs(x) <= 180 and abs(y) <= 90 for x, y in tous)
            projection = 'wgs84' if degres else zone_lambert
        projections.append({'couche': couche, 'code': projection, 'libelle': libelle_projection(projection),
                            'supposee': supposee})
        convertir = _convertisseur(projection)
        type_couche = type_de_valeur(couche)
        for rang, (attributs, polygones) in enumerate(objets, start=1):
            if len(zones) >= ZONES_MAX:
                avertissements.append(f'Au plus {ZONES_MAX} zones : les suivantes sont ignorées.')
                break
            nom, type_ = _nom_et_type(attributs, couche, rang)
            deduit = (type_ or type_couche) is not None
            sortie = []
            for poly in polygones:
                anneaux = []
                for anneau in poly:
                    sommets += len(anneau)
                    if sommets > SOMMETS_MAX:
                        raise ErreurZones(f'Géométries trop détaillées (plus de {SOMMETS_MAX} sommets) : '
                                          'simplifiez les zones avant de les importer.')
                    anneaux.append([[round(c, 8) for c in convertir(x, y)] for x, y in anneau])
                sortie.append(anneaux)
            zones.append({
                'nom': nom[:120], 'type': type_ or type_couche or type_defaut, 'type_deduit': deduit,
                'attributs': dict(list(attributs.items())[:ATTRIBUTS_MAX]),
                'polygones': sortie, 'couche': couche, 'fichier': fichier,
            })
    if not zones:
        raise ErreurZones('Aucune zone (surface) trouvée dans les fichiers déposés.')
    return {'zones': zones, 'projections': projections, 'avertissements': avertissements}
