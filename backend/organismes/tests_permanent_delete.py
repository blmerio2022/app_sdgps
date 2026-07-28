"""Suppression DÉFINITIVE des organismes (unitaire + en masse).

Contrat : la purge n'est possible QUE sur un élément en corbeille (`is_deleted=True`), elle est
réservée au Super Admin / Admin Système, et un organisme de premier niveau portant encore des
organismes de deuxième niveau ACTIFS ne peut pas être purgé (purge « bottom-up »).
"""
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from organismes.models import OrganismeNiveau1, OrganismeNiveau2

User = get_user_model()


class PermanentDeleteOrganismeTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='sa@sdgps.ma', email='sa@sdgps.ma', password='X@2026',
            is_superuser=True, is_staff=True)
        if hasattr(self.admin, 'must_change_password'):
            self.admin.must_change_password = False
            self.admin.save(update_fields=['must_change_password'])
        self.client.force_authenticate(self.admin)

        self.n1 = OrganismeNiveau1.objects.create(code='N1', nom='Direction', is_deleted=True)
        self.n2 = OrganismeNiveau2.objects.create(
            code='N2', nom='Service', niveau1=self.n1, is_deleted=True)

    def _url_n1(self, pk):
        return reverse('organisme-niveau1-permanent-delete', args=[pk])

    def _url_n2(self, pk):
        return reverse('organisme-niveau2-permanent-delete', args=[pk])

    # ------------------------------------------------------------------ unitaire
    def test_purge_un_organisme_en_corbeille(self):
        resp = self.client.delete(self._url_n2(self.n2.pk))
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(OrganismeNiveau2.objects.filter(pk=self.n2.pk).exists())

    def test_refuse_la_purge_dun_element_actif(self):
        """Les outils de purge ne sont proposés que dans la corbeille : le serveur le garantit."""
        actif = OrganismeNiveau2.objects.create(
            code='N2-A', nom='Actif', niveau1=self.n1, is_deleted=False)
        resp = self.client.delete(self._url_n2(actif.pk))
        self.assertEqual(resp.status_code, 404)
        self.assertTrue(OrganismeNiveau2.objects.filter(pk=actif.pk).exists())

    def test_premier_niveau_bloque_par_ses_enfants_actifs(self):
        actif = OrganismeNiveau2.objects.create(
            code='N2-B', nom='Enfant actif', niveau1=self.n1, is_deleted=False)
        resp = self.client.delete(self._url_n1(self.n1.pk))
        self.assertEqual(resp.status_code, 400)
        self.assertIn('sous-élément', resp.json()['detail'])
        self.assertTrue(OrganismeNiveau1.objects.filter(pk=self.n1.pk).exists())
        actif.delete()

    def test_premier_niveau_bloque_meme_par_des_enfants_en_corbeille(self):
        """La FK `niveau1` est en PROTECT : une ligne enfant bloque, même supprimée
        logiquement. La purge est strictement « bottom-up » — et surtout, la contrainte
        remonte en 400 explicite, jamais en 500."""
        resp = self.client.delete(self._url_n1(self.n1.pk))
        self.assertEqual(resp.status_code, 400)
        self.assertTrue(OrganismeNiveau1.objects.filter(pk=self.n1.pk).exists())

    def test_premier_niveau_purgeable_une_fois_les_enfants_purges(self):
        self.n2.delete()
        resp = self.client.delete(self._url_n1(self.n1.pk))
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(OrganismeNiveau1.objects.filter(pk=self.n1.pk).exists())

    # ------------------------------------------------------------------ en masse
    def test_purge_en_masse(self):
        autre = OrganismeNiveau2.objects.create(
            code='N2-C', nom='Autre', niveau1=self.n1, is_deleted=True)
        url = reverse('organisme-niveau2-bulk-permanent-delete')
        resp = self.client.post(url, {'ids': [str(self.n2.pk), str(autre.pk)]}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['deleted_count'], 2)
        self.assertEqual(OrganismeNiveau2.objects.count(), 0)

    def test_purge_en_masse_ignore_les_elements_actifs(self):
        actif = OrganismeNiveau2.objects.create(
            code='N2-D', nom='Actif', niveau1=self.n1, is_deleted=False)
        url = reverse('organisme-niveau2-bulk-permanent-delete')
        resp = self.client.post(url, {'ids': [str(self.n2.pk), str(actif.pk)]}, format='json')
        self.assertEqual(resp.json()['deleted_count'], 1)
        self.assertTrue(OrganismeNiveau2.objects.filter(pk=actif.pk).exists())
        actif.delete()

    def test_purge_en_masse_signale_les_elements_conserves(self):
        """Un premier niveau bloqué est conservé et remonté dans `errors` (jamais de 500)."""
        url = reverse('organisme-niveau1-bulk-permanent-delete')
        resp = self.client.post(url, {'ids': [str(self.n1.pk)]}, format='json')
        body = resp.json()
        self.assertEqual(body['deleted_count'], 0)
        self.assertEqual(len(body['errors']), 1)
        self.assertTrue(OrganismeNiveau1.objects.filter(pk=self.n1.pk).exists())

    def test_ids_requis(self):
        url = reverse('organisme-niveau2-bulk-permanent-delete')
        self.assertEqual(self.client.post(url, {}, format='json').status_code, 400)
        self.assertEqual(self.client.post(url, {'ids': []}, format='json').status_code, 400)

    # ------------------------------------------------------------------ permissions
    def test_reserve_aux_administrateurs(self):
        simple = User.objects.create_user(
            username='u@sdgps.ma', email='u@sdgps.ma', password='X@2026')
        if hasattr(simple, 'must_change_password'):
            simple.must_change_password = False
            simple.save(update_fields=['must_change_password'])
        self.client.force_authenticate(simple)
        resp = self.client.delete(self._url_n2(self.n2.pk))
        self.assertIn(resp.status_code, (401, 403))
        self.assertTrue(OrganismeNiveau2.objects.filter(pk=self.n2.pk).exists())
