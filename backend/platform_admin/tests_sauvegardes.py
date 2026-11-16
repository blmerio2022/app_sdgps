"""
Sauvegardes : création (base, fichiers en option), liste, téléchargement, rétention,
droits (suppression / restauration : Super Admin), restauration complète avec sauvegarde
de sécurité, confirmation par le nom exact de l'environnement.
"""
import io
import json
import shutil
import tempfile
import zipfile
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import AuditEvent, Organization
from platform_admin import sauvegardes

User = get_user_model()
MDP = 'Passw0rd!Sur'


class _MediaTemporaire:
    def setUp(self):
        super().setUp()
        self._media = tempfile.mkdtemp()
        self._surcharge = override_settings(MEDIA_ROOT=self._media, ENVIRONMENT='development')
        self._surcharge.enable()

    def tearDown(self):
        self._surcharge.disable()
        shutil.rmtree(self._media, ignore_errors=True)
        super().tearDown()


class SauvegardesApiTests(_MediaTemporaire, TestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.sa = User.objects.create_superuser(username='sa@x.ma', email='sa@x.ma', password=MDP)
        self.sys = User.objects.create_user(username='s@x.ma', email='s@x.ma', password=MDP,
                                            platform_role='ROLE_ADMIN_SYSTEME')
        self.agent = User.objects.create_user(username='a@x.ma', email='a@x.ma', password=MDP)

    def test_creation_liste_telechargement(self):
        self.client.force_authenticate(self.sys)
        etat = self.client.get('/api/v1/platform-admin/sauvegardes/').data
        self.assertTrue(etat['en_retard'])
        r = self.client.post('/api/v1/platform-admin/sauvegardes/', {}, format='json')
        self.assertEqual(r.status_code, 201)
        nom = r.data['nom']
        etat = self.client.get('/api/v1/platform-admin/sauvegardes/').data
        self.assertFalse(etat['en_retard'])
        self.assertEqual(etat['derniere']['nom'], nom)
        rep = self.client.get(f'/api/v1/platform-admin/sauvegardes/{nom}/')
        zf = zipfile.ZipFile(io.BytesIO(b''.join(rep.streaming_content)))
        manifeste = json.loads(zf.read('manifeste.json'))
        self.assertGreater(manifeste['objets'], 0)
        self.assertIn('accounts.customuser', zf.read('donnees.json').decode())
        actions = set(AuditEvent.objects.values_list('action', flat=True))
        self.assertTrue({AuditEvent.ACTION_SAUVEGARDE, AuditEvent.ACTION_SAUVEGARDE_TELECHARGEE} <= actions)

    def test_medias_inclus_mais_pas_les_sauvegardes(self):
        import os
        os.makedirs(os.path.join(self._media, 'pieces'))
        with open(os.path.join(self._media, 'pieces', 'a.jpg'), 'wb') as f:
            f.write(b'JPEG')
        sauvegardes.creer()
        res = sauvegardes.creer(avec_medias=True)
        self.assertEqual(res['medias'], 1)

    def test_droits(self):
        self.client.force_authenticate(self.agent)
        self.assertEqual(self.client.get('/api/v1/platform-admin/sauvegardes/').status_code, 403)
        nom = sauvegardes.creer()['nom']
        self.client.force_authenticate(self.sys)
        self.assertEqual(self.client.delete(f'/api/v1/platform-admin/sauvegardes/{nom}/').status_code, 403)
        self.assertEqual(self.client.post(f'/api/v1/platform-admin/sauvegardes/{nom}/restaurer/',
                                          {'confirmation': 'development'}, format='json').status_code, 403)
        self.client.force_authenticate(self.sa)
        self.assertEqual(self.client.delete(f'/api/v1/platform-admin/sauvegardes/{nom}/').status_code, 204)

    def test_nom_invalide(self):
        self.client.force_authenticate(self.sys)
        self.assertEqual(self.client.get('/api/v1/platform-admin/sauvegardes/settings.py/').status_code, 404)
        with self.assertRaises(sauvegardes.SauvegardeErreur):
            sauvegardes.chemin('../x.zip')

    def test_retention(self):
        from unittest import mock
        noms = []
        for i in range(4):
            with mock.patch('django.utils.timezone.localtime') as lt:
                lt.return_value.strftime.return_value = f'20261116-00000{i}'
                noms.append(sauvegardes.creer()['nom'])
        self.assertEqual(len(sauvegardes.purger(2)), 2)
        self.assertEqual([s['nom'] for s in sauvegardes.lister()], noms[:1:-1])

    def test_commande(self):
        sortie = StringIO()
        call_command('sauvegarder', '--retention', '5', stdout=sortie)
        self.assertIn('Sauvegarde créée', sortie.getvalue())


class RestaurationTests(_MediaTemporaire, TransactionTestCase):
    def test_restauration_complete(self):
        sa = User.objects.create_superuser(username='sa@x.ma', email='sa@x.ma', password=MDP)
        Organization.objects.create(code='AVANT', name='Avant')
        nom = sauvegardes.creer()['nom']
        Organization.objects.create(code='APRES', name='Après')
        client = APIClient()
        client.force_authenticate(sa)
        r = client.post(f'/api/v1/platform-admin/sauvegardes/{nom}/restaurer/', {'confirmation': 'production'},
                        format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('development', r.data['detail'])
        r = client.post(f'/api/v1/platform-admin/sauvegardes/{nom}/restaurer/', {'confirmation': 'development'},
                        format='json')
        self.assertEqual(r.status_code, 200, r.data)
        codes = set(Organization.all_objects.values_list('code', flat=True))
        self.assertIn('AVANT', codes)
        self.assertNotIn('APRES', codes)
        self.assertTrue(r.data['sauvegarde_securite'].endswith('-securite.zip'))
        self.assertTrue(AuditEvent.objects.filter(action=AuditEvent.ACTION_SAUVEGARDE_RESTAUREE,
                                                  acteur_email='sa@x.ma').exists())
