"""Tests du tri MULTI-NIVEAUX des listes d'ORGANISMES (`organisme_niveau1_sort_config` /
`organisme_niveau2_sort_config`).

Miroir du tri des organisations : valeur par défaut héritée du super admin (source), endpoints
GET/PUT/reset par niveau avec validation d'allowlist, déduplication et normalisation du sens.
"""
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from accounts.piece_defaults import (
    DEFAULT_ORGANISME_N1_SORT_CONFIG, DEFAULT_ORGANISME_N2_SORT_CONFIG,
    default_organisme_niveau1_sort_config, default_organisme_niveau2_sort_config,
)

User = get_user_model()


class OrganismeSortDefaultTests(TestCase):
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
        self.assertEqual(default_organisme_niveau1_sort_config(), DEFAULT_ORGANISME_N1_SORT_CONFIG)
        self.assertEqual(default_organisme_niveau2_sort_config(), DEFAULT_ORGANISME_N2_SORT_CONFIG)

    def test_source_super_admin(self):
        cfg1 = [{'field': 'nom', 'dir': 'desc'}, {'field': 'code', 'dir': 'asc'}]
        cfg2 = [{'field': 'niveau1_nom', 'dir': 'asc'}, {'field': 'ville', 'dir': 'desc'}]
        admin = self._oldest_super_admin()
        admin.organisme_niveau1_sort_config = cfg1
        admin.organisme_niveau2_sort_config = cfg2
        admin.save(update_fields=['organisme_niveau1_sort_config', 'organisme_niveau2_sort_config'])
        self.assertEqual(default_organisme_niveau1_sort_config(), cfg1)
        self.assertEqual(default_organisme_niveau2_sort_config(), cfg2)

    def test_repli_si_config_super_admin_vide(self):
        admin = self._oldest_super_admin()
        admin.organisme_niveau1_sort_config = []
        admin.organisme_niveau2_sort_config = []
        admin.save(update_fields=['organisme_niveau1_sort_config', 'organisme_niveau2_sort_config'])
        self.assertEqual(default_organisme_niveau1_sort_config(), DEFAULT_ORGANISME_N1_SORT_CONFIG)
        self.assertEqual(default_organisme_niveau2_sort_config(), DEFAULT_ORGANISME_N2_SORT_CONFIG)


class OrganismeSortConfigEndpointTests(APITestCase):
    def setUp(self):
        # Pas de super admin par défaut → la source est vide sauf test dédié.
        User.objects.filter(is_superuser=True).delete()
        self.user = User.objects.create_user(
            username='u@sdgps.ma', email='u@sdgps.ma', password='Test@2026')
        if hasattr(self.user, 'must_change_password'):
            self.user.must_change_password = False
            self.user.save(update_fields=['must_change_password'])

    def _url(self, niveau):
        return reverse('organisme-sort-config', args=[niveau])

    def _reset_url(self, niveau):
        return reverse('organisme-sort-config-reset', args=[niveau])

    def test_requiert_authentification(self):
        resp = self.client.get(self._url(1))
        self.assertIn(resp.status_code, (401, 403))

    def test_niveau_invalide_renvoie_400(self):
        self.client.force_authenticate(self.user)
        resp = self.client.get(self._url(3))
        self.assertEqual(resp.status_code, 400)

    def test_put_niveau1_valide_dedoublonne_normalise_puis_get_relit(self):
        self.client.force_authenticate(self.user)
        payload = [
            {'field': 'nom', 'dir': 'desc'},
            {'field': 'code', 'dir': 'weird'},   # sens non 'desc' → normalisé 'asc'
            {'field': 'nom', 'dir': 'asc'},        # doublon → ignoré
        ]
        resp = self.client.put(self._url(1), payload, format='json')
        self.assertEqual(resp.status_code, 200)
        expected = [{'field': 'nom', 'dir': 'desc'}, {'field': 'code', 'dir': 'asc'}]
        self.assertEqual(resp.json(), expected)
        self.assertEqual(self.client.get(self._url(1)).json(), expected)

    def test_put_niveau2_accepte_champs_specifiques(self):
        self.client.force_authenticate(self.user)
        payload = [{'field': 'niveau1_nom', 'dir': 'asc'}, {'field': 'ville', 'dir': 'desc'}]
        resp = self.client.put(self._url(2), payload, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), payload)

    def test_configs_niveaux_independantes(self):
        self.client.force_authenticate(self.user)
        self.client.put(self._url(1), [{'field': 'code', 'dir': 'asc'}], format='json')
        self.client.put(self._url(2), [{'field': 'ville', 'dir': 'desc'}], format='json')
        self.assertEqual(self.client.get(self._url(1)).json(), [{'field': 'code', 'dir': 'asc'}])
        self.assertEqual(self.client.get(self._url(2)).json(), [{'field': 'ville', 'dir': 'desc'}])

    def test_put_niveau1_rejette_champ_du_niveau2(self):
        # `niveau1_nom`/`ville` ne sont pas triables pour le niveau 1.
        self.client.force_authenticate(self.user)
        resp = self.client.put(self._url(1), [{'field': 'ville', 'dir': 'asc'}], format='json')
        self.assertEqual(resp.status_code, 400)

    def test_put_niveau2_rejette_champ_du_niveau1(self):
        # `nbr_niveaux2` n'existe que pour le niveau 1.
        self.client.force_authenticate(self.user)
        resp = self.client.put(self._url(2), [{'field': 'nbr_niveaux2', 'dir': 'asc'}], format='json')
        self.assertEqual(resp.status_code, 400)

    def test_put_rejette_champ_hors_allowlist(self):
        self.client.force_authenticate(self.user)
        resp = self.client.put(self._url(1), [{'field': 'password', 'dir': 'asc'}], format='json')
        self.assertEqual(resp.status_code, 400)

    def test_put_rejette_non_liste(self):
        self.client.force_authenticate(self.user)
        resp = self.client.put(self._url(1), {'field': 'nom'}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_reset_copie_la_source_super_admin(self):
        admin = User.objects.create_user(
            username='s@sdgps.ma', email='s@sdgps.ma', password='X@2026',
            is_superuser=True, is_staff=True)
        admin.organisme_niveau1_sort_config = [{'field': 'nbr_niveaux2', 'dir': 'desc'}]
        admin.save(update_fields=['organisme_niveau1_sort_config'])
        self.client.force_authenticate(self.user)
        resp = self.client.post(self._reset_url(1))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [{'field': 'nbr_niveaux2', 'dir': 'desc'}])

    def test_reset_sans_source_renvoie_400(self):
        # Aucun super admin → aucune source.
        self.client.force_authenticate(self.user)
        resp = self.client.post(self._reset_url(1))
        self.assertEqual(resp.status_code, 400)
