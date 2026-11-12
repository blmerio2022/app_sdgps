"""
Tests du rattachement d'un utilisateur à une organisation
(`POST /api/v1/organizations/{id}/add-member/`).

L'endpoint ne crée aucun compte — la création est réservée à l'administration de
l'application (cf. `accounts/tests_account_creation.py`) — mais il décide de qui
appartient à quelle organisation et avec quel rôle. Il doit donc appliquer les mêmes
bornes que le reste du RBAC, ce qui n'était pas le cas : un Admin Organisation pouvait
rattacher n'importe quel compte de la plateforme et le nommer administrateur.
"""
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Membership, Organization

User = get_user_model()


def make_user(email, is_superuser=False, platform_role=None):
    user = User.objects.create_user(username=email, email=email, password='Passw0rd!')
    if is_superuser:
        user.is_superuser = True
        user.is_staff = True
    if platform_role:
        user.platform_role = platform_role
    user.save()
    return user


class AddMemberTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(code='ORG-A', name='Organisation A')
        self.autre_org = Organization.objects.create(code='ORG-B', name='Organisation B')

        self.superadmin = make_user('super@example.com', is_superuser=True)
        self.admin_systeme = make_user('sys@example.com', platform_role='ROLE_ADMIN_SYSTEME')

        self.org_admin = make_user('orgadmin@example.com')
        Membership.objects.create(
            user=self.org_admin, organization=self.org, role='ROLE_ORGANISATION_ADMIN',
        )

        self.agent = make_user('agent@example.com')
        Membership.objects.create(
            user=self.agent, organization=self.org, role='ROLE_ORGANISATION_AGENT',
        )

        # Utilisateur d'une AUTRE organisation, inconnu de self.org_admin.
        self.etranger = make_user('etranger@example.com')
        Membership.objects.create(
            user=self.etranger, organization=self.autre_org, role='ROLE_ORGANISATION_AGENT',
        )

    def url(self, org=None):
        return f'/api/v1/organizations/{(org or self.org).id}/add-member/'

    def ajouter(self, utilisateur, role='ROLE_ORGANISATION_AGENT', org=None):
        return self.client.post(
            self.url(org), {'user': utilisateur.pk, 'role': role}, format='json',
        )

    # --- Administration de l'application ------------------------------------

    def test_super_admin_rattache_n_importe_qui(self):
        self.client.force_authenticate(self.superadmin)

        resp = self.ajouter(self.etranger)

        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertTrue(
            Membership.objects.filter(user=self.etranger, organization=self.org).exists()
        )

    def test_admin_systeme_peut_nommer_un_admin_d_organisation(self):
        self.client.force_authenticate(self.admin_systeme)

        resp = self.ajouter(self.etranger, role='ROLE_ORGANISATION_ADMIN')

        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(
            Membership.objects.get(user=self.etranger, organization=self.org).role,
            'ROLE_ORGANISATION_ADMIN',
        )

    def test_admin_systeme_agit_sur_une_organisation_dont_il_n_est_pas_membre(self):
        self.client.force_authenticate(self.admin_systeme)

        resp = self.ajouter(self.agent, org=self.autre_org)

        self.assertEqual(resp.status_code, 201, resp.data)

    # --- Admin Organisation --------------------------------------------------

    def test_org_admin_rattache_un_utilisateur_de_son_organisation(self):
        """Happy-path conservé : il reste maître des agents de son périmètre."""
        collegue = make_user('collegue@example.com')
        Membership.objects.create(
            user=collegue, organization=self.org, role='ROLE_ORGANISATION_AGENT',
        )
        autre_org_a_lui = Organization.objects.create(code='ORG-C', name='Organisation C')
        Membership.objects.create(
            user=self.org_admin, organization=autre_org_a_lui, role='ROLE_ORGANISATION_ADMIN',
        )
        self.client.force_authenticate(self.org_admin)

        resp = self.ajouter(collegue, org=autre_org_a_lui)

        self.assertEqual(resp.status_code, 201, resp.data)

    def test_org_admin_ne_peut_pas_nommer_un_administrateur(self):
        """Le cœur du correctif : `UserUpdateSerializer` le lui interdisait déjà."""
        self.client.force_authenticate(self.org_admin)

        resp = self.ajouter(self.agent, role='ROLE_ORGANISATION_ADMIN', org=self.autre_org)

        self.assertEqual(resp.status_code, 403)

    def test_org_admin_ne_peut_pas_nommer_un_admin_dans_sa_propre_org(self):
        collegue = make_user('collegue2@example.com')
        Membership.objects.create(
            user=collegue, organization=self.org, role='ROLE_ORGANISATION_AGENT',
        )
        org_c = Organization.objects.create(code='ORG-D', name='Organisation D')
        Membership.objects.create(
            user=self.org_admin, organization=org_c, role='ROLE_ORGANISATION_ADMIN',
        )
        self.client.force_authenticate(self.org_admin)

        resp = self.ajouter(collegue, role='ROLE_ORGANISATION_ADMIN', org=org_c)

        self.assertEqual(resp.status_code, 403)
        self.assertIn('administrateur', resp.data['detail'].lower())

    def test_org_admin_ne_peut_pas_piocher_un_utilisateur_etranger(self):
        """Second volet du correctif : plus d'accès à l'annuaire de la plateforme."""
        org_c = Organization.objects.create(code='ORG-E', name='Organisation E')
        Membership.objects.create(
            user=self.org_admin, organization=org_c, role='ROLE_ORGANISATION_ADMIN',
        )
        self.client.force_authenticate(self.org_admin)

        resp = self.ajouter(self.etranger, org=org_c)

        self.assertEqual(resp.status_code, 403)
        self.assertFalse(
            Membership.objects.filter(user=self.etranger, organization=org_c).exists()
        )

    def test_org_admin_ne_peut_pas_rattacher_un_admin_de_l_application(self):
        org_c = Organization.objects.create(code='ORG-F', name='Organisation F')
        Membership.objects.create(
            user=self.org_admin, organization=org_c, role='ROLE_ORGANISATION_ADMIN',
        )
        self.client.force_authenticate(self.org_admin)

        resp = self.ajouter(self.admin_systeme, org=org_c)

        self.assertEqual(resp.status_code, 403)

    def test_org_admin_ne_peut_pas_agir_sur_une_organisation_etrangere(self):
        self.client.force_authenticate(self.org_admin)

        resp = self.ajouter(self.etranger, org=self.autre_org)

        self.assertEqual(resp.status_code, 403)

    # --- Agent et anonyme ----------------------------------------------------

    def test_agent_refuse(self):
        self.client.force_authenticate(self.agent)

        resp = self.ajouter(self.etranger)

        self.assertEqual(resp.status_code, 403)

    def test_anonyme_refuse(self):
        resp = self.ajouter(self.etranger)

        self.assertEqual(resp.status_code, 401)

    # --- Validation ----------------------------------------------------------

    def test_organisation_inexistante(self):
        self.client.force_authenticate(self.superadmin)

        resp = self.client.post(
            '/api/v1/organizations/00000000-0000-0000-0000-000000000000/add-member/',
            {'user': self.etranger.pk}, format='json',
        )

        self.assertEqual(resp.status_code, 404)

    def test_doublon_refuse(self):
        """L'organisation vient de l'URL : le contrôle de doublon doit la voir."""
        self.client.force_authenticate(self.superadmin)

        resp = self.ajouter(self.agent)

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(
            Membership.objects.filter(user=self.agent, organization=self.org).count(), 1,
        )

    def test_l_organisation_du_corps_est_ignoree(self):
        """Un corps malicieux ne doit pas détourner la cible vers une autre org."""
        self.client.force_authenticate(self.superadmin)

        resp = self.client.post(
            self.url(),
            {'user': self.etranger.pk, 'organization': str(self.autre_org.id)},
            format='json',
        )

        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertTrue(
            Membership.objects.filter(user=self.etranger, organization=self.org).exists()
        )

    def test_utilisateur_requis(self):
        self.client.force_authenticate(self.superadmin)

        resp = self.client.post(self.url(), {}, format='json')

        self.assertEqual(resp.status_code, 400)
