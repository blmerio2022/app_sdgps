"""
Rapport de SYNTHÈSE sur une plage de sessions.

Règle métier : l'opérateur choisit une session de début et une session de fin, et le
rapport couvre toute la plage.

  - une pièce **commune** à toutes les sessions (`session` nulle) n'y figure qu'**une
    seule fois** — jamais dupliquée autant de fois qu'il y a de sessions ;
  - une pièce **spécifique** à une session est déclinée pour chaque session de la plage,
    et les occurrences sont regroupées **par pièce** : tous les « Rapport de traitement »
    à la suite (session 1, 2, 3…), puis la pièce suivante, et ainsi de suite.

Chaque occurrence porte sa propre session dans l'en-tête, le pied de page et la page de
garde : sans cela quatre « Rapport de traitement » successifs seraient indiscernables.
"""
from datetime import datetime, timezone as dt_timezone
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Membership, Organization
from pieces.models import Piece
from pieces.report import (build_report_context, order_pieces_for_synthesis,
                           piece_designation, report_filename)
from projects.models import Affaire, Projet, Propriete, Session, Ssdgps

User = get_user_model()


class SyntheseBaseTest(TestCase):
    """SSDGPS à 3 sessions : 2 pièces communes et 2 pièces déclinées par session."""

    def setUp(self):
        self.org = Organization.objects.create(code='ORG-SY', name='Org Synthèse')
        self.user = User.objects.create_user(username='sy@sdgps.ma', email='sy@sdgps.ma',
                                             password='Passw0rd!')
        Membership.objects.create(user=self.user, organization=self.org,
                                  role='ROLE_ORGANISATION_AGENT')
        projet = Projet.objects.create(nom_projet='P', code_projet='P-SY-1',
                                       organization=self.org, created_by=self.user)
        propriete = Propriete.objects.create(nom_propriete='X', id_titre='T9000/A',
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
            for n in (1, 2, 3)
        ]

        ordre = 0
        # Pièce commune, placée en tête du rapport.
        self.commune_lpa = self._piece('LPA', None, ordre); ordre += 1
        # Pièce déclinée par session : ROB (rapport d'observations).
        self.rob = [self._piece('ROB', s, ordre + i) for i, s in enumerate(self.sessions)]
        ordre += len(self.sessions)
        # Seconde pièce déclinée par session : RTLB.
        self.rtlb = [self._piece('RTLB', s, ordre + i) for i, s in enumerate(self.sessions)]
        ordre += len(self.sessions)
        # Seconde pièce commune, en fin de rapport.
        self.commune_rdc = self._piece('RDC', None, ordre)

        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _piece(self, type_piece, session, ordre, numero=1):
        return Piece.objects.create(
            ssdgps=self.ssdgps, session=session, type_piece=type_piece, numero=numero,
            statut='valide', ordre=ordre, source_saisie='manuel',
            payload={'rows': []}, created_by=self.user)

    def _plage(self, debut=0, fin=2, **extra):
        params = {'ssdgps': str(self.ssdgps.pk),
                  'session_from': str(self.sessions[debut].pk),
                  'session_to': str(self.sessions[fin].pk), **extra}
        return self.client.get('/api/v1/pieces/report/', params)


class OrdonnancementTests(SyntheseBaseTest):

    @staticmethod
    def _resume(pieces):
        """[(type de pièce, n° de session ou None)] dans l'ordre du rapport."""
        return [(p.type_piece, p.session.numero_session if p.session_id else None)
                for p in pieces]

    def test_une_piece_puis_ses_sessions(self):
        """Cœur de la règle : on décline les sessions AVANT de passer à la pièce suivante."""
        toutes = [self.commune_lpa, *self.rob, *self.rtlb, self.commune_rdc]
        self.assertEqual(self._resume(order_pieces_for_synthesis(toutes)), [
            ('LPA', None),
            ('ROB', 1), ('ROB', 2), ('ROB', 3),
            ('RTLB', 1), ('RTLB', 2), ('RTLB', 3),
            ('RDC', None),
        ])

    def test_la_piece_commune_n_est_pas_dupliquee(self):
        ordonnees = order_pieces_for_synthesis(
            [self.commune_lpa, *self.rob, self.commune_rdc])
        types = [p.type_piece for p in ordonnees]
        self.assertEqual(types.count('LPA'), 1)
        self.assertEqual(types.count('RDC'), 1)

    def test_l_ordre_des_pieces_du_rapport_est_respecte(self):
        """La position d'un groupe suit le plus petit `ordre` qu'il contient : l'ordre
        choisi par l'opérateur n'est pas bousculé par le regroupement."""
        # On remonte RTLB avant ROB dans l'ordre du rapport.
        for p in self.rtlb:
            p.ordre = 0
            p.save(update_fields=['ordre'])
        ordonnees = order_pieces_for_synthesis([*self.rob, *self.rtlb])
        self.assertEqual([p.type_piece for p in ordonnees][:3], ['RTLB'] * 3)

    def test_entree_desordonnee_donne_le_meme_resultat(self):
        """Le regroupement ne dépend pas de l'ordre d'arrivée des pièces."""
        melange = [self.rtlb[2], self.commune_rdc, self.rob[1], self.commune_lpa,
                   self.rtlb[0], self.rob[2], self.rtlb[1], self.rob[0]]
        attendu = self._resume(order_pieces_for_synthesis(
            [self.commune_lpa, *self.rob, *self.rtlb, self.commune_rdc]))
        self.assertEqual(self._resume(order_pieces_for_synthesis(melange)), attendu)

    def test_numero_distingue_deux_pieces_du_meme_type(self):
        """« Rapport de la détermination N°1 » et « N°2 » sont deux pièces distinctes :
        chacune forme son propre groupe."""
        rdn1 = [self._piece('RDN', s, 20, numero=1) for s in self.sessions]
        rdn2 = [self._piece('RDN', s, 21, numero=2) for s in self.sessions]
        ordonnees = order_pieces_for_synthesis([*rdn2, *rdn1])
        self.assertEqual([p.numero for p in ordonnees], [1, 1, 1, 2, 2, 2])
        self.assertEqual([p.session.numero_session for p in ordonnees],
                         [1, 2, 3, 1, 2, 3])


class MarquageDeSessionTests(SyntheseBaseTest):

    def _contexte(self, pieces):
        return build_report_context(self.ssdgps, None, order_pieces_for_synthesis(pieces))

    def test_chaque_occurrence_porte_sa_session(self):
        ctx = self._contexte([self.commune_lpa, *self.rob])
        libelles = [p['session_label'] for p in ctx['pieces']]
        self.assertEqual(libelles[0], '')                      # pièce commune
        self.assertEqual(libelles[1], 'N°1 du 11/01/2024')
        self.assertEqual(libelles[2], 'N°2 du 12/01/2024')
        self.assertEqual(libelles[3], 'N°3 du 13/01/2024')

    def test_la_page_de_garde_distingue_les_occurrences(self):
        ctx = self._contexte([self.commune_lpa, *self.rob])
        designations = [r['designation'] for r in ctx['cover_rows']]
        self.assertEqual(designations[0], piece_designation(self.commune_lpa))
        for i, numero in enumerate((1, 2, 3), start=1):
            self.assertTrue(designations[i].endswith(f'Session n°{numero}'),
                            designations[i])

    def test_aucun_marquage_hors_synthese(self):
        """Rapport ne couvrant qu'une session : l'annotation par pièce serait redondante
        (l'en-tête global porte déjà la session)."""
        ctx = build_report_context(self.ssdgps, self.sessions[0],
                                   [self.commune_lpa, self.rob[0]])
        self.assertEqual([p['session_label'] for p in ctx['pieces']], ['', ''])
        self.assertEqual([r['designation'] for r in ctx['cover_rows']],
                         [piece_designation(self.commune_lpa),
                          piece_designation(self.rob[0])])


class NomDeFichierTests(SyntheseBaseTest):

    def test_plage_de_sessions(self):
        nom = report_filename(self.ssdgps, None, sessions=self.sessions)
        self.assertIn('SESSIONS-N1-A-N3', nom)

    def test_plage_reduite_a_une_session(self):
        """Nommer « SESSIONS-N2-A-N2 » serait trompeur."""
        nom = report_filename(self.ssdgps, None, sessions=[self.sessions[1]])
        self.assertIn('SESSION-N2', nom)
        self.assertNotIn('SESSIONS', nom)

    def test_sans_plage_le_nom_est_inchange(self):
        self.assertIn('SESSION-N1', report_filename(self.ssdgps, self.sessions[0]))


class EndpointPlageTests(SyntheseBaseTest):
    """Logique de la VUE : validation des bornes, portée, nom de fichier.

    Le rendu PDF est remplacé par un bouchon : ces tests portent sur les paramètres, pas
    sur WeasyPrint (couvert par les autres classes, qui rendent directement). Cela les
    rend instantanés et les met à l'abri d'un bogue du client de test Django sous
    Python 3.14 (`Context.__copy__`), qui échoue dès qu'un gabarit est rendu à travers
    lui — l'environnement de CI, en Python 3.11, n'est pas concerné.
    """

    def setUp(self):
        super().setUp()
        correctif = patch('pieces.views.render_report_pdf', return_value=b'%PDF-1.7 factice')
        correctif.start()
        self.addCleanup(correctif.stop)

    def test_plage_complete(self):
        resp = self._plage(0, 2)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIn('SESSIONS-N1-A-N3', resp.data['filename'])

    def test_la_generation_est_journalisee(self):
        """Traçabilité : une génération de rapport ne modifie rien, donc les colonnes
        d'audit des tables n'en gardent aucune trace. Le journal, si (cf.
        `accounts/audit.py`)."""
        from accounts.models import AuditEvent

        self._plage(0, 2)

        evenement = AuditEvent.objects.get(action=AuditEvent.ACTION_RAPPORT_GENERE)
        self.assertEqual(evenement.cible_id, str(self.ssdgps.pk))
        self.assertEqual(evenement.details['sessions'], [1, 2, 3])
        self.assertIn('SESSIONS-N1-A-N3', evenement.details['fichier'])

    def test_bornes_inversees_acceptees(self):
        """De la session 3 à la session 1 : même rapport que de 1 à 3."""
        resp = self._plage(2, 0)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIn('SESSIONS-N1-A-N3', resp.data['filename'])

    def test_plage_partielle(self):
        resp = self._plage(0, 1)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIn('SESSIONS-N1-A-N2', resp.data['filename'])

    def test_une_seule_borne_refusee(self):
        resp = self.client.get('/api/v1/pieces/report/', {
            'ssdgps': str(self.ssdgps.pk), 'session_from': str(self.sessions[0].pk)})
        self.assertEqual(resp.status_code, 400)
        self.assertIn('session_to', resp.data['detail'])

    def test_session_unique_et_plage_sont_exclusives(self):
        resp = self._plage(0, 2, session=str(self.sessions[0].pk))
        self.assertEqual(resp.status_code, 400)
        self.assertIn('pas les deux', resp.data['detail'])

    def test_borne_etrangere_au_ssdgps_refusee(self):
        autre = Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=2,
                                      type_ssdgps='multi-session',
                                      affaire=self.ssdgps.affaire)
        etrangere = Session.objects.create(ssdgps=autre, numero_session=1)
        resp = self.client.get('/api/v1/pieces/report/', {
            'ssdgps': str(self.ssdgps.pk),
            'session_from': str(self.sessions[0].pk),
            'session_to': str(etrangere.pk)})
        self.assertEqual(resp.status_code, 400)
        self.assertIn('introuvable', resp.data['detail'])

    def test_session_supprimee_exclue_de_la_plage(self):
        """Une session supprimée au milieu de la plage ne doit rien y apporter."""
        self.sessions[1].is_deleted = True
        self.sessions[1].save(update_fields=['is_deleted'])

        with patch('pieces.views.render_report_pdf', return_value=b'%PDF') as rendu:
            resp = self._plage(0, 2)
        self.assertEqual(resp.status_code, 200, resp.content)

        pieces = rendu.call_args.args[2]
        sessions_incluses = {p.session.numero_session for p in pieces if p.session_id}
        self.assertEqual(sessions_incluses, {1, 3})

    def test_les_pieces_transmises_suivent_le_regroupement(self):
        """La vue passe au rendu des pièces DÉJÀ regroupées par pièce puis par session."""
        with patch('pieces.views.render_report_pdf', return_value=b'%PDF') as rendu:
            self._plage(0, 2)
        pieces = rendu.call_args.args[2]
        resume = [(p.type_piece, p.session.numero_session if p.session_id else None)
                  for p in pieces]
        self.assertEqual(resume, [
            ('LPA', None),
            ('ROB', 1), ('ROB', 2), ('ROB', 3),
            ('RTLB', 1), ('RTLB', 2), ('RTLB', 3),
            ('RDC', None),
        ])

    def test_rapport_sans_piece_refuse(self):
        Piece.objects.filter(ssdgps=self.ssdgps).update(statut='brouillon')
        resp = self._plage(0, 2)
        self.assertEqual(resp.status_code, 400)
        self.assertIn('Aucune pièce valide', resp.data['detail'])
