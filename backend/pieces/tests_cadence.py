"""Cadence d'enregistrement du ROB calculée automatiquement (`pieces/cadence.py`)."""
from django.test import SimpleTestCase

from pieces.cadence import cadence_calculee, completer_cadences
from pieces.models import Piece
from projects.tests_workflow_ssdgps import WorkflowBaseTest


class CalculTests(SimpleTestCase):
    def test_duree_sur_epoques_moins_une_ramenee_a_l_intervalle_standard(self):
        # Ligne réelle d'un classeur Zelmath : 3 h 34 min 32 s, 12 872 époques → 1 s.
        self.assertEqual(cadence_calculee({'duree': '03:34:32', 'epoques': '12872'}), '1 s')
        self.assertEqual(cadence_calculee({'duree': '00:30:00', 'epoques': 121}), '15 s')
        self.assertEqual(cadence_calculee({'duree': '00:10:00', 'epoques': '119'}), '5 s')     # 5,08 s
        self.assertEqual(cadence_calculee({'duree': '00:01:00', 'epoques': '121'}), '0,5 s')
        self.assertEqual(cadence_calculee({'duree': '45 min', 'epoques': '91'}), '30 s')

    def test_rien_si_incalculable(self):
        for ligne in ({'duree': '', 'epoques': '10'}, {'duree': '00:10:00', 'epoques': ''},
                      {'duree': '00:10:00', 'epoques': '1'}, {'duree': 'n/a', 'epoques': '5'}, None):
            self.assertIsNone(cadence_calculee(ligne), ligne)

    def test_vide_calculee_fournie_conservee(self):
        lignes = [{'duree': '00:30:00', 'epoques': '121', 'cadence': ''},
                  {'duree': '00:30:00', 'epoques': '121', 'cadence': '30 s'},      # donnée source
                  {'duree': '', 'epoques': '', 'cadence': ''}]
        self.assertEqual(completer_cadences(lignes), 1)
        self.assertEqual([l['cadence'] for l in lignes], ['15 s', '30 s', ''])

    def test_cadence_calculee_suit_une_correction_des_epoques(self):
        anciennes = [{'id': 'a', 'duree': '00:30:00', 'epoques': '121', 'cadence': '15 s'},   # calculée
                     {'id': 'b', 'duree': '00:30:00', 'epoques': '121', 'cadence': '1 s'}]    # fournie
        nouvelles = [{'id': 'a', 'duree': '00:30:00', 'epoques': '361', 'cadence': '15 s'},
                     {'id': 'b', 'duree': '00:30:00', 'epoques': '361', 'cadence': '1 s'}]
        completer_cadences(nouvelles, anciennes)
        self.assertEqual([l['cadence'] for l in nouvelles], ['5 s', '1 s'])


class EnregistrementTests(WorkflowBaseTest):
    def test_calculee_a_la_creation_et_a_la_modification(self):
        p = Piece.objects.create(ssdgps=self.ssdgps, session=self.session, type_piece='ROB',
                                 payload={'rows': [{'point': 'A', 'duree': '00:30:00', 'epoques': '121'}]})
        p.refresh_from_db()
        self.assertEqual(p.payload['rows'][0]['cadence'], '15 s')
        p.payload = {'rows': [{'point': 'A', 'duree': '01:00:00', 'epoques': '121', 'cadence': '15 s'}]}
        p.save()
        p.refresh_from_db()
        self.assertEqual(p.payload['rows'][0]['cadence'], '30 s')

    def test_autres_pieces_intactes(self):
        p = Piece.objects.create(ssdgps=self.ssdgps, session=self.session, type_piece='RTLB',
                                 payload={'rows': [{'duree': '00:30:00', 'epoques': '121'}]})
        p.refresh_from_db()
        self.assertNotIn('cadence', p.payload['rows'][0])

    def test_import_du_classeur_remplit_la_cadence(self):
        from pieces.tests_import_classeur import classeur_zelmath
        url = '/api/v1/pieces/import/'
        r = self.client.post(url, {'fichier': classeur_zelmath(), 'type_piece': 'ROB', 'feuille': 'Feuil3'},
                             format='multipart')
        import json
        r = self.client.post(url, {'fichier': classeur_zelmath(), 'type_piece': 'ROB', 'feuille': 'Feuil3',
                                   'mapping': json.dumps(r.data['mapping_propose']), 'ssdgps': str(self.ssdgps.id),
                                   'session': str(self.session.id)}, format='multipart')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(Piece.objects.get(type_piece='ROB').payload['rows'][0]['cadence'], '1 s')
