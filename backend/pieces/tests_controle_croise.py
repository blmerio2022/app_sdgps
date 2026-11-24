"""
Contrôle croisé des points entre les pièces (`GET /api/v1/ssdgps/<id>/controle-croise/`).
"""
from datetime import datetime, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import Membership, Organization
from pieces.controle_croise import analyser_controle_croise
from pieces.models import Piece, PieceImage
from projects.models import Affaire, Projet, Propriete, Ssdgps

User = get_user_model()


def lignes(champ, *noms):
    return {'rows': [{'id': str(i + 1), champ: n} for i, n in enumerate(noms)]}


class ControleCroiseTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(code='ORG-X', name='Org X')
        self.user = User.objects.create_user(username='x@x.ma', email='x@x.ma', password='Passw0rd!')
        Membership.objects.create(user=self.user, organization=self.org, role='ROLE_ORGANISATION_AGENT')
        projet = Projet.objects.create(nom_projet='P', code_projet='PX', organization=self.org, created_by=self.user)
        prop = Propriete.objects.create(nom_propriete='X', id_requisition='R1/1', projet=projet)
        aff = Affaire.objects.create(numero_sd_affaire=1, nature_procedure_affaire='IFF', nature_affaire='BI',
                                     date_bornage=datetime(2023, 4, 9, tzinfo=dt_timezone.utc), propriete=prop)
        self.ss = Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=1, type_ssdgps='mono-session',
                                        affaire=aff)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def piece(self, type_piece, payload, numero=None):
        return Piece.objects.create(ssdgps=self.ss, type_piece=type_piece, numero=numero, payload=payload)

    def analyse(self):
        return analyser_controle_croise(Piece.objects.filter(ssdgps=self.ss, is_deleted=False))

    def codes(self, r):
        return {c['code']: c for c in r['controles']}

    @override_settings(MEDIA_ROOT='/tmp/sdgps-controle-croise')
    def test_dossier_concordant_aucune_anomalie(self):
        self.piece('LPA', lignes('nom_point', 'A', 'B'))
        self.piece('ROB', lignes('point', 'A', 'B', 'N1'))
        ppn = self.piece('PPN', lignes('nom_point', 'N1'))
        PieceImage.objects.create(piece=ppn, point_ref='1',
                                  fichier=SimpleUploadedFile('n1.jpg', b'x', content_type='image/jpeg'))
        self.piece('RDD', lignes('nom_point', 'A', 'B', 'N1'))
        r = self.analyse()
        self.assertTrue(r['ok'], r['controles'])
        self.assertEqual(r['sources']['LPA'], {'pieces': 1, 'points': 2})

    def test_points_absents_de_la_definitive_et_non_observes(self):
        self.piece('LPA', lignes('nom_point', 'A', 'B', 'C'))
        self.piece('PPN', lignes('nom_point', 'N1', 'N2'))
        self.piece('ROB', lignes('point', 'A', 'B', 'N1', 'ZZ'))
        self.piece('RDD', lignes('nom_point', 'A', 'B', 'N1', 'X9'))
        c = self.codes(self.analyse())
        self.assertEqual(c['lpa_hors_rdd']['points'], ['C'])
        self.assertEqual(c['lpa_hors_rdd']['gravite'], 'erreur')
        self.assertEqual(c['ppn_hors_rdd']['points'], ['N2'])
        self.assertEqual(c['rdd_inconnu']['points'], ['X9'])
        self.assertEqual(c['lpa_non_observe']['points'], ['C'])
        self.assertEqual(c['ppn_non_observe']['points'], ['N2'])
        self.assertEqual(c['observe_inconnu']['points'], ['ZZ'])
        self.assertEqual({p['type_piece'] for p in c['lpa_hors_rdd']['pieces']}, {'LPA', 'RDD'})

    def test_rapprochement_sans_casse_ni_espace_et_graphies_signalees(self):
        self.piece('LPA', lignes('nom_point', 'GPS 1'))
        self.piece('RDD', lignes('nom_point', 'gps1'))
        c = self.codes(self.analyse())
        self.assertNotIn('lpa_hors_rdd', c)                       # même point
        self.assertEqual(c['orthographe']['points'], ['GPS 1 / gps1'])

    def test_noms_presque_identiques_signales(self):
        # « AXl6 » (L minuscule) dans la LPA, « AXI6 » (i majuscule) ailleurs.
        self.piece('LPA', lignes('nom_point', 'AXl6', 'B'))
        self.piece('RDD', lignes('nom_point', 'AXI6', 'B'))
        c = self.codes(self.analyse())
        self.assertEqual(c['confusion']['points'], ['AXI6 / AXl6'])
        self.assertEqual(c['confusion']['gravite'], 'avertissement')
        self.assertNotIn('confusion', self.codes(analyser_controle_croise([])))

    def test_doublons_et_fiches_photo(self):
        self.piece('LPA', lignes('nom_point', 'A', 'A', 'B'))
        self.piece('PPA', lignes('nom_point', 'A', 'Q'))
        c = self.codes(self.analyse())
        self.assertEqual(c['doublon_lpa']['points'], ['A'])
        self.assertEqual(c['lpa_sans_ppa']['points'], ['B'])
        self.assertEqual(c['ppa_hors_lpa']['points'], ['Q'])

    def test_determinations_inconnues(self):
        self.piece('LPA', lignes('nom_point', 'A'))
        self.piece('RDN', lignes('nom_point', 'A', 'W'), numero=1)
        self.assertEqual(self.codes(self.analyse())['determination_inconnu']['points'], ['W'])

    @override_settings(MEDIA_ROOT='/tmp/sdgps-controle-croise')
    def test_photos_sans_point_et_orphelines(self):
        ppa = self.piece('PPA', lignes('nom_point', 'A', 'B'))
        for ref in ('1', '9'):        # « 1 » = ligne A ; « 9 » = aucune ligne
            PieceImage.objects.create(piece=ppa, point_ref=ref,
                                      fichier=SimpleUploadedFile('p.jpg', b'x', content_type='image/jpeg'))
        c = self.codes(self.analyse())
        self.assertEqual(c['ppa_sans_photo']['points'], ['B'])
        self.assertEqual(c['ppa_photo_orpheline']['points'], ['9'])

    def test_controle_sans_les_pieces_a_comparer_ne_signale_rien(self):
        self.piece('LPA', lignes('nom_point', 'A', 'B'))       # pas de RDD, pas de ROB
        self.assertTrue(self.analyse()['ok'])

    def test_api_portee_et_pieces_supprimees(self):
        self.piece('LPA', lignes('nom_point', 'A', 'B'))
        rdd = self.piece('RDD', lignes('nom_point', 'A'))
        url = f'/api/v1/ssdgps/{self.ss.pk}/controle-croise/'
        data = self.client.get(url).data
        self.assertEqual(data['erreurs'], 1)
        Piece.objects.filter(pk=rdd.pk).update(is_deleted=True)       # pièce en corbeille ignorée
        self.assertTrue(self.client.get(url).data['ok'])
        autre = Organization.objects.create(code='ORG-Z', name='Z')
        intrus = User.objects.create_user(username='z@z.ma', email='z@z.ma', password='Passw0rd!')
        Membership.objects.create(user=intrus, organization=autre, role='ROLE_ORGANISATION_AGENT')
        self.client.force_authenticate(intrus)
        self.assertEqual(self.client.get(url).status_code, 404)
