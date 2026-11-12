"""
Contrôle de cohérence avant génération (`GET /api/v1/pieces/report-check/`).

Le rendu d'un rapport ne dit rien : il prend les pièces valides telles qu'elles sont.
Une pièce restée en brouillon en est absente, un trou dans la numérotation des
déterminations passe inaperçu, une session sans pièce disparaît du document — et
l'opérateur ne s'en aperçoit qu'à la relecture du PDF, voire au contrôle du dossier.

Ce que ces tests verrouillent :
- chaque famille d'anomalie est bien détectée, et seulement quand elle existe ;
- les gravités sont tenues : une incohérence de DOSSIER est une `erreur`, ce que
  l'opérateur n'a probablement pas voulu est un `avertissement` ;
- le contrôle ne modifie rien et ne bloque jamais la génération ;
- la portée et les droits sont ceux du rapport — c'est la même résolution.
"""
from datetime import datetime, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Membership, Organization
from pieces.coherence import analyser_coherence, types_attendus
from pieces.models import Piece
from projects.models import Affaire, Projet, Propriete, Session, Ssdgps

User = get_user_model()


class CoherenceBaseTest(TestCase):
    """SDGPS PDC/GPS à 2 sessions. Le dossier de départ est volontairement incomplet :
    c'est l'état réel d'un SDGPS en cours d'instruction."""

    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(code='ORG-CO', name='Org Cohérence')
        self.user = User.objects.create_user(
            username='co@sdgps.ma', email='co@sdgps.ma', password='Passw0rd!')
        Membership.objects.create(user=self.user, organization=self.org,
                                  role='ROLE_ORGANISATION_AGENT')
        projet = Projet.objects.create(nom_projet='P', code_projet='P-CO-1',
                                       organization=self.org, created_by=self.user)
        propriete = Propriete.objects.create(nom_propriete='X', id_titre='T9300/A',
                                             projet=projet)
        affaire = Affaire.objects.create(
            numero_sd_affaire=1, nature_procedure_affaire='IFF', nature_affaire='BI',
            date_bornage=datetime(2023, 4, 9, tzinfo=dt_timezone.utc), propriete=propriete)
        self.ssdgps = Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=1,
                                            type_ssdgps='multi-session', affaire=affaire)
        self.sessions = [
            Session.objects.create(ssdgps=self.ssdgps, numero_session=n,
                                   date_session=datetime(2024, 1, 10 + n,
                                                         tzinfo=dt_timezone.utc))
            for n in (1, 2)
        ]
        self.client.force_authenticate(self.user)

    def _piece(self, type_piece, session=None, ordre=0, numero=None,
               statut=Piece.Statut.VALIDE, rows=({'a': 1},)):
        return Piece.objects.create(
            ssdgps=self.ssdgps, session=session, type_piece=type_piece, numero=numero,
            ordre=ordre, statut=statut, payload={'rows': list(rows)},
        )

    def controler(self, **params):
        query = '&'.join(f'{k}={v}' for k, v in params.items())
        url = f'/api/v1/pieces/report-check/?ssdgps={self.ssdgps.id}'
        return self.client.get(f'{url}&{query}' if query else url)

    def codes(self, resp):
        return [a['code'] for a in resp.data['anomalies']]


class DetectionDesAnomaliesTests(CoherenceBaseTest):
    def test_un_sdgps_sans_piece_est_une_erreur(self):
        resp = self.controler()

        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertIn('aucune_piece', self.codes(resp))
        self.assertFalse(resp.data['ok'])

    def test_une_piece_non_validee_est_signalee_comme_exclue(self):
        self._piece('LPA', statut=Piece.Statut.BROUILLON)

        resp = self.controler()

        anomalie = next(a for a in resp.data['anomalies']
                        if a['code'] == 'piece_non_validee')
        self.assertEqual(anomalie['severite'], 'avertissement')
        self.assertEqual(anomalie['type_piece'], 'LPA')

    def test_un_trou_dans_les_determinations_est_une_erreur(self):
        self._piece('RDN', self.sessions[0], 1, numero=1)
        self._piece('RDN', self.sessions[0], 2, numero=3)

        resp = self.controler(session=self.sessions[0].id)

        anomalie = next(a for a in resp.data['anomalies']
                        if a['code'] == 'determination_manquante')
        self.assertEqual(anomalie['severite'], 'erreur')
        self.assertIn('n°2', anomalie['message'])

    def test_des_determinations_qui_se_suivent_ne_declenchent_rien(self):
        self._piece('RDN', self.sessions[0], 1, numero=1)
        self._piece('RDN', self.sessions[0], 2, numero=2)

        resp = self.controler(session=self.sessions[0].id)

        self.assertNotIn('determination_manquante', self.codes(resp))

    def test_un_doublon_de_determination_est_impossible_en_base(self):
        # Rien à contrôler côté cohérence : la contrainte d'unicité
        # (ssdgps, type_piece, numero, session) refuse déjà le doublon.
        self._piece('RDN', self.sessions[0], 1, numero=1)

        with self.assertRaises(IntegrityError), transaction.atomic():
            self._piece('RDN', self.sessions[0], 2, numero=1)

    def test_une_session_sans_piece_propre_est_signalee(self):
        self._piece('LPA', None, 0)                       # pièce commune uniquement
        self._piece('ROB', self.sessions[0], 1)

        resp = self.controler()

        sessions = [a['session_numero'] for a in resp.data['anomalies']
                    if a['code'] == 'session_sans_piece']
        self.assertEqual(sessions, [2])

    def test_une_piece_validee_mais_vide_est_signalee(self):
        self._piece('LPA', None, 0, rows=())

        resp = self.controler()

        anomalie = next(a for a in resp.data['anomalies'] if a['code'] == 'piece_vide')
        self.assertEqual(anomalie['severite'], 'avertissement')
        self.assertEqual(anomalie['type_piece'], 'LPA')

    def test_les_pieces_attendues_absentes_sont_regroupees(self):
        self._piece('LPA', None, 0)

        resp = self.controler()

        absentes = [a for a in resp.data['anomalies']
                    if a['code'] == 'piece_attendue_absente']
        # Une seule ligne, sinon une douzaine de lignes identiques noieraient le reste.
        self.assertEqual(len(absentes), 1)
        self.assertNotIn('LPA', absentes[0]['types_pieces'])
        self.assertIn('RDD', absentes[0]['types_pieces'])

    def test_les_compteurs_separent_erreurs_et_avertissements(self):
        self._piece('RDN', self.sessions[0], 1, numero=2)   # trou : n°1 absente

        resp = self.controler(session=self.sessions[0].id)

        self.assertEqual(resp.data['total'],
                         resp.data['erreurs'] + resp.data['avertissements'])
        self.assertGreaterEqual(resp.data['erreurs'], 1)


class PorteeDuControleTests(CoherenceBaseTest):
    def test_une_session_ne_voit_pas_les_pieces_de_l_autre(self):
        self._piece('RDN', self.sessions[1], 1, numero=2)   # trou, mais session 2

        resp = self.controler(session=self.sessions[0].id)

        self.assertNotIn('determination_manquante', self.codes(resp))

    def test_la_plage_de_synthese_couvre_les_deux_sessions(self):
        self._piece('RDN', self.sessions[1], 1, numero=2)

        resp = self.controler(session_from=self.sessions[0].id,
                              session_to=self.sessions[1].id)

        self.assertIn('determination_manquante', self.codes(resp))

    def test_le_ssdgps_est_requis(self):
        resp = self.client.get('/api/v1/pieces/report-check/')

        self.assertEqual(resp.status_code, 400)

    def test_session_et_plage_ensemble_sont_refusees(self):
        resp = self.controler(session=self.sessions[0].id,
                              session_from=self.sessions[0].id,
                              session_to=self.sessions[1].id)

        self.assertEqual(resp.status_code, 400)


class DroitsEtInnocuiteTests(CoherenceBaseTest):
    def test_un_anonyme_est_refuse(self):
        self.client.force_authenticate(None)

        resp = self.controler()

        self.assertEqual(resp.status_code, 401)

    def test_une_autre_organisation_est_refusee(self):
        autre = Organization.objects.create(code='ORG-CO2', name='Autre')
        intrus = User.objects.create_user(username='in2@sdgps.ma', email='in2@sdgps.ma',
                                          password='Passw0rd!')
        Membership.objects.create(user=intrus, organization=autre,
                                  role='ROLE_ORGANISATION_AGENT')
        self.client.force_authenticate(intrus)

        resp = self.controler()

        self.assertEqual(resp.status_code, 403)

    def test_le_controle_ne_modifie_rien(self):
        piece = self._piece('LPA', None, 0, statut=Piece.Statut.BROUILLON)
        avant = (piece.statut, piece.updated_at)

        self.controler()

        piece.refresh_from_db()
        self.assertEqual((piece.statut, piece.updated_at), avant)

    def test_un_dossier_incomplet_reste_generable(self):
        # Le contrôle informe, il n'interdit pas : un SDGPS en cours d'instruction se
        # génère légitimement. L'endpoint de génération ne consulte pas le contrôle.
        self._piece('LPA', None, 0)

        resp = self.controler()

        self.assertFalse(resp.data['ok'])
        self.assertEqual(resp.status_code, 200)


class AnalyseUnitaireTests(CoherenceBaseTest):
    """La fonction d'analyse elle-même, hors HTTP."""

    def test_un_dossier_sans_anomalie_est_ok(self):
        pieces = [self._piece(code, None, index)
                  for index, code in enumerate(types_attendus('PDC/GPS'))]

        resultat = analyser_coherence(self.ssdgps, pieces, [])

        self.assertTrue(resultat['ok'], resultat['anomalies'])
        self.assertEqual(resultat['total'], 0)

    def test_les_anomalies_portent_toutes_un_code_et_une_gravite(self):
        resultat = analyser_coherence(self.ssdgps, [], self.sessions)

        for anomalie in resultat['anomalies']:
            self.assertIn(anomalie['severite'], ('erreur', 'avertissement'))
            self.assertTrue(anomalie['code'])
            self.assertTrue(anomalie['message'])

    def test_la_page_de_garde_n_est_jamais_reclamee(self):
        # Elle est générée par le rapport lui-même (cf. report.EXCLUDED_TYPES).
        self.assertNotIn('PGSDGPS', types_attendus('PDC/GPS'))

    def test_les_types_attendus_suivent_la_nature(self):
        self.assertIn('CCSPA', types_attendus('PDC/GPS'))
        self.assertNotIn('CCSPA', types_attendus('DDC/GPS'))
