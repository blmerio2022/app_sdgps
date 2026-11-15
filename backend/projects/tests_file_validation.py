"""
File de validation : ce que l'encadrement voit, et la décision groupée.

- un Admin Organisation voit les dossiers soumis de SON organisation, du plus ancien au
  plus récent, avec l'attente, l'auteur de la soumission et la cohérence ;
- un Agent n'a pas de file ; une autre organisation n'y apparaît pas ;
- l'administration de l'application voit toutes les organisations ;
- la décision groupée applique les règles unitaires à chaque dossier, journalise et
  notifie chacun, et un refus sur l'un n'arrête pas les autres.
"""
from datetime import datetime, timedelta, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.utils import timezone

from accounts.models import AuditEvent, Membership, Organization
from notifications.models import Notification
from projects.models import Affaire, Projet, Propriete, Ssdgps

from .tests_workflow_ssdgps import WorkflowBaseTest

User = get_user_model()


class FileValidationTests(WorkflowBaseTest):
    def setUp(self):
        super().setUp()
        self._piece()
        self.assertEqual(self.transition('soumettre').status_code, 200)
        Ssdgps.objects.filter(pk=self.ssdgps.pk).update(statut_change_at=timezone.now() - timedelta(days=4))
        # Un second dossier soumis, plus récent, dans la même affaire.
        self.ssdgps2 = Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=2,
                                             type_ssdgps='mono-session', affaire=self.ssdgps.affaire,
                                             statut=Ssdgps.Statut.SOUMIS, statut_change_at=timezone.now())
        # Une autre organisation, avec un dossier soumis.
        autre = Organization.objects.create(code='ORG-AUTRE', name='Autre')
        projet = Projet.objects.create(nom_projet='Q', code_projet='Q-1', organization=autre)
        prop = Propriete.objects.create(nom_propriete='Y', id_titre='T1', projet=projet)
        aff = Affaire.objects.create(numero_sd_affaire=1, nature_procedure_affaire='IFF', nature_affaire='BI',
                                     date_bornage=datetime(2023, 1, 1, tzinfo=dt_timezone.utc), propriete=prop)
        self.etranger = Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=1, type_ssdgps='mono-session',
                                              affaire=aff, statut=Ssdgps.Statut.SOUMIS)

    def file(self, statut=None):
        url = '/api/v1/ssdgps/a-valider/' + (f'?statut={statut}' if statut else '')
        return self.client.get(url)

    def test_l_admin_org_voit_ses_dossiers_soumis_du_plus_ancien_au_plus_recent(self):
        self.client.force_authenticate(self.admin)
        r = self.file()
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data['encadrement'])
        ids = [d['id'] for d in r.data['results']]
        self.assertEqual(ids, [str(self.ssdgps.id), str(self.ssdgps2.id)])
        premier = r.data['results'][0]
        self.assertEqual(premier['attente_jours'], 4)
        self.assertTrue(premier['par'])
        self.assertEqual(premier['coherence']['pieces'], 1)
        self.assertEqual(r.data['compteurs'], {'soumis': 2, 'valide': 0})

    def test_un_agent_n_a_pas_de_file(self):
        r = self.file()
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data['encadrement'])
        self.assertEqual(r.data['results'], [])

    def test_l_admin_systeme_voit_toutes_les_organisations(self):
        sys = User.objects.create_user(username='s@x.ma', email='s@x.ma', password='Passw0rd!',
                                       platform_role='ROLE_ADMIN_SYSTEME')
        self.client.force_authenticate(sys)
        ids = {d['id'] for d in self.file().data['results']}
        self.assertIn(str(self.etranger.id), ids)

    def test_statut_inconnu_400(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.file('en_cours').status_code, 400)

    def test_validation_groupee(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post('/api/v1/ssdgps/transition-groupee/', {
            'ids': [str(self.ssdgps.id), str(self.ssdgps2.id), str(self.etranger.id)],
            'action': 'valider'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['reussis'], 2)
        self.assertEqual(r.data['resultats'][2], {'id': str(self.etranger.id), 'ok': False,
                                                  'detail': 'Dossier introuvable.'})
        self.ssdgps.refresh_from_db()
        self.assertEqual(self.ssdgps.statut, Ssdgps.Statut.VALIDE)
        self.assertEqual(AuditEvent.objects.filter(action=AuditEvent.ACTION_SSDGPS_STATUT,
                                                   details__groupee=True).count(), 2)
        self.assertTrue(Notification.objects.filter(type=Notification.TYPE_DOSSIER_VALIDE).exists())
        self.assertEqual(self.file('valide').data['compteurs']['valide'], 2)

    def test_rejet_groupe_sans_motif_refuse_par_dossier(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post('/api/v1/ssdgps/transition-groupee/',
                             {'ids': [str(self.ssdgps.id)], 'action': 'rejeter'}, format='json')
        self.assertEqual(r.data['reussis'], 0)
        self.assertIn('motif', r.data['resultats'][0]['detail'])

    def test_un_agent_ne_valide_pas_en_groupe(self):
        r = self.client.post('/api/v1/ssdgps/transition-groupee/',
                             {'ids': [str(self.ssdgps.id)], 'action': 'valider'}, format='json')
        self.assertEqual(r.data['reussis'], 0)
        self.assertIn('réservée', r.data['resultats'][0]['detail'])

    def test_liste_vide_refusee(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post('/api/v1/ssdgps/transition-groupee/', {'ids': []},
                                          format='json').status_code, 400)
