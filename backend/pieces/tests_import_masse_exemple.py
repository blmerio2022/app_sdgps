"""
Import en masse de bout en bout sur le levé d'exemple réel (PDC mono-session), dans ses
deux organisations :

- `01-format-n1` : un sous-dossier par pièce, avec souvent plusieurs sources pour la même
  pièce (CSV extrait + rapports HTML de TBC V1 / V2) ;
- `02-format-n2` : tous les fichiers à plat.

Rejoue ce que fait l'écran sur le dossier ENTIER (sous-dossiers compris) : plan, imports
unitaires (CSV, rapports TBC), photos par point, puis rapport de contrôle — dans la base
de TEST. Les exemples ne sont pas versionnés (`docs/exemples-ssdgps/` est ignoré par
git) : le test est sauté quand le dossier est absent (CI).
"""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from pieces.models import Piece
from projects.tests_workflow_ssdgps import WorkflowBaseTest

RACINE = (Path(settings.BASE_DIR).parent / 'docs' / 'exemples-ssdgps' / '01-exemples-donnees-pieces-ssdgps'
          / '03-import-en-masse' / '01-ssdgps-monosession' / '01-pdc')
MEDIA = tempfile.mkdtemp()
RDN = [('RDN', n) for n in range(1, 11)]


@override_settings(MEDIA_ROOT=MEDIA)
class _Levé(WorkflowBaseTest):
    dossier = None

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def depot(self):
        """Tout le dossier, sous-dossiers compris, comme « Choisir un dossier »."""
        return [(c, c.relative_to(self.dossier.parent).as_posix())
                for c in sorted(self.dossier.rglob('*')) if c.is_file()]

    def fichier(self, chemin):
        return SimpleUploadedFile(chemin.name, chemin.read_bytes())

    def planifier(self):
        depot = self.depot()
        r = self.client.post('/api/v1/pieces/import-plan/', {
            'ssdgps': str(self.ssdgps.id), 'fichiers': [self.fichier(c) for c, _ in depot],
            'chemins': json.dumps([rel for _, rel in depot])}, format='multipart')
        self.assertEqual(r.status_code, 200, getattr(r, 'data', r))
        return depot, r.data

    def importer(self, depot, data):
        cree = {}
        for item in [i for i in data['plan'] if i['action'] == 'creer']:
            corps = {'fichier': self.fichier(depot[item['index']][0]), 'type_piece': item['type_piece'],
                     'ssdgps': str(self.ssdgps.id)}
            if item.get('numero'):
                corps['numero'] = str(item['numero'])
            if item['mode'] == 'html':
                rep = self.client.post('/api/v1/pieces/import-html/', corps, format='multipart')
            else:
                corps['mapping'] = json.dumps(item['mapping'])
                if item.get('feuille'):
                    corps['feuille'] = item['feuille']
                rep = self.client.post('/api/v1/pieces/import/', corps, format='multipart')
            self.assertIn(rep.status_code, (200, 201), (item['fichier'], rep.data))
            cree.setdefault(item['type_piece'], rep.data['id'])
        # Comme l'écran : un envoi par (pièce, point), rattaché à la CLÉ du point (`point_ref`).
        groupes = {}
        for img in [i for i in data['images'] if i['type_piece'] in ('PPA', 'PPN')]:
            groupes.setdefault((img['type_piece'], img['point_ref']), []).append(depot[img['index']][0])
        for (type_, ref), chemins in groupes.items():
            rep = self.client.post(f"/api/v1/pieces/{cree[type_]}/images/", {
                'fichiers': [self.fichier(c) for c in chemins], 'point_ref': ref}, format='multipart')
            self.assertIn(rep.status_code, (200, 201), rep.data)
        return cree

    def verifier_photos(self, cree):
        """Chaque point des PPA / PPN a sa photo, lue COMME la page des photos (clé = ID de la
        ligne, sinon nom ; `point_ref` doit y être égal)."""
        for type_ in ('PPA', 'PPN'):
            piece = Piece.objects.get(pk=cree[type_])
            refs = set(piece.images.values_list('point_ref', flat=True))
            for ligne in piece.payload['rows']:
                cle = str(ligne.get('id') if ligne.get('id') not in (None, '') else ligne.get('nom_point')).strip()
                self.assertIn(cle, refs, f"{type_} : le point {ligne.get('nom_point')} (clé {cle}) n'a pas de photo")

    @staticmethod
    def crees(data):
        return sorted((i['type_piece'], i.get('numero') or 0) for i in data['plan'] if i['action'] == 'creer')


@unittest.skipUnless((RACINE / '01-format-n1').is_dir(), "levé d'exemple absent (non versionné)")
class FormatParPieceTests(_Levé):
    dossier = RACINE / '01-format-n1'

    def test_dossier_range_par_piece(self):
        depot, data = self.planifier()
        attendu = [('LPA', 0), ('PPA', 0), ('PPN', 0), ('ROB', 0), ('RTLB', 0), ('RFB', 0), ('RDL', 0),
                   ('RDD', 0), ('RDIA', 0)] + [(t, n) for t, n in RDN]
        self.assertEqual(self.crees(data), sorted(attendu))
        # Le CSV du rapport de contrôle n'est pas importé : le RC se calcule.
        rc = next(i for i in data['plan'] if 'rapport-controle' in i['fichier'])
        self.assertEqual(rc['action'], 'ignorer')
        self.assertIn('calculé', rc['raison'])
        self.assertTrue(data['rc_possible'])
        # Le rapport HTML d'origine l'emporte sur le CSV, la version V2 sur la V1.
        par_type = {i['type_piece']: i for i in data['plan'] if i['action'] == 'creer'}
        self.assertEqual(par_type['RFB']['mode'], 'html')
        self.assertIn('V2', par_type['RFB']['nom_rapport'])
        self.assertEqual(par_type['RDD']['mode'], 'html')
        images = {i['type_piece'] for i in data['images']}
        self.assertEqual(images, {'PPA', 'PPN', 'CCSPA', 'RDC'})
        self.assertEqual(sum(1 for i in data['images'] if i['type_piece'] == 'RDC'), 3)
        cree = self.importer(depot, data)
        self.assertEqual(Piece.objects.filter(ssdgps=self.ssdgps, type_piece='RDN').count(), 10)
        self.assertEqual(Piece.objects.get(pk=cree['PPA']).images.count(), 15)
        self.verifier_photos(cree)

    def test_determinations_assemblees_en_une_seule_rdia(self):
        depot, data = self.planifier()
        # Mode « assemblées » sans fichier RDIA : la libre + les 10 n°k → une seule pièce.
        libre = next(i for i in data['plan'] if i['type_piece'] == 'RDL' and i['action'] == 'creer')
        nk = sorted((i for i in data['plan'] if i['type_piece'] == 'RDN' and i['action'] == 'creer'),
                    key=lambda i: i['numero'])
        sources = [{'label': 'Libre', 'rows': libre['donnees']}] + [
            {'label': f"N°{i['numero']}", 'rows': i['donnees']} for i in nk]
        rep = self.client.post('/api/v1/pieces/assemble-rdi/', {'ssdgps': str(self.ssdgps.id), 'commit': '1',
                                                                'sources': json.dumps(sources)}, format='json')
        self.assertEqual(rep.status_code, 201, rep.data)
        self.assertEqual(len(rep.data['payload']['rows']), 11 * 15)
        self.assertFalse(Piece.objects.filter(ssdgps=self.ssdgps, type_piece='RDN').exists())


@unittest.skipUnless((RACINE / '02-format-n2').is_dir(), "levé d'exemple absent (non versionné)")
class FormatAPlatTests(_Levé):
    dossier = RACINE / '02-format-n2'

    def test_dossier_a_plat_puis_rapport_de_controle(self):
        depot, data = self.planifier()
        attendu = [('LPA', 0), ('PPA', 0), ('PPN', 0), ('ROB', 0), ('RTLB', 0), ('RFB', 0), ('RDL', 0),
                   ('RDD', 0)] + RDN
        self.assertEqual(self.crees(data), sorted(attendu))
        photos = [i for i in data['images'] if i['type_piece'] in ('PPA', 'PPN')]
        self.assertEqual(len(photos), 22)
        self.assertTrue(all(i['point'] for i in photos))
        self.assertTrue(data['rc_possible'])
        cree = self.importer(depot, data)
        self.verifier_photos(cree)
        rep = self.client.post('/api/v1/pieces/compute-rc/', {'ssdgps': str(self.ssdgps.id), 'commit': '1'},
                               format='multipart')
        self.assertEqual(rep.status_code, 201, rep.data)
        self.assertGreater(len(rep.data['payload']['rows']), 0)
