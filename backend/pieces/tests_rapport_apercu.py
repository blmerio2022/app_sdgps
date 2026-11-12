"""
Prévisualisation de la PAGE DE GARDE d'un rapport (`GET /api/v1/pieces/report-cover/`).

La page de garde est la table des matières officielle du rapport : ordre, numérotation,
désignations, observations. C'est là que se voient une pièce oubliée, un intitulé fautif
ou un ordre inattendu — et les découvrir après plusieurs minutes de rendu coûte une
génération complète pour rien.

Ce que ces tests verrouillent :
- l'aperçu ne rend PAS le contenu des pièces (c'est ce qui le rend quasi instantané) ;
- il est servi comme `report/` : JSON base64 par défaut, flux binaire sur `?brut=1` ;
- il reprend EXACTEMENT la portée et les contrôles d'accès de `report/` ;
- il ne crée aucun suivi de génération et ne journalise rien ;
- la colonne « Page » reste vide : le n° de page d'une pièce suppose la pagination de
  tout le rapport, qu'il faudrait précisément rendre pour la connaître.

Le rendu WeasyPrint est bouché (cf. `tests_rapport_async`) : le client de test Django
échoue sur tout rendu de gabarit sous Python 3.14 (`Context.__copy__`) ; la CI, en 3.11,
n'est pas concernée.
"""
import base64
from datetime import datetime, timezone as dt_timezone
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import AuditEvent, Membership, Organization
from pieces.models import Piece, RapportGeneration
from pieces.report import build_cover_context
from projects.models import Affaire, Projet, Propriete, Session, Ssdgps

User = get_user_model()

PDF_FACTICE = b'%PDF-1.7 factice'


class ApercuGardeBaseTest(TestCase):
    """SSDGPS à 2 sessions, 3 pièces valides (1 commune, 1 par session)."""

    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(code='ORG-AP', name='Org Aperçu')
        self.user = User.objects.create_user(
            username='ap@sdgps.ma', email='ap@sdgps.ma', password='Passw0rd!')
        Membership.objects.create(user=self.user, organization=self.org,
                                  role='ROLE_ORGANISATION_AGENT')
        projet = Projet.objects.create(nom_projet='P', code_projet='P-AP-1',
                                       organization=self.org, created_by=self.user)
        self.propriete = Propriete.objects.create(nom_propriete='X', id_titre='T9200/A',
                                                  projet=projet)
        affaire = Affaire.objects.create(
            numero_sd_affaire=1, nature_procedure_affaire='IFF', nature_affaire='BI',
            date_bornage=datetime(2023, 4, 9, tzinfo=dt_timezone.utc),
            propriete=self.propriete)
        self.ssdgps = Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=1,
                                            type_ssdgps='multi-session', affaire=affaire)
        self.sessions = [
            Session.objects.create(ssdgps=self.ssdgps, numero_session=n,
                                   date_session=datetime(2024, 1, 10 + n,
                                                         tzinfo=dt_timezone.utc))
            for n in (1, 2)
        ]

        self.lpa = self._piece('LPA', None, 0)
        self._piece('ROB', self.sessions[0], 1)
        self._piece('ROB', self.sessions[1], 2)

        self.client.force_authenticate(self.user)

    def _piece(self, type_piece, session, ordre, statut=Piece.Statut.VALIDE):
        return Piece.objects.create(
            ssdgps=self.ssdgps, session=session, type_piece=type_piece,
            numero=1 if session else None, ordre=ordre, statut=statut,
            payload={'rows': [{'a': 1}]},
        )

    def apercu(self, **params):
        query = '&'.join(f'{k}={v}' for k, v in params.items())
        url = f'/api/v1/pieces/report-cover/?ssdgps={self.ssdgps.id}'
        return self.client.get(f'{url}&{query}' if query else url)


class TransportDeLApercuTests(ApercuGardeBaseTest):
    @patch('pieces.views.render_cover_pdf', return_value=PDF_FACTICE)
    def test_le_pdf_est_renvoye_en_base64(self, _rendu):
        resp = self.apercu()

        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['content_type'], 'application/pdf')
        self.assertEqual(base64.b64decode(resp.data['data']), PDF_FACTICE)

    @patch('pieces.views.render_cover_pdf', return_value=PDF_FACTICE)
    def test_le_nom_de_fichier_annonce_un_apercu(self, _rendu):
        resp = self.apercu()

        # Un aperçu enregistré par erreur ne doit pas se confondre avec le rapport.
        self.assertTrue(resp.data['filename'].startswith('APERCU_'), resp.data['filename'])
        self.assertTrue(resp.data['filename'].endswith('.pdf'))

    @patch('pieces.views.render_cover_pdf', return_value=PDF_FACTICE)
    def test_le_flux_binaire_est_servi_sur_brut(self, _rendu):
        resp = self.apercu(brut=1)

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'application/pdf')
        self.assertEqual(resp.content, PDF_FACTICE)

    def test_format_raw_reste_capte_par_drf(self):
        # Garde-fou : `format` est réservé à la négociation de contenu DRF et renvoie
        # 404 AVANT la vue. Le paramètre d'un flux brut ne peut donc pas s'appeler ainsi.
        resp = self.apercu(format='raw')

        self.assertEqual(resp.status_code, 404)


class PorteeDeLApercuTests(ApercuGardeBaseTest):
    @patch('pieces.views.render_cover_pdf', return_value=PDF_FACTICE)
    def test_sans_session_toutes_les_pieces_sont_listees(self, rendu):
        self.apercu()

        pieces = rendu.call_args.args[2]
        self.assertEqual(len(pieces), 3)

    @patch('pieces.views.render_cover_pdf', return_value=PDF_FACTICE)
    def test_une_session_limite_aux_siennes_et_aux_communes(self, rendu):
        self.apercu(session=self.sessions[0].id)

        pieces = rendu.call_args.args[2]
        self.assertEqual({p.session_id for p in pieces}, {None, self.sessions[0].id})

    @patch('pieces.views.render_cover_pdf', return_value=PDF_FACTICE)
    def test_la_plage_de_synthese_regroupe_les_pieces(self, rendu):
        self.apercu(session_from=self.sessions[0].id, session_to=self.sessions[1].id)

        pieces = rendu.call_args.args[2]
        self.assertEqual(len(pieces), 3)
        self.assertIsNone(rendu.call_args.args[1])  # pas de session unique

    @patch('pieces.views.render_cover_pdf', return_value=PDF_FACTICE)
    def test_le_mode_recto_verso_est_transmis(self, rendu):
        self.apercu(duplex=1)

        self.assertTrue(rendu.call_args.kwargs['duplex'])

    @patch('pieces.views.render_cover_pdf', return_value=PDF_FACTICE)
    def test_les_pieces_non_valides_sont_exclues(self, rendu):
        self._piece('RDL', None, 3, statut=Piece.Statut.BROUILLON)

        self.apercu()

        self.assertEqual(len(rendu.call_args.args[2]), 3)

    def test_le_ssdgps_est_requis(self):
        resp = self.client.get('/api/v1/pieces/report-cover/')

        self.assertEqual(resp.status_code, 400)

    def test_session_et_plage_ensemble_sont_refusees(self):
        resp = self.apercu(session=self.sessions[0].id,
                           session_from=self.sessions[0].id,
                           session_to=self.sessions[1].id)

        self.assertEqual(resp.status_code, 400)

    def test_sans_piece_valide_l_apercu_est_refuse(self):
        Piece.objects.update(statut=Piece.Statut.BROUILLON)

        resp = self.apercu()

        self.assertEqual(resp.status_code, 400)


class DroitsSurLApercuTests(ApercuGardeBaseTest):
    def test_un_anonyme_est_refuse(self):
        self.client.force_authenticate(None)

        resp = self.apercu()

        self.assertEqual(resp.status_code, 401)

    def test_une_autre_organisation_est_refusee(self):
        autre_org = Organization.objects.create(code='ORG-AP2', name='Autre')
        intrus = User.objects.create_user(username='in@sdgps.ma', email='in@sdgps.ma',
                                          password='Passw0rd!')
        Membership.objects.create(user=intrus, organization=autre_org,
                                  role='ROLE_ORGANISATION_AGENT')
        self.client.force_authenticate(intrus)

        resp = self.apercu()

        self.assertEqual(resp.status_code, 403)


class EffetsDeBordTests(ApercuGardeBaseTest):
    @patch('pieces.views.render_cover_pdf', return_value=PDF_FACTICE)
    def test_aucun_suivi_de_generation_n_est_cree(self, _rendu):
        self.apercu()

        self.assertEqual(RapportGeneration.objects.count(), 0)

    @patch('pieces.views.render_cover_pdf', return_value=PDF_FACTICE)
    def test_aucun_rapport_genere_n_est_journalise(self, _rendu):
        self.apercu()

        self.assertFalse(AuditEvent.objects.filter(
            action=AuditEvent.ACTION_RAPPORT_GENERE).exists())

    # `AdminEmailHandler` (gestionnaire par défaut de `django.request` sur les réponses
    # 5xx) rend un gabarit de traceback, impossible sous Python 3.14 en local
    # (cf. l'en-tête de module). Il est bouché : le test porte sur la réponse rendue.
    @patch('django.utils.log.AdminEmailHandler.emit')
    @patch('pieces.views.render_cover_pdf',
           side_effect=RuntimeError('WeasyPrint indisponible'))
    def test_une_chaine_pdf_absente_donne_un_message_actionnable(self, _rendu, _mail):
        resp = self.apercu()

        self.assertEqual(resp.status_code, 501)
        self.assertIn('WeasyPrint', resp.data['detail'])

    @patch('django.utils.log.AdminEmailHandler.emit')
    @patch('pieces.views.render_cover_pdf', side_effect=ValueError('donnée inattendue'))
    def test_un_echec_de_rendu_reste_explicite(self, _rendu, _mail):
        resp = self.apercu()

        self.assertEqual(resp.status_code, 500)
        self.assertIn('ValueError', resp.data['detail'])


class ContexteDeLaGardeTests(ApercuGardeBaseTest):
    """Le contexte de l'aperçu, sans passer par le rendu PDF."""

    def _pieces(self):
        return list(Piece.objects.filter(ssdgps=self.ssdgps, statut=Piece.Statut.VALIDE)
                    .order_by('ordre'))

    def test_le_contenu_des_pieces_n_est_pas_rendu(self):
        # C'est tout l'intérêt de l'aperçu : `_piece_content` (tableaux, images encodées,
        # photos de points) est l'essentiel du coût d'un rapport.
        with patch('pieces.report._piece_content') as contenu:
            contexte = build_cover_context(self.ssdgps, None, self._pieces())

        contenu.assert_not_called()
        self.assertEqual(contexte['pieces'], [])

    def test_la_garde_liste_toutes_les_pieces_dans_l_ordre(self):
        contexte = build_cover_context(self.ssdgps, None, self._pieces())

        self.assertEqual(contexte['total'], 3)
        self.assertEqual([r['ordre'] for r in contexte['cover_rows']], [1, 2, 3])

    def test_la_colonne_page_reste_vide(self):
        # Le n° de page d'une pièce suppose la pagination de TOUT le rapport : l'inventer
        # dans un aperçu serait trompeur.
        contexte = build_cover_context(self.ssdgps, None, self._pieces())

        self.assertTrue(all(r['page'] is None for r in contexte['cover_rows']))

    def test_l_entete_porte_l_identification_du_ssdgps(self):
        contexte = build_cover_context(self.ssdgps, None, self._pieces())

        self.assertEqual(contexte['header']['titre'], self.propriete.id_titre)
        self.assertEqual(contexte['header']['numero_ssdgps'], self.ssdgps.numero_ssdgps)
