"""
Carte des dossiers (`GET /api/v1/carte-dossiers/`).
"""
from datetime import datetime, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Membership, Organization
from pieces.models import Piece
from projects.carte import centre, nombre
from projects.models import Affaire, Projet, Propriete, Ssdgps

User = get_user_model()
URL = '/api/v1/carte-dossiers/'
# Points anciens réels (Foum Jemaa, zone Nord) : ~31,96° N, 6,99° O.
LPA = {'rows': [{'nom_point': '8', 'x_m': '353 108.16', 'y_m': '146 858.01'},
                {'nom_point': 'GPS1', 'x_m': '353 472.07', 'y_m': '156 983.92'}]}


class CarteTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(code='ORG-M', name='Org Carte')
        self.user = User.objects.create_user(username='m@m.ma', email='m@m.ma', password='Passw0rd!')
        Membership.objects.create(user=self.user, organization=self.org, role='ROLE_ORGANISATION_AGENT')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def ssdgps(self, org=None, numero=1):
        projet = Projet.objects.create(nom_projet='P', code_projet=f'M-{numero}', organization=org or self.org,
                                       created_by=self.user if org is None else None)
        prop = Propriete.objects.create(nom_propriete='Prop', id_requisition='R1/1', projet=projet)
        aff = Affaire.objects.create(numero_sd_affaire=1, nature_procedure_affaire='IFF', nature_affaire='BI',
                                     date_bornage=datetime(2023, 4, 9, tzinfo=dt_timezone.utc), propriete=prop)
        return Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=numero, type_ssdgps='mono-session',
                                     affaire=aff)

    def test_utilitaires(self):
        self.assertEqual(nombre('353 108.16'), 353108.16)
        self.assertEqual(nombre('12,5'), 12.5)
        self.assertIsNone(nombre('x'))
        self.assertIsNone(centre([{'x_m': '', 'y_m': ''}]))
        self.assertEqual(centre([{'x_m': '0', 'y_m': '10'}, {'x_m': '2', 'y_m': '4'}]), (2.0, 4.0, 1))

    def test_position_d_apres_la_lpa_zone_des_photos(self):
        ss = self.ssdgps()
        Piece.objects.create(ssdgps=ss, type_piece='LPA', payload=LPA)
        Piece.objects.create(ssdgps=ss, type_piece='PPA', payload={'rows': [{'zone_projection': 'Zone I'}]})
        data = self.client.get(URL).data
        [d] = data['dossiers']
        self.assertAlmostEqual(d['lat'], 31.96, places=1)
        self.assertAlmostEqual(d['lon'], -6.99, places=1)
        self.assertEqual((d['nb_points'], d['source'], d['zone_supposee']), (2, 'LPA', False))
        self.assertIn(f'pieces/{ss.id}', d['lien'])

    def test_repli_sur_rdd_et_zone_supposee(self):
        ss = self.ssdgps()
        Piece.objects.create(ssdgps=ss, type_piece='RDD', payload=LPA)
        [d] = self.client.get(URL).data['dossiers']
        self.assertEqual((d['source'], d['zone_supposee'], d['zone']), ('RDD', True, 'nord'))

    def test_sans_points_ou_hors_maroc_ecarte(self):
        self.ssdgps(numero=1)
        ss2 = self.ssdgps(numero=2)
        Piece.objects.create(ssdgps=ss2, type_piece='LPA',
                             payload={'rows': [{'x_m': '9000000', 'y_m': '9000000'}]})
        data = self.client.get(URL).data
        self.assertEqual((data['dossiers'], data['sans_position'], data['total']), ([], 2, 2))

    def test_rbac_et_corbeille(self):
        autre = Organization.objects.create(code='ORG-N', name='Autre')
        cache = self.ssdgps(org=autre, numero=3)
        Piece.objects.create(ssdgps=cache, type_piece='LPA', payload=LPA)
        mien = self.ssdgps(numero=4)
        Piece.objects.create(ssdgps=mien, type_piece='LPA', payload=LPA)
        self.assertEqual([d['id'] for d in self.client.get(URL).data['dossiers']], [str(mien.id)])
        Ssdgps.objects.filter(pk=mien.pk).update(is_deleted=True)
        self.assertEqual(self.client.get(URL).data['dossiers'], [])

    def test_anonyme(self):
        self.assertEqual(APIClient().get(URL).status_code, 401)
