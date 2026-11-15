"""
Journal d'audit — API de l'écran de consultation (`/api/v1/audit-events/…`).

Ce que ces tests verrouillent :
- pagination FACULTATIVE (avec `page` : `{count, results}` ; sans : liste, comme avant) ;
- filtres : recherche libre, type d'objet, plusieurs actions, journée entière, ordre ;
- synthèse (comptes par action, acteurs distincts, échecs de connexion, période) ;
- export CSV lisible par Excel, plafonné, et LUI-MÊME journalisé ;
- réservé à l'administration de l'application (Super Admin, Admin Système).
"""
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import AuditEvent, Membership, Organization

User = get_user_model()
URL = '/api/v1/audit-events/'


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class AuditEcranBase(TestCase):
    def setUp(self):
        self.api = APIClient()
        self.admin = User.objects.create_superuser(username='sa@a.ma', email='sa@a.ma', password='x')
        org = Organization.objects.create(code='ORG-A', name='Org A')
        self.admin_org = User.objects.create_user(username='ao@a.ma', email='ao@a.ma', password='x')
        Membership.objects.create(user=self.admin_org, organization=org, role='ROLE_ORGANISATION_ADMIN')
        self.api.force_authenticate(self.admin)
        self.e1 = AuditEvent.objects.create(action=AuditEvent.ACTION_CONNEXION, acteur_email='youssef@cabinet.ma',
                                            adresse_ip='10.0.0.5')
        self.e2 = AuditEvent.objects.create(action=AuditEvent.ACTION_CONNEXION_ECHEC, acteur_email='pirate@x.ma',
                                            adresse_ip='203.0.113.9')
        self.e3 = AuditEvent.objects.create(action=AuditEvent.ACTION_RAPPORT_GENERE, acteur_email='youssef@cabinet.ma',
                                            cible_type='ssdgps', cible_id='abc', cible_libelle='SDGPS 4 Ferme Zaytoun',
                                            details={'fichier': 'r.pdf'})


class ListeTests(AuditEcranBase):
    def test_pagination_facultative(self):
        r = self.api.get(URL + '?page=1&page_size=2')
        self.assertEqual(r.data['count'], 3)
        self.assertEqual(len(r.data['results']), 2)
        self.assertIsNotNone(r.data['next'])
        self.assertIsInstance(self.api.get(URL).data, list)          # appelants historiques

    def test_recherche_libre(self):
        for q, attendu in (('zaytoun', [self.e3.id]), ('203.0.113', [self.e2.id]),
                           ('youssef', [self.e3.id, self.e1.id])):
            ids = [e['id'] for e in self.api.get(URL, {'q': q}).data]
            self.assertEqual(sorted(map(str, ids)), sorted(map(str, attendu)), q)

    def test_type_d_objet_et_plusieurs_actions(self):
        self.assertEqual(len(self.api.get(URL, {'cible_type': 'ssdgps'}).data), 1)
        actions = f'{AuditEvent.ACTION_CONNEXION},{AuditEvent.ACTION_CONNEXION_ECHEC}'
        self.assertEqual(len(self.api.get(URL, {'action': actions}).data), 2)

    def test_date_seule_couvre_la_journee(self):
        aujourd_hui = self.e1.created_at.date().isoformat()
        self.assertEqual(len(self.api.get(URL, {'depuis': aujourd_hui, 'jusqu_a': aujourd_hui}).data), 3)
        self.assertEqual(len(self.api.get(URL, {'jusqu_a': '2000-01-01'}).data), 0)

    def test_ordre(self):
        desc = [e['id'] for e in self.api.get(URL).data]
        asc = [e['id'] for e in self.api.get(URL, {'ordre': 'asc'}).data]
        self.assertEqual(asc, desc[::-1])


class SyntheseEtFiltresTests(AuditEcranBase):
    def test_synthese(self):
        r = self.api.get(URL + 'synthese/')
        self.assertEqual(r.data['total'], 3)
        self.assertEqual(r.data['acteurs_distincts'], 2)
        self.assertEqual(r.data['echecs_connexion'], 1)
        self.assertEqual({a['action'] for a in r.data['par_action']},
                         {AuditEvent.ACTION_CONNEXION, AuditEvent.ACTION_CONNEXION_ECHEC,
                          AuditEvent.ACTION_RAPPORT_GENERE})
        self.assertIsNotNone(r.data['premier'])
        # La synthèse suit les filtres.
        self.assertEqual(self.api.get(URL + 'synthese/', {'q': 'pirate'}).data['total'], 1)

    def test_filtres_proposes(self):
        r = self.api.get(URL + 'filtres/')
        self.assertEqual(r.data['types_cible'], ['ssdgps'])
        self.assertEqual(len(r.data['actions']), len(AuditEvent.ACTIONS))


class ExportTests(AuditEcranBase):
    def test_csv_lisible_et_journalise(self):
        r = self.api.get(URL + 'export/', {'q': 'youssef'})
        self.assertEqual(r.status_code, 200)
        self.assertIn('attachment; filename="journal-audit-', r['Content-Disposition'])
        texte = r.content.decode('utf-8')
        self.assertTrue(texte.startswith('﻿Horodatage;Action;Acteur'))
        self.assertIn('SDGPS 4 Ferme Zaytoun', texte)
        self.assertIn('Rapport généré', texte)
        self.assertNotIn('pirate', texte)                             # filtre respecté
        ev = AuditEvent.objects.get(action=AuditEvent.ACTION_JOURNAL_EXPORTE)
        self.assertEqual((ev.acteur, ev.details['nombre'], ev.details['filtres']),
                         (self.admin, 2, {'q': 'youssef'}))

    @patch('accounts.audit_views.EXPORT_MAX', 2)
    def test_plafond(self):
        r = self.api.get(URL + 'export/')
        self.assertEqual(r.status_code, 400)
        self.assertIn('affinez', r.data['detail'])
        self.assertFalse(AuditEvent.objects.filter(action=AuditEvent.ACTION_JOURNAL_EXPORTE).exists())


class DroitsTests(AuditEcranBase):
    def test_reserve_a_l_administration_de_l_application(self):
        self.api.force_authenticate(self.admin_org)
        for url in ('', '?page=1', 'synthese/', 'filtres/', 'export/', 'actions/'):
            self.assertEqual(self.api.get(URL + url).status_code, 403, url)
        self.api.force_authenticate(None)
        self.assertEqual(self.api.get(URL + 'export/').status_code, 401)
