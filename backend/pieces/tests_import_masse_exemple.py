"""
Import en masse de bout en bout sur le levé d'exemple réel (PDC mono-session) :
`docs/exemples-ssdgps/01-exemples-donnees-pieces-ssdgps/03-import-en-masse/…/01-pdc`.

Rejoue ce que fait l'écran : plan, imports unitaires (CSV, rapports TBC), photos par
point, canevas, puis calcul du rapport de contrôle — dans la base de TEST.

Les exemples ne sont pas versionnés (`docs/exemples-ssdgps/` est ignoré par git) : le
test est sauté quand le dossier est absent (CI).
"""
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from pieces.models import Piece
from projects.tests_workflow_ssdgps import WorkflowBaseTest

DOSSIER = (Path(settings.BASE_DIR).parent / 'docs' / 'exemples-ssdgps' / '01-exemples-donnees-pieces-ssdgps'
           / '03-import-en-masse' / '01-ssdgps-monosession' / '01-pdc')
MEDIA = tempfile.mkdtemp()


@unittest.skipUnless(DOSSIER.is_dir(), "levé d'exemple absent (non versionné)")
@override_settings(MEDIA_ROOT=MEDIA)
class ImportMasseExempleTests(WorkflowBaseTest):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def _depot(self):
        """Fichiers à plat à la racine + contenu des dossiers `_files`, comme un dossier déposé."""
        fichiers, chemins = [], []
        for chemin in sorted(DOSSIER.rglob('*')):
            if chemin.is_dir():
                continue
            rel = chemin.relative_to(DOSSIER.parent).as_posix()
            parties = rel.split('/')
            if len(parties) > 2 and not parties[1].endswith('_files'):
                continue
            fichiers.append((chemin, rel))
        return fichiers

    def _fichier(self, chemin):
        return SimpleUploadedFile(chemin.name, chemin.read_bytes())

    def test_le_leve_complet_est_reconnu_et_importe(self):
        depot = self._depot()
        r = self.client.post('/api/v1/pieces/import-plan/', {
            'ssdgps': str(self.ssdgps.id), 'fichiers': [self._fichier(c) for c, _ in depot],
            'chemins': json.dumps([rel for _, rel in depot])}, format='multipart')
        self.assertEqual(r.status_code, 200, r.data)
        plan = [i for i in r.data['plan'] if i['action'] == 'creer']
        types = sorted((i['type_piece'], i.get('numero') or 0) for i in plan)
        self.assertEqual(types, sorted([('LPA', 0), ('ROB', 0), ('RTLB', 0), ('PPA', 0), ('PPN', 0), ('RFB', 0),
                                        ('RDL', 0), ('RDD', 0)] + [('RDN', n) for n in range(1, 11)]))
        photos = [i for i in r.data['images'] if i['type_piece'] in ('PPA', 'PPN')]
        self.assertEqual(len(photos), 22)
        self.assertTrue(all(i['point'] for i in photos))
        self.assertEqual([i['type_piece'] for i in r.data['images'] if i['nature_image'] == 'plan'], ['CCSPA'])
        self.assertTrue(r.data['rc_possible'])

        # Exécution, comme l'écran : chaque pièce par l'import unitaire.
        cree = {}
        for item in plan:
            chemin = depot[item['index']][0]
            corps = {'fichier': self._fichier(chemin), 'type_piece': item['type_piece'], 'ssdgps': str(self.ssdgps.id)}
            if item.get('numero'):
                corps['numero'] = str(item['numero'])
            if item['mode'] == 'html':
                rep = self.client.post('/api/v1/pieces/import-html/', corps, format='multipart')
            else:
                corps['mapping'] = json.dumps(item['mapping'])
                rep = self.client.post('/api/v1/pieces/import/', corps, format='multipart')
            self.assertIn(rep.status_code, (200, 201), (item['fichier'], rep.data))
            cree.setdefault(item['type_piece'], rep.data['id'])

        # Photos : un envoi par point, dans la pièce PPA / PPN créée depuis son CSV.
        for img in photos:
            chemin = depot[img['index']][0]
            rep = self.client.post(f"/api/v1/pieces/{cree[img['type_piece']]}/images/", {
                'fichiers': [self._fichier(chemin)], 'point_ref': img['point']}, format='multipart')
            self.assertIn(rep.status_code, (200, 201), rep.data)
        ppa = Piece.objects.get(pk=cree['PPA'])
        self.assertEqual(ppa.images.count(), 15)
        self.assertEqual(ppa.images.filter(point_ref='GPS1').count(), 1)

        # Rapport de contrôle calculé à partir de la LPA et des 10 déterminations.
        rep = self.client.post('/api/v1/pieces/compute-rc/', {'ssdgps': str(self.ssdgps.id), 'commit': '1'},
                               format='multipart')
        self.assertEqual(rep.status_code, 201, rep.data)
        self.assertGreater(len(rep.data['payload']['rows']), 0)
        self.assertEqual(Piece.objects.filter(ssdgps=self.ssdgps, type_piece='RDN').count(), 10)
