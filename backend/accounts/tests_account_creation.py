"""
Tests du verrou sur la CRÉATION DE COMPTES.

Règle métier : il n'existe aucune inscription publique, et un compte — qu'il s'agisse
d'un Admin Système, d'un Admin Organisation ou d'un Agent Organisation — ne peut être
créé que par le Super Admin ou l'Admin Système de l'application.

Couvre :
- la disparition de l'endpoint public d'inscription (`/api/auth/register/`) ;
- le scoping RBAC de `POST /api/v1/users/` pour chaque rôle ;
- la hiérarchie des rôles créables (seul un Super Admin crée un Admin Système) ;
- la lecture, qui reste ouverte à un Admin Organisation (contrairement à la création).
"""
from django.test import TestCase
from django.urls import NoReverseMatch, Resolver404, resolve, reverse
from rest_framework.test import APIClient

from django.contrib.auth import get_user_model

from .models import Membership, Organization
from .permissions import is_application_admin

User = get_user_model()

USERS_URL = '/api/v1/users/'


def make_user(email, is_superuser=False, platform_role=None):
    user = User.objects.create_user(username=email, email=email, password='Passw0rd!')
    if is_superuser:
        user.is_superuser = True
        user.is_staff = True
    if platform_role:
        user.platform_role = platform_role
    user.save()
    return user


class PasDInscriptionPubliqueTests(TestCase):
    """L'endpoint public d'inscription n'existe plus du tout."""

    def setUp(self):
        self.client = APIClient()

    def test_la_route_register_n_est_plus_resolue(self):
        with self.assertRaises(NoReverseMatch):
            reverse('register')

    def test_l_ancienne_url_ne_resout_plus_vers_aucune_vue(self):
        """Plus aucune vue derrière `/api/auth/register/` : la requête ne peut qu'échouer.

        On interroge le résolveur plutôt que le client de test : un 404 passerait par le
        rendu d'un gabarit d'erreur, sans rapport avec ce qu'on vérifie.
        """
        with self.assertRaises(Resolver404):
            resolve('/api/auth/register/')

    def test_aucun_serializer_d_inscription_ne_subsiste(self):
        from . import serializers

        self.assertFalse(hasattr(serializers, 'RegisterSerializer'))

    def test_aucune_vue_d_inscription_ne_subsiste(self):
        from . import views

        self.assertFalse(hasattr(views, 'RegisterView'))

    def test_aucune_route_d_auth_ne_cree_de_compte(self):
        """L'ancienne inscription créait une organisation et son admin : plus de trace.

        On vérifie qu'aucune des routes `/api/auth/` restantes ne porte un nom
        d'inscription — seules subsistent connexion, mots de passe et préférences.
        """
        from . import urls as auth_urls

        noms = {pattern.name for pattern in auth_urls.urlpatterns}
        self.assertNotIn('register', noms)
        self.assertIn('login', noms)


class HelperIsApplicationAdminTests(TestCase):
    """Le prédicat partagé qui porte la règle."""

    def test_super_admin_en_releve(self):
        self.assertTrue(is_application_admin(make_user('s@example.com', is_superuser=True)))

    def test_admin_systeme_en_releve(self):
        user = make_user('a@example.com', platform_role='ROLE_ADMIN_SYSTEME')
        self.assertTrue(is_application_admin(user))

    def test_admin_organisation_n_en_releve_pas(self):
        org = Organization.objects.create(code='ORG-H', name='Org H')
        user = make_user('oa@example.com')
        Membership.objects.create(user=user, organization=org, role='ROLE_ORGANISATION_ADMIN')
        self.assertFalse(is_application_admin(user))

    def test_agent_n_en_releve_pas(self):
        self.assertFalse(is_application_admin(make_user('ag@example.com')))

    def test_anonyme_n_en_releve_pas(self):
        from django.contrib.auth.models import AnonymousUser

        self.assertFalse(is_application_admin(AnonymousUser()))
        self.assertFalse(is_application_admin(None))


class CreationDeCompteRBACTests(TestCase):
    """`POST /api/v1/users/` est réservé à l'administration de l'application."""

    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(code='ORG-1', name='Organisation 1')

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

    def payload(self, email, role='ROLE_ORGANISATION_AGENT', with_org=True):
        data = {
            'email': email,
            'first_name': 'Nou',
            'last_name': 'Veau',
            'password': 'Passw0rd!2026',
            'role': role,
        }
        if with_org:
            data['organization_id'] = str(self.org.id)
        return data

    # --- Refus ---------------------------------------------------------------

    def test_anonyme_refuse(self):
        resp = self.client.post(USERS_URL, self.payload('x1@example.com'), format='json')

        self.assertEqual(resp.status_code, 401)
        self.assertFalse(User.objects.filter(email='x1@example.com').exists())

    def test_agent_refuse_en_403(self):
        self.client.force_authenticate(self.agent)

        resp = self.client.post(USERS_URL, self.payload('x2@example.com'), format='json')

        self.assertEqual(resp.status_code, 403)
        self.assertFalse(User.objects.filter(email='x2@example.com').exists())

    def test_admin_organisation_refuse_en_403(self):
        """Le cœur de la règle : un Admin Organisation ne crée plus d'agent."""
        self.client.force_authenticate(self.org_admin)

        resp = self.client.post(USERS_URL, self.payload('x3@example.com'), format='json')

        self.assertEqual(resp.status_code, 403)
        self.assertFalse(User.objects.filter(email='x3@example.com').exists())

    def test_admin_organisation_ne_cree_pas_non_plus_un_admin_org(self):
        self.client.force_authenticate(self.org_admin)

        resp = self.client.post(
            USERS_URL,
            self.payload('x4@example.com', role='ROLE_ORGANISATION_ADMIN'),
            format='json',
        )

        self.assertEqual(resp.status_code, 403)
        self.assertFalse(User.objects.filter(email='x4@example.com').exists())

    def test_le_message_de_refus_est_explicite(self):
        self.client.force_authenticate(self.org_admin)

        resp = self.client.post(USERS_URL, self.payload('x5@example.com'), format='json')

        self.assertIn('Super Admin', resp.data['detail'])
        self.assertIn('Admin Système', resp.data['detail'])

    def test_admin_systeme_ne_cree_pas_d_admin_systeme(self):
        self.client.force_authenticate(self.admin_systeme)

        resp = self.client.post(
            USERS_URL,
            self.payload('x6@example.com', role='ROLE_ADMIN_SYSTEME', with_org=False),
            format='json',
        )

        self.assertEqual(resp.status_code, 400)
        self.assertIn('Super Admin', str(resp.data['role']))
        self.assertFalse(User.objects.filter(email='x6@example.com').exists())

    # --- Autorisations -------------------------------------------------------

    def test_super_admin_cree_un_agent(self):
        self.client.force_authenticate(self.superadmin)

        resp = self.client.post(USERS_URL, self.payload('ok1@example.com'), format='json')

        self.assertEqual(resp.status_code, 201)
        cree = User.objects.get(email='ok1@example.com')
        self.assertEqual(cree.get_primary_role(), 'ROLE_ORGANISATION_AGENT')
        self.assertEqual(cree.created_by, self.superadmin)

    def test_super_admin_cree_un_admin_organisation(self):
        self.client.force_authenticate(self.superadmin)

        resp = self.client.post(
            USERS_URL,
            self.payload('ok2@example.com', role='ROLE_ORGANISATION_ADMIN'),
            format='json',
        )

        self.assertEqual(resp.status_code, 201)
        self.assertEqual(
            User.objects.get(email='ok2@example.com').get_primary_role(),
            'ROLE_ORGANISATION_ADMIN',
        )

    def test_super_admin_cree_un_admin_systeme(self):
        self.client.force_authenticate(self.superadmin)

        resp = self.client.post(
            USERS_URL,
            self.payload('ok3@example.com', role='ROLE_ADMIN_SYSTEME', with_org=False),
            format='json',
        )

        self.assertEqual(resp.status_code, 201)
        self.assertTrue(User.objects.get(email='ok3@example.com').is_platform_admin())

    def test_admin_systeme_cree_un_agent(self):
        self.client.force_authenticate(self.admin_systeme)

        resp = self.client.post(USERS_URL, self.payload('ok4@example.com'), format='json')

        self.assertEqual(resp.status_code, 201)
        self.assertEqual(
            User.objects.get(email='ok4@example.com').get_primary_role(),
            'ROLE_ORGANISATION_AGENT',
        )

    def test_admin_systeme_cree_un_admin_organisation(self):
        """Régression : ce cas était refusé à tort alors que le rôle l'autorise."""
        self.client.force_authenticate(self.admin_systeme)

        resp = self.client.post(
            USERS_URL,
            self.payload('ok5@example.com', role='ROLE_ORGANISATION_ADMIN'),
            format='json',
        )

        self.assertEqual(resp.status_code, 201)
        self.assertEqual(
            User.objects.get(email='ok5@example.com').get_primary_role(),
            'ROLE_ORGANISATION_ADMIN',
        )

    def test_admin_systeme_peut_rattacher_a_n_importe_quelle_organisation(self):
        autre = Organization.objects.create(code='ORG-2', name='Organisation 2')
        self.client.force_authenticate(self.admin_systeme)

        data = self.payload('ok6@example.com')
        data['organization_id'] = str(autre.id)
        resp = self.client.post(USERS_URL, data, format='json')

        self.assertEqual(resp.status_code, 201)
        self.assertEqual(
            User.objects.get(email='ok6@example.com').get_primary_organization(), autre,
        )

    # --- La lecture reste ouverte -------------------------------------------

    def test_admin_organisation_peut_toujours_lister_ses_agents(self):
        """Le verrou ne porte que sur POST : la liste reste accessible."""
        self.client.force_authenticate(self.org_admin)

        resp = self.client.get(USERS_URL)

        self.assertEqual(resp.status_code, 200)

    def test_admin_organisation_peut_toujours_modifier_un_agent(self):
        self.client.force_authenticate(self.org_admin)

        resp = self.client.patch(
            f'{USERS_URL}{self.agent.pk}/', {'first_name': 'Modifié'}, format='json',
        )

        self.assertEqual(resp.status_code, 200)
        self.agent.refresh_from_db()
        self.assertEqual(self.agent.first_name, 'Modifié')
