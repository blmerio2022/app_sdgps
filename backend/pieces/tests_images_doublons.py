"""
Photo ré-importée sous un nom déjà présent sur le stockage.

Les fichiers d'une pièce supprimée restent sur le disque. Ré-importer le même levé dans
le même SDGPS envoie donc des photos dont le nom existe déjà (« GPS1.jpg », puis
« GPS1_xxxxxxx.jpg »…). Chaque envoi doit aboutir (201) : le stockage choisit un nom
libre, la photo est rattachée à son point.
"""
import shutil
import tempfile
from io import BytesIO

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image

from analytics.tests_quotas import QuotaBaseTest
from pieces.models import Piece

MEDIA = tempfile.mkdtemp(prefix='sdgps-doublons-')


def photo(nom='GPS1.jpg'):
    buf = BytesIO()
    Image.new('RGB', (60, 40), (120, 80, 40)).save(buf, format='JPEG')
    return SimpleUploadedFile(nom, buf.getvalue(), content_type='image/jpeg')


@override_settings(MEDIA_ROOT=MEDIA)
class PhotoNomDejaPresentTests(QuotaBaseTest):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def test_meme_nom_envoye_plusieurs_fois(self):
        piece = Piece.objects.create(ssdgps=self.ssdgps, type_piece='PPA', numero=1,
                                     source_saisie='image', created_by=self.agent)
        self.client.force_authenticate(self.agent)
        for i in range(4):
            resp = self.client.post(f'/api/v1/pieces/{piece.pk}/images/',
                                    {'fichiers': photo(), 'point_ref': '10'}, format='multipart')
            self.assertEqual(resp.status_code, 201, f'envoi n°{i + 1} : {resp.content[:300]}')
        self.assertEqual(piece.images.filter(point_ref='10').count(), 4)

    def test_nom_present_apres_suppression_de_la_piece(self):
        """Scénario réel : pièce supprimée (fichiers restés), puis nouvel import."""
        for _ in range(3):
            piece = Piece.objects.create(ssdgps=self.ssdgps, type_piece='PPA', numero=1,
                                         source_saisie='image', created_by=self.agent)
            self.client.force_authenticate(self.agent)
            resp = self.client.post(f'/api/v1/pieces/{piece.pk}/images/',
                                    {'fichiers': photo('FOUM JEMAA.jpg'), 'point_ref': '3'},
                                    format='multipart')
            self.assertEqual(resp.status_code, 201, resp.content[:300])
            Piece.objects.filter(pk=piece.pk).delete()


@override_settings(MEDIA_ROOT=MEDIA)
class ErreurInattendueTests(QuotaBaseTest):
    """Une erreur serveur à l'enregistrement n'est plus une 500 muette : message lisible,
    trace dans les journaux, rien d'enregistré."""

    def test_erreur_expliquee_et_tracee(self):
        from unittest import mock
        from pieces.models import PieceImage
        piece = Piece.objects.create(ssdgps=self.ssdgps, type_piece='PPA', numero=1,
                                     source_saisie='image', created_by=self.agent)
        self.client.force_authenticate(self.agent)
        with mock.patch.object(PieceImage, 'save', side_effect=RuntimeError('panne')), \
                self.assertLogs('pieces.views', level='ERROR') as journal:
            resp = self.client.post(f'/api/v1/pieces/{piece.pk}/images/',
                                    {'fichiers': photo('GPS1.jpg'), 'point_ref': '10'},
                                    format='multipart')
        self.assertEqual(resp.status_code, 500)
        self.assertEqual(resp.data['code'], 'ERREUR_ENREGISTREMENT_IMAGE')
        self.assertIn('GPS1.jpg', resp.data['detail'])
        self.assertIn('RuntimeError', resp.data['detail'])
        self.assertIn('Traceback', '\n'.join(journal.output))
        self.assertEqual(piece.images.count(), 0)
