"""
Quotas de stockage par organisation.

Couvre les trois états du champ `Organization.storage_quota_bytes` (NULL = défaut
global, 0 = illimité, N = plafond), le calcul de consommation, l'application du quota
aux téléversements, et le fait que SEUL le super administrateur peut arbitrer un
plafond — un Admin Système administre les organisations mais pas leurs limites.

Un test verrouille aussi la **cohérence** entre `analytics.quotas` (agrégats rapides,
appelés à chaque upload) et `analytics.services` (parcours complet du tableau de bord) :
les deux doivent compter les mêmes octets, sans quoi l'opérateur verrait un total sur
son tableau de bord et serait bloqué à un autre.
"""
from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from accounts.models import Membership, Organization
from analytics.quotas import (effective_quota_bytes, ensure_within_quota, human_bytes,
                              organization_of_user, organization_usage_bytes,
                              organization_user_ids, quota_state)
from analytics.services import compute_storage_overview
from pieces.models import Piece, PieceImage
from projects.models import Affaire, Projet, Propriete, Ssdgps

User = get_user_model()


def image_bytes(taille=(40, 40)):
    buf = BytesIO()
    Image.new('RGB', taille, (10, 90, 180)).save(buf, format='PNG')
    return buf.getvalue()


class QuotaBaseTest(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(code='ORG-Q', name='Org Quota')
        self.autre_org = Organization.objects.create(code='ORG-A', name='Autre Org')

        self.agent = self._membre('agent@q.ma', self.org, 'ROLE_ORGANISATION_AGENT')
        self.agent_autre = self._membre('agent@a.ma', self.autre_org,
                                        'ROLE_ORGANISATION_AGENT')
        self.super_admin = User.objects.create_superuser(
            username='super@q.ma', email='super@q.ma', password='Passw0rd!')
        self.admin_systeme = User.objects.create_user(
            username='sys@q.ma', email='sys@q.ma', password='Passw0rd!',
            platform_role='ROLE_ADMIN_SYSTEME')

        self.ssdgps = self._ssdgps(self.agent)
        self.client = APIClient()

    def _membre(self, email, org, role):
        u = User.objects.create_user(username=email, email=email, password='Passw0rd!')
        Membership.objects.create(user=u, organization=org, role=role)
        return u

    def _ssdgps(self, createur, numero=1):
        projet = Projet.objects.create(nom_projet='P', code_projet=f'P-{numero}',
                                       organization=self.org, created_by=createur)
        propriete = Propriete.objects.create(nom_propriete='X', id_requisition='R1/55',
                                             projet=projet)
        affaire = Affaire.objects.create(numero_sd_affaire=1, nature_procedure_affaire='IFF',
                                         nature_affaire='BI', date_bornage='2023-04-09',
                                         propriete=propriete)
        return Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=numero,
                                     type_ssdgps='multi-session', affaire=affaire)

    def _piece_avec_fichier(self, octets):
        piece = Piece.objects.create(ssdgps=self.ssdgps, type_piece='LPA', numero=1,
                                     source_saisie='manuel', created_by=self.agent,
                                     taille_octets=octets)
        piece.fichier.save('data.csv', SimpleUploadedFile('data.csv', b'a'), save=True)
        Piece.objects.filter(pk=piece.pk).update(taille_octets=octets)
        return piece


class SemantiqueQuotaTests(QuotaBaseTest):

    def test_null_retombe_sur_le_defaut_global(self):
        self.org.storage_quota_bytes = None
        with override_settings(DEFAULT_ORGANIZATION_STORAGE_QUOTA_BYTES=5000):
            self.assertEqual(effective_quota_bytes(self.org), 5000)

    def test_zero_signifie_illimite(self):
        self.org.storage_quota_bytes = 0
        with override_settings(DEFAULT_ORGANIZATION_STORAGE_QUOTA_BYTES=5000):
            # 0 est un arbitrage EXPLICITE : il prime sur le défaut global.
            self.assertEqual(effective_quota_bytes(self.org), 0)
            self.assertTrue(quota_state(self.org)['is_unlimited'])

    def test_valeur_positive_est_le_plafond(self):
        self.org.storage_quota_bytes = 1234
        self.assertEqual(effective_quota_bytes(self.org), 1234)


class ConsommationTests(QuotaBaseTest):

    def test_compte_les_fichiers_de_pieces(self):
        self._piece_avec_fichier(4096)
        self.assertGreaterEqual(organization_usage_bytes(self.org.pk), 4096)

    def test_n_impute_pas_les_autres_organisations(self):
        self._piece_avec_fichier(4096)
        self.assertEqual(organization_usage_bytes(self.autre_org.pk), 0)

    def test_organisation_principale_unique_pour_un_membre_multiple(self):
        """Un utilisateur membre de deux organisations n'est compté que dans la
        première (adhésion active la plus ancienne) — sinon son volume serait imputé
        deux fois."""
        Membership.objects.create(user=self.agent, organization=self.autre_org,
                                  role='ROLE_ORGANISATION_AGENT')
        self.assertIn(self.agent.id, organization_user_ids(self.org.pk))
        self.assertNotIn(self.agent.id, organization_user_ids(self.autre_org.pk))

    def test_coherence_avec_la_ventilation_du_tableau_de_bord(self):
        """Garde-fou : quotas et tableau de bord doivent compter les mêmes octets."""
        self._piece_avec_fichier(4096)
        PieceImage.objects.create(
            piece=Piece.objects.first(), ordre=0, taille_octets=2048,
            fichier=SimpleUploadedFile('i.png', image_bytes(), content_type='image/png'))

        rapide = organization_usage_bytes(self.org.pk)
        complet = compute_storage_overview(organization_id=self.org.pk)['total_bytes']
        self.assertEqual(rapide, complet)

    def test_piece_supprimee_liberee_du_quota(self):
        piece = self._piece_avec_fichier(4096)
        avant = organization_usage_bytes(self.org.pk)
        piece.is_deleted = True
        piece.save(update_fields=['is_deleted'])
        self.assertLess(organization_usage_bytes(self.org.pk), avant)


class ApplicationQuotaTests(QuotaBaseTest):

    def test_sous_le_plafond_passe(self):
        self.org.storage_quota_bytes = 10_000
        ensure_within_quota(self.org, 500)          # ne lève pas

    def test_depassement_leve_une_erreur_explicite(self):
        self.org.storage_quota_bytes = 1000
        self._piece_avec_fichier(900)
        with self.assertRaises(ValidationError) as ctx:
            ensure_within_quota(self.org, 500)
        message = str(ctx.exception)
        self.assertIn('Org Quota', message)
        self.assertIn('Quota de stockage dépassé', message)

    def test_quota_illimite_ne_bloque_jamais(self):
        self.org.storage_quota_bytes = 0
        ensure_within_quota(self.org, 10 ** 12)     # ne lève pas

    def test_sans_organisation_ne_bloque_jamais(self):
        """Un super admin hors organisation ne doit pas être bloqué faute d'imputation."""
        ensure_within_quota(None, 10 ** 12)
        self.assertIsNone(organization_of_user(self.super_admin))

    def test_upload_image_refuse_au_dela_du_quota(self):
        """Bout en bout : le lot entier est refusé AVANT toute écriture."""
        self.org.storage_quota_bytes = 1
        self.org.save(update_fields=['storage_quota_bytes'])
        piece = Piece.objects.create(ssdgps=self.ssdgps, type_piece='RDC', numero=1,
                                     source_saisie='image', created_by=self.agent)
        self.client.force_authenticate(self.agent)

        resp = self.client.post(
            f'/api/v1/pieces/{piece.pk}/images/',
            {'fichiers': SimpleUploadedFile('p.png', image_bytes(), content_type='image/png')},
            format='multipart')

        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('Quota de stockage dépassé', str(resp.data['detail']))
        self.assertEqual(piece.images.count(), 0)   # rien n'a été écrit


class ApiQuotaTests(QuotaBaseTest):

    def test_super_admin_lit_la_liste(self):
        self.client.force_authenticate(self.super_admin)
        resp = self.client.get('/api/v1/organizations/storage-quotas/')
        self.assertEqual(resp.status_code, 200)
        noms = [r['organization_name'] for r in resp.data['results']]
        self.assertIn('Org Quota', noms)

    def test_admin_systeme_refuse(self):
        """Un Admin Système administre les organisations, mais pas leurs plafonds."""
        self.client.force_authenticate(self.admin_systeme)
        self.assertEqual(
            self.client.get('/api/v1/organizations/storage-quotas/').status_code, 403)

    def test_agent_refuse(self):
        self.client.force_authenticate(self.agent)
        self.assertEqual(
            self.client.get(f'/api/v1/organizations/{self.org.pk}/storage-quota/').status_code,
            403)

    def test_super_admin_fixe_un_plafond(self):
        self.client.force_authenticate(self.super_admin)
        resp = self.client.put(f'/api/v1/organizations/{self.org.pk}/storage-quota/',
                               {'storage_quota_bytes': 2048}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['effective_quota_bytes'], 2048)
        self.org.refresh_from_db()
        self.assertEqual(self.org.storage_quota_bytes, 2048)

    def test_null_remet_au_defaut_global(self):
        self.org.storage_quota_bytes = 999
        self.org.save(update_fields=['storage_quota_bytes'])
        self.client.force_authenticate(self.super_admin)
        resp = self.client.put(f'/api/v1/organizations/{self.org.pk}/storage-quota/',
                               {'storage_quota_bytes': None}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.org.refresh_from_db()
        self.assertIsNone(self.org.storage_quota_bytes)

    def test_valeur_negative_refusee(self):
        self.client.force_authenticate(self.super_admin)
        resp = self.client.put(f'/api/v1/organizations/{self.org.pk}/storage-quota/',
                               {'storage_quota_bytes': -5}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_valeur_non_entiere_refusee(self):
        self.client.force_authenticate(self.super_admin)
        resp = self.client.put(f'/api/v1/organizations/{self.org.pk}/storage-quota/',
                               {'storage_quota_bytes': 'beaucoup'}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_champ_manquant_refuse(self):
        self.client.force_authenticate(self.super_admin)
        resp = self.client.put(f'/api/v1/organizations/{self.org.pk}/storage-quota/',
                               {}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_plafond_sous_la_consommation_accepte_mais_signale(self):
        """Le super admin peut geler une organisation déjà au-delà de son nouveau plafond."""
        self._piece_avec_fichier(5000)
        self.client.force_authenticate(self.super_admin)
        resp = self.client.put(f'/api/v1/organizations/{self.org.pk}/storage-quota/',
                               {'storage_quota_bytes': 100}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data['is_exceeded'])


class LisibiliteTests(TestCase):

    def test_human_bytes(self):
        self.assertEqual(human_bytes(0), '0 octets')
        self.assertEqual(human_bytes(512), '512 octets')
        self.assertEqual(human_bytes(1024), '1 Ko')
        self.assertEqual(human_bytes(1536), '1,5 Ko')
        self.assertEqual(human_bytes(5 * 1024 ** 3), '5 Go')
