"""
Tests des garde-fous « dernier administrateur d'organisation ».

Vérifie qu'on ne peut pas supprimer, désactiver ou rétrograder un ROLE_ORGANISATION_ADMIN
si cela laisserait son organisation sans aucun administrateur actif.
"""
from django.test import TestCase
from rest_framework.test import APIClient

from django.contrib.auth import get_user_model
from .models import Organization, Membership

User = get_user_model()


def make_user(email, is_superuser=False):
    user = User.objects.create_user(username=email, email=email, password='Passw0rd!')
    if is_superuser:
        user.is_superuser = True
        user.is_staff = True
        user.save(update_fields=['is_superuser', 'is_staff'])
    return user


class OrgAdminProtectionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.superadmin = make_user('super@example.com', is_superuser=True)
        self.client.force_authenticate(self.superadmin)
        self.org = Organization.objects.create(code='ORG-1', name='Organisation 1')

    def _add_member(self, email, role):
        user = make_user(email)
        Membership.objects.create(user=user, organization=self.org, role=role)
        return user

    def add_admin(self, email):
        return self._add_member(email, 'ROLE_ORGANISATION_ADMIN')

    def add_agent(self, email):
        return self._add_member(email, 'ROLE_ORGANISATION_AGENT')

    # --- Suppression ---------------------------------------------------------

    def test_delete_last_org_admin_is_blocked(self):
        admin = self.add_admin('admin1@example.com')
        self.add_agent('agent1@example.com')

        resp = self.client.delete(f'/api/v1/users/{admin.pk}/')

        self.assertEqual(resp.status_code, 403)
        admin.refresh_from_db()
        self.assertFalse(admin.is_deleted)

    def test_delete_org_admin_with_backup_is_allowed(self):
        admin1 = self.add_admin('admin1@example.com')
        self.add_admin('admin2@example.com')

        resp = self.client.delete(f'/api/v1/users/{admin1.pk}/')

        self.assertEqual(resp.status_code, 204)
        admin1.refresh_from_db()
        self.assertTrue(admin1.is_deleted)

    # --- Désactivation (toggle-active) --------------------------------------

    def test_deactivate_last_org_admin_is_blocked(self):
        admin = self.add_admin('admin1@example.com')

        resp = self.client.post(f'/api/v1/users/{admin.pk}/toggle-active/')

        self.assertEqual(resp.status_code, 403)
        admin.refresh_from_db()
        self.assertTrue(admin.is_active)

    def test_deactivate_org_admin_with_backup_is_allowed(self):
        admin1 = self.add_admin('admin1@example.com')
        self.add_admin('admin2@example.com')

        resp = self.client.post(f'/api/v1/users/{admin1.pk}/toggle-active/')

        self.assertEqual(resp.status_code, 200)
        admin1.refresh_from_db()
        self.assertFalse(admin1.is_active)

    def test_deactivate_last_org_admin_via_patch_is_blocked(self):
        admin = self.add_admin('admin1@example.com')

        resp = self.client.patch(
            f'/api/v1/users/{admin.pk}/',
            {'is_active': False},
            format='json',
        )

        self.assertEqual(resp.status_code, 403)
        admin.refresh_from_db()
        self.assertTrue(admin.is_active)

    # --- Rétrogradation (PATCH role) ----------------------------------------

    def test_demote_last_org_admin_is_blocked(self):
        admin = self.add_admin('admin1@example.com')

        resp = self.client.patch(
            f'/api/v1/users/{admin.pk}/',
            {'role': 'ROLE_ORGANISATION_AGENT'},
            format='json',
        )

        self.assertEqual(resp.status_code, 400)
        membership = admin.memberships.get(organization=self.org)
        self.assertEqual(membership.role, 'ROLE_ORGANISATION_ADMIN')

    def test_demote_org_admin_with_backup_is_allowed(self):
        admin1 = self.add_admin('admin1@example.com')
        self.add_admin('admin2@example.com')

        resp = self.client.patch(
            f'/api/v1/users/{admin1.pk}/',
            {'role': 'ROLE_ORGANISATION_AGENT'},
            format='json',
        )

        self.assertEqual(resp.status_code, 200)
        membership = admin1.memberships.get(organization=self.org)
        self.assertEqual(membership.role, 'ROLE_ORGANISATION_AGENT')

    # --- Multi-organisations -------------------------------------------------

    def test_delete_blocked_when_only_one_of_several_orgs_is_orphaned(self):
        org2 = Organization.objects.create(code='ORG-2', name='Organisation 2')
        # admin est le SEUL admin de org1, mais org2 a un admin de secours.
        admin = self.add_admin('admin1@example.com')
        Membership.objects.create(user=admin, organization=org2, role='ROLE_ORGANISATION_ADMIN')
        backup = make_user('admin2@example.com')
        Membership.objects.create(user=backup, organization=org2, role='ROLE_ORGANISATION_ADMIN')

        resp = self.client.delete(f'/api/v1/users/{admin.pk}/')

        self.assertEqual(resp.status_code, 403)
        self.assertIn('Organisation 1', resp.json().get('detail', ''))
        admin.refresh_from_db()
        self.assertFalse(admin.is_deleted)

    def test_inactive_admin_does_not_count_as_backup(self):
        admin = self.add_admin('admin1@example.com')
        # Un 2e admin existe mais est inactif -> ne compte pas.
        inactive = self.add_admin('admin2@example.com')
        inactive.is_active = False
        inactive.save(update_fields=['is_active'])

        resp = self.client.delete(f'/api/v1/users/{admin.pk}/')

        self.assertEqual(resp.status_code, 403)


class OrgAdminScopingTests(TestCase):
    """
    Vérifie le scoping de la page utilisateurs pour un Admin Organisation :
    - /auth/me/ expose son organisation ;
    - il ne peut créer AUCUN compte (réservé au Super Admin / Admin Système).
    """

    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(code='ORG-A', name='Organisation A')
        self.other_org = Organization.objects.create(code='ORG-B', name='Organisation B')
        self.admin = make_user('orgadmin@example.com')
        Membership.objects.create(
            user=self.admin, organization=self.org, role='ROLE_ORGANISATION_ADMIN'
        )
        self.client.force_authenticate(self.admin)

    def test_me_exposes_organization(self):
        resp = self.client.get('/api/auth/me/')

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['role'], 'ROLE_ORGANISATION_ADMIN')
        self.assertEqual(data['organization_id'], str(self.org.id))
        self.assertEqual(data['organization_name'], self.org.name)

    def test_create_agent_in_own_org_is_blocked(self):
        """Nouvelle règle : la création de comptes est réservée à l'administration de
        l'application (cf. `tests_account_creation.py`). Un Admin Organisation gère ses
        agents mais ne les crée plus, même dans sa propre organisation."""
        resp = self.client.post('/api/v1/users/', {
            'email': 'agent-a@example.com',
            'first_name': 'Agent', 'last_name': 'A',
            'password': 'Passw0rd!',
            'role': 'ROLE_ORGANISATION_AGENT',
            'organization_id': str(self.org.id),
        }, format='json')

        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertFalse(User.objects.filter(email='agent-a@example.com').exists())

    def test_create_agent_in_foreign_org_is_blocked(self):
        resp = self.client.post('/api/v1/users/', {
            'email': 'agent-b@example.com',
            'first_name': 'Agent', 'last_name': 'B',
            'password': 'Passw0rd!',
            'role': 'ROLE_ORGANISATION_AGENT',
            'organization_id': str(self.other_org.id),
        }, format='json')

        self.assertEqual(resp.status_code, 403)
        self.assertFalse(User.objects.filter(email='agent-b@example.com').exists())

    def test_cannot_move_agent_to_another_org(self):
        agent = make_user('agent@example.com')
        Membership.objects.create(
            user=agent, organization=self.org, role='ROLE_ORGANISATION_AGENT'
        )

        resp = self.client.patch(f'/api/v1/users/{agent.pk}/', {
            'organization_id': str(self.other_org.id),
        }, format='json')

        self.assertEqual(resp.status_code, 400)
        # L'agent reste dans son organisation d'origine, sans nouvelle adhésion.
        orgs = set(agent.memberships.values_list('organization_id', flat=True))
        self.assertEqual(orgs, {self.org.id})

    def test_can_edit_agent_name_without_changing_org(self):
        agent = make_user('agent@example.com')
        Membership.objects.create(
            user=agent, organization=self.org, role='ROLE_ORGANISATION_AGENT'
        )

        resp = self.client.patch(f'/api/v1/users/{agent.pk}/', {
            'first_name': 'Nouveau',
            'organization_id': str(self.org.id),  # même org → autorisé
        }, format='json')

        self.assertEqual(resp.status_code, 200, resp.content)
        agent.refresh_from_db()
        self.assertEqual(agent.first_name, 'Nouveau')
