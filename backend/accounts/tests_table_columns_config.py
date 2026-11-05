"""Tests de la configuration des COLONNES GÉNÉRIQUE par tableau (`table_columns_configs`).

Mécanisme mutualisé (un champ dict + un couple de vues) pour TOUS les tableaux de l'app :
organisations, organismes, utilisateurs, projets, explorateur, SSDGPS, pièces. Contrat : validation
d'allowlist par clé, déduplication, normalisation de `visible` en booléen, isolation entre clés,
réinitialisation depuis le super admin (source). Miroir de `tests_table_sort_config`.
"""
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from accounts.piece_defaults import superadmin_table_columns_config
from accounts.views import TABLE_COLUMN_FIELDS

User = get_user_model()


class TableColumnsConfigEndpointTests(APITestCase):
    def setUp(self):
        # Pas de super admin par défaut → la source est vide sauf test dédié.
        User.objects.filter(is_superuser=True).delete()
        self.user = User.objects.create_user(
            username='u@sdgps.ma', email='u@sdgps.ma', password='Test@2026')
        if hasattr(self.user, 'must_change_password'):
            self.user.must_change_password = False
            self.user.save(update_fields=['must_change_password'])
        self.url = reverse('table-columns-config', args=['users'])
        self.reset_url = reverse('table-columns-config-reset', args=['users'])

    def test_requiert_authentification(self):
        resp = self.client.get(self.url)
        self.assertIn(resp.status_code, (401, 403))

    def test_get_defaut_liste_vide(self):
        self.client.force_authenticate(self.user)
        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_cle_inconnue_renvoie_400(self):
        self.client.force_authenticate(self.user)
        bad = reverse('table-columns-config', args=['inconnu'])
        self.assertEqual(self.client.get(bad).status_code, 400)
        self.assertEqual(self.client.put(bad, [], format='json').status_code, 400)

    def test_put_valide_dedoublonne_normalise_puis_get_relit(self):
        self.client.force_authenticate(self.user)
        payload = [
            {'field': 'email', 'visible': False},
            {'field': 'role'},                       # visible absent → True par défaut
            {'field': 'email', 'visible': True},      # doublon → ignoré (garde le 1er)
        ]
        resp = self.client.put(self.url, payload, format='json')
        self.assertEqual(resp.status_code, 200)
        expected = [{'field': 'email', 'visible': False}, {'field': 'role', 'visible': True}]
        self.assertEqual(resp.json(), expected)
        self.assertEqual(self.client.get(self.url).json(), expected)

    def test_put_normalise_visible_en_booleen(self):
        self.client.force_authenticate(self.user)
        resp = self.client.put(self.url, [{'field': 'email', 'visible': 1}], format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [{'field': 'email', 'visible': True}])

    def test_put_rejette_champ_hors_allowlist(self):
        self.client.force_authenticate(self.user)
        resp = self.client.put(self.url, [{'field': 'password', 'visible': True}], format='json')
        self.assertEqual(resp.status_code, 400)

    def test_put_rejette_non_liste(self):
        self.client.force_authenticate(self.user)
        resp = self.client.put(self.url, {'field': 'email'}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_cles_isolees_dans_le_dictionnaire(self):
        """Écrire une clé ne doit pas écraser les autres entrées du dictionnaire."""
        self.client.force_authenticate(self.user)
        self.client.put(self.url, [{'field': 'email', 'visible': True}], format='json')
        proj_url = reverse('table-columns-config', args=['projects'])
        self.client.put(proj_url, [{'field': 'nom_projet', 'visible': False}], format='json')
        self.assertEqual(self.client.get(self.url).json(), [{'field': 'email', 'visible': True}])
        self.assertEqual(self.client.get(proj_url).json(),
                         [{'field': 'nom_projet', 'visible': False}])

    def test_reset_copie_la_source_super_admin(self):
        admin = User.objects.create_user(
            username='s@sdgps.ma', email='s@sdgps.ma', password='X@2026',
            is_superuser=True, is_staff=True)
        admin.table_columns_configs = {'users': [{'field': 'email', 'visible': False}]}
        admin.save(update_fields=['table_columns_configs'])
        self.assertEqual(superadmin_table_columns_config('users'),
                         [{'field': 'email', 'visible': False}])
        self.client.force_authenticate(self.user)
        resp = self.client.post(self.reset_url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [{'field': 'email', 'visible': False}])

    def test_reset_sans_source_renvoie_400(self):
        # Aucun super admin → aucune source.
        self.client.force_authenticate(self.user)
        resp = self.client.post(self.reset_url)
        self.assertEqual(resp.status_code, 400)

    def test_registry_couvre_tous_les_tableaux(self):
        # Garde-fou : les 11 clés attendues sont déclarées.
        for key in ('organizations', 'organisme_niveau1', 'organisme_niveau2', 'users', 'projects',
                    'project_proprietes', 'project_affaires', 'project_ssdgps', 'project_sessions',
                    'ssdgps', 'pieces'):
            self.assertIn(key, TABLE_COLUMN_FIELDS)

    def test_explorateur_expose_identifiant_et_compteur_de_pieces(self):
        # Colonnes « ID propriété » et « Pièces » de l'explorateur de projet.
        self.assertIn('id_propriete', TABLE_COLUMN_FIELDS['project_proprietes'])
        self.assertIn('nbr_total_pieces', TABLE_COLUMN_FIELDS['project_proprietes'])
        self.assertIn('nbr_total_pieces', TABLE_COLUMN_FIELDS['project_affaires'])
