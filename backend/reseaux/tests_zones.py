"""Réseau GNSS — zones importées (shapefile, GeoPackage), réseau personnalisé, densification
dans les zones de l'opérateur."""
import io
import sqlite3
import struct
import tempfile
import zipfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase

from .densification import ErreurDensification, densifier
from .generation import ErreurReseau, evaluer_personnalise, generer_reseau
from .projection import lambert_vers_wgs84
from .tests import URL, ApiTests, _grille_triangulaire, _pt
from .zones import ErreurZones, importer_zones, projection_du_wkt, wkb_gpkg

PRJ_NORD = ('PROJCS["Merchich_Nord_Maroc",GEOGCS["GCS_Merchich",DATUM["D_Merchich",SPHEROID["Clarke_1880_IGN",'
            '6378249.2,293.46602]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],'
            'PROJECTION["Lambert_Conformal_Conic"],PARAMETER["False_Easting",500000.0],'
            'PARAMETER["False_Northing",300000.0],PARAMETER["Central_Meridian",-5.4],'
            'PARAMETER["Standard_Parallel_1",33.3],PARAMETER["Scale_Factor",0.999625769],'
            'PARAMETER["Latitude_Of_Origin",33.3],UNIT["Meter",1.0]]')
PRJ_WGS84 = ('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],'
             'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]')

# Deux carrés Lambert (sens horaire = extérieur) ; le premier a un trou (anti-horaire).
CARRE_A = [(420000, 380000), (420000, 384000), (424000, 384000), (424000, 380000)]
TROU_A = [(421000, 381000), (422000, 381000), (422000, 382000), (421000, 382000)]
CARRE_B = [(430000, 380000), (430000, 382000), (432000, 382000), (432000, 380000)]


def shapefile(polygones, champs, valeurs, prj=PRJ_NORD):
    """Fichiers .shp / .dbf / .prj minimaux. `polygones` : liste (par objet) de listes d'anneaux."""
    corps = b''
    for k, anneaux in enumerate(polygones, start=1):
        pts = [pt for a in anneaux for pt in a + [a[0]]]
        parties, debut = [], 0
        for a in anneaux:
            parties.append(debut)
            debut += len(a) + 1
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        contenu = struct.pack('<i4d2i', 5, min(xs), min(ys), max(xs), max(ys), len(anneaux), len(pts))
        contenu += struct.pack(f'<{len(parties)}i', *parties)
        contenu += b''.join(struct.pack('<2d', *p) for p in pts)
        corps += struct.pack('>2i', k, len(contenu) // 2) + contenu
    entete = struct.pack('>i5i i', 9994, 0, 0, 0, 0, 0, (100 + len(corps)) // 2)
    entete += struct.pack('<2i4d4d', 1000, 5, 0, 0, 0, 0, 0, 0, 0, 0)
    shp = entete + corps
    # DBF : champs texte de 40 caractères.
    n_champs = len(champs)
    taille_entete = 32 + 32 * n_champs + 1
    taille_ligne = 1 + 40 * n_champs
    dbf = struct.pack('<4BIHH20x', 3, 126, 1, 1, len(valeurs), taille_entete, taille_ligne)
    for nom in champs:
        dbf += nom.encode('latin-1').ljust(11, b'\x00') + b'C' + b'\x00' * 4 + bytes([40, 0]) + b'\x00' * 14
    dbf += b'\x0D'
    for ligne in valeurs:
        dbf += b' ' + b''.join(str(v).encode('cp1252').ljust(40) for v in ligne)
    dbf += b'\x1A'
    return {'.shp': shp, '.dbf': dbf, '.prj': prj.encode()}


def zip_de(base, fichiers):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        for ext, octets in fichiers.items():
            z.writestr(f'{base}{ext}', octets)
    return buf.getvalue()


def wkb_polygone(anneaux):
    out = struct.pack('<BII', 1, 3, len(anneaux))
    for a in anneaux:
        pts = a + [a[0]]
        out += struct.pack('<I', len(pts)) + b''.join(struct.pack('<2d', *p) for p in pts)
    return out


def geopackage(objets, srs=26191, table='zones_densification'):
    with tempfile.NamedTemporaryFile(suffix='.gpkg', delete=False) as tmp:
        chemin = tmp.name
    cx = sqlite3.connect(chemin)
    cx.executescript('''
        CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT, srs_id INTEGER PRIMARY KEY, organization TEXT,
            organization_coordsys_id INTEGER, definition TEXT, description TEXT);
        CREATE TABLE gpkg_contents (table_name TEXT PRIMARY KEY, data_type TEXT, identifier TEXT, srs_id INTEGER);
        CREATE TABLE gpkg_geometry_columns (table_name TEXT, column_name TEXT, geometry_type_name TEXT,
            srs_id INTEGER, z TINYINT, m TINYINT);''')
    cx.execute('INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?, ?)', ('x', srs, 'EPSG', srs, 'undefined', ''))
    cx.execute('INSERT INTO gpkg_contents VALUES (?, ?, ?, ?)', (table, 'features', table, srs))
    cx.execute('INSERT INTO gpkg_geometry_columns VALUES (?, ?, ?, ?, 0, 0)', (table, 'geom', 'MULTIPOLYGON', srs))
    cx.execute(f'CREATE TABLE {table} (fid INTEGER PRIMARY KEY, geom BLOB, libelle TEXT, surface REAL)')
    for libelle, anneaux in objets:
        blob = b'GP\x00\x01' + struct.pack('<i', srs) + wkb_polygone(anneaux)
        cx.execute(f'INSERT INTO {table} (geom, libelle, surface) VALUES (?, ?, ?)', (blob, libelle, 16.5))
    cx.commit()
    cx.close()
    with open(chemin, 'rb') as f:
        return f.read()


class ProjectionTests(SimpleTestCase):
    def test_wkt_reconnus(self):
        self.assertEqual(projection_du_wkt(PRJ_NORD), 'nord')
        self.assertEqual(projection_du_wkt(PRJ_NORD.replace('33.3]', '29.7]').replace('Nord', 'Sud')), 'sud')
        self.assertEqual(projection_du_wkt(PRJ_WGS84), 'wgs84')
        self.assertEqual(projection_du_wkt('PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84"]]'), 'mercator')
        self.assertIsNone(projection_du_wkt('PROJCS["ETRS89 / UTM 31N"]'))
        self.assertIsNone(projection_du_wkt(''))


class ShapefileTests(SimpleTestCase):
    def test_zip_noms_types_trous_et_projection(self):
        fichiers = shapefile([[CARRE_A, TROU_A], [CARRE_B]], ['NOM', 'TYPE', 'COMMUNE'],
                             [['Douar Aït Ali', 'Zone levée', 'Azilal'], ['Secteur 2', 'Densification', 'Demnate']])
        r = importer_zones([('zones.zip', zip_de('zones', fichiers))])
        self.assertEqual([z['nom'] for z in r['zones']], ['Douar Aït Ali', 'Secteur 2'])
        self.assertEqual([z['type'] for z in r['zones']], ['levee', 'densification'])
        self.assertTrue(all(z['type_deduit'] for z in r['zones']))
        self.assertEqual(r['zones'][0]['attributs']['COMMUNE'], 'Azilal')
        a = r['zones'][0]['polygones']
        self.assertEqual((len(a), len(a[0]), len(a[0][0])), (1, 2, 4))          # 1 polygone, 1 trou, 4 sommets
        lat, lon = lambert_vers_wgs84(*CARRE_A[0], 'nord')
        self.assertAlmostEqual(a[0][0][0][0], lat, places=6)
        self.assertAlmostEqual(a[0][0][0][1], lon, places=6)
        self.assertEqual(r['projections'][0]['code'], 'nord')
        self.assertFalse(r['projections'][0]['supposee'])

    def test_fichiers_separes_sans_prj_type_par_defaut(self):
        fichiers = shapefile([[CARRE_B]], ['ID'], [['7']])
        r = importer_zones([('emprise.shp', fichiers['.shp']), ('emprise.dbf', fichiers['.dbf'])],
                           zone_lambert='sud', type_defaut='densification')
        z = r['zones'][0]
        self.assertEqual((z['nom'], z['type'], z['type_deduit']), ('7', 'densification', False))
        self.assertTrue(r['projections'][0]['supposee'])
        self.assertEqual(r['projections'][0]['code'], 'sud')
        self.assertTrue(r['avertissements'])

    def test_coordonnees_en_degres_sans_prj(self):
        carre = [(-6.5, 31.5), (-6.5, 31.6), (-6.4, 31.6), (-6.4, 31.5)]
        fichiers = shapefile([[carre]], ['NAME'], [['Zone']])
        r = importer_zones([('z.shp', fichiers['.shp'])])
        self.assertEqual(r['projections'][0]['code'], 'wgs84')
        self.assertEqual(r['zones'][0]['polygones'][0][0][0], [31.5, -6.5])

    def test_erreurs(self):
        with self.assertRaisesMessage(ErreurZones, 'Aucun fichier exploitable'):
            importer_zones([('notes.txt', b'x')])
        with self.assertRaisesMessage(ErreurZones, 'pas un shapefile valide'):
            importer_zones([('z.shp', b'0' * 120)])
        with self.assertRaisesMessage(ErreurZones, 'pas une archive ZIP'):
            importer_zones([('z.zip', b'pas un zip')])
        points = bytearray(shapefile([[CARRE_B]], ['ID'], [['1']])['.shp'])
        points[32:36] = struct.pack('<i', 1)                         # type « points »
        with self.assertRaisesMessage(ErreurZones, 'ne contient pas de polygones'):
            importer_zones([('p.shp', bytes(points))])


class GeoPackageTests(SimpleTestCase):
    def test_couche_type_deduit_du_nom_et_projection_epsg(self):
        r = importer_zones([('etude.gpkg', geopackage([('Secteur nord', [CARRE_A]), ('Secteur sud', [CARRE_B])]))])
        self.assertEqual([z['nom'] for z in r['zones']], ['Secteur nord', 'Secteur sud'])
        self.assertEqual({z['type'] for z in r['zones']}, {'densification'})       # nom de la couche
        self.assertEqual(r['zones'][0]['attributs']['surface'], '16.5')
        self.assertEqual(r['projections'][0]['code'], 'nord')

    def test_wkb_multipolygone_et_geometrie_vide(self):
        multi = struct.pack('<BII', 1, 6, 2) + wkb_polygone([CARRE_A]) + wkb_polygone([CARRE_B])
        self.assertEqual(len(wkb_gpkg(b'GP\x00\x01' + struct.pack('<i', 0) + multi)), 2)
        self.assertIsNone(wkb_gpkg(b'GP\x00\x11' + struct.pack('<i', 0)))
        self.assertIsNone(wkb_gpkg(b'xx'))

    def test_fichier_qui_n_est_pas_un_geopackage(self):
        with self.assertRaisesMessage(ErreurZones, 'GeoPackage lisible'):
            importer_zones([('faux.gpkg', b'pas une base sqlite' * 50)])


class ReseauPersonnaliseTests(SimpleTestCase):
    def test_meme_lignes_que_la_variante_meme_score(self):
        pts = _grille_triangulaire(3, 3)
        r = generer_reseau(pts)
        v = next(x for x in r['variantes'] if x['code'] == 'delaunay')
        noms = [p['nom_point'] for p in r['points']]
        lignes = [[noms[l['de']], noms[l['a']]] for l in v['lignes']]
        perso = evaluer_personnalise(pts, lignes)
        self.assertEqual(perso['code'], 'personnalise')
        self.assertEqual(perso['indicateurs']['score'], v['indicateurs']['score'])
        # Retirer une ligne : moins de lignes, score différent ou égal mais recalculé.
        moins = evaluer_personnalise(pts, lignes[1:])
        self.assertEqual(moins['indicateurs']['nb_lignes_base'], len(lignes) - 1)
        self.assertLessEqual(moins['indicateurs']['score'], perso['indicateurs']['score'])

    def test_lignes_invalides(self):
        pts = _grille_triangulaire(2, 2)
        with self.assertRaisesMessage(ErreurReseau, 'point inconnu'):
            evaluer_personnalise(pts, [['A00', 'ZZZ']])
        with self.assertRaisesMessage(ErreurReseau, 'lui-même'):
            evaluer_personnalise(pts, [['A00', 'A00']])
        double = pts + [_pt('A00', 999999, 999999)]
        with self.assertRaisesMessage(ErreurReseau, 'Deux points portent le nom'):
            evaluer_personnalise(double, [])


def _lambert(poly):
    return [[list(p) for p in a] for a in poly]


class DensificationZonesTests(SimpleTestCase):
    ANCIENS = [_pt('A', 420000, 380000), _pt('B', 428000, 380000), _pt('C', 424000, 387000)]

    def test_points_places_dans_la_zone_de_densification(self):
        zone = [[(422000, 381000), (422000, 384000), (426000, 384000), (426000, 381000)]]
        r = densifier(self.ANCIENS, nb_nouveaux=2, zones_densification=[_lambert(zone)])
        nouveaux = [p for p in r['points'] if p['statut'] == 'nouveau']
        self.assertEqual(len(nouveaux), 2)
        for p in nouveaux:
            self.assertTrue(422000 <= p['x_m'] <= 426000 and 381000 <= p['y_m'] <= 384000, p)
        self.assertEqual(r['zones_utilisees'], {'densification': 1, 'levee': 0})
        self.assertEqual(r['zone_polygone'], [])

    def test_reseau_personnalise_evalue_sans_proposition(self):
        nouveaux = [{**_pt('N1', 424000, 382000), 'statut': 'nouveau'}]
        r = densifier(self.ANCIENS, nouveaux, nb_nouveaux=5, lignes=[[0, 1], [1, 2], [2, 0], [3, 0]])
        self.assertTrue(r['personnalise'])
        self.assertEqual(r['reseau']['indicateurs']['nb_lignes_base'], 4)
        self.assertEqual(len([p for p in r['points'] if p['statut'] == 'nouveau']), 1)
        with self.assertRaises(ErreurDensification):
            densifier(self.ANCIENS, lignes=[[0, 9]])


class ApiZonesTests(ApiTests):
    def test_import_zones_et_evaluation(self):
        self.client.force_authenticate(self.agent)
        fichiers = shapefile([[CARRE_A]], ['NOM', 'NATURE'], [['Lot 1', 'levé']])
        r = self.client.post(f'{URL}zones/importer/', {
            'fichiers': [SimpleUploadedFile('lot.zip', zip_de('lot', fichiers))], 'zone': 'nord'}, format='multipart')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['zones'][0]['type'], 'levee')
        r = self.client.post(f'{URL}zones/importer/', {'fichiers': [SimpleUploadedFile('a.txt', b'x')]},
                             format='multipart')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.client.post(f'{URL}zones/importer/', {}, format='multipart').status_code, 400)
        pts = _grille_triangulaire(2, 2)
        r = self.client.post(f'{URL}evaluer/', {'points': pts, 'lignes': [['A00', 'A01'], ['A01', 'A10'],
                                                                        ['A10', 'A00']]}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['indicateurs']['nb_triangles'], 1)
        r = self.client.post(f'{URL}evaluer/', {'points': pts, 'lignes': [['A00', 'X']]}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_densification_avec_zones_par_api(self):
        self.client.force_authenticate(self.agent)
        zone = [[[422000, 381000], [422000, 384000], [426000, 384000], [426000, 381000]]]
        r = self.client.post(f'{URL}densifier/', {
            'anciens': DensificationZonesTests.ANCIENS, 'nb_nouveaux': 1, 'zones_levee': [zone]}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['zones_utilisees']['levee'], 1)
        r = self.client.post(f'{URL}densifier/', {
            'anciens': DensificationZonesTests.ANCIENS, 'zones_levee': [[['a', 'b']]]}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_non_authentifie(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post(f'{URL}evaluer/', {}, format='json').status_code, 401)
        self.assertEqual(self.client.post(f'{URL}zones/importer/', {}).status_code, 401)
