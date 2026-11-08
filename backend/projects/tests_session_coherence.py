"""
Cohérence « type de SSDGPS ↔ nombre de sessions ».

Un SSDGPS **mono-session** n'a qu'UNE session, implicite et structurelle : auto-créée
par `projects.signals.autocreate_mono_session`, jamais atteignable dans l'interface (le
front va droit aux pièces) et comptée 0 par `nbr_total_sessions`. Toute session
supplémentaire est donc **invisible et inatteignable**.

Aucune validation ne l'empêchait, et deux chemins distincts ont produit cet état sur les
données réelles — 2 SSDGPS sur 445 :

  - ajouter une session à un SSDGPS mono-session (SDGPS n°4 : sessions 2 et 3 créées
    deux jours après le SSDGPS) ;
  - basculer un multi-session en mono alors qu'il comptait plusieurs sessions
    (SDGPS n°2 : 4 sessions importées, type modifié ensuite).

Le second cas est le plus dangereux : la génération du rapport SANS portée de session
retient **toutes** les pièces du SSDGPS, donc les pièces de plusieurs sessions se
retrouveraient fusionnées dans un seul rapport, sans avertissement.

Ces tests verrouillent les deux garde-fous et le nettoyage prudent des orphelines.
"""
from datetime import datetime, timezone as dt_timezone
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import Membership, Organization
from pieces.models import Piece
from projects.models import Affaire, Projet, Propriete, Session, Ssdgps

User = get_user_model()


class CoherenceSessionBaseTest(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(code='ORG-C', name='Org Cohérence')
        self.user = User.objects.create_user(
            username='c@sdgps.ma', email='c@sdgps.ma', password='Passw0rd!')
        Membership.objects.create(user=self.user, organization=self.org,
                                  role='ROLE_ORGANISATION_ADMIN')
        self.projet = Projet.objects.create(nom_projet='P', code_projet='P-C-1',
                                            organization=self.org, created_by=self.user)
        self.propriete = Propriete.objects.create(
            nom_propriete='X', id_requisition='R1/55', projet=self.projet)
        self.affaire = Affaire.objects.create(
            numero_sd_affaire=1, nature_procedure_affaire='IFF', nature_affaire='BI',
            date_bornage=datetime(2023, 4, 9, tzinfo=dt_timezone.utc),
            propriete=self.propriete)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _ssdgps(self, type_ssdgps, numero=1):
        return Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=numero,
                                     type_ssdgps=type_ssdgps, affaire=self.affaire)

    def _session(self, ssdgps, numero, date=None):
        """Création directe par l'ORM : contourne volontairement le sérialiseur, pour
        pouvoir reconstituer l'état incohérent hérité."""
        session, _ = Session.objects.update_or_create(
            ssdgps=ssdgps, numero_session=numero, defaults={'date_session': date})
        return session

    def _piece(self, ssdgps, session=None, numero=1):
        return Piece.objects.create(ssdgps=ssdgps, session=session, type_piece='LPA',
                                    numero=numero, statut='valide', ordre=numero,
                                    source_saisie='manuel', payload={'rows': []},
                                    created_by=self.user)


class CreationSessionTests(CoherenceSessionBaseTest):

    def test_ajout_de_session_refuse_sur_mono_session(self):
        ssdgps = self._ssdgps('mono-session')
        resp = self.client.post('/api/v1/sessions/', {
            'ssdgps': str(ssdgps.pk), 'numero_session': 2,
        }, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('mono-session', str(resp.data))
        # Seule la session implicite subsiste.
        self.assertEqual(ssdgps.sessions.filter(is_deleted=False).count(), 1)

    def test_ajout_de_session_autorise_sur_multi_session(self):
        ssdgps = self._ssdgps('multi-session')
        resp = self.client.post('/api/v1/sessions/', {
            'ssdgps': str(ssdgps.pk), 'numero_session': 1,
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)

    def test_le_signal_n_est_pas_bloque(self):
        """Le signal crée la session n°1 par l'ORM, pas par le sérialiseur : la
        validation ne doit pas l'empêcher, sinon tout mono-session naîtrait sans session."""
        ssdgps = self._ssdgps('mono-session')
        self.assertEqual(ssdgps.sessions.filter(is_deleted=False).count(), 1)
        self.assertEqual(ssdgps.sessions.first().numero_session, 1)

    def test_modification_de_la_session_implicite_reste_permise(self):
        """Renseigner la `date_session` de la session implicite (souvent nulle à
        l'auto-création) doit rester possible : seule la CRÉATION est bloquée."""
        ssdgps = self._ssdgps('mono-session')
        session = ssdgps.sessions.get()
        resp = self.client.patch(f'/api/v1/sessions/{session.pk}/',
                                 {'date_session': '2024-01-14'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        session.refresh_from_db()
        self.assertIsNotNone(session.date_session)

    def test_modification_permise_meme_sur_un_ssdgps_incoherent(self):
        """Les SSDGPS déjà incohérents restent modifiables — on ne bloque pas la
        correction de l'existant."""
        ssdgps = self._ssdgps('mono-session')
        orpheline = self._session(ssdgps, 2)
        resp = self.client.patch(f'/api/v1/sessions/{orpheline.pk}/',
                                 {'date_session': '2024-02-02'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)


class BasculeTypeSsdgpsTests(CoherenceSessionBaseTest):

    def test_bascule_vers_mono_refusee_avec_plusieurs_sessions(self):
        ssdgps = self._ssdgps('multi-session')
        self._session(ssdgps, 1)
        self._session(ssdgps, 2)
        resp = self.client.patch(f'/api/v1/ssdgps/{ssdgps.pk}/',
                                 {'type_ssdgps': 'mono-session'}, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('2 sessions actives', str(resp.data))
        ssdgps.refresh_from_db()
        self.assertEqual(ssdgps.type_ssdgps, 'multi-session')

    def test_bascule_vers_mono_autorisee_avec_une_seule_session(self):
        """Une session unique devient légitimement la session implicite."""
        ssdgps = self._ssdgps('multi-session')
        self._session(ssdgps, 1)
        resp = self.client.patch(f'/api/v1/ssdgps/{ssdgps.pk}/',
                                 {'type_ssdgps': 'mono-session'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_sessions_supprimees_ne_bloquent_pas_la_bascule(self):
        ssdgps = self._ssdgps('multi-session')
        self._session(ssdgps, 1)
        orpheline = self._session(ssdgps, 2)
        orpheline.is_deleted = True
        orpheline.save(update_fields=['is_deleted'])
        resp = self.client.patch(f'/api/v1/ssdgps/{ssdgps.pk}/',
                                 {'type_ssdgps': 'mono-session'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_bascule_vers_multi_toujours_libre(self):
        """C'est le sens inverse — il n'introduit aucune incohérence."""
        ssdgps = self._ssdgps('mono-session')
        resp = self.client.patch(f'/api/v1/ssdgps/{ssdgps.pk}/',
                                 {'type_ssdgps': 'multi-session'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_mise_a_jour_sans_changement_de_type_non_entravee(self):
        """Non-régression : un SSDGPS mono déjà incohérent reste modifiable sur ses
        autres champs — la validation ne porte que sur la BASCULE."""
        ssdgps = self._ssdgps('mono-session')
        self._session(ssdgps, 2)
        resp = self.client.patch(f'/api/v1/ssdgps/{ssdgps.pk}/',
                                 {'numero_ssdgps': 9}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        ssdgps.refresh_from_db()
        self.assertEqual(ssdgps.numero_ssdgps, 9)


class NettoyageOrphelinesTests(CoherenceSessionBaseTest):

    def _run(self, **options):
        out = StringIO()
        call_command('cleanup_orphan_sessions', stdout=out, **options)
        return out.getvalue()

    def test_dry_run_n_ecrit_rien(self):
        ssdgps = self._ssdgps('mono-session')
        self._session(ssdgps, 2)
        sortie = self._run(dry_run=True)
        self.assertIn('session(s) seraient supprimées', sortie)
        self.assertEqual(ssdgps.sessions.filter(is_deleted=False).count(), 2)

    def test_confirmation_requise(self):
        ssdgps = self._ssdgps('mono-session')
        self._session(ssdgps, 2)
        with self.assertRaises(CommandError):
            self._run()
        self.assertEqual(ssdgps.sessions.filter(is_deleted=False).count(), 2)

    def test_supprime_les_orphelines_vides(self):
        ssdgps = self._ssdgps('mono-session')
        self._session(ssdgps, 2)
        self._session(ssdgps, 3)
        self._run(yes=True)
        restantes = ssdgps.sessions.filter(is_deleted=False)
        self.assertEqual(restantes.count(), 1)
        self.assertEqual(restantes.get().numero_session, 1)

    def test_conserve_la_session_porteuse_de_pieces(self):
        """La session gardée est celle qui porte des pièces, même si ce n'est pas la n°1."""
        ssdgps = self._ssdgps('mono-session')
        porteuse = self._session(ssdgps, 3)
        self._piece(ssdgps, session=porteuse)
        self._run(yes=True)
        restantes = ssdgps.sessions.filter(is_deleted=False)
        self.assertEqual([s.numero_session for s in restantes], [3])

    def test_ssdgps_laisse_intact_si_plusieurs_sessions_portent_des_pieces(self):
        """Arbitrage métier : le script ne fusionne jamais des sessions peuplées."""
        ssdgps = self._ssdgps('mono-session')
        s2 = self._session(ssdgps, 2)
        s3 = self._session(ssdgps, 3)
        self._piece(ssdgps, session=s2, numero=1)
        self._piece(ssdgps, session=s3, numero=2)
        sortie = self._run(yes=True)
        self.assertIn('LAISSÉ INTACT', sortie)
        self.assertEqual(ssdgps.sessions.filter(is_deleted=False).count(), 3)

    def test_suppression_logique_donc_reversible(self):
        ssdgps = self._ssdgps('mono-session')
        orpheline = self._session(ssdgps, 2)
        self._run(yes=True)
        orpheline.refresh_from_db()
        self.assertTrue(orpheline.is_deleted)
        self.assertIsNotNone(orpheline.deleted_at)

    def test_multi_session_jamais_touche(self):
        ssdgps = self._ssdgps('multi-session')
        self._session(ssdgps, 1)
        self._session(ssdgps, 2)
        self._run(dry_run=True)
        self.assertEqual(ssdgps.sessions.filter(is_deleted=False).count(), 2)

    def test_mono_session_conforme_non_touche(self):
        ssdgps = self._ssdgps('mono-session')
        sortie = self._run(dry_run=True)
        self.assertIn('Aucune session orpheline', sortie)
        self.assertEqual(ssdgps.sessions.filter(is_deleted=False).count(), 1)

    @override_settings(IS_PRODUCTION_LIKE=True, ENVIRONMENT='production')
    def test_production_exige_le_nom_exact_de_l_environnement(self):
        ssdgps = self._ssdgps('mono-session')
        self._session(ssdgps, 2)
        with self.assertRaises(CommandError):
            self._run(yes=True)                       # --yes ne suffit pas
        self._run(confirm_environment='production')    # nom exact → autorisé
        self.assertEqual(ssdgps.sessions.filter(is_deleted=False).count(), 1)
