"""
Export complet d'un dossier en ZIP : contenu, portée RBAC, journalisation.
"""
import io
import json
import shutil
import tempfile
import zipfile

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.test import override_settings

from accounts.models import AuditEvent
from pieces.models import Piece, PieceImage, RapportGeneration
from projects.models import Ssdgps

from .tests_workflow_ssdgps import WorkflowBaseTest

User = get_user_model()
MEDIA = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=MEDIA)
class ExportZipTests(WorkflowBaseTest):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        super().setUp()
        self.lpa = Piece.objects.create(
            ssdgps=self.ssdgps, type_piece='LPA', ordre=0, statut=Piece.Statut.VALIDE,
            payload={'rows': [{'id': 1, 'nom_point': 'B12', 'x': '123.45', 'extra': 'é'}]})
        self.lpa.fichier.save('lpa.xlsx', ContentFile(b'XLSX'), save=True)
        self.ppa = Piece.objects.create(ssdgps=self.ssdgps, type_piece='PPA', ordre=1, payload={})
        img = PieceImage(piece=self.ppa, point_ref='B12', ordre=0)
        img.fichier.save('p.jpg', ContentFile(b'JPEG'), save=True)
        Piece.objects.create(ssdgps=self.ssdgps, type_piece='RDC', ordre=2, is_deleted=True,
                             payload={'rows': [{'id': 1}]})
        gen = RapportGeneration.objects.create(ssdgps=self.ssdgps, created_by=self.agent,
                                               statut=RapportGeneration.Statut.TERMINE, nom_fichier='R.pdf')
        gen.fichier.save('R.pdf', ContentFile(b'%PDF-1.4'), save=True)

    def telecharger(self):
        return self.client.get(f'/api/v1/ssdgps/{self.ssdgps.id}/export-zip/')

    def test_contenu_de_l_archive(self):
        r = self.telecharger()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r['Content-Type'], 'application/zip')
        self.assertIn('attachment', r['Content-Disposition'])
        zf = zipfile.ZipFile(io.BytesIO(b''.join(r.streaming_content)))
        noms = set(zf.namelist())
        self.assertTrue({'LISEZMOI.txt', 'dossier.json', 'donnees/01_LPA.csv', 'sources/01_LPA.xlsx',
                         'photos/02_PPA/001_B12.jpg', 'rapport/R.pdf'} <= noms, noms)
        self.assertFalse(any('RDC' in n for n in noms))   # corbeille exclue
        csv = zf.read('donnees/01_LPA.csv').decode('utf-8')
        self.assertTrue(csv.startswith('﻿'))
        self.assertIn('Nom Point', csv.splitlines()[0])
        self.assertIn('B12', csv)
        self.assertIn('extra', csv.splitlines()[0])   # colonne hors catalogue conservée
        fiche = json.loads(zf.read('dossier.json'))
        self.assertEqual([p['type'] for p in fiche['pieces']], ['LPA', 'PPA'])
        self.assertIn('Statut', zf.read('LISEZMOI.txt').decode('utf-8'))

    def test_journalise(self):
        self.telecharger()
        ev = AuditEvent.objects.get(action=AuditEvent.ACTION_DOSSIER_EXPORTE)
        self.assertEqual(ev.acteur, self.agent)
        self.assertEqual(ev.details['pieces'], 2)
        self.assertTrue(ev.details['rapport'])

    def test_ouvert_sur_un_dossier_fige(self):
        Ssdgps.objects.filter(pk=self.ssdgps.pk).update(statut=Ssdgps.Statut.CLOS)
        self.assertEqual(self.telecharger().status_code, 200)

    def test_hors_portee_404(self):
        etranger = User.objects.create_user(username='e@x.ma', email='e@x.ma', password='Passw0rd!')
        self.client.force_authenticate(etranger)
        self.assertEqual(self.telecharger().status_code, 404)

    def test_plafond(self):
        from unittest import mock
        with mock.patch('projects.export_dossier.PLAFOND_OCTETS', 1):
            self.assertEqual(self.telecharger().status_code, 413)
