"""
Rapport d'UNE pièce (`GET /api/v1/pieces/report/?ssdgps=…&piece=…`) et point fixe des
déterminations dans le rapport de la RDIA.

- l'opérateur génère et visualise le rendu d'une pièce précise, quel que soit son statut
  (c'est avant de la valider qu'il veut le voir), avec la portée RBAC habituelle ;
- la session de la pièce identifie le rapport ; le fichier est nommé « RAPPORT_PIECE-… » ;
- RDIA : la colonne « Détermination » porte le(s) point(s) fixe(s) de chaque
  détermination (« N°3 — Fixe : GPS1 »), dans les deux versions du tableau.

Rendu WeasyPrint bouché (cf. tests_rapport_apercu).
"""
from unittest.mock import patch

from django.contrib.auth import get_user_model

from accounts.models import Membership, Organization
from pieces.models import Piece
from pieces.rc import avec_points_fixes, libelles_determinations
from pieces.report import _piece_content
from pieces.tests_rapport_apercu import PDF_FACTICE, ApercuGardeBaseTest

User = get_user_model()

RDIA_ROWS = [
    {'id': '1', 'determination': 'Libre', 'nom_point': 'A', 'x_m': '1', 'sigma_x_m': '0.01', 'y_m': '2', 'sigma_y_m': '0.01'},
    {'id': '2', 'determination': 'Libre', 'nom_point': 'B', 'x_m': '3', 'sigma_x_m': '0.01', 'y_m': '4', 'sigma_y_m': '0.01'},
    {'id': '3', 'determination': 'N°1', 'nom_point': 'A', 'x_m': '1', 'sigma_x_m': 'FIXE', 'y_m': '2', 'sigma_y_m': 'FIXE'},
    {'id': '4', 'determination': 'N°1', 'nom_point': 'B', 'x_m': '3', 'sigma_x_m': '0.01', 'y_m': '4', 'sigma_y_m': '0.01'},
    {'id': '5', 'determination': 'N°2', 'nom_point': 'A', 'x_m': '1', 'sigma_x_m': 'FIXE', 'y_m': '2', 'sigma_y_m': 'FIXE'},
    {'id': '6', 'determination': 'N°2', 'nom_point': 'B', 'x_m': '3', 'sigma_x_m': 'FIXE', 'y_m': '4', 'sigma_y_m': 'FIXE'},
]


class RapportPieceTests(ApercuGardeBaseTest):
    URL = '/api/v1/pieces/report/'

    def _rapport(self, **params):
        query = '&'.join(f'{k}={v}' for k, v in {'ssdgps': self.ssdgps.pk, **params}.items())
        return self.client.get(f'{self.URL}?{query}')

    @patch('pieces.views.render_report_pdf', return_value=PDF_FACTICE)
    def test_une_seule_piece_meme_en_brouillon(self, rendu):
        brouillon = self._piece('RDC', self.sessions[1], 5, statut=Piece.Statut.BROUILLON)
        resp = self._rapport(piece=brouillon.pk)
        self.assertEqual(resp.status_code, 200, resp.content)
        _ssdgps, session, pieces = rendu.call_args.args[:3]
        self.assertEqual([p.pk for p in pieces], [brouillon.pk])
        self.assertEqual(session, self.sessions[1])      # la session de la pièce
        self.assertTrue(resp.data['filename'].startswith('RAPPORT_PIECE-RDC-N1_'))

    @patch('pieces.views.render_report_pdf', return_value=PDF_FACTICE)
    def test_piece_commune_sans_session(self, rendu):
        resp = self._rapport(piece=self.lpa.pk)
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(rendu.call_args.args[1])
        self.assertTrue(resp.data['filename'].startswith('RAPPORT_PIECE-LPA_'))

    @patch('pieces.views.render_report_pdf', return_value=PDF_FACTICE)
    def test_piece_supprimee_ou_d_un_autre_ssdgps_introuvable(self, _rendu):
        self.lpa.is_deleted = True
        self.lpa.save(update_fields=['is_deleted'])
        self.assertEqual(self._rapport(piece=self.lpa.pk).status_code, 404)
        self.assertEqual(self._rapport(piece='00000000-0000-0000-0000-000000000000').status_code, 404)

    @patch('pieces.views.render_report_pdf', return_value=PDF_FACTICE)
    def test_incompatible_avec_une_portee_de_session(self, _rendu):
        resp = self._rapport(piece=self.lpa.pk, session=self.sessions[0].pk)
        self.assertEqual(resp.status_code, 400)

    @patch('pieces.views.render_report_pdf', return_value=PDF_FACTICE)
    def test_rbac_autre_organisation(self, _rendu):
        autre = Organization.objects.create(code='ORG-X', name='Autre')
        intrus = User.objects.create_user(username='x@x.ma', email='x@x.ma', password='Passw0rd!')
        Membership.objects.create(user=intrus, organization=autre, role='ROLE_ORGANISATION_AGENT')
        self.client.force_authenticate(intrus)
        self.assertIn(self._rapport(piece=self.lpa.pk).status_code, (403, 404))

    @patch('pieces.views.render_report_pdf', return_value=PDF_FACTICE)
    def test_sans_piece_le_rapport_complet_reste_inchange(self, rendu):
        resp = self._rapport()
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(rendu.call_args.args[2]), 3)
        self.assertTrue(resp.data['filename'].startswith('RAPPORT_SDGPS_'))


class PointFixeDeterminationTests(ApercuGardeBaseTest):
    def test_libelles(self):
        libelles = libelles_determinations(RDIA_ROWS)
        self.assertEqual(libelles['Libre'], 'Libre')
        self.assertEqual(libelles['N°1'], 'N°1 — Fixe : A')
        self.assertEqual(libelles['N°2'], 'N°2 — Fixes : A, B')
        lignes = avec_points_fixes([{'determination': 'N°1', 'x': 1}], libelles)
        self.assertEqual(lignes, [{'determination': 'N°1 — Fixe : A', 'x': 1}])

    def test_rapport_rdia_brut_et_ecarts(self):
        ecarts = [{'id': '1', 'determination': 'N°1', 'nom_point_fixe': 'A', 'nom_point_calcule': 'B',
                   'delta_d_m': '0.01'}]
        piece = Piece.objects.create(ssdgps=self.ssdgps, type_piece='RDIA', ordre=9,
                                     statut=Piece.Statut.VALIDE, versions_rapport='both',
                                     payload={'rows': RDIA_ROWS, 'rows_ecarts': ecarts})
        contenu = _piece_content(piece)
        cellules = ' | '.join(str(c) for t in contenu['tables'] for ligne in t['flat'] for c in ligne)
        self.assertIn('N°1 — Fixe : A', cellules)
        self.assertIn('N°2 — Fixes : A, B', cellules)
        piece.refresh_from_db()
        self.assertEqual(piece.payload['rows'][2]['determination'], 'N°1')   # données intactes
