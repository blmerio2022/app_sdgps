"""
Identification de la SESSION dans le rapport PDF d'un SSDGPS de session unique.

Attendu métier : lorsque le rapport porte sur une session unique, le **numéro** et la
**date** de cette session s'affichent

  - dans l'en-tête de TOUTES les pages — page de garde, séparateurs de pièce et en-tête
    courant des pages de contenu (tableaux, images, photos) — juste **après** la nature
    du SDGPS ;
  - dans le pied de page de toutes les pages, juste **après** « SDGPS N°i ».

Seules les pages blanches de calage recto-verso en sont dépourvues : par convention
d'impression, elles ne portent ni en-tête ni pied.

Deux chemins mènent à un rapport de session unique et doivent se comporter pareil :
portée explicite sur une session (SSDGPS multi-session), ou SSDGPS ne comptant qu'une
seule session. À l'inverse, un rapport couvrant plusieurs sessions ne doit nommer
AUCUNE session — afficher la première serait un contresens.
"""
from datetime import datetime, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.test import TestCase

from accounts.models import Membership, Organization
from pieces.models import Piece
from pieces.report import (build_report_context, report_foot_prefix,
                           resolve_report_session)
from projects.models import Affaire, Projet, Propriete, Session, Ssdgps

User = get_user_model()


class RapportSessionBaseTest(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(code='ORG-S', name='Org Session')
        self.user = User.objects.create_user(
            username='s@sdgps.ma', email='s@sdgps.ma', password='Passw0rd!')
        Membership.objects.create(user=self.user, organization=self.org,
                                  role='ROLE_ORGANISATION_AGENT')
        projet = Projet.objects.create(nom_projet='P', code_projet='P-S-1',
                                       organization=self.org, created_by=self.user)
        self.propriete = Propriete.objects.create(
            nom_propriete='Bled Essalam', id_titre='T9000/A', projet=projet)
        self.affaire = Affaire.objects.create(
            numero_sd_affaire=1, nature_procedure_affaire='IFF', nature_affaire='BI',
            date_bornage=datetime(2023, 4, 9, tzinfo=dt_timezone.utc),
            propriete=self.propriete)

    def _ssdgps(self, type_ssdgps='mono-session', numero=1):
        return Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=numero,
                                     type_ssdgps=type_ssdgps, affaire=self.affaire)

    def _session(self, ssdgps, numero=1, date=datetime(2024, 1, 14, tzinfo=dt_timezone.utc)):
        """Pose une session sur le SSDGPS.

        `update_or_create` est indispensable : un SSDGPS **mono-session** reçoit déjà
        une session n°1 automatiquement, à sa création, via
        `projects.signals.autocreate_mono_session` (sans date). Un `create` entrerait en
        collision avec la contrainte d'unicité (ssdgps, numero_session)."""
        session, _ = Session.objects.update_or_create(
            ssdgps=ssdgps, numero_session=numero, defaults={'date_session': date})
        return session

    def _piece(self, ssdgps):
        return Piece.objects.create(ssdgps=ssdgps, type_piece='LPA', numero=1,
                                    statut='valide', ordre=1, source_saisie='manuel',
                                    payload={'rows': []}, created_by=self.user)


class ResolutionSessionTests(RapportSessionBaseTest):

    def test_session_explicite_retenue(self):
        """Portée sur une session : c'est elle, sans ambiguïté."""
        ssdgps = self._ssdgps('multi-session')
        s1 = self._session(ssdgps, 1)
        self._session(ssdgps, 2)
        self.assertEqual(resolve_report_session(ssdgps, s1), s1)

    def test_session_unique_deduite_sans_portee(self):
        """Un SSDGPS à session unique nomme sa session même si l'appelant n'en passe
        aucune — c'est le cas de génération le plus courant."""
        ssdgps = self._ssdgps('mono-session')
        session = self._session(ssdgps, 1)
        self.assertEqual(resolve_report_session(ssdgps, None), session)

    def test_plusieurs_sessions_sans_portee_ne_nomme_rien(self):
        ssdgps = self._ssdgps('multi-session')
        self._session(ssdgps, 1)
        self._session(ssdgps, 2)
        self.assertIsNone(resolve_report_session(ssdgps, None))

    def test_aucune_session(self):
        """SSDGPS multi-session sans aucune session : rien à nommer. (Un mono-session
        ne peut pas être dans cet état : le signal lui crée sa session n°1.)"""
        self.assertIsNone(resolve_report_session(self._ssdgps('multi-session'), None))

    def test_mono_session_a_toujours_sa_session_auto(self):
        """Conséquence du signal `autocreate_mono_session` : tout SSDGPS mono-session
        nomme sa session, sans qu'aucune session n'ait été créée explicitement."""
        ssdgps = self._ssdgps('mono-session')
        resolue = resolve_report_session(ssdgps, None)
        self.assertIsNotNone(resolue)
        self.assertEqual(resolue.numero_session, 1)

    def test_session_supprimee_ignoree(self):
        """`is_deleted` n'est filtré par aucun manager : sans exclusion explicite, une
        session supprimée serait comptée — et pourrait passer pour la seule session."""
        ssdgps = self._ssdgps('multi-session')
        vivante = self._session(ssdgps, 1)
        supprimee = self._session(ssdgps, 2)
        supprimee.is_deleted = True
        supprimee.save(update_fields=['is_deleted'])
        self.assertEqual(resolve_report_session(ssdgps, None), vivante)

    def test_resolution_ne_depend_pas_du_type_declare(self):
        """Des SSDGPS marqués « mono-session » portent en base PLUSIEURS sessions
        (constaté sur les données réelles). La résolution compte donc les sessions
        existantes, et ne se fie pas à `type_ssdgps`."""
        ssdgps = self._ssdgps('mono-session')
        self._session(ssdgps, 1)
        self._session(ssdgps, 2)
        self.assertIsNone(resolve_report_session(ssdgps, None))


class EnteteSessionTests(RapportSessionBaseTest):

    def _header(self, ssdgps, session=None):
        return build_report_context(ssdgps, session, [self._piece(ssdgps)])['header']

    def test_numero_et_date_dans_l_entete(self):
        # Multi-session avec UNE seule session : la session porte un numéro arbitraire
        # (un mono-session aurait sa session auto n°1 en plus, donc deux sessions).
        ssdgps = self._ssdgps('multi-session')
        self._session(ssdgps, 3, datetime(2024, 1, 14, tzinfo=dt_timezone.utc))
        header = self._header(ssdgps)
        self.assertEqual(header['session_numero'], 3)
        self.assertEqual(header['session_date'], '14/01/2024')
        self.assertEqual(header['session_label'], 'N°3 du 14/01/2024')

    def test_libelle_sans_date_quand_la_date_manque(self):
        """Des sessions réelles n'ont pas de `date_session` : le libellé reste lisible
        au lieu d'afficher « du  » suivi du vide."""
        ssdgps = self._ssdgps('multi-session')
        self._session(ssdgps, 2, None)
        header = self._header(ssdgps)
        self.assertEqual(header['session_label'], 'N°2')

    def test_libelle_vide_si_plusieurs_sessions(self):
        """Libellé vide = le template n'affiche pas la ligne « Session »."""
        ssdgps = self._ssdgps('multi-session')
        self._session(ssdgps, 1)
        self._session(ssdgps, 2)
        self.assertEqual(self._header(ssdgps)['session_label'], '')

    def test_portee_session_renseigne_l_entete(self):
        ssdgps = self._ssdgps('multi-session')
        s1 = self._session(ssdgps, 1)
        self._session(ssdgps, 2)
        header = self._header(ssdgps, session=s1)
        self.assertEqual(header['session_label'], 'N°1 du 14/01/2024')

    def test_la_date_est_sans_heure(self):
        """`date_session` est l'une des deux dates sans heure de l'app (cf.
        `tests_report_dates.py`) : l'en-tête ne doit jamais afficher d'heure."""
        ssdgps = self._ssdgps('mono-session')
        self._session(ssdgps, 1, datetime(2024, 1, 14, 16, 45, tzinfo=dt_timezone.utc))
        self.assertEqual(self._header(ssdgps)['session_date'], '14/01/2024')
        self.assertNotIn(':', self._header(ssdgps)['session_label'])


class PiedDePageSessionTests(RapportSessionBaseTest):

    def test_session_juste_apres_sdgps(self):
        """Ordre exigé : identification, SD, SDGPS N°i, PUIS la session."""
        ssdgps = self._ssdgps('mono-session', numero=7)
        self.assertEqual(report_foot_prefix(ssdgps, 3),
                         'T9000/A SD1 SDGPS N°7 SESSION N°3')

    def test_pied_sans_session_inchange(self):
        """Non-régression : un rapport multi-session garde le pied historique."""
        ssdgps = self._ssdgps('multi-session', numero=7)
        self.assertEqual(report_foot_prefix(ssdgps, None), 'T9000/A SD1 SDGPS N°7')

    def test_repli_sur_la_requisition_sans_titre(self):
        self.propriete.id_titre = ''
        self.propriete.id_requisition = 'R19000/55'
        self.propriete.save(update_fields=['id_titre', 'id_requisition'])
        ssdgps = self._ssdgps('mono-session')
        self.assertEqual(report_foot_prefix(ssdgps, 1),
                         'R19000/55 SD1 SDGPS N°1 SESSION N°1')

    def test_session_numero_zero_affichee(self):
        """`0` est un numéro valide : seul `None` signifie « pas de session »."""
        ssdgps = self._ssdgps('mono-session')
        self.assertIn('SESSION N°0', report_foot_prefix(ssdgps, 0))


class RenduTemplateSessionTests(RapportSessionBaseTest):
    """Rendu HTML des trois en-têtes, sans passer par WeasyPrint (rapide et suffisant :
    c'est le template qui place la ligne « Session »)."""

    def _html(self, mode, ssdgps, session=None, **extra):
        from django.template.loader import render_to_string
        context = build_report_context(ssdgps, session, [self._piece(ssdgps)])
        piece = context['pieces'][0] if context['pieces'] else None
        return render_to_string('pieces/report.html', {
            'header': context['header'], 'mode': mode, 'foot_prefix': '',
            'duplex': False, 'cover_rows': context['cover_rows'],
            'total': context['total'], 'piece': piece, **extra})

    def test_page_de_garde_affiche_la_session_apres_la_nature(self):
        ssdgps = self._ssdgps('mono-session')
        self._session(ssdgps, 1)
        html = self._html('cover', ssdgps)
        self.assertIn('N°1 du 14/01/2024', html)
        # La ligne « Session » suit celle de la nature du SDGPS.
        self.assertLess(html.index('Nature du Sous Dossier GPS'),
                        html.index('N°1 du 14/01/2024'))

    def test_separateur_et_entete_courant_affichent_la_session(self):
        """Le séparateur de pièce ET l'en-tête courant des pages de contenu — c'est ce
        dernier qui se répète sur toutes les pages de tableaux, images et photos."""
        ssdgps = self._ssdgps('mono-session')
        self._session(ssdgps, 1)
        html = self._html('piece', ssdgps)
        self.assertGreaterEqual(html.count('N°1 du 14/01/2024'), 2)

    def test_aucune_ligne_session_si_plusieurs_sessions(self):
        ssdgps = self._ssdgps('multi-session')
        self._session(ssdgps, 1)
        self._session(ssdgps, 2)
        for mode in ('cover', 'piece'):
            html = self._html(mode, ssdgps)
            self.assertNotIn('du 14/01/2024', html)
