"""Ressources TBC (étude modèle, ruban) : dépôt par niveau, résolution, droits, téléchargement."""
import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import AuditEvent, Membership, Organization
from ressources.models import RessourceTbc

User = get_user_model()
URL = '/api/v1/ressources-tbc/'
MEDIA = tempfile.mkdtemp()


def fichier(nom='modele.vct', contenu=b'TBC'):
    return SimpleUploadedFile(nom, contenu)


@override_settings(MEDIA_ROOT=MEDIA, STORAGES={
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'}})
class RessourcesTbcTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(code='ORG-A', name='Cadastre A')
        self.autre = Organization.objects.create(code='ORG-B', name='Cadastre B')
        mk = lambda e, **kw: User.objects.create_user(username=e, email=e, password='Passw0rd!', **kw)
        self.superadmin = mk('su@x.ma', is_superuser=True, is_staff=True)
        self.admin_org = mk('ao@x.ma')
        Membership.objects.create(user=self.admin_org, organization=self.org, role='ROLE_ORGANISATION_ADMIN')
        self.agent = mk('ag@x.ma')
        Membership.objects.create(user=self.agent, organization=self.org, role='ROLE_ORGANISATION_AGENT')
        self.agent_b = mk('agb@x.ma')
        Membership.objects.create(user=self.agent_b, organization=self.autre, role='ROLE_ORGANISATION_AGENT')

    def deposer(self, user, type_ressource='etude_modele', org=None, nom='modele.vct', contenu=b'TBC'):
        self.client.force_authenticate(user)
        corps = {'type_ressource': type_ressource, 'fichier': fichier(nom, contenu), 'description': 'v1'}
        if org:
            corps['organisation'] = str(org.id)
        return self.client.post(URL, corps, format='multipart')

    def effective(self, user, type_ressource='etude_modele'):
        self.client.force_authenticate(user)
        r = self.client.get(URL)
        self.assertEqual(r.status_code, 200)
        return next(x for x in r.data['ressources'] if x['type_ressource'] == type_ressource)['ressource']

    def test_repli_sur_l_application_puis_ressource_de_l_organisation(self):
        self.assertIsNone(self.effective(self.agent))
        self.assertEqual(self.deposer(self.superadmin, contenu=b'APP').status_code, 201)
        self.assertEqual(self.effective(self.agent)['source'], 'application')
        r = self.deposer(self.admin_org, org=self.org, contenu=b'ORG')
        self.assertEqual(r.status_code, 201, r.data)
        mienne = self.effective(self.agent)
        self.assertEqual((mienne['source'], mienne['organisation']['nom']), ('organisation', 'Cadastre A'))
        self.assertEqual(self.effective(self.agent_b)['source'], 'application')      # autre organisation
        # Téléchargement : le contenu de l'organisation.
        self.client.force_authenticate(self.agent)
        rep = self.client.get(f"{URL}{mienne['id']}/fichier/")
        self.assertEqual(rep.status_code, 200)
        self.assertEqual(b''.join(rep.streaming_content), b'ORG')
        self.assertIn('modele.vct', rep['Content-Disposition'])
        # Retrait par l'admin de l'organisation : retour sur la ressource de l'application.
        self.client.force_authenticate(self.admin_org)
        self.assertEqual(self.client.delete(f"{URL}{mienne['id']}/").status_code, 204)
        self.assertEqual(self.effective(self.agent)['source'], 'application')
        self.assertTrue(AuditEvent.objects.filter(action=AuditEvent.ACTION_RESSOURCE_TBC).count() >= 3)

    def test_nouveau_depot_remplace_l_ancien(self):
        self.deposer(self.superadmin, contenu=b'1')
        self.deposer(self.superadmin, nom='modele2.vce', contenu=b'2')
        self.assertEqual(RessourceTbc.objects.filter(is_deleted=False).count(), 1)
        self.assertEqual(self.effective(self.agent)['nom_fichier'], 'modele2.vce')
        self.assertEqual(RessourceTbc.objects.filter(is_deleted=True).count(), 1)

    def test_droits_de_depot(self):
        self.assertEqual(self.deposer(self.agent, org=self.org).status_code, 403)          # agent
        self.assertEqual(self.deposer(self.admin_org).status_code, 403)                    # niveau application
        self.assertEqual(self.deposer(self.admin_org, org=self.autre).status_code, 403)    # autre organisation
        self.assertEqual(self.deposer(self.superadmin, org=self.autre).status_code, 201)   # admin appli : partout
        ruban = self.deposer(self.superadmin, type_ressource='ruban', nom='BLM.bin')
        self.assertEqual(ruban.status_code, 201)
        self.client.force_authenticate(self.admin_org)
        self.assertEqual(self.client.delete(f"{URL}{ruban.data['id']}/").status_code, 403)

    def test_validation_du_fichier(self):
        r = self.deposer(self.superadmin, type_ressource='ruban', nom='ruban.exe')
        self.assertEqual(r.status_code, 400)
        self.assertIn('fichier', r.data)
        self.client.force_authenticate(self.superadmin)
        self.assertEqual(self.client.post(URL, {'type_ressource': 'autre'}, format='multipart').status_code, 400)
        self.assertEqual(self.client.post(URL, {'type_ressource': 'ruban'}, format='multipart').status_code, 400)

    def test_telechargement_hors_organisation_404(self):
        r = self.deposer(self.admin_org, org=self.org)
        self.client.force_authenticate(self.agent_b)
        self.assertEqual(self.client.get(f"{URL}{r.data['id']}/fichier/").status_code, 404)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(URL).status_code, 401)

    def test_gestion_niveaux_selon_le_role(self):
        self.client.force_authenticate(self.agent)
        self.assertEqual(self.client.get(f'{URL}gestion/').status_code, 403)
        self.client.force_authenticate(self.admin_org)
        niveaux = self.client.get(f'{URL}gestion/').data['niveaux']
        self.assertEqual([n['organisation']['nom'] for n in niveaux], ['Cadastre A'])
        self.client.force_authenticate(self.superadmin)
        niveaux = self.client.get(f'{URL}gestion/').data['niveaux']
        self.assertIsNone(niveaux[0]['organisation'])
        self.assertEqual({n['organisation']['nom'] for n in niveaux[1:]}, {'Cadastre A', 'Cadastre B'})

    def test_description_modifiable(self):
        r = self.deposer(self.admin_org, org=self.org)
        self.client.force_authenticate(self.admin_org)
        r = self.client.patch(f"{URL}{r.data['id']}/", {'description': 'Version 2026'}, format='json')
        self.assertEqual(r.data['description'], 'Version 2026')
