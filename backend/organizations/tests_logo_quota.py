"""
Tests du logo d'organisation : validation, réduction et imputation au quota.

Le logo pèse dans la volumétrie d'une organisation
(`analytics.quotas._organization_logo_bytes`) mais n'était soumis à AUCUN contrôle :
ni format, ni plafond de fichier, ni quota. On pouvait donc dépasser le quota de
stockage par ce chemin — un quota contournable n'est pas un quota.

Mêmes règles que les photos de profil (`accounts.avatars`).
"""
from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image
from rest_framework.test import APIClient

from accounts.models import Membership, Organization

User = get_user_model()


def image_png(taille=(60, 60)):
    buf = BytesIO()
    Image.new('RGB', taille, (10, 90, 180)).save(buf, format='PNG')
    return buf.getvalue()


class LogoOrganisationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.superadmin = User.objects.create_user(
            username='super@example.com', email='super@example.com', password='Passw0rd!',
        )
        self.superadmin.is_superuser = True
        self.superadmin.is_staff = True
        self.superadmin.save()
        self.client.force_authenticate(self.superadmin)

        self.org = Organization.objects.create(code='ORG-L', name='Organisation Logo')

    def url(self):
        return f'/api/v1/organizations/{self.org.id}/'

    def envoyer_logo(self, contenu, nom='logo.png', content_type='image/png'):
        fichier = SimpleUploadedFile(nom, contenu, content_type=content_type)
        return self.client.patch(self.url(), {'logo': fichier}, format='multipart')

    # --- Validation ----------------------------------------------------------

    def test_un_logo_valide_est_accepte(self):
        resp = self.envoyer_logo(image_png())

        self.assertEqual(resp.status_code, 200, resp.data)
        self.org.refresh_from_db()
        self.assertTrue(self.org.logo)

    def test_une_extension_non_autorisee_est_refusee(self):
        resp = self.envoyer_logo(b'nimporte quoi', nom='logo.exe',
                                 content_type='application/octet-stream')

        self.assertEqual(resp.status_code, 400)
        self.assertIn('logo', resp.data)

    def test_un_fichier_qui_n_est_pas_une_image_est_refuse(self):
        resp = self.envoyer_logo(b'ceci n est pas une image', nom='logo.png')

        self.assertEqual(resp.status_code, 400)

    def test_un_logo_trop_volumineux_est_refuse(self):
        from django.test import override_settings

        with override_settings(PROFILE_PICTURE_MAX_UPLOAD_MB=0):
            resp = self.envoyer_logo(image_png())

        self.assertEqual(resp.status_code, 400)
        self.assertIn('volumineuse', str(resp.data['logo']).lower())

    # --- Réduction -----------------------------------------------------------

    def test_le_logo_est_reduit_avant_enregistrement(self):
        """Une grande image ne doit pas être stockée telle quelle."""
        grand = image_png(taille=(2000, 2000))

        resp = self.envoyer_logo(grand)

        self.assertEqual(resp.status_code, 200, resp.data)
        self.org.refresh_from_db()
        self.assertLess(self.org.logo.size, len(grand))

    # --- Quota ---------------------------------------------------------------

    def test_un_logo_depassant_le_quota_est_refuse(self):
        self.org.storage_quota_bytes = 10          # 10 octets : tout logo dépasse
        self.org.save(update_fields=['storage_quota_bytes'])
        # Le quota s'applique à l'organisation PRINCIPALE : on rattache un membre pour
        # que la consommation soit bien celle de cette organisation.
        agent = User.objects.create_user(
            username='agent@example.com', email='agent@example.com', password='Passw0rd!',
        )
        Membership.objects.create(
            user=agent, organization=self.org, role='ROLE_ORGANISATION_AGENT',
        )

        resp = self.envoyer_logo(image_png())

        self.assertEqual(resp.status_code, 400)
        self.assertIn('quota', str(resp.data).lower())
        self.org.refresh_from_db()
        self.assertFalse(self.org.logo)

    def test_un_quota_illimite_laisse_passer(self):
        self.org.storage_quota_bytes = 0           # 0 = illimité (cf. quotas.py)
        self.org.save(update_fields=['storage_quota_bytes'])

        resp = self.envoyer_logo(image_png())

        self.assertEqual(resp.status_code, 200, resp.data)

    def test_un_quota_large_laisse_passer(self):
        self.org.storage_quota_bytes = 50 * 1024 * 1024
        self.org.save(update_fields=['storage_quota_bytes'])

        resp = self.envoyer_logo(image_png())

        self.assertEqual(resp.status_code, 200, resp.data)

    def test_le_logo_compte_dans_la_consommation(self):
        from analytics.quotas import organization_usage_bytes

        avant = organization_usage_bytes(self.org.pk)
        self.envoyer_logo(image_png())

        self.assertGreater(organization_usage_bytes(self.org.pk), avant)

    def test_retirer_le_logo_reste_possible(self):
        self.envoyer_logo(image_png())

        resp = self.client.patch(self.url(), {'logo': ''}, format='multipart')

        self.assertEqual(resp.status_code, 200, resp.data)
        self.org.refresh_from_db()
        self.assertFalse(self.org.logo)
