"""
Tableau de bord d'activité : comptages mensuels, délai de validation, taux de rejet,
indicateurs par opérateur et portée (Admin Org : ses organisations ; Agent : 403).
"""
from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.utils import timezone

from accounts.audit import journaliser
from accounts.models import AuditEvent, Organization
from projects.tests_workflow_ssdgps import WorkflowBaseTest

User = get_user_model()


class ActiviteTests(WorkflowBaseTest):
    def setUp(self):
        super().setUp()
        self.ssdgps.created_by = self.agent
        self.ssdgps.save(update_fields=['created_by'])
        self._piece()
        maintenant = timezone.now()
        # Soumis il y a 3 jours (simulé), validé maintenant ; puis un rejet d'un autre cycle.
        with mock.patch('django.utils.timezone.now', return_value=maintenant - timedelta(days=3)):
            self.assertEqual(self.transition('soumettre').status_code, 200)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.transition('valider').status_code, 200)
        self.assertEqual(self.transition('rouvrir', motif='Erreur').status_code, 200)
        self.client.force_authenticate(self.agent)
        self.transition('soumettre')
        self.client.force_authenticate(self.admin)
        self.transition('rejeter', motif='LPA')
        journaliser(AuditEvent.ACTION_RAPPORT_GENERE, acteur=self.agent, cible=self.ssdgps)
        journaliser(AuditEvent.ACTION_IA_APPEL, acteur=self.agent, jetons_entree=100, jetons_sortie=20)

    def get(self, **params):
        return self.client.get('/api/v1/analytics/activite/', params)

    def test_indicateurs(self):
        r = self.get()
        self.assertEqual(r.status_code, 200, r.data)
        t = r.data['totaux']
        self.assertEqual((t['crees'], t['soumis'], t['valides'], t['rejetes'], t['rapports']), (1, 2, 1, 1, 1))
        self.assertEqual(r.data['taux_rejet'], 0.5)
        self.assertAlmostEqual(r.data['delai_validation_jours'], 3.0, delta=0.1)
        self.assertEqual(len(r.data['par_mois']), 12)
        agent = next(o for o in r.data['operateurs'] if o['id'] == self.agent.id)
        self.assertEqual((agent['crees'], agent['soumissions'], agent['rejets_recus'], agent['rapports'],
                          agent['appels_ia'], agent['jetons_ia']), (1, 2, 1, 1, 1, 120))

    def test_un_agent_n_y_a_pas_acces(self):
        self.client.force_authenticate(self.agent)
        self.assertEqual(self.get().status_code, 403)

    def test_l_admin_org_ne_voit_pas_une_autre_organisation(self):
        autre = Organization.objects.create(code='O2', name='O2')
        r = self.get(organisation=str(autre.id))
        self.assertEqual(r.data['totaux']['crees'], 0)
        self.assertEqual(r.data['operateurs'], [])

    def test_admin_systeme_tout_et_periode_invalide(self):
        self.client.force_authenticate(User.objects.create_user(
            username='s@x.ma', email='s@x.ma', password='Passw0rd!', platform_role='ROLE_ADMIN_SYSTEME'))
        self.assertEqual(self.get().data['totaux']['crees'], 1)
        self.assertEqual(self.get(depuis='2026-12-01', jusqu_a='2026-01-01').status_code, 400)
