"""
Génération des rapports en TÂCHE DE FOND (Celery).

Le rendu dure des dizaines de secondes à plusieurs minutes. En synchrone, il
immobilisait un worker gunicorn sur trois, dépassait le délai du serveur sur un gros
SDGPS, et ne pouvait afficher qu'une progression simulée (bloquée à 90 %).

Ce que ces tests verrouillent :
- la demande REND LA MAIN tout de suite (202) et renvoie un suivi ;
- la progression est RÉELLE : elle avance pièce par pièce, pilotée par le rendu ;
- le PDF produit est **stocké** donc re-téléchargeable sans relancer le rendu ;
- un échec de rendu se termine en statut « échec » porteur d'un message exploitable,
  et non en barre figée ;
- le scoping RBAC et la validation des paramètres sont ceux de l'endpoint synchrone —
  c'est la même résolution de portée qui est appelée.

Le rendu WeasyPrint lui-même est bouché : il est couvert par les suites dédiées, et le
client de test Django échoue sur tout rendu de gabarit sous Python 3.14
(`Context.__copy__`) — la CI, en 3.11, n'est pas concernée.
"""
from datetime import datetime, timezone as dt_timezone
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import AuditEvent, Membership, Organization
from pieces.models import Piece, RapportGeneration
from projects.models import Affaire, Projet, Propriete, Session, Ssdgps

User = get_user_model()

PDF_FACTICE = b'%PDF-1.7 factice'


class RapportAsyncBaseTest(TestCase):
    """SSDGPS à 2 sessions, 3 pièces valides."""

    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(code='ORG-AS', name='Org Async')
        self.user = User.objects.create_user(
            username='as@sdgps.ma', email='as@sdgps.ma', password='Passw0rd!')
        Membership.objects.create(user=self.user, organization=self.org,
                                  role='ROLE_ORGANISATION_AGENT')
        projet = Projet.objects.create(nom_projet='P', code_projet='P-AS-1',
                                       organization=self.org, created_by=self.user)
        propriete = Propriete.objects.create(nom_propriete='X', id_titre='T9100/A',
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

        self._piece('LPA', None, 0)
        self._piece('ROB', self.sessions[0], 1)
        self._piece('ROB', self.sessions[1], 2)

        self.client.force_authenticate(self.user)

    def _piece(self, type_piece, session, ordre, statut=Piece.Statut.VALIDE):
        return Piece.objects.create(
            ssdgps=self.ssdgps, session=session, type_piece=type_piece,
            numero=1 if session else None, ordre=ordre, statut=statut,
            payload={'rows': [{'a': 1}]},
        )

    def lancer(self, **params):
        query = '&'.join(f'{k}={v}' for k, v in params.items())
        url = f'/api/v1/pieces/report-async/?ssdgps={self.ssdgps.id}'
        return self.client.post(f'{url}&{query}' if query else url, format='json')


class DemandeDeGenerationTests(RapportAsyncBaseTest):
    @patch('pieces.tasks.render_report_pdf', return_value=PDF_FACTICE)
    def test_la_demande_rend_la_main_en_202(self, _rendu):
        resp = self.lancer()

        self.assertEqual(resp.status_code, 202, resp.data)
        self.assertIn('id', resp.data)

    @patch('pieces.tasks.render_report_pdf', return_value=PDF_FACTICE)
    def test_un_suivi_est_cree_et_rattache_au_demandeur(self, _rendu):
        self.lancer()

        generation = RapportGeneration.objects.get()
        self.assertEqual(generation.ssdgps, self.ssdgps)
        self.assertEqual(generation.created_by, self.user)

    @patch('pieces.tasks.render_report_pdf', return_value=PDF_FACTICE)
    def test_le_mode_recto_verso_est_transmis(self, rendu):
        self.lancer(duplex=1)

        self.assertTrue(RapportGeneration.objects.get().duplex)
        self.assertTrue(rendu.call_args.kwargs['duplex'])

    @patch('pieces.tasks.render_report_pdf', return_value=PDF_FACTICE)
    def test_la_portee_session_est_transmise(self, _rendu):
        self.lancer(session=self.sessions[0].id)

        self.assertEqual(RapportGeneration.objects.get().session, self.sessions[0])

    @patch('pieces.tasks.render_report_pdf', return_value=PDF_FACTICE)
    def test_la_plage_de_synthese_est_transmise(self, _rendu):
        self.lancer(session_from=self.sessions[0].id, session_to=self.sessions[1].id)

        generation = RapportGeneration.objects.get()
        self.assertEqual(len(generation.sessions_plage), 2)
        self.assertIsNone(generation.session)

    def test_le_ssdgps_est_requis(self):
        resp = self.client.post('/api/v1/pieces/report-async/', format='json')

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(RapportGeneration.objects.count(), 0)

    def test_session_et_plage_ensemble_sont_refusees(self):
        resp = self.lancer(session=self.sessions[0].id,
                           session_from=self.sessions[0].id, session_to=self.sessions[1].id)

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(RapportGeneration.objects.count(), 0)

    def test_sans_piece_valide_rien_n_est_mis_en_file(self):
        """Le contrôle a lieu AVANT la mise en file : inutile d'occuper un worker."""
        Piece.objects.update(statut=Piece.Statut.BROUILLON)

        resp = self.lancer()

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(RapportGeneration.objects.count(), 0)

    def test_un_ssdgps_d_une_autre_organisation_est_refuse(self):
        autre = User.objects.create_user(username='x@sdgps.ma', email='x@sdgps.ma',
                                         password='Passw0rd!')
        autre_org = Organization.objects.create(code='ORG-ZZ', name='Autre')
        Membership.objects.create(user=autre, organization=autre_org,
                                  role='ROLE_ORGANISATION_AGENT')
        self.client.force_authenticate(autre)

        resp = self.lancer()

        self.assertEqual(resp.status_code, 403)
        self.assertEqual(RapportGeneration.objects.count(), 0)

    def test_anonyme_refuse(self):
        self.client.force_authenticate(None)

        self.assertEqual(self.lancer().status_code, 401)


class ExecutionDeLaTacheTests(RapportAsyncBaseTest):
    """Celery est en mode « eager » en test : la tâche s'exécute dans la demande."""

    @patch('pieces.tasks.render_report_pdf', return_value=PDF_FACTICE)
    def test_le_rapport_est_produit_et_stocke(self, _rendu):
        self.lancer()

        generation = RapportGeneration.objects.get()
        self.assertEqual(generation.statut, RapportGeneration.Statut.TERMINE)
        self.assertEqual(generation.progression, 100)
        self.assertTrue(generation.fichier)
        self.assertEqual(generation.octets, len(PDF_FACTICE))
        self.assertTrue(generation.nom_fichier.endswith('.pdf'))

    @patch('pieces.tasks.render_report_pdf', return_value=PDF_FACTICE)
    def test_les_horodatages_sont_renseignes(self, _rendu):
        self.lancer()

        generation = RapportGeneration.objects.get()
        self.assertIsNotNone(generation.started_at)
        self.assertIsNotNone(generation.finished_at)

    @patch('pieces.tasks.render_report_pdf', return_value=PDF_FACTICE)
    def test_les_pieces_sont_relues_en_base_au_moment_du_rendu(self, rendu):
        """Une tâche peut démarrer bien après la demande : elle doit travailler sur
        l'état courant, pas sur une liste figée au moment du clic."""
        self.lancer()

        pieces = rendu.call_args.args[2]
        self.assertEqual(len(pieces), 3)

    @patch('pieces.tasks.render_report_pdf', return_value=PDF_FACTICE)
    def test_la_generation_est_journalisee(self, _rendu):
        self.lancer()

        evenement = AuditEvent.objects.get(action=AuditEvent.ACTION_RAPPORT_GENERE)
        self.assertTrue(evenement.details['asynchrone'])
        self.assertEqual(evenement.cible_id, str(self.ssdgps.pk))

    @patch('pieces.tasks.render_report_pdf',
           side_effect=RuntimeError('WeasyPrint indisponible'))
    def test_une_dependance_manquante_termine_en_echec_explicite(self, _rendu):
        self.lancer()

        generation = RapportGeneration.objects.get()
        self.assertEqual(generation.statut, RapportGeneration.Statut.ECHEC)
        self.assertIn('WeasyPrint indisponible', generation.erreur)

    @patch('pieces.tasks.render_report_pdf', side_effect=ValueError('image illisible'))
    def test_un_echec_de_rendu_donne_un_message_exploitable(self, _rendu):
        """Une barre figée ne dit rien à l'opérateur : l'erreur doit être nommée."""
        self.lancer()

        generation = RapportGeneration.objects.get()
        self.assertEqual(generation.statut, RapportGeneration.Statut.ECHEC)
        self.assertIn('ValueError', generation.erreur)
        self.assertIn('image illisible', generation.erreur)
        self.assertIsNotNone(generation.finished_at)

    @patch('pieces.tasks.render_report_pdf', return_value=PDF_FACTICE)
    def test_une_tache_sur_un_suivi_inexistant_ne_leve_pas(self, _rendu):
        from pieces.tasks import generer_rapport
        import uuid

        self.assertIsNone(generer_rapport(str(uuid.uuid4())))


class ProgressionReelleTests(RapportAsyncBaseTest):
    """La progression suit le rendu, pièce par pièce."""

    def test_la_progression_avance_a_chaque_piece(self):
        vues = []

        def rendu(ssdgps, session, pieces, **kwargs):
            rappel = kwargs['on_progress']
            total = len(pieces)
            for index in range(total):
                rappel(index, total, f'Pièce {index + 1}')
                vues.append(RapportGeneration.objects.get().progression)
            return PDF_FACTICE

        with patch('pieces.tasks.render_report_pdf', side_effect=rendu):
            self.lancer()

        self.assertEqual(vues, sorted(vues))
        self.assertLess(vues[0], vues[-1])

    def test_l_etape_en_cours_est_publiee(self):
        def rendu(ssdgps, session, pieces, **kwargs):
            kwargs['on_progress'](1, 3, 'Rendu de la pièce 2/3 — Rapport des observations')
            self.assertIn('Rapport des observations',
                          RapportGeneration.objects.get().etape)
            return PDF_FACTICE

        with patch('pieces.tasks.render_report_pdf', side_effect=rendu):
            self.lancer()

    def test_marquer_progression_borne_les_valeurs(self):
        generation = RapportGeneration.objects.create(ssdgps=self.ssdgps)

        generation.marquer_progression(99, 3, 'x')
        self.assertEqual(generation.progression, 95)

        generation.marquer_progression(-5, 0, 'x')
        self.assertEqual(generation.progression, 5)

    def test_une_etape_trop_longue_est_tronquee(self):
        generation = RapportGeneration.objects.create(ssdgps=self.ssdgps)

        generation.marquer_progression(1, 2, 'x' * 500)

        self.assertEqual(len(RapportGeneration.objects.get(pk=generation.pk).etape), 255)

    def test_un_suivi_defaillant_ne_casse_pas_le_rendu(self):
        """Une minute de rendu ne se perd pas pour un compteur (cf. `report._avancer`)."""
        from pieces.report import _avancer

        def rappel_casse(*_args):
            raise RuntimeError('base indisponible')

        _avancer(rappel_casse, 1, 2, 'x')   # ne doit pas lever
        _avancer(None, 1, 2, 'x')


class SuiviEtTelechargementTests(RapportAsyncBaseTest):
    def _generation_terminee(self):
        with patch('pieces.tasks.render_report_pdf', return_value=PDF_FACTICE):
            self.lancer()
        return RapportGeneration.objects.get()

    def test_le_suivi_est_consultable(self):
        generation = self._generation_terminee()

        resp = self.client.get(f'/api/v1/rapports/{generation.pk}/')

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['statut'], 'termine')
        self.assertEqual(resp.data['progression'], 100)
        self.assertEqual(resp.data['demande_par'], self.user.email)

    def test_le_fichier_est_retelechargeable(self):
        """Fermer l'onglet ne doit plus faire perdre plusieurs minutes de rendu."""
        import base64

        generation = self._generation_terminee()

        resp = self.client.get(f'/api/v1/rapports/{generation.pk}/fichier/')

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(base64.b64decode(resp.data['data']), PDF_FACTICE)
        self.assertEqual(resp.data['filename'], generation.nom_fichier)

    def test_le_fichier_brut_est_servi_sur_demande(self):
        """Le paramètre est `brut`, pas `format` : DRF réserve `format` à la négociation
        de contenu et renvoie 404 avant d'entrer dans la vue — l'ancien `?format=raw`,
        documenté de longue date, n'a donc jamais pu fonctionner."""
        generation = self._generation_terminee()

        resp = self.client.get(f'/api/v1/rapports/{generation.pk}/fichier/?brut=1')

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'application/pdf')
        self.assertEqual(resp.content, PDF_FACTICE)

    def test_l_ancien_parametre_format_ne_sert_pas_le_flux_brut(self):
        """Garde-fou : `?format=raw` est capté par DRF (404). Ne pas le réintroduire."""
        generation = self._generation_terminee()

        resp = self.client.get(f'/api/v1/rapports/{generation.pk}/fichier/?format=raw')

        self.assertEqual(resp.status_code, 404)

    def test_un_rapport_non_termine_n_est_pas_telechargeable(self):
        generation = RapportGeneration.objects.create(
            ssdgps=self.ssdgps, statut=RapportGeneration.Statut.EN_COURS)

        resp = self.client.get(f'/api/v1/rapports/{generation.pk}/fichier/')

        self.assertEqual(resp.status_code, 409)

    def test_l_historique_est_filtrable_par_ssdgps(self):
        self._generation_terminee()

        resp = self.client.get(f'/api/v1/rapports/?ssdgps={self.ssdgps.id}')

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 1)

    def test_une_autre_organisation_ne_voit_pas_le_suivi(self):
        generation = self._generation_terminee()
        autre = User.objects.create_user(username='y@sdgps.ma', email='y@sdgps.ma',
                                         password='Passw0rd!')
        autre_org = Organization.objects.create(code='ORG-YY', name='Autre')
        Membership.objects.create(user=autre, organization=autre_org,
                                  role='ROLE_ORGANISATION_AGENT')
        self.client.force_authenticate(autre)

        self.assertEqual(
            self.client.get(f'/api/v1/rapports/{generation.pk}/').status_code, 404)

    def test_anonyme_refuse(self):
        generation = self._generation_terminee()
        self.client.force_authenticate(None)

        self.assertEqual(
            self.client.get(f'/api/v1/rapports/{generation.pk}/').status_code, 401)

    def test_le_suivi_est_en_lecture_seule(self):
        generation = self._generation_terminee()

        resp = self.client.delete(f'/api/v1/rapports/{generation.pk}/')

        self.assertEqual(resp.status_code, 405)


class PurgeDesRapportsTests(RapportAsyncBaseTest):
    """Un rapport est un artefact dérivé : purgé, pas compté dans le quota."""

    def _vieille_generation(self, jours):
        from django.core.files.base import ContentFile
        from django.utils import timezone

        generation = RapportGeneration.objects.create(
            ssdgps=self.ssdgps, statut=RapportGeneration.Statut.TERMINE,
            nom_fichier='vieux.pdf', octets=len(PDF_FACTICE))
        generation.fichier.save('vieux.pdf', ContentFile(PDF_FACTICE), save=True)
        RapportGeneration.objects.filter(pk=generation.pk).update(
            created_at=timezone.now() - timezone.timedelta(days=jours))
        return generation

    def test_les_rapports_anciens_sont_purges(self):
        from django.core.management import call_command

        self._vieille_generation(40)

        call_command('purger_rapports', jours=30, verbosity=0)

        self.assertEqual(RapportGeneration.objects.count(), 0)

    def test_les_rapports_recents_sont_conserves(self):
        from django.core.management import call_command

        self._vieille_generation(5)

        call_command('purger_rapports', jours=30, verbosity=0)

        self.assertEqual(RapportGeneration.objects.count(), 1)

    def test_la_simulation_n_efface_rien(self):
        from django.core.management import call_command

        self._vieille_generation(40)

        call_command('purger_rapports', jours=30, simuler=True, verbosity=0)

        self.assertEqual(RapportGeneration.objects.count(), 1)

    def test_le_fichier_est_retire_du_stockage(self):
        from django.core.files.storage import default_storage
        from django.core.management import call_command

        generation = self._vieille_generation(40)
        chemin = generation.fichier.name
        self.assertTrue(default_storage.exists(chemin))

        call_command('purger_rapports', jours=30, verbosity=0)

        self.assertFalse(default_storage.exists(chemin))


class ModeEagerTests(TestCase):
    """Sans Redis, l'application doit rester pleinement fonctionnelle."""

    def test_celery_est_en_mode_eager_sans_broker(self):
        from django.conf import settings

        self.assertTrue(settings.CELERY_TASK_ALWAYS_EAGER)

    def test_une_tache_en_echec_ne_remonte_pas_en_exception(self):
        """`EAGER_PROPAGATES` à False : l'échec se lit dans le suivi, pas en 500."""
        from django.conf import settings

        self.assertFalse(settings.CELERY_TASK_EAGER_PROPAGATES)

    def test_l_application_celery_est_chargee(self):
        from backend import celery_app

        self.assertEqual(celery_app.main, 'sdgps')
