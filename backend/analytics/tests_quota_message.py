"""
Refus de quota EXPLIQUÉ, et espace de stockage visible par l'opérateur.

- tout téléversement refusé pour quota (images, pièce avec fichier, import CSV, logo)
  répond 400 avec un corps structuré `{code: 'QUOTA_DEPASSE', detail, quota: {...}}` —
  le front s'en sert pour dire quelle organisation, combien est utilisé, combien reste
  et combien l'envoi ajoutait, au lieu d'un message d'erreur générique ;
- `GET /api/v1/analytics/mon-stockage/` : quota de l'organisation de l'appelant, sa part
  et ses projets les plus lourds (jamais ceux d'un collègue).
"""
from django.core.files.uploadedfile import SimpleUploadedFile

from analytics.quotas import CODE_QUOTA_DEPASSE, QuotaExceeded, ensure_within_quota
from analytics.tests_quotas import QuotaBaseTest, image_bytes
from pieces.models import Piece, PieceImage


class RefusQuotaStructureTests(QuotaBaseTest):
    def _plafonner(self, octets):
        self.org.storage_quota_bytes = octets
        self.org.save(update_fields=['storage_quota_bytes'])

    def _verifier_refus(self, resp):
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(resp.data['code'], CODE_QUOTA_DEPASSE)
        self.assertIn('Quota de stockage dépassé', resp.data['detail'])
        self.assertIn('rien n\'a été enregistré', resp.data['detail'])
        quota = resp.data['quota']
        self.assertEqual(quota['organization_name'], 'Org Quota')
        self.assertEqual(quota['quota_bytes'], 1)
        self.assertGreater(quota['incoming_bytes'], 0)
        self.assertEqual(quota['remaining_bytes'], max(0, quota['quota_bytes'] - quota['used_bytes']))

    def test_images_refusees_corps_structure(self):
        self._plafonner(1)
        piece = Piece.objects.create(ssdgps=self.ssdgps, type_piece='RDC', numero=1,
                                     source_saisie='image', created_by=self.agent)
        self.client.force_authenticate(self.agent)
        resp = self.client.post(
            f'/api/v1/pieces/{piece.pk}/images/',
            {'fichiers': SimpleUploadedFile('p.png', image_bytes(), content_type='image/png')},
            format='multipart')
        self._verifier_refus(resp)
        self.assertEqual(PieceImage.objects.count(), 0)

    def test_import_csv_refuse_corps_structure(self):
        """Une pièce importée avec son fichier source passe par le serializer : le refus
        garde son code au lieu d'être aplati en erreur de champ."""
        self._plafonner(1)
        self.client.force_authenticate(self.agent)
        csv = 'Nom Point,X,Y,Z\nP1,1,2,3\n'.encode()
        resp = self.client.post('/api/v1/pieces/import/', {
            'fichier': SimpleUploadedFile('lpa.csv', csv, content_type='text/csv'),
            'type_piece': 'LPA', 'ssdgps': str(self.ssdgps.pk),
            'mapping': '{"Nom Point": "nom_point", "X": "x", "Y": "y", "Z": "z"}',
        }, format='multipart')
        self._verifier_refus(resp)
        self.assertFalse(Piece.objects.filter(type_piece='LPA').exists())

    def test_illimite_rien_n_est_refuse(self):
        self._plafonner(0)
        piece = Piece.objects.create(ssdgps=self.ssdgps, type_piece='RDC', numero=1,
                                     source_saisie='image', created_by=self.agent)
        self.client.force_authenticate(self.agent)
        resp = self.client.post(
            f'/api/v1/pieces/{piece.pk}/images/',
            {'fichiers': SimpleUploadedFile('p.png', image_bytes(), content_type='image/png')},
            format='multipart')
        self.assertIn(resp.status_code, (200, 201), resp.content)

    def test_payload_de_l_exception(self):
        self._plafonner(10)
        with self.assertRaises(QuotaExceeded) as ctx:
            ensure_within_quota(self.org, 100)
        corps = ctx.exception.payload()
        self.assertEqual(corps['code'], CODE_QUOTA_DEPASSE)
        self.assertEqual(corps['quota']['incoming_bytes'], 100)
        self.assertEqual(corps['quota']['quota_bytes'], 10)


class MonStockageTests(QuotaBaseTest):
    URL = '/api/v1/analytics/mon-stockage/'

    def test_anonyme_refuse(self):
        self.assertEqual(self.client.get(self.URL).status_code, 401)

    def test_agent_voit_le_quota_de_son_organisation_et_ses_projets(self):
        self.org.storage_quota_bytes = 10_000
        self.org.save(update_fields=['storage_quota_bytes'])
        self._piece_avec_fichier(4_000)
        self.client.force_authenticate(self.agent)
        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, 200, resp.content)
        org = resp.data['organisation']
        self.assertEqual(org['organization_name'], 'Org Quota')
        self.assertEqual(org['effective_quota_bytes'], 10_000)
        self.assertEqual(org['used_bytes'], 4_000)
        self.assertEqual(org['remaining_bytes'], 6_000)
        self.assertFalse(org['is_unlimited'])
        self.assertEqual(resp.data['ma_part_bytes'], 4_000)
        self.assertEqual(len(resp.data['mes_projets']), 1)
        self.assertEqual(resp.data['mes_projets'][0]['code'], 'P-1')
        self.assertEqual(resp.data['mes_projets'][0]['bytes'], 4_000)

    def test_collegue_voit_le_total_mais_pas_les_projets_d_autrui(self):
        self._piece_avec_fichier(4_000)
        collegue = self._membre('collegue@q.ma', self.org, 'ROLE_ORGANISATION_AGENT')
        self.client.force_authenticate(collegue)
        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['organisation']['used_bytes'], 4_000)
        self.assertEqual(resp.data['ma_part_bytes'], 0)
        self.assertEqual(resp.data['mes_projets'], [])

    def test_autre_organisation_isolee(self):
        self._piece_avec_fichier(4_000)
        self.client.force_authenticate(self.agent_autre)
        resp = self.client.get(self.URL)
        self.assertEqual(resp.data['organisation']['organization_name'], 'Autre Org')
        self.assertEqual(resp.data['organisation']['used_bytes'], 0)

    def test_illimite_par_defaut(self):
        self.client.force_authenticate(self.agent)
        org = self.client.get(self.URL).data['organisation']
        self.assertTrue(org['is_unlimited'])
        self.assertIsNone(org['remaining_bytes'])

    def test_sans_organisation(self):
        self.client.force_authenticate(self.super_admin)
        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.data['organisation'])
