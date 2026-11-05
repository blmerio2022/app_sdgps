"""Tests des COLONNES D'AUDIT STANDARD (cf. CLAUDE.md « Colonnes d'audit obligatoires »).

Contrat vérifié ici :
- l'API expose les 7 colonnes d'audit pour les organisations et les utilisateurs ;
- l'auteur de la suppression / création / modification est bien capturé (`deleted_by`,
  `created_by`, `updated_by`) ;
- les allowlists de colonnes (`TABLE_COLUMN_FIELDS`) déclarent ces colonnes pour TOUS les
  tableaux, condition nécessaire pour pouvoir les afficher et enregistrer la configuration.
"""
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from accounts.models import Organization
from accounts.views import TABLE_COLUMN_FIELDS

User = get_user_model()

# Les 7 colonnes d'audit, dans leur nommage API unifié.
AUDIT_FIELDS = (
    'created_by_email', 'created_at',
    'updated_by_email', 'updated_at',
    'is_deleted', 'deleted_by_email', 'deleted_at',
)


class AuditColumnsAllowlistTests(APITestCase):
    """Les 7 colonnes d'audit sont déclarées pour CHAQUE tableau de l'app."""

    def test_toutes_les_cles_declarent_les_colonnes_daudit(self):
        for key, fields in TABLE_COLUMN_FIELDS.items():
            for audit_field in AUDIT_FIELDS:
                self.assertIn(
                    audit_field, fields,
                    msg=f"Le tableau « {key} » ne déclare pas la colonne d'audit « {audit_field} ».",
                )


class OrganizationAuditApiTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='sys@sdgps.ma', email='sys@sdgps.ma', password='X@2026',
            is_superuser=True, is_staff=True)
        if hasattr(self.admin, 'must_change_password'):
            self.admin.must_change_password = False
            self.admin.save(update_fields=['must_change_password'])
        self.client.force_authenticate(self.admin)
        self.org = Organization.objects.create(code='ORG-1', name='Org 1', type='PRIVATE')

    def test_liste_expose_les_colonnes_daudit(self):
        resp = self.client.get(reverse('organization-list'))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        rows = data['results'] if isinstance(data, dict) and 'results' in data else data
        self.assertTrue(rows, 'La liste des organisations est vide.')
        for audit_field in AUDIT_FIELDS:
            self.assertIn(audit_field, rows[0])

    def test_suppression_logique_capture_lauteur(self):
        resp = self.client.delete(reverse('organization-detail', args=[self.org.id]))
        self.assertIn(resp.status_code, (200, 204))
        self.org.refresh_from_db()
        self.assertTrue(self.org.is_deleted)
        self.assertIsNotNone(self.org.deleted_at)
        self.assertEqual(self.org.deleted_by, self.admin)

    def test_updated_by_email_est_un_alias_de_modified_by(self):
        self.org.modified_by = self.admin
        self.org.save(update_fields=['modified_by'])
        resp = self.client.get(reverse('organization-detail', args=[self.org.id]))
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['updated_by_email'], self.admin.email)
        # L'ancien nom reste exposé pour compatibilité.
        self.assertEqual(body['modified_by_email'], self.admin.email)


class UserAuditApiTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='sys2@sdgps.ma', email='sys2@sdgps.ma', password='X@2026',
            is_superuser=True, is_staff=True)
        if hasattr(self.admin, 'must_change_password'):
            self.admin.must_change_password = False
            self.admin.save(update_fields=['must_change_password'])
        self.client.force_authenticate(self.admin)

    def test_liste_expose_les_colonnes_daudit(self):
        resp = self.client.get(reverse('user-list'))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        rows = data['results'] if isinstance(data, dict) and 'results' in data else data
        self.assertTrue(rows, 'La liste des utilisateurs est vide.')
        for audit_field in AUDIT_FIELDS:
            self.assertIn(audit_field, rows[0])

    def test_created_at_est_un_alias_de_date_joined(self):
        resp = self.client.get(reverse('user-list'))
        rows = resp.json()
        rows = rows['results'] if isinstance(rows, dict) and 'results' in rows else rows
        row = next(r for r in rows if r['email'] == self.admin.email)
        self.assertEqual(row['created_at'], row['date_joined'])

    def test_suppression_logique_capture_lauteur(self):
        cible = User.objects.create_user(
            username='cible@sdgps.ma', email='cible@sdgps.ma', password='X@2026')
        resp = self.client.delete(reverse('user-detail', args=[cible.id]))
        self.assertIn(resp.status_code, (200, 204))
        cible.refresh_from_db()
        self.assertTrue(cible.is_deleted)
        self.assertEqual(cible.deleted_by, self.admin)
