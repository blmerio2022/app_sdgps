"""
Notifications : qui est prévenu, de quoi, et ce que chacun peut voir.

- soumission → l'encadrement de l'organisation (à défaut l'Admin Système), jamais l'auteur ;
- décision (valider / rejeter / clore / rouvrir) → le créateur du dossier et l'auteur de
  la soumission, avec le motif ;
- rapport de fond terminé ou en échec → son demandeur ;
- API strictement personnelle (404 sur la notification d'autrui, admins compris) ;
- préférences e-mail : seuls les écarts aux défauts sont gardés ;
- `notifier` ne lève jamais.
"""
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Membership
from projects.tests_workflow_ssdgps import WorkflowBaseTest

from .models import Notification, PreferenceNotification
from .services import email_souhaite, notifier, notifier_rapport

User = get_user_model()


class TransitionsTests(WorkflowBaseTest):
    def setUp(self):
        super().setUp()
        self.ssdgps.created_by = self.agent
        self.ssdgps.save(update_fields=['created_by'])
        self._piece()

    def test_soumission_previent_l_encadrement_pas_l_auteur(self):
        self.assertEqual(self.transition('soumettre').status_code, 200)
        notes = Notification.objects.all()
        self.assertEqual([n.destinataire for n in notes], [self.admin])
        n = notes[0]
        self.assertEqual(n.type, Notification.TYPE_DOSSIER_SOUMIS)
        self.assertIn(f'/pieces/{self.ssdgps.id}', n.lien)
        self.assertEqual(n.cible_id, str(self.ssdgps.id))

    def test_sans_admin_org_l_admin_systeme_est_prevenu(self):
        Membership.objects.filter(user=self.admin).delete()
        sys = User.objects.create_user(username='sys@x.ma', email='sys@x.ma', password='Passw0rd!',
                                       platform_role='ROLE_ADMIN_SYSTEME')
        self.transition('soumettre')
        self.assertEqual(list(Notification.objects.values_list('destinataire', flat=True)), [sys.id])

    def test_rejet_previent_le_redacteur_avec_le_motif(self):
        self.transition('soumettre')
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.transition('rejeter', motif='Il manque la LPA signée').status_code, 200)
        n = Notification.objects.get(destinataire=self.agent)
        self.assertEqual(n.type, Notification.TYPE_DOSSIER_REJETE)
        self.assertIn('Il manque la LPA signée', n.message)
        self.assertTrue(n.acteur_nom)

    def test_validation_previent_aussi_l_auteur_de_la_soumission(self):
        autre = User.objects.create_user(username='a2@x.ma', email='a2@x.ma', password='Passw0rd!')
        Membership.objects.create(user=autre, organization=self.org, role='ROLE_ORGANISATION_AGENT')
        self.client.force_authenticate(autre)
        self.transition('soumettre')
        self.client.force_authenticate(self.admin)
        self.transition('valider')
        dest = set(Notification.objects.filter(type=Notification.TYPE_DOSSIER_VALIDE)
                   .values_list('destinataire', flat=True))
        self.assertEqual(dest, {self.agent.id, autre.id})

    def test_transition_refusee_ne_notifie_personne(self):
        self.assertEqual(self.transition('valider').status_code, 400)
        self.assertFalse(Notification.objects.exists())


class RapportTests(WorkflowBaseTest):
    def test_rapport_pret_et_echec(self):
        gen = mock.Mock(ssdgps=self.ssdgps, created_by=self.agent, nom_fichier='R.pdf')
        notifier_rapport(gen, True)
        notifier_rapport(gen, False, 'Aucune pièce')
        types = list(Notification.objects.filter(destinataire=self.agent)
                     .order_by('id').values_list('type', 'message'))
        self.assertEqual(types[0][0], Notification.TYPE_RAPPORT_PRET)
        self.assertEqual(types[1], (Notification.TYPE_RAPPORT_ECHEC, 'Aucune pièce'))

    def test_la_tache_de_fond_notifie_l_echec(self):
        from pieces.models import RapportGeneration
        from pieces.tasks import generer_rapport
        gen = RapportGeneration.objects.create(ssdgps=self.ssdgps, created_by=self.agent)
        generer_rapport.apply(args=[str(gen.pk)])   # aucune pièce valide → échec
        self.assertTrue(Notification.objects.filter(destinataire=self.agent,
                                                    type=Notification.TYPE_RAPPORT_ECHEC).exists())


class ServiceTests(TestCase):
    def setUp(self):
        self.u = User.objects.create_user(username='u@x.ma', email='u@x.ma', password='Passw0rd!')

    def test_sans_doublon_ni_inactif_ni_acteur(self):
        inactif = User.objects.create_user(username='i@x.ma', email='i@x.ma', password='Passw0rd!',
                                           is_active=False)
        acteur = User.objects.create_user(username='ac@x.ma', email='ac@x.ma', password='Passw0rd!')
        notifier([self.u, self.u, None, inactif, acteur], Notification.TYPE_SECURITE, 'T', acteur=acteur)
        self.assertEqual(list(Notification.objects.values_list('destinataire', flat=True)), [self.u.id])

    def test_ne_leve_jamais(self):
        with mock.patch.object(Notification.objects, 'create', side_effect=RuntimeError('base HS')),                 self.assertLogs('notifications.services', level='ERROR'):
            self.assertEqual(notifier([self.u], Notification.TYPE_SECURITE, 'T'), [])

    def test_email_selon_preferences(self):
        self.assertTrue(email_souhaite(self.u, Notification.TYPE_DOSSIER_REJETE))
        self.assertFalse(email_souhaite(self.u, Notification.TYPE_RAPPORT_PRET))
        PreferenceNotification.objects.create(utilisateur=self.u, emails_actifs=False)
        self.assertFalse(email_souhaite(self.u, Notification.TYPE_DOSSIER_REJETE))

    def test_email_envoye_apres_commit(self):
        with mock.patch('accounts.email_service.EmailService.send_email', return_value=True) as envoi:
            with self.captureOnCommitCallbacks(execute=True):
                notifier([self.u], Notification.TYPE_DOSSIER_REJETE, 'Dossier rejeté', 'motif')
        envoi.assert_called_once()
        self.assertEqual(envoi.call_args[0][0], 'u@x.ma')
        self.assertTrue(Notification.objects.get().email_envoye)


class ApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.u = User.objects.create_user(username='u@x.ma', email='u@x.ma', password='Passw0rd!')
        self.autre = User.objects.create_superuser(username='s@x.ma', email='s@x.ma', password='Passw0rd!')
        self.n1 = Notification.objects.create(destinataire=self.u, type='SECURITE', titre='A')
        self.n2 = Notification.objects.create(destinataire=self.u, type='SECURITE', titre='B')
        self.etrangere = Notification.objects.create(destinataire=self.autre, type='SECURITE', titre='C')
        self.client.force_authenticate(self.u)

    def test_liste_et_compte_personnels(self):
        r = self.client.get('/api/v1/notifications/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual([x['titre'] for x in r.data['results']], ['B', 'A'])
        self.assertEqual(r.data['non_lues'], 2)
        self.assertEqual(self.client.get('/api/v1/notifications/compte/').data, {'non_lues': 2})

    def test_marquer_lue_tout_lu_vider(self):
        self.assertTrue(self.client.post(f'/api/v1/notifications/{self.n1.id}/lue/').data['lue'])
        self.assertEqual(self.client.get('/api/v1/notifications/?non_lues=1').data['count'], 1)
        self.assertEqual(self.client.post('/api/v1/notifications/tout-lu/').data['marquees'], 1)
        self.assertEqual(self.client.post('/api/v1/notifications/vider/').data['supprimees'], 2)
        self.assertTrue(Notification.objects.filter(pk=self.etrangere.pk, lue=False).exists())

    def test_notification_d_autrui_404_meme_pour_un_super_admin(self):
        self.assertEqual(self.client.post(f'/api/v1/notifications/{self.etrangere.id}/lue/').status_code, 404)
        self.assertEqual(self.client.delete(f'/api/v1/notifications/{self.etrangere.id}/').status_code, 404)
        self.client.force_authenticate(self.autre)
        self.assertEqual(self.client.delete(f'/api/v1/notifications/{self.n1.id}/').status_code, 404)
        self.assertEqual(self.client.delete(f'/api/v1/notifications/{self.etrangere.id}/').status_code, 204)

    def test_anonyme_refuse(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/v1/notifications/').status_code, 401)

    def test_preferences(self):
        r = self.client.get('/api/v1/notifications/preferences/')
        self.assertTrue(r.data['emails_actifs'])
        rapport = next(t for t in r.data['types'] if t['type'] == 'RAPPORT_PRET')
        self.assertFalse(rapport['email'])
        r = self.client.put('/api/v1/notifications/preferences/',
                            {'types': {'RAPPORT_PRET': True, 'DOSSIER_REJETE': True}}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(PreferenceNotification.objects.get(utilisateur=self.u).emails_par_type,
                         {'RAPPORT_PRET': True})
        self.assertEqual(self.client.put('/api/v1/notifications/preferences/',
                                         {'types': {'XX': True}}, format='json').status_code, 400)
