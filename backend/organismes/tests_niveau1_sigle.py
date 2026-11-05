"""Colonne « Sigle premier niveau » du tableau des organismes de DEUXIÈME niveau.

L'API expose `niveau1_sigle` (sigle de l'organisme de rattachement) et les allowlists de
colonnes / de tri de la clé `organisme_niveau2` le déclarent, condition nécessaire pour pouvoir
afficher la colonne et enregistrer la configuration du tableau.
"""
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from accounts.views import ORGANISME_N2_SORT_FIELDS, TABLE_COLUMN_FIELDS
from organismes.models import OrganismeNiveau1, OrganismeNiveau2

User = get_user_model()


class Niveau1SigleApiTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='sig@sdgps.ma', email='sig@sdgps.ma', password='X@2026',
            is_superuser=True, is_staff=True)
        if hasattr(self.admin, 'must_change_password'):
            self.admin.must_change_password = False
            self.admin.save(update_fields=['must_change_password'])
        self.client.force_authenticate(self.admin)

        self.n1 = OrganismeNiveau1.objects.create(code='N1-A', nom='Direction A', sigle='DA')
        self.n2 = OrganismeNiveau2.objects.create(
            code='N2-A', nom='Service A', niveau1=self.n1, ville='Rabat')

    def _rows(self):
        resp = self.client.get(reverse('organisme-niveau2-list'))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        return data['results'] if isinstance(data, dict) and 'results' in data else data

    def test_liste_expose_le_sigle_du_premier_niveau(self):
        row = next(r for r in self._rows() if r['code'] == 'N2-A')
        self.assertIn('niveau1_sigle', row)
        self.assertEqual(row['niveau1_sigle'], 'DA')
        # Le nom du premier niveau reste exposé (colonne distincte).
        self.assertEqual(row['niveau1_nom'], 'Direction A')

    def test_champ_present_meme_si_le_parent_na_pas_de_sigle(self):
        """Sans `allow_null`, DRF omettrait le champ et la colonne disparaîtrait du tableau."""
        n1 = OrganismeNiveau1.objects.create(code='N1-B', nom='Direction B')
        OrganismeNiveau2.objects.create(code='N2-B', nom='Service B', niveau1=n1)
        row = next(r for r in self._rows() if r['code'] == 'N2-B')
        self.assertIn('niveau1_sigle', row)
        self.assertFalse(row['niveau1_sigle'])

    def test_le_sigle_suit_le_parent(self):
        self.n1.sigle = 'NOUVEAU'
        self.n1.save(update_fields=['sigle'])
        row = next(r for r in self._rows() if r['code'] == 'N2-A')
        self.assertEqual(row['niveau1_sigle'], 'NOUVEAU')

    def test_declare_dans_les_allowlists_colonnes_et_tri(self):
        self.assertIn('niveau1_sigle', TABLE_COLUMN_FIELDS['organisme_niveau2'])
        self.assertIn('niveau1_sigle', ORGANISME_N2_SORT_FIELDS)

    def test_absent_du_premier_niveau(self):
        """Le tableau de niveau 1 n'a pas de parent : la colonne ne le concerne pas."""
        self.assertNotIn('niveau1_sigle', TABLE_COLUMN_FIELDS['organisme_niveau1'])
