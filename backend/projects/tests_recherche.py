"""
Recherche globale (Ctrl+K) : groupes, liens, portée RBAC, corbeille exclue.
"""
from django.contrib.auth import get_user_model

from pieces.models import Piece
from projects.models import Propriete, Ssdgps

from .tests_workflow_ssdgps import WorkflowBaseTest

User = get_user_model()


class RechercheTests(WorkflowBaseTest):
    def setUp(self):
        super().setUp()
        Piece.objects.create(ssdgps=self.ssdgps, type_piece='LPA',
                             payload={'rows': [{'id': 1, 'nom_point': 'B-1234'}, {'id': 2, 'nom_point': 'C9'}]})

    def chercher(self, q):
        r = self.client.get('/api/v1/recherche/', {'q': q})
        self.assertEqual(r.status_code, 200)
        return {g['type']: g['resultats'] for g in r.data['groupes']}

    def test_projet_propriete_par_titre(self):
        g = self.chercher('P-WF')
        self.assertEqual(g['projet'][0]['lien'], f'projets/{self.ssdgps.affaire.propriete.projet_id}')
        g = self.chercher('T9400')
        self.assertIn('proprieteId=', g['propriete'][0]['lien'])

    def test_numero_ssdgps_et_affaire(self):
        g = self.chercher('n°1')
        self.assertEqual(g['ssdgps'][0]['lien'].split('/pieces/')[1], str(self.ssdgps.id))
        self.assertIn('affaireId=', g['affaire'][0]['lien'])

    def test_nom_de_point(self):
        g = self.chercher('b-12')
        self.assertEqual(g['point'][0]['titre'], 'B-1234')
        self.assertIn('/piece/', g['point'][0]['lien'])
        self.assertNotIn('point', self.chercher('ZZZ'))

    def test_trop_court(self):
        r = self.client.get('/api/v1/recherche/', {'q': 'P'})
        self.assertEqual(r.data['groupes'], [])

    def test_corbeille_exclue(self):
        Propriete.objects.filter(pk=self.ssdgps.affaire.propriete_id).update(is_deleted=True)
        g = self.chercher('T9400')
        self.assertNotIn('propriete', g)

    def test_hors_portee_invisible(self):
        self.client.force_authenticate(User.objects.create_user(username='e@x.ma', email='e@x.ma',
                                                                password='Passw0rd!'))
        self.assertEqual(self.chercher('P-WF'), {})
        self.assertEqual(self.chercher('B-12'), {})

    def test_anonyme_401(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/v1/recherche/', {'q': 'xx'}).status_code, 401)
