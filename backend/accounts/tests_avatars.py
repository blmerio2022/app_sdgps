"""
Plafonnement et redimensionnement des photos de profil.

Avant ce correctif, `CustomUser.profile_picture` n'avait **ni validateur de taille ni
redimensionnement**, contrairement aux images de pièces. Mesure sur la base de
développement : 15 photos pesaient 18 Mo (64 % de tous les médias pour 4 % des
fichiers), dont des captures d'écran de 4,9 Mo stockées à l'identique.
"""
from io import BytesIO

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from accounts.avatars import (ALLOWED_AVATAR_EXTENSIONS, normalize_avatar,
                              validate_avatar, validate_avatar_extension,
                              validate_avatar_size)

User = get_user_model()


def image_file(nom='photo.png', taille=(3000, 2000), mode='RGB', fmt='PNG', couleur=(10, 90, 180)):
    """Fichier image en mémoire, prêt à être « téléversé »."""
    im = Image.new(mode, taille, couleur if mode != 'RGBA' else (*couleur, 255))
    buf = BytesIO()
    im.save(buf, format=fmt)
    return SimpleUploadedFile(nom, buf.getvalue(), content_type=f'image/{fmt.lower()}')


class ValidationAvatarTests(SimpleTestCase):

    def test_extensions_alignees_sur_le_front(self):
        """Toute divergence ferait accepter un fichier par le front, rejeté par le serveur.
        Liste de référence : `allowedPhotoExtensions` du composant de profil Angular."""
        self.assertEqual(
            ALLOWED_AVATAR_EXTENSIONS,
            {'.png', '.jpg', '.jpeg', '.gif', '.tif', '.tiff', '.webp'})

    def test_extension_refusee(self):
        with self.assertRaises(ValidationError):
            validate_avatar_extension(SimpleUploadedFile('virus.exe', b'MZ'))

    def test_extension_acceptee_insensible_a_la_casse(self):
        validate_avatar_extension(SimpleUploadedFile('Photo.PNG', b''))   # ne lève pas

    @override_settings(PROFILE_PICTURE_MAX_UPLOAD_MB=1)
    def test_fichier_trop_volumineux_refuse(self):
        gros = SimpleUploadedFile('gros.png', b'x' * (2 * 1024 * 1024))
        with self.assertRaises(ValidationError) as ctx:
            validate_avatar_size(gros)
        self.assertIn('maximum 1 Mo', str(ctx.exception))

    def test_fichier_non_image_refuse(self):
        faux = SimpleUploadedFile('faux.png', b'ceci n est pas une image')
        with self.assertRaises(ValidationError):
            validate_avatar(faux)


class NormalisationAvatarTests(SimpleTestCase):

    def test_image_reduite_aux_dimensions_maximales(self):
        contenu, nom = normalize_avatar(image_file(taille=(3000, 2000)))
        largeur, hauteur = Image.open(BytesIO(contenu.read())).size
        self.assertLessEqual(largeur, settings.PROFILE_PICTURE_MAX_DIMENSIONS[0])
        self.assertLessEqual(hauteur, settings.PROFILE_PICTURE_MAX_DIMENSIONS[1])
        self.assertTrue(nom.endswith('.jpg'))

    def test_proportions_conservees(self):
        contenu, _ = normalize_avatar(image_file(taille=(2000, 1000)))
        largeur, hauteur = Image.open(BytesIO(contenu.read())).size
        self.assertAlmostEqual(largeur / hauteur, 2.0, places=1)

    def test_petite_image_non_agrandie(self):
        """`thumbnail` ne fait que réduire : une photo déjà petite garde sa taille."""
        contenu, _ = normalize_avatar(image_file(taille=(64, 64)))
        self.assertEqual(Image.open(BytesIO(contenu.read())).size, (64, 64))

    def test_transparence_preservee_en_png(self):
        contenu, nom = normalize_avatar(image_file('logo.png', (800, 800), mode='RGBA'))
        self.assertTrue(nom.endswith('.png'))
        self.assertIn(Image.open(BytesIO(contenu.read())).mode, ('RGBA', 'LA', 'P'))

    def test_poids_fortement_reduit(self):
        """L'intérêt du correctif : le fichier stocké pèse une fraction de l'original."""
        source = image_file(taille=(3000, 2000))
        avant = source.size
        contenu, _ = normalize_avatar(source)
        self.assertLess(contenu.size, avant)

    def test_image_illisible_renvoie_none(self):
        """Repli sûr : on conserve le fichier d'origine plutôt que de perdre la photo."""
        self.assertIsNone(normalize_avatar(SimpleUploadedFile('x.png', b'pas une image')))


class UploadProfilTests(TestCase):
    """Bout en bout via l'endpoint réellement utilisé par le front :
    `PUT /api/v1/platform-admin/me/profile/` (tous rôles, malgré son nom)."""

    def setUp(self):
        self.user = User.objects.create_user(
            username='photo@sdgps.ma', email='photo@sdgps.ma', password='Passw0rd!',
            first_name='Ada', last_name='Lovelace')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_photo_volumineuse_est_reduite_avant_stockage(self):
        source = image_file('capture.png', (2400, 1600))
        poids_envoye = source.size

        resp = self.client.put('/api/v1/platform-admin/me/profile/',
                               {'profile_picture': source}, format='multipart')
        self.assertEqual(resp.status_code, 200, resp.content)

        self.user.refresh_from_db()
        self.assertTrue(self.user.profile_picture)
        self.assertLess(self.user.profile_picture.size, poids_envoye)
        largeur, hauteur = Image.open(self.user.profile_picture).size
        self.assertLessEqual(largeur, settings.PROFILE_PICTURE_MAX_DIMENSIONS[0])
        self.assertLessEqual(hauteur, settings.PROFILE_PICTURE_MAX_DIMENSIONS[1])

    @override_settings(PROFILE_PICTURE_MAX_UPLOAD_MB=1)
    def test_photo_au_dela_du_plafond_rejetee(self):
        enorme = SimpleUploadedFile('enorme.png', b'x' * (2 * 1024 * 1024),
                                    content_type='image/png')
        resp = self.client.put('/api/v1/platform-admin/me/profile/',
                               {'profile_picture': enorme}, format='multipart')
        self.assertEqual(resp.status_code, 400)
        self.user.refresh_from_db()
        self.assertFalse(self.user.profile_picture)

    def test_fichier_non_image_rejete(self):
        resp = self.client.put('/api/v1/platform-admin/me/profile/',
                               {'profile_picture': SimpleUploadedFile(
                                   'faux.png', b'pas une image', content_type='image/png')},
                               format='multipart')
        self.assertEqual(resp.status_code, 400)
