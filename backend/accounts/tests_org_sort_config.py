"""Tests du tri MULTI-NIVEAUX de la liste des organisations (`org_sort_config`).

Miroir du tri SSDGPS : valeur par défaut héritée du super admin (source), endpoints
GET/PUT/reset avec validation d'allowlist, déduplication et normalisation du sens.
"""
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from accounts.piece_defaults import (
    DEFAULT_ORG_SORT_CONFIG, default_org_sort_config, superadmin_org_sort_config,
)

User = get_user_model()


class OrgSortDefaultTests(TestCase):
    def _oldest_super_admin(self):
        admin = (User.objects.filter(is_superuser=True)
                 .order_by('date_joined', 'email').first())
        if admin is None:
            admin = User.objects.create_user(
                username='super@sdgps.ma', email='super@sdgps.ma',
                password='Test@2026', is_superuser=True, is_staff=True)
        return admin

    def test_repli_sans_super_admin(self):
        User.objects.filter(is_superuser=True).delete()
        self.assertEqual(default_org_sort_config(), DEFAULT_ORG_SORT_CONFIG)

    def test_source_super_admin(self):
        cfg = [{'field': 'name', 'dir': 'desc'}, {'field': 'code', 'dir': 'asc'}]
        admin = self._oldest_super_admin()
        admin.org_sort_config = cfg
        admin.save(update_fields=['org_sort_config'])
        self.assertEqual(default_org_sort_config(), cfg)

    def test_repli_si_config_super_admin_vide(self):
        admin = self._oldest_super_admin()
        admin.org_sort_config = []
        admin.save(update_fields=['org_sort_config'])
        self.assertEqual(default_org_sort_config(), DEFAULT_ORG_SORT_CONFIG)


class OrgSortConfigEndpointTests(APITestCase):
    def setUp(self):
        # Pas de super admin par défaut → la source est vide sauf test dédié.
        User.objects.filter(is_superuser=True).delete()
        self.user = User.objects.create_user(
            username='u@sdgps.ma', email='u@sdgps.ma', password='Test@2026')
        if hasattr(self.user, 'must_change_password'):
            self.user.must_change_password = False
            self.user.save(update_fields=['must_change_password'])
        self.url = reverse('org-sort-config')
        self.reset_url = reverse('org-sort-config-reset')

    def test_requiert_authentification(self):
        resp = self.client.get(self.url)
        self.assertIn(resp.status_code, (401, 403))

    def test_put_valide_dedoublonne_normalise_puis_get_relit(self):
        self.client.force_authenticate(self.user)
        payload = [
            {'field': 'name', 'dir': 'desc'},
            {'field': 'code', 'dir': 'weird'},   # sens non 'desc' → normalisé 'asc'
            {'field': 'name', 'dir': 'asc'},      # doublon → ignoré
        ]
        resp = self.client.put(self.url, payload, format='json')
        self.assertEqual(resp.status_code, 200)
        expected = [{'field': 'name', 'dir': 'desc'}, {'field': 'code', 'dir': 'asc'}]
        self.assertEqual(resp.json(), expected)
        self.assertEqual(self.client.get(self.url).json(), expected)

    def test_put_rejette_champ_hors_allowlist(self):
        self.client.force_authenticate(self.user)
        resp = self.client.put(self.url, [{'field': 'password', 'dir': 'asc'}], format='json')
        self.assertEqual(resp.status_code, 400)

    def test_put_rejette_non_liste(self):
        self.client.force_authenticate(self.user)
        resp = self.client.put(self.url, {'field': 'name'}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_reset_copie_la_source_super_admin(self):
        admin = User.objects.create_user(
            username='s@sdgps.ma', email='s@sdgps.ma', password='X@2026',
            is_superuser=True, is_staff=True)
        admin.org_sort_config = [{'field': 'member_count', 'dir': 'desc'}]
        admin.save(update_fields=['org_sort_config'])
        self.client.force_authenticate(self.user)
        resp = self.client.post(self.reset_url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [{'field': 'member_count', 'dir': 'desc'}])

    def test_reset_sans_source_renvoie_400(self):
        # Aucun super admin → aucune source.
        self.client.force_authenticate(self.user)
        resp = self.client.post(self.reset_url)
        self.assertEqual(resp.status_code, 400)
