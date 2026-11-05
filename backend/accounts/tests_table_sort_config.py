"""Tests du tri MULTI-NIVEAUX GÉNÉRIQUE par tableau (`table_sort_configs`).

Mécanisme mutualisé (un champ dict + un couple de vues) pour les listes qui n'ont pas de champ
dédié : utilisateurs, projets, explorateur de projet, ... Même contrat que les vues dédiées :
validation d'allowlist par clé, déduplication, normalisation du sens, réinitialisation depuis le
super admin (source), isolation entre clés.
"""
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from accounts.piece_defaults import superadmin_table_sort_config
from accounts.views import TABLE_SORT_FIELDS

User = get_user_model()


class TableSortConfigEndpointTests(APITestCase):
    def setUp(self):
        # Pas de super admin par défaut → la source est vide sauf test dédié.
        User.objects.filter(is_superuser=True).delete()
        self.user = User.objects.create_user(
            username='u@sdgps.ma', email='u@sdgps.ma', password='Test@2026')
        if hasattr(self.user, 'must_change_password'):
            self.user.must_change_password = False
            self.user.save(update_fields=['must_change_password'])
        self.url = reverse('table-sort-config', args=['users'])
        self.reset_url = reverse('table-sort-config-reset', args=['users'])

    def test_requiert_authentification(self):
        resp = self.client.get(self.url)
        self.assertIn(resp.status_code, (401, 403))

    def test_cle_inconnue_renvoie_400(self):
        self.client.force_authenticate(self.user)
        bad = reverse('table-sort-config', args=['inconnu'])
        self.assertEqual(self.client.get(bad).status_code, 400)
        self.assertEqual(self.client.put(bad, [], format='json').status_code, 400)

    def test_put_valide_dedoublonne_normalise_puis_get_relit(self):
        self.client.force_authenticate(self.user)
        payload = [
            {'field': 'email', 'dir': 'desc'},
            {'field': 'role', 'dir': 'weird'},   # sens non 'desc' → normalisé 'asc'
            {'field': 'email', 'dir': 'asc'},     # doublon → ignoré
        ]
        resp = self.client.put(self.url, payload, format='json')
        self.assertEqual(resp.status_code, 200)
        expected = [{'field': 'email', 'dir': 'desc'}, {'field': 'role', 'dir': 'asc'}]
        self.assertEqual(resp.json(), expected)
        self.assertEqual(self.client.get(self.url).json(), expected)

    def test_put_rejette_champ_hors_allowlist(self):
        self.client.force_authenticate(self.user)
        resp = self.client.put(self.url, [{'field': 'password', 'dir': 'asc'}], format='json')
        self.assertEqual(resp.status_code, 400)

    def test_put_rejette_non_liste(self):
        self.client.force_authenticate(self.user)
        resp = self.client.put(self.url, {'field': 'email'}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_cles_isolees_dans_le_dictionnaire(self):
        """Écrire une clé ne doit pas écraser les autres entrées du dictionnaire."""
        self.client.force_authenticate(self.user)
        self.client.put(self.url, [{'field': 'email', 'dir': 'asc'}], format='json')
        proj_url = reverse('table-sort-config', args=['projects'])
        self.client.put(proj_url, [{'field': 'nom_projet', 'dir': 'desc'}], format='json')
        self.assertEqual(self.client.get(self.url).json(), [{'field': 'email', 'dir': 'asc'}])
        self.assertEqual(self.client.get(proj_url).json(), [{'field': 'nom_projet', 'dir': 'desc'}])

    def test_reset_copie_la_source_super_admin(self):
        admin = User.objects.create_user(
            username='s@sdgps.ma', email='s@sdgps.ma', password='X@2026',
            is_superuser=True, is_staff=True)
        admin.table_sort_configs = {'users': [{'field': 'date_joined', 'dir': 'desc'}]}
        admin.save(update_fields=['table_sort_configs'])
        self.assertEqual(superadmin_table_sort_config('users'),
                         [{'field': 'date_joined', 'dir': 'desc'}])
        self.client.force_authenticate(self.user)
        resp = self.client.post(self.reset_url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [{'field': 'date_joined', 'dir': 'desc'}])

    def test_reset_sans_source_renvoie_400(self):
        # Aucun super admin → aucune source.
        self.client.force_authenticate(self.user)
        resp = self.client.post(self.reset_url)
        self.assertEqual(resp.status_code, 400)

    def test_registry_non_vide(self):
        # Garde-fou : les clés attendues sont déclarées.
        for key in ('users', 'projects', 'project_proprietes', 'project_affaires',
                    'project_ssdgps', 'project_sessions'):
            self.assertIn(key, TABLE_SORT_FIELDS)

    def test_explorateur_trie_sur_identifiant_et_compteur_de_pieces(self):
        # Colonnes « ID propriété » et « Pièces » de l'explorateur de projet.
        self.assertIn('id_propriete', TABLE_SORT_FIELDS['project_proprietes'])
        self.assertIn('nbr_total_pieces', TABLE_SORT_FIELDS['project_proprietes'])
        self.assertIn('nbr_total_pieces', TABLE_SORT_FIELDS['project_affaires'])
