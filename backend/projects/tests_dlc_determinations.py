"""DLC : déterminations intermédiaires (RDN / RDIA) disponibles comme pour les autres natures."""
import importlib

from django.apps import apps
from django.test import SimpleTestCase

from pieces.catalog import natures_applicable
from pieces.coherence import types_attendus
from pieces.models import Piece
from projects.models import ModeleSsdgps, Ssdgps
from projects.tests_workflow_ssdgps import WorkflowBaseTest

mig = importlib.import_module('projects.migrations.0011_dlc_determinations_intermediaires')


class CatalogueTests(SimpleTestCase):
    def test_rdn_et_rdia_pour_les_quatre_natures_rdi_retire(self):
        for nature in ('PDC/GPS', 'DDC/GPS', 'PLC/GPS', 'DLC/GPS'):
            self.assertTrue(natures_applicable('RDN', nature), nature)
            self.assertTrue(natures_applicable('RDIA', nature), nature)
            self.assertFalse(natures_applicable('RDI', nature), nature)
        self.assertNotIn('RDI', types_attendus('DLC/GPS'))
        self.assertIn('RDN', types_attendus('DLC/GPS'))

    def test_remplacement_en_place_sans_doublon(self):
        avant = [{'type_piece': 'RDL'}, {'type_piece': 'RDI', 'obligatoire': False}, {'type_piece': 'RDD'}]
        self.assertEqual([(p['type_piece'], p.get('numero'), p.get('obligatoire')) for p in mig.remplacer(avant)],
                         [('RDL', None, None), ('RDN', 1, False), ('RDIA', None, False), ('RDD', None, None)])
        self.assertEqual([p['type_piece'] for p in mig.remplacer([{'type_piece': 'RDI'}, {'type_piece': 'RDIA'}])],
                         ['RDN', 'RDIA'])
        self.assertIsNone(mig.remplacer([{'type_piece': 'RDN', 'numero': 1}]))


class MigrationTests(WorkflowBaseTest):
    def test_modeles_et_dossiers_modifiables_mis_a_jour(self):
        modele = ModeleSsdgps.objects.create(nom='Mon DLC', nature_ssdgps='DLC/GPS', portee='personnel',
                                             proprietaire=self.agent, pieces=[{'type_piece': 'RDI', 'obligatoire': True}])
        Ssdgps.objects.filter(pk=self.ssdgps.pk).update(pieces_prevues=[{'type_piece': 'RDI', 'obligatoire': True}])
        fige = Ssdgps.objects.create(nature_ssdgps='DLC/GPS', numero_ssdgps=2, type_ssdgps='mono-session',
                                     affaire=self.ssdgps.affaire, statut='valide',
                                     pieces_prevues=[{'type_piece': 'RDI', 'obligatoire': True}])
        avec_rdi = Ssdgps.objects.create(nature_ssdgps='DLC/GPS', numero_ssdgps=3, type_ssdgps='mono-session',
                                         affaire=self.ssdgps.affaire, pieces_prevues=[{'type_piece': 'RDI'}])
        Piece.objects.create(ssdgps=avec_rdi, type_piece='RDI', payload={'rows': []})
        mig.migrer(apps, None)
        modele.refresh_from_db()
        self.assertEqual([p['type_piece'] for p in modele.pieces], ['RDN', 'RDIA'])
        self.ssdgps.refresh_from_db()
        self.assertEqual([p['type_piece'] for p in self.ssdgps.pieces_prevues], ['RDN', 'RDIA'])
        fige.refresh_from_db()
        avec_rdi.refresh_from_db()
        self.assertEqual(fige.pieces_prevues, [{'type_piece': 'RDI', 'obligatoire': True}])
        self.assertEqual(avec_rdi.pieces_prevues, [{'type_piece': 'RDI'}])

    def test_catalogue_de_l_api_propose_rdn_et_rdia_au_dlc(self):
        r = self.client.get('/api/v1/pieces/catalog/')
        self.assertEqual(r.status_code, 200)
        types = {t['code']: t for t in r.data}
        self.assertIn('DLC/GPS', types['RDN']['natures'])
        self.assertIn('DLC/GPS', types['RDIA']['natures'])
        self.assertEqual(types['RDI']['natures'], [])
