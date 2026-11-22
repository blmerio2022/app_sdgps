"""
Code projet généré automatiquement, et titre / réquisition acceptés avec ou sans leur
lettre de tête (T / R).
"""
from unittest import mock

from django.db import IntegrityError
from django.utils import timezone

from projects.codes import creer_avec_code, prochain_code
from projects.models import Projet, Propriete
from projects.tests_domain import DomainBaseTest
from projects.validators import REQUISITION_RE, TITRE_RE, normaliser_identifiant

ANNEE = timezone.localdate().year


class CodeProjetTests(DomainBaseTest):
    URL = '/api/v1/projets/'

    def _creer(self, **extra):
        return self.client.post(self.URL, {'nom_projet': 'Densification', 'organization': str(self.org1.id),
                                           **extra}, format='json')

    def test_code_genere_quand_il_est_vide_ou_absent(self):
        r1 = self._creer()
        self.assertEqual(r1.status_code, 201, r1.content)
        self.assertEqual(r1.data['code_projet'], f'PRJ-{ANNEE}-001')
        r2 = self._creer(code_projet='  ')
        self.assertEqual(r2.data['code_projet'], f'PRJ-{ANNEE}-002')

    def test_numero_suit_le_plus_grand_meme_supprime(self):
        Projet.objects.create(nom_projet='X', code_projet=f'PRJ-{ANNEE}-007', organization=self.org1,
                              is_deleted=True)
        Projet.objects.create(nom_projet='Y', code_projet='CODE-LIBRE', organization=self.org1)
        self.assertEqual(prochain_code(), f'PRJ-{ANNEE}-008')
        self.assertEqual(prochain_code(2030), 'PRJ-2030-001')

    def test_code_saisi_conserve_et_unicite(self):
        self.assertEqual(self._creer(code_projet='AZ-01').data['code_projet'], 'AZ-01')
        self.assertEqual(self._creer(code_projet='AZ-01').status_code, 400)

    def test_code_ne_peut_pas_etre_vide_en_modification(self):
        p = self._projet(code='P-9')
        resp = self.client.patch(f'{self.URL}{p.id}/', {'code_projet': ''}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_course_rattrapee(self):
        """Un autre a pris le code entre le calcul et l'insertion : on réessaie au suivant."""
        Projet.objects.create(nom_projet='Concurrent', code_projet=f'PRJ-{ANNEE}-001', organization=self.org1)
        creer = lambda code: Projet.objects.create(nom_projet='Moi', code_projet=code, organization=self.org1)
        with mock.patch('projects.codes.prochain_code',
                        side_effect=[f'PRJ-{ANNEE}-001', f'PRJ-{ANNEE}-002']):
            self.assertEqual(creer_avec_code(creer).code_projet, f'PRJ-{ANNEE}-002')


class IdentifiantsProprieteTests(DomainBaseTest):
    URL = '/api/v1/proprietes/'

    def test_expressions(self):
        for ok in ('T12345/A', '12345/A', 'T12345/12', '12345/1'):
            self.assertTrue(TITRE_RE.match(ok), ok)
        for ok in ('R19000/55', '19000/55', 'R19000/AB', '19000/AB'):
            self.assertTrue(REQUISITION_RE.match(ok), ok)
        for ko in ('X12345/A', 'T/A', '12345', 'R19000/ABC'):
            self.assertFalse(TITRE_RE.match(ko) or REQUISITION_RE.match(ko), ko)
        self.assertEqual(normaliser_identifiant(' r 19000/ab '), 'R19000/AB')

    def _creer(self, **ids):
        return self.client.post(self.URL, {
            'nom_propriete': 'Terrain', 'projet': str(self._projet().id),
            'organisme_niveau1': str(self.on1.id), 'organisme_niveau2': str(self.on2.id), **ids,
        }, format='json')

    def test_sans_lettre_de_tete_accepte(self):
        resp = self._creer(id_titre='12345/a', id_requisition='19000/55')
        self.assertEqual(resp.status_code, 201, resp.content)
        p = Propriete.objects.get(pk=resp.data['id'])
        self.assertEqual((p.id_titre, p.id_requisition), ('12345/A', '19000/55'))

    def test_avec_lettre_et_saisie_normalisee(self):
        resp = self._creer(id_titre='t 12345/a')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.data['id_titre'], 'T12345/A')

    def test_format_invalide_refuse(self):
        resp = self._creer(id_requisition='Z19000/55')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('[R]', str(resp.data))


from projects.tests_modeles_assistant import BaseTest as AssistantBaseTest, URL_ASSISTANT  # noqa: E402


class AssistantCodeEtIdentifiantsTests(AssistantBaseTest):
    def test_assistant_sans_code_et_titre_sans_lettre(self):
        corps = self.corps()
        corps['projet'] = {'nouveau': {'nom_projet': 'Projet assistant'}}
        corps['propriete']['nouveau']['id_titre'] = '1234/a'
        self.client.force_authenticate(self.agent)
        resp = self.client.post(URL_ASSISTANT, corps, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        projet = Projet.objects.get(nom_projet='Projet assistant')
        self.assertEqual(projet.code_projet, f'PRJ-{ANNEE}-001')
        self.assertTrue(Propriete.objects.filter(projet=projet, id_titre='1234/A').exists())
