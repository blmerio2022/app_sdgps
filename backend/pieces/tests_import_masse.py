"""
Import en masse : reconnaissance du type de chaque fichier et plan proposé.

- en-têtes libellés comme dans l'application → type reconnu, correspondance prête ;
- le code du type dans le nom du fichier donne un bonus et le numéro d'une pièce répétable ;
- une pièce existante de même type/numéro est proposée au remplacement ;
- deux fichiers pour une pièce unique : le second est écarté (doublon) ;
- fichier illisible signalé sans bloquer les autres ;
- portée RBAC, verrou du dossier figé ;
- le ré-import d'une pièce (piece_id) respecte désormais le verrou.
"""
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile

from pieces.catalog import effective_champs
from pieces.import_masse import _code_dans_nom, analyser_fichier
from pieces.models import Piece
from projects.models import Ssdgps
from projects.tests_workflow_ssdgps import WorkflowBaseTest

User = get_user_model()


def csv_de(type_piece, nom, lignes=2):
    champs = [c for c in effective_champs(type_piece) if c['name'] != 'id']
    entete = ';'.join(c['label'] for c in champs)
    corps = '\n'.join(';'.join(f'v{i}' for _ in champs) for i in range(lignes))
    return SimpleUploadedFile(nom, (entete + '\n' + corps).encode('utf-8'), content_type='text/csv')


class ReconnaissanceTests(WorkflowBaseTest):
    def test_code_et_numero_dans_le_nom(self):
        self.assertEqual(_code_dans_nom('levé_RDN_2.csv', 'RDN'), (True, 2))
        self.assertEqual(_code_dans_nom('rdn n°3.xlsx', 'RDN'), (True, 3))
        self.assertEqual(_code_dans_nom('LPA.csv', 'LPA'), (True, None))
        self.assertEqual(_code_dans_nom('RDNX.csv', 'RDN'), (False, None))

    def test_entetes_suffisent(self):
        plan = analyser_fichier(csv_de('LPA', 'points.csv'), 'PDC/GPS')
        self.assertEqual(plan['type_piece'], 'LPA')
        self.assertGreater(plan['confiance'], 0.9)
        self.assertTrue(plan['mapping'])
        self.assertEqual(plan['lignes'], 2)

    def test_fichier_illisible(self):
        plan = analyser_fichier(SimpleUploadedFile('notes.docx', b'x'), 'PDC/GPS')
        self.assertFalse(plan['lisible'])
        self.assertIsNone(plan['type_piece'])


class PlanApiTests(WorkflowBaseTest):
    def plan(self, *fichiers, ssdgps=None):
        return self.client.post('/api/v1/pieces/import-plan/', {
            'ssdgps': str((ssdgps or self.ssdgps).id), 'fichiers': list(fichiers)}, format='multipart')

    def test_plan_complet(self):
        Piece.objects.create(ssdgps=self.ssdgps, type_piece='LPA', payload={'rows': []})
        r = self.plan(csv_de('LPA', 'LPA.csv'), csv_de('RDN', 'RDN_2.csv'), csv_de('RDN', 'det.csv'),
                      csv_de('LPA', 'lpa_bis.csv'), SimpleUploadedFile('x.docx', b'x'))
        self.assertEqual(r.status_code, 200, r.data)
        p = r.data['plan']
        self.assertEqual((p[0]['type_piece'], p[0]['action']), ('LPA', 'remplacer'))
        self.assertTrue(p[0]['piece_existante'])
        self.assertEqual((p[1]['type_piece'], p[1]['numero'], p[1]['action']), ('RDN', 2, 'creer'))
        # Mêmes en-têtes que la RDD / RDL, sans indice dans le nom : ambigu, l'opérateur tranche.
        self.assertTrue(p[2]['ambigu'])
        self.assertIsNone(p[2]['type_piece'])
        tete = p[2]['candidats'][0]['score']
        self.assertIn('RDN', {c['type_piece'] for c in p[2]['candidats'] if c['score'] == tete})
        self.assertTrue(p[3]['doublon'])
        self.assertEqual(p[3]['action'], 'ignorer')
        self.assertEqual(p[4]['action'], 'ignorer')
        self.assertFalse(Piece.objects.filter(type_piece='RDN').exists())   # rien persisté

    def test_premier_numero_libre(self):
        Piece.objects.create(ssdgps=self.ssdgps, type_piece='RDN', numero=1, payload={'rows': []})
        p = self.plan(csv_de('RDN', 'RDN.csv')).data['plan'][0]
        self.assertEqual((p['type_piece'], p['numero'], p['action']), ('RDN', 2, 'creer'))

    def test_sans_fichier_400(self):
        self.assertEqual(self.client.post('/api/v1/pieces/import-plan/', {'ssdgps': str(self.ssdgps.id)},
                                          format='multipart').status_code, 400)

    def test_hors_portee_404(self):
        self.client.force_authenticate(User.objects.create_user(username='e@x.ma', email='e@x.ma',
                                                                password='Passw0rd!'))
        self.assertEqual(self.plan(csv_de('LPA', 'LPA.csv')).status_code, 404)

    def test_dossier_fige_403(self):
        Ssdgps.objects.filter(pk=self.ssdgps.pk).update(statut=Ssdgps.Statut.SOUMIS)
        self.assertEqual(self.plan(csv_de('LPA', 'LPA.csv')).status_code, 403)


class ReimportVerrouTests(WorkflowBaseTest):
    def test_reimport_refuse_sur_dossier_fige(self):
        piece = Piece.objects.create(ssdgps=self.ssdgps, type_piece='LPA', payload={'rows': [{'id': 1}]})
        Ssdgps.objects.filter(pk=self.ssdgps.pk).update(statut=Ssdgps.Statut.VALIDE)
        r = self.client.post('/api/v1/pieces/import/', {
            'fichier': csv_de('LPA', 'LPA.csv'), 'type_piece': 'LPA', 'piece_id': str(piece.id),
            'mapping': '{"nom_point": "Nom Point"}'}, format='multipart')
        self.assertEqual(r.status_code, 403)
        piece.refresh_from_db()
        self.assertEqual(piece.payload, {'rows': [{'id': 1}]})
