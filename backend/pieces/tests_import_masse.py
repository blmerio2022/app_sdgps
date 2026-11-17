"""
Import en masse : reconnaissance de chaque fichier d'un levé et plan proposé.

- tableaux : en-têtes libellés comme dans l'application → type reconnu ; code ou mot-clé
  dans le nom ; une pièce par feuille d'un classeur Excel ; PPA / PPN départagées par le
  nom ou par croisement avec la LPA ; petite faute de frappe d'en-tête tolérée ;
- rapports HTML de TBC : fermeture de boucle → RFB ; ajustement sans point fixe → RDL,
  un point fixe → RDN (numéro tiré du nom), plusieurs → RDD ; une page-cadre seule est
  signalée, une page-cadre dont le contenu est déposé est écartée ;
- images : nom = point → photo rattachée au point ; sinon nature de l'image (photo de
  terrain, plan → canevas, document → rapport de consultation) ; mot-clé du nom ;
- plan : remplacement d'une pièce existante, numéros libres, doublons, RC calculable ;
- portée RBAC, verrou du dossier figé, ré-imports CSV et HTML refusés sur un dossier figé.
"""
import io
import json

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image, ImageDraw

from pieces.catalog import effective_champs
from pieces.import_masse import _code_dans_nom, analyser_tableau, nature_image
from pieces.models import Piece
from projects.models import Ssdgps
from projects.tests_workflow_ssdgps import WorkflowBaseTest

User = get_user_model()


def csv_de(type_piece, nom, lignes=2, valeurs=None, entetes=None):
    champs = [c for c in effective_champs(type_piece) if c['name'] != 'id']
    entete = ';'.join(entetes or [c['label'] for c in champs])
    corps = '\n'.join(';'.join((valeurs[i] if valeurs and c['name'] == 'nom_point' else f'v{i}')
                               for c in champs) for i in range(lignes))
    return SimpleUploadedFile(nom, (entete + '\n' + corps).encode('utf-8'), content_type='text/csv')


def html_ajustement(points, fixes, nom='rapport.html'):
    lignes = ''.join(
        f"<tr><td>{p}</td><td>1000.0</td><td>{'?' if p in fixes else '0.010'}</td>"
        f"<td>2000.0</td><td>{'?' if p in fixes else '0.012'}</td></tr>" for p in points)
    html = ("<html><body><h1>Rapport sur l’ajustement du réseau</h1><table>"
            "<tr><th>ID de point</th><th>Abscisse</th><th>Abscisse Erreur</th><th>Nord</th>"
            f"<th>Nord Erreur</th></tr>{lignes}</table></body></html>")
    return SimpleUploadedFile(nom, html.encode('utf-8'), content_type='text/html')


def html_boucle(nom='boucle.html'):
    bloc = ('<a>PV1-PV2-PV3</a> Longueur = 1000.0 ΔHoriz = 0.01 ΔVert = 0.02 PPM = 3.0 '
            'Δ3D = 0.02 ΔX = 0.01 ΔY = 0.01 ΔZ = 0.01 ')
    html = f"<html><body><h1>Résultats de fermeture de boucle GNSS</h1> Boucle : A-B-C {bloc}</body></html>"
    return SimpleUploadedFile(nom, html.encode('utf-8'), content_type='text/html')


def image(nom, sorte):
    if sorte == 'photo':
        im = Image.new('RGB', (300, 300), (40, 120, 30))
        d = ImageDraw.Draw(im)
        for i in range(0, 300, 20):
            d.rectangle([i, 0, i + 10, 300], fill=(160, 90, 20))
    elif sorte == 'plan':
        im = Image.new('RGB', (900, 400), (255, 255, 255))
        ImageDraw.Draw(im).line([10, 10, 880, 380], fill=(200, 0, 0), width=3)
    else:  # document portrait
        im = Image.new('RGB', (400, 600), (255, 255, 255))
        d = ImageDraw.Draw(im)
        for y in range(40, 560, 30):
            d.line([30, y, 370, y], fill=(60, 60, 60), width=2)
    tampon = io.BytesIO()
    im.save(tampon, 'PNG' if nom.endswith('.png') else 'JPEG')
    return SimpleUploadedFile(nom, tampon.getvalue())


def classeur(feuilles):
    import openpyxl
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for titre, type_piece in feuilles:
        ws = wb.create_sheet(titre)
        champs = [c for c in effective_champs(type_piece) if c['name'] != 'id']
        ws.append([c['label'] for c in champs])
        ws.append([f'v{i}' for i in range(len(champs))])
    wb.create_sheet('Vide')
    tampon = io.BytesIO()
    wb.save(tampon)
    return SimpleUploadedFile('levé.xlsx', tampon.getvalue())


class ReconnaissanceTests(WorkflowBaseTest):
    def test_code_et_numero_dans_le_nom(self):
        self.assertEqual(_code_dans_nom('levé_RDN_2.csv', 'RDN'), (True, 2))
        self.assertEqual(_code_dans_nom('rdn n°3.xlsx', 'RDN'), (True, 3))
        self.assertEqual(_code_dans_nom('RDNX.csv', 'RDN'), (False, None))

    def test_entetes_et_faute_de_frappe(self):
        entetes = [c['label'] for c in effective_champs('PPA') if c['name'] != 'id']
        entetes = [('Sytème Projection' if e == 'Système Projection' else e) for e in entetes]
        item = analyser_tableau(csv_de('PPA', 'photos points anciens.csv', entetes=entetes), 'PDC/GPS', 'x/photos points anciens.csv')
        self.assertEqual(item['type_piece'], 'PPA')
        self.assertIn('systeme_projection', item['mapping'])

    def test_nature_des_images(self):
        self.assertEqual(nature_image(image('a.jpg', 'photo')), 'photo')
        self.assertEqual(nature_image(image('b.png', 'plan')), 'plan')
        self.assertEqual(nature_image(image('c.png', 'document')), 'document')


class PlanApiTests(WorkflowBaseTest):
    def plan(self, *fichiers, chemins=None):
        corps = {'ssdgps': str(self.ssdgps.id), 'fichiers': list(fichiers)}
        if chemins:
            corps['chemins'] = json.dumps(chemins)
        r = self.client.post('/api/v1/pieces/import-plan/', corps, format='multipart')
        self.assertEqual(r.status_code, 200, getattr(r, 'data', r))
        return r.data

    def par_type(self, data):
        return {(i['type_piece'], i.get('numero')): i for i in data['plan'] if i.get('action') != 'ignorer'}

    def test_tableaux_existant_doublon_numero(self):
        Piece.objects.create(ssdgps=self.ssdgps, type_piece='LPA', payload={'rows': []})
        d = self.plan(csv_de('LPA', 'LPA.csv'), csv_de('RDN', 'RDN_2.csv'), csv_de('LPA', 'lpa_bis.csv'),
                      SimpleUploadedFile('x.docx', b'x'))
        t = self.par_type(d)
        self.assertEqual(t[('LPA', None)]['action'], 'remplacer')
        self.assertIn(('RDN', 2), t)
        self.assertTrue(any(i['doublon'] for i in d['plan']))
        self.assertEqual(d['ecartes'][0]['raison'], 'Format non pris en charge')
        self.assertFalse(Piece.objects.filter(type_piece='RDN').exists())   # rien persisté

    def test_une_piece_par_feuille_excel(self):
        d = self.plan(classeur([('Points anciens', 'LPA'), ('Observations', 'ROB')]))
        feuilles = {i['feuille']: i['type_piece'] for i in d['plan']}
        self.assertEqual(feuilles, {'Points anciens': 'LPA', 'Observations': 'ROB'})

    def test_rapports_tbc_par_leur_contenu(self):
        pts = ['A', 'B', 'C']
        d = self.plan(html_boucle(), html_ajustement(pts, []), html_ajustement(pts, ['A']),
                      html_ajustement(pts, ['B']), html_ajustement(pts, ['A', 'B']),
                      chemins=['l/boucle_files/x.html', 'l/Rapport libre_files/a.html',
                               'l/Rapport 1_files/b.html', 'l/Rapport 2_files/c.html', 'l/Rapport def_files/d.html'])
        t = self.par_type(d)
        self.assertEqual(set(t), {('RFB', None), ('RDL', None), ('RDN', 1), ('RDN', 2), ('RDD', None)})
        self.assertIn('B', t[('RDN', 2)]['raison'])

    def test_rapport_html_prioritaire_sur_csv_et_derniere_version(self):
        pts = ['A', 'B']
        d = self.plan(csv_de('RDL', 'data-rapport-determination-libre.csv'), html_ajustement(pts, []),
                      html_ajustement(pts, []), chemins=['l/09-rapport-determination-libre/data-rapport-determination-libre.csv',
                                                        'l/09-rapport-determination-libre/Rapport libre V1_files/a.html',
                                                        'l/09-rapport-determination-libre/Rapport libre V2_files/b.html'])
        retenus = [i for i in d['plan'] if i['action'] != 'ignorer']
        self.assertEqual(len(retenus), 1)
        self.assertEqual((retenus[0]['mode'], retenus[0]['nom_rapport']), ('html', 'Rapport libre V2'))

    def test_csv_des_determinations_numerotees_et_assemblees(self):
        rdia = SimpleUploadedFile('data-rapport-determinations-intermediaires.csv',
                                  'ID,Nom Point Fixe,Nom Point Calculé,X(m),σX(m),Y(m),σY(m)\n1,8,8,1,FIXE,2,FIXE\n'.encode())
        dossier = 'l/10-rapport-determinations-intermediaires/'
        d = self.plan(csv_de('RDN', 'data-rapport-determination-n3.csv'), rdia, html_ajustement(['A', 'B'], ['A']),
                      csv_de('RDN', 'data-rapport-determination-n1.csv'),
                      chemins=[dossier + 'data-rapport-determination-n3.csv', dossier + 'data-rapport-determinations-intermediaires.csv',
                               dossier + 'Rapport 1_files/x.html', dossier + 'data-rapport-determination-n1.csv'])
        t = {(i['type_piece'], i.get('numero'), i['mode']): i['action'] for i in d['plan']}
        self.assertEqual(t[('RDN', 3, 'tableau')], 'creer')
        self.assertEqual(t[('RDIA', None, 'tableau')], 'creer')
        self.assertEqual(t[('RDN', 1, 'html')], 'creer')
        self.assertEqual(t[('RDN', 1, 'tableau')], 'ignorer')   # même n° déjà fourni par le rapport HTML

    def test_le_nom_du_dossier_ne_donne_pas_de_numero(self):
        # « 02-format-n2 » est un dossier : il ne fait pas du CSV une détermination n°2.
        d = self.plan(csv_de('LPA', 'data-liste-points-anciens.csv'), csv_de('RDN', 'data-rapport-determination-n3.csv'),
                      chemins=['02-format-n2/data-liste-points-anciens.csv', '02-format-n2/data-rapport-determination-n3.csv'])
        lpa = next(i for i in d['plan'] if i['type_piece'] == 'LPA')
        self.assertTrue(all(c['numero_nom'] is None for c in lpa['candidats']))
        rdn = next(i for i in d['plan'] if i['type_piece'] == 'RDN')
        self.assertEqual(rdn['numero'], 3)

    def test_dossier_files_seul(self):
        d = self.plan(html_ajustement(['A', 'B'], ['A']), chemins=['Rapport 7_files/x.html'])
        self.assertEqual((d['plan'][0]['type_piece'], d['plan'][0]['numero'], d['plan'][0]['action']), ('RDN', 7, 'creer'))

    def test_page_cadre_seule_signalee_et_page_cadre_redondante_ecartee(self):
        cadre = SimpleUploadedFile('Rapport 1.html', b'<html><frameset><frame src="x"></frameset></html>')
        d = self.plan(cadre, chemins=['l/Rapport 1.html'])
        self.assertIn('_files', d['plan'][0]['erreur'])
        cadre.seek(0)
        d = self.plan(cadre, html_ajustement(['A', 'B'], ['A']), chemins=['l/Rapport 1.html', 'l/Rapport 1_files/x.html'])
        self.assertEqual(len(d['plan']), 1)
        self.assertEqual(d['ecartes'][0]['fichier'], 'l/Rapport 1.html')

    def test_photos_rattachees_aux_points_et_autres_images(self):
        d = self.plan(csv_de('LPA', 'liste points anciens.csv', valeurs=['GPS1', 'BT10']),
                      csv_de('PPA', 'data.csv', valeurs=['GPS1', 'BT10']),
                      csv_de('PPN', 'data2.csv', valeurs=['MEKOUSSA', 'S9']),
                      image('GPS1.jpg', 'photo'), image('MEKOUSSA.jpg', 'photo'), image('inconnu.jpg', 'photo'),
                      image('canevas.png', 'plan'), image('page.png', 'document'),
                      image('stabilite.png', 'document'))
        t = {i['type_piece'] for i in d['plan'] if i.get('action') != 'ignorer'}
        self.assertTrue({'PPA', 'PPN'} <= t)   # PPA / PPN départagées par la LPA
        img = {i['fichier']: i for i in d['images']}
        self.assertEqual((img['GPS1.jpg']['type_piece'], img['GPS1.jpg']['point']), ('PPA', 'GPS1'))
        # Sans colonne ID, la clé du point est son nom (règle de la page des photos).
        self.assertEqual(img['GPS1.jpg']['point_ref'], 'GPS1')
        self.assertEqual((img['MEKOUSSA.jpg']['type_piece'], img['MEKOUSSA.jpg']['point']), ('PPN', 'MEKOUSSA'))
        self.assertEqual(img['inconnu.jpg']['point'], '')
        self.assertEqual(set(img['inconnu.jpg']['candidats']), {'PPA', 'PPN'})
        self.assertEqual(img['canevas.png']['type_piece'], 'CCSPA')     # seul canevas d'un PDC
        self.assertEqual(img['page.png']['type_piece'], 'RDC')
        self.assertEqual(img['stabilite.png']['type_piece'], 'CCSPA')   # mot-clé du nom
        self.assertIn({'nom': 'GPS1', 'cle': 'GPS1'}, d['points']['PPA'])

    def test_photo_rattachee_a_l_id_de_la_ligne(self):
        # Avec une colonne ID (cas réel), la photo « 8 » porte l'ID de SA ligne (« 1 ») — et
        # non « 8 », qui désignerait la 8e ligne, un autre point.
        csv = SimpleUploadedFile('data-rapport-photos-points-anciens.csv', (
            'ID,Nom Point,X(m),Y(m),Date Visite,Système Projection,Zone Projection,Fichier Image\n'
            '1,8,1,2,07/04/2023,Lambert,Zone I,8.jpg\n8,BT10,1,2,07/04/2023,Lambert,Zone I,BT10.jpg\n').encode())
        d = self.plan(csv, image('8.jpg', 'photo'), image('BT10.jpg', 'photo'))
        ppa = next(i for i in d['plan'] if i['type_piece'] == 'PPA')
        self.assertEqual(ppa['mapping'].get('id'), 'ID')
        img = {i['fichier']: i['point_ref'] for i in d['images']}
        self.assertEqual(img, {'8.jpg': '1', 'BT10.jpg': '8'})

    def test_rc_possible(self):
        d = self.plan(csv_de('LPA', 'LPA.csv'), html_ajustement(['A'], ['A']), chemins=['l/LPA.csv', 'l/R 1_files/x.html'])
        self.assertTrue(d['rc_possible'])
        self.assertFalse(d['rc_existant'])
        rc = Piece.objects.create(ssdgps=self.ssdgps, type_piece='RC', payload={'rows': []})
        d = self.plan(csv_de('LPA', 'LPA.csv'))
        self.assertTrue(d['rc_existant'])
        self.assertEqual(d['pieces_existantes']['RC'], str(rc.id))

    def test_sans_fichier_400(self):
        self.assertEqual(self.client.post('/api/v1/pieces/import-plan/', {'ssdgps': str(self.ssdgps.id)},
                                          format='multipart').status_code, 400)

    def test_hors_portee_404(self):
        self.client.force_authenticate(User.objects.create_user(username='e@x.ma', email='e@x.ma',
                                                                password='Passw0rd!'))
        r = self.client.post('/api/v1/pieces/import-plan/', {'ssdgps': str(self.ssdgps.id),
                                                             'fichiers': [csv_de('LPA', 'LPA.csv')]}, format='multipart')
        self.assertEqual(r.status_code, 404)

    def test_dossier_fige_403(self):
        Ssdgps.objects.filter(pk=self.ssdgps.pk).update(statut=Ssdgps.Statut.SOUMIS)
        r = self.client.post('/api/v1/pieces/import-plan/', {'ssdgps': str(self.ssdgps.id),
                                                             'fichiers': [csv_de('LPA', 'LPA.csv')]}, format='multipart')
        self.assertEqual(r.status_code, 403)


class ImportUnitaireTests(WorkflowBaseTest):
    def test_import_d_une_feuille_precise(self):
        r = self.client.post('/api/v1/pieces/import/', {
            'fichier': classeur([('Points anciens', 'LPA'), ('Observations', 'ROB')]), 'type_piece': 'ROB',
            'feuille': 'Observations'}, format='multipart')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertIn('Point', ' '.join(r.data['columns']))

    def test_reimports_refuses_sur_dossier_fige(self):
        piece = Piece.objects.create(ssdgps=self.ssdgps, type_piece='LPA', payload={'rows': [{'id': 1}]})
        rdl = Piece.objects.create(ssdgps=self.ssdgps, type_piece='RDL', payload={'rows': [{'id': 1}]})
        Ssdgps.objects.filter(pk=self.ssdgps.pk).update(statut=Ssdgps.Statut.VALIDE)
        r = self.client.post('/api/v1/pieces/import/', {
            'fichier': csv_de('LPA', 'LPA.csv'), 'type_piece': 'LPA', 'piece_id': str(piece.id),
            'mapping': '{"nom_point": "Nom Point"}'}, format='multipart')
        self.assertEqual(r.status_code, 403)
        r = self.client.post('/api/v1/pieces/import-html/', {
            'fichier': html_ajustement(['A'], []), 'type_piece': 'RDL', 'piece_id': str(rdl.id)}, format='multipart')
        self.assertEqual(r.status_code, 403)
        rdl.refresh_from_db()
        self.assertEqual(rdl.payload, {'rows': [{'id': 1}]})


class AssemblageRdiaTests(WorkflowBaseTest):
    def test_rdia_assemblee_depuis_des_lignes_fournies(self):
        sources = [{'label': 'Libre', 'rows': [{'nom_point': 'A', 'x_m': '1'}]},
                   {'label': 'N°1', 'rows': [{'nom_point': 'A', 'x_m': '1', 'sigma_x_m': 'FIXE'}, {'nom_point': 'B', 'x_m': '2'}]}]
        r = self.client.post('/api/v1/pieces/assemble-rdi/', {'ssdgps': str(self.ssdgps.id), 'commit': '1',
                                                              'sources': json.dumps(sources)}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        lignes = r.data['payload']['rows']
        self.assertEqual([(l['determination'], l['nom_point']) for l in lignes], [('Libre', 'A'), ('N°1', 'A'), ('N°1', 'B')])
        self.assertFalse(Piece.objects.filter(ssdgps=self.ssdgps, type_piece='RDN').exists())
        # Réassemblage d'une RDIA existante ; refusé sur un dossier figé.
        rdia = r.data['id']
        r = self.client.post('/api/v1/pieces/assemble-rdi/', {'piece_id': rdia, 'commit': '1',
                                                              'sources': json.dumps(sources[1:])}, format='json')
        self.assertEqual(len(r.data['payload']['rows']), 2)
        Ssdgps.objects.filter(pk=self.ssdgps.pk).update(statut=Ssdgps.Statut.SOUMIS)
        r = self.client.post('/api/v1/pieces/assemble-rdi/', {'piece_id': rdia, 'commit': '1',
                                                              'sources': json.dumps(sources)}, format='json')
        self.assertEqual(r.status_code, 403)

    def test_sources_invalides_400(self):
        r = self.client.post('/api/v1/pieces/assemble-rdi/', {'ssdgps': str(self.ssdgps.id), 'commit': '1',
                                                              'sources': json.dumps([{'label': 'x'}])}, format='json')
        self.assertEqual(r.status_code, 400)

