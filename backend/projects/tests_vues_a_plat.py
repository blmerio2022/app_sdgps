"""
Vues « à plat » : toutes les affaires / SSDGPS / sessions d'un projet, d'une propriété ou
d'une affaire, sans parcourir la hiérarchie niveau par niveau.

Verrouille les filtres d'ancêtre, l'exclusion des niveaux intermédiaires en corbeille,
l'exclusion des sessions structurelles des mono-session, le contexte parent renvoyé, et la
portée RBAC (un utilisateur d'une autre organisation ne voit rien).
"""
from datetime import datetime, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Membership, Organization
from projects.models import Affaire, Projet, Propriete, Session, Ssdgps

User = get_user_model()


class VuesAPlatTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        org = Organization.objects.create(code='ORG-P', name='Org Plat')
        autre = Organization.objects.create(code='ORG-Q', name='Autre')
        self.agent = User.objects.create_user(username='a@sdgps.ma', email='a@sdgps.ma', password='x')
        Membership.objects.create(user=self.agent, organization=org, role='ROLE_ORGANISATION_AGENT')
        self.intrus = User.objects.create_user(username='i@sdgps.ma', email='i@sdgps.ma', password='x')
        Membership.objects.create(user=self.intrus, organization=autre, role='ROLE_ORGANISATION_AGENT')

        self.projet = Projet.objects.create(nom_projet='P', code_projet='P-PLAT', organization=org)
        self.p1 = Propriete.objects.create(nom_propriete='Une', id_titre='T1/A', projet=self.projet)
        self.p2 = Propriete.objects.create(nom_propriete='Deux', id_requisition='R2/1', projet=self.projet)
        date = datetime(2024, 1, 1, tzinfo=dt_timezone.utc)
        self.a1 = Affaire.objects.create(numero_sd_affaire=1, nature_procedure_affaire='IFF',
                                         nature_affaire='BI', date_bornage=date, propriete=self.p1)
        self.a2 = Affaire.objects.create(numero_sd_affaire=1, nature_procedure_affaire='IFF',
                                         nature_affaire='BI', date_bornage=date, propriete=self.p2)
        self.multi = Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=1,
                                           type_ssdgps='multi-session', affaire=self.a1)
        self.mono = Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=2,
                                          type_ssdgps='mono-session', affaire=self.a1)
        self.multi2 = Ssdgps.objects.create(nature_ssdgps='DLC/GPS', numero_ssdgps=1,
                                            type_ssdgps='multi-session', affaire=self.a2)
        self.s1 = Session.objects.create(ssdgps=self.multi, numero_session=1)
        self.s2 = Session.objects.create(ssdgps=self.multi, numero_session=2)
        self.s3 = Session.objects.create(ssdgps=self.multi2, numero_session=1)
        self.client.force_authenticate(self.agent)

    def ids(self, url, **params):
        resp = self.client.get(url, params)
        self.assertEqual(resp.status_code, 200, resp.data)
        data = resp.data if isinstance(resp.data, list) else resp.data['results']
        return {row['id'] for row in data}, data

    def test_affaires_d_un_projet(self):
        ids, data = self.ids('/api/v1/affaires/', projet=self.projet.pk)
        self.assertEqual(ids, {str(self.a1.pk), str(self.a2.pk)})
        a1 = next(r for r in data if r['id'] == str(self.a1.pk))
        self.assertEqual(a1['propriete_id_titre'], 'T1/A')
        self.assertEqual(a1['propriete_nom'], 'Une')

    def test_affaires_sous_une_propriete_supprimee_exclues(self):
        self.p2.is_deleted = True
        self.p2.save()
        ids, _ = self.ids('/api/v1/affaires/', projet=self.projet.pk)
        self.assertEqual(ids, {str(self.a1.pk)})

    def test_sessions_d_un_projet_sans_les_sessions_des_mono(self):
        ids, data = self.ids('/api/v1/sessions/', projet=self.projet.pk)
        self.assertEqual(ids, {str(self.s1.pk), str(self.s2.pk), str(self.s3.pk)})
        # La session structurelle du mono-session n'y figure pas.
        self.assertFalse(Session.objects.filter(ssdgps=self.mono, pk__in=ids).exists())
        s3 = next(r for r in data if r['id'] == str(self.s3.pk))
        self.assertEqual(s3['ssdgps_numero'], 1)
        self.assertEqual(s3['ssdgps_nature'], 'DLC/GPS')
        self.assertEqual(s3['propriete_id_requisition'], 'R2/1')
        self.assertEqual(str(s3['affaire']), str(self.a2.pk))

    def test_sessions_d_une_propriete_et_d_une_affaire(self):
        self.assertEqual(self.ids('/api/v1/sessions/', propriete=self.p2.pk)[0], {str(self.s3.pk)})
        self.assertEqual(self.ids('/api/v1/sessions/', affaire=self.a1.pk)[0],
                         {str(self.s1.pk), str(self.s2.pk)})

    def test_sessions_sous_un_ssdgps_supprime_exclues(self):
        self.multi.is_deleted = True
        self.multi.save()
        self.assertEqual(self.ids('/api/v1/sessions/', projet=self.projet.pk)[0], {str(self.s3.pk)})

    def test_le_filtre_historique_par_ssdgps_inchange(self):
        """`?ssdgps=` (explorateur) garde son comportement : la session d'un mono-session
        reste lisible quand on la demande par son SSDGPS."""
        ids, _ = self.ids('/api/v1/sessions/', ssdgps=self.mono.pk)
        self.assertEqual(len(ids), 1)

    def test_ssdgps_d_une_propriete_hors_affaire_supprimee(self):
        self.assertEqual(self.ids('/api/v1/ssdgps/', propriete=self.p1.pk)[0],
                         {str(self.multi.pk), str(self.mono.pk)})
        self.a1.is_deleted = True
        self.a1.save()
        self.assertEqual(self.ids('/api/v1/ssdgps/', propriete=self.p1.pk)[0], set())

    def test_portee_rbac(self):
        self.client.force_authenticate(self.intrus)
        self.assertEqual(self.ids('/api/v1/affaires/', projet=self.projet.pk)[0], set())
        self.assertEqual(self.ids('/api/v1/sessions/', projet=self.projet.pk)[0], set())
