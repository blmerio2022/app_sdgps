"""
Cachet + signature apposés sur les pages du rapport.

Ce que ces tests verrouillent :
- **traitement d'image** (`signature_image.traiter`) : le papier, ses ombres et son
  quadrillage disparaissent, l'encre reste ; couleurs, rotation, recadrage, sensibilité ;
  refus motivés (image illisible, page blanche) ;
- **API** `/api/v1/cachets-signatures/` : création, aperçu à blanc, reprise du
  traitement, défaut unique, suppression logique, plafond ;
- **confidentialité** : un cachet est strictement personnel — ni un autre agent, ni un
  administrateur de l'application ne le voient, ne le modifient ou ne l'apposent ;
- **apposition** (`cachet.py`) : géométrie, pages concernées, image embarquée une fois ;
- **rapport** : options validées par la résolution commune de portée, transmises au
  rendu synchrone, à l'aperçu de la page de garde et à la tâche de fond ; un cachet
  supprimé entre la demande et le rendu fait échouer la génération avec un message clair.
"""
import json
import shutil
import tempfile
from datetime import datetime, timezone as dt_timezone
from io import BytesIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase, override_settings
from PIL import Image, ImageDraw
from rest_framework.test import APIClient

from accounts.models import AuditEvent, Membership, Organization
from pieces import cachet as cachet_mod
from pieces.models import CachetSignature, Piece, RapportGeneration
from pieces.signature_image import (ImageSignatureInvalide, normaliser_parametres,
                                    traiter)
from projects.models import Affaire, Projet, Propriete, Ssdgps

User = get_user_model()
URL = '/api/v1/cachets-signatures/'
PDF_FACTICE = b'%PDF-1.7 factice'

ENCRE_BLEUE = (70, 100, 200)
ENCRE_NOIRE = (25, 28, 50)


def photo_de_cachet(largeur=900, hauteur=600, quadrillage=True, encre=True):
    """Photo synthétique réaliste : papier crème en dégradé (ombre), quadrillage pâle de
    cahier, tampon bleu (double cercle + barre) et signature sombre."""
    papier = Image.linear_gradient('L').resize((largeur, hauteur)).rotate(90, expand=False)
    papier = papier.point(lambda v: 228 - v * 45 // 255)          # 228 → 183 : ombre
    image = Image.merge('RGB', (papier, papier.point(lambda v: v * 97 // 100),
                                papier.point(lambda v: v * 88 // 100)))
    d = ImageDraw.Draw(image)
    if quadrillage:
        for y in range(30, hauteur, 30):
            d.line([(0, y), (largeur, y)], fill=(190, 198, 212), width=1)
    if encre:
        cx, cy, r = largeur // 3, hauteur // 2, hauteur // 4
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=ENCRE_BLEUE, width=6)
        d.ellipse([cx - r + 14, cy - r + 14, cx + r - 14, cy + r - 14],
                  outline=ENCRE_BLEUE, width=4)
        d.rectangle([cx - r // 2, cy - 8, cx + r // 2, cy + 8], fill=ENCRE_BLEUE)
        d.line([(largeur // 2, hauteur // 2 + 40), (largeur // 2 + 80, hauteur // 2 - 30),
                (largeur // 2 + 160, hauteur // 2 + 50), (largeur - 120, hauteur // 2 - 20)],
               fill=ENCRE_NOIRE, width=6)
    return image


def octets(image, fmt='JPEG'):
    tampon = BytesIO()
    image.save(tampon, format=fmt, quality=92)
    return tampon.getvalue()


_CACHE = {}


def jpeg_type():
    """Photo de référence, encodée une fois (les tests d'API n'en éprouvent pas le contenu)."""
    if 'jpeg' not in _CACHE:
        _CACHE['jpeg'] = octets(photo_de_cachet())
    return _CACHE['jpeg']


def png_type():
    """PNG détouré de la photo de référence, calculé une fois."""
    if 'png' not in _CACHE:
        _CACHE['png'] = traiter(jpeg_type()).png()
    return _CACHE['png']


def fichier(image=None, nom='cachet.jpg'):
    contenu = octets(image) if image is not None else jpeg_type()
    return SimpleUploadedFile(nom, contenu, content_type='image/jpeg')


# =========================================================================== traitement

class TraitementImageTests(SimpleTestCase):
    def test_le_fond_devient_transparent_et_l_encre_reste_opaque(self):
        resultat = traiter(octets(photo_de_cachet()))
        alpha = resultat.image.getchannel('A')

        self.assertEqual(resultat.image.mode, 'RGBA')
        # Recadré sur l'encre, avec une marge : les coins sont du papier → transparents.
        for coin in ((0, 0), (resultat.largeur - 1, 0), (0, resultat.hauteur - 1),
                     (resultat.largeur - 1, resultat.hauteur - 1)):
            self.assertEqual(alpha.getpixel(coin), 0, coin)
        # De l'encre franche subsiste, en quantité.
        self.assertGreater(sum(alpha.histogram()[200:]), 2000)

    def test_le_quadrillage_et_l_ombre_du_papier_sont_effaces(self):
        # Même photo sans encre au centre : seule une bande d'encre (la barre du tampon)
        # sert de repère ; tout le reste — dégradé, lignes de cahier — doit disparaître.
        image = photo_de_cachet(encre=False)
        ImageDraw.Draw(image).rectangle([100, 280, 800, 300], fill=ENCRE_BLEUE)
        resultat = traiter(octets(image))
        alpha = resultat.image.getchannel('A')

        # Le résultat est recadré sur la barre : 700 × 20 px plus la marge, et pas la
        # page entière (ce qu'auraient produit des lignes de cahier conservées).
        self.assertLess(resultat.hauteur, 80)
        self.assertGreater(resultat.largeur, 650)
        opaques = sum(alpha.histogram()[128:])
        self.assertLess(opaques, 700 * 30)          # rien d'autre que la barre

    def test_le_recadrage_automatique_reduit_l_image_a_l_encre(self):
        resultat = traiter(octets(photo_de_cachet()))
        self.assertLess(resultat.largeur, 900)
        self.assertLess(resultat.hauteur, 600)

    def test_couleur_d_origine_conserve_la_teinte_de_l_encre(self):
        resultat = traiter(octets(photo_de_cachet()), {'couleur': 'origine'})
        image = resultat.image
        bleus = [image.getpixel((x, y)) for x in range(0, image.width, 3)
                 for y in range(0, image.height, 3) if image.getpixel((x, y))[3] > 240]
        self.assertTrue(any(b > r + 60 for r, g, b, _a in bleus),
                        "le bleu du tampon a disparu")

    def test_encre_uniforme_bleue_ou_noire(self):
        for couleur, teinte in (('bleu', (24, 52, 148)), ('noir', (22, 22, 26))):
            image = traiter(octets(photo_de_cachet()), {'couleur': couleur}).image
            couleurs = {px[:3] for px in image.getdata() if px[3] > 0}
            self.assertEqual(couleurs, {teinte}, couleur)

    def test_la_rotation_permute_les_dimensions(self):
        droit = traiter(octets(photo_de_cachet()))
        tourne = traiter(octets(photo_de_cachet()), {'rotation': 90})
        self.assertAlmostEqual(droit.largeur, tourne.hauteur, delta=4)
        self.assertAlmostEqual(droit.hauteur, tourne.largeur, delta=4)

    def test_le_cadre_limite_la_zone_traitee(self):
        # Moitié gauche seulement : le tampon, sans la signature.
        complet = traiter(octets(photo_de_cachet()))
        gauche = traiter(octets(photo_de_cachet()),
                         {'cadre': {'x': 0, 'y': 0, 'l': 0.5, 'h': 1}})
        self.assertLess(gauche.largeur, complet.largeur * 0.75)

    def test_la_sensibilite_garde_plus_ou_moins_d_encre_pale(self):
        image = photo_de_cachet(encre=False)
        d = ImageDraw.Draw(image)
        d.rectangle([100, 100, 400, 140], fill=(40, 40, 60))           # encre franche
        d.rectangle([100, 300, 400, 340], fill=(150, 150, 180))        # encre pâle
        faible = traiter(octets(image), {'sensibilite': 0})
        forte = traiter(octets(image), {'sensibilite': 100})
        # Sensibilité haute : la barre pâle est gardée → le résultat est plus haut.
        self.assertGreater(forte.hauteur, faible.hauteur + 100)

    def test_une_image_deja_detouree_est_acceptee(self):
        png = Image.new('RGBA', (400, 300), (0, 0, 0, 0))
        ImageDraw.Draw(png).ellipse([50, 50, 350, 250], outline=(30, 60, 160, 255), width=8)
        resultat = traiter(octets(png, 'PNG'))
        self.assertEqual(resultat.image.getchannel('A').getpixel((0, 0)), 0)
        self.assertGreater(resultat.couverture, 0.01)

    def test_page_blanche_refusee(self):
        with self.assertRaisesMessage(ImageSignatureInvalide, 'Aucune encre'):
            traiter(octets(photo_de_cachet(encre=False, quadrillage=False)))

    def test_fichier_illisible_refuse(self):
        with self.assertRaisesMessage(ImageSignatureInvalide, 'illisible'):
            traiter(b'ceci n est pas une image')

    def test_le_resultat_est_borne_en_taille(self):
        resultat = traiter(octets(photo_de_cachet(3000, 2000)))
        self.assertLessEqual(max(resultat.largeur, resultat.hauteur), 1200)

    def test_le_png_produit_se_relit(self):
        resultat = traiter(octets(photo_de_cachet()))
        relu = Image.open(BytesIO(resultat.png()))
        self.assertEqual((relu.mode, relu.size), ('RGBA', resultat.image.size))


class NormalisationParametresTests(SimpleTestCase):
    def test_defauts(self):
        p = normaliser_parametres(None)
        self.assertEqual((p['sensibilite'], p['couleur'], p['lissage'], p['rotation'],
                          p['cadre']), (50, 'origine', True, 0, None))

    def test_valeurs_refusees(self):
        for brut in ({'sensibilite': 140}, {'sensibilite': 'x'}, {'couleur': 'rouge'},
                     {'rotation': 45}, {'cadre': {'x': 0, 'y': 0, 'l': 0.001, 'h': 0.5}},
                     {'cadre': {'x': 0}}, 'texte'):
            with self.assertRaises(ValueError, msg=brut):
                normaliser_parametres(brut)

    def test_cadre_borne_a_l_image(self):
        p = normaliser_parametres({'cadre': {'x': 0.8, 'y': -1, 'l': 0.9, 'h': 3}})
        self.assertEqual(p['cadre'], {'x': 0.8, 'y': 0.0, 'l': 0.2, 'h': 1.0})

    def test_rotation_negative_ramenee(self):
        self.assertEqual(normaliser_parametres({'rotation': -90})['rotation'], 270)


# =========================================================================== apposition

def options(**kw):
    return cachet_mod.OptionsCachet(image_png=png_type(), **kw)


class GeometrieAppositionTests(SimpleTestCase):
    A4 = (595.28, 841.89)

    def test_positions(self):
        mm = 72 / 25.4
        for position, attendu in (('bas-gauche', 12 * mm),
                                  ('bas-centre', (self.A4[0] - 45 * mm) / 2),
                                  ('bas-droite', self.A4[0] - 12 * mm - 45 * mm)):
            o = cachet_mod.OptionsCachet(image_png=b'', position=position, largeur_mm=45)
            x, y, l, _h = cachet_mod.geometrie(o, *self.A4, ratio=0.5)
            self.assertAlmostEqual(x, attendu, places=2, msg=position)
            self.assertAlmostEqual(y, 12 * mm, places=2)        # au-dessus du pied de page
            self.assertAlmostEqual(l, 45 * mm, places=2)

    def test_hauteur_plafonnee_proportions_gardees(self):
        o = cachet_mod.OptionsCachet(image_png=b'', largeur_mm=90)
        _x, _y, l, h = cachet_mod.geometrie(o, *self.A4, ratio=1.5)
        self.assertAlmostEqual(h, 60 * 72 / 25.4, places=2)
        self.assertAlmostEqual(h / l, 1.5, places=3)

    def test_pages_concernees(self):
        toutes = cachet_mod.OptionsCachet(image_png=b'', pages='toutes')
        sauf = cachet_mod.OptionsCachet(image_png=b'', pages='sauf-garde')
        self.assertTrue(cachet_mod.doit_apposer(toutes, 0, 1, blanche=False))
        self.assertFalse(cachet_mod.doit_apposer(toutes, 3, 1, blanche=True))
        self.assertFalse(cachet_mod.doit_apposer(sauf, 0, 1, blanche=False))
        self.assertTrue(cachet_mod.doit_apposer(sauf, 1, 1, blanche=False))
        self.assertFalse(cachet_mod.doit_apposer(None, 1, 1, blanche=False))

    def test_reglages_valides_et_refuses(self):
        self.assertEqual(cachet_mod.valider_reglages(None, None, None),
                         {'position': 'bas-droite', 'largeur_mm': 45.0, 'pages': 'toutes'})
        for args in (('haut',), (None, '200'), (None, 'abc'), (None, None, 'paires')):
            with self.assertRaises(cachet_mod.OptionsCachetInvalides, msg=args):
                cachet_mod.valider_reglages(*args)


class ApposerSurPdfTests(SimpleTestCase):
    def _pdf(self, formats):
        from reportlab.pdfgen import canvas
        tampon = BytesIO()
        c = canvas.Canvas(tampon)
        for largeur, hauteur in formats:
            c.setPageSize((largeur, hauteur))
            c.drawString(50, 50, 'contenu')
            c.showPage()
        c.save()
        return tampon.getvalue()

    def _images_par_page(self, pdf):
        from pypdf import PdfReader
        lecteur = PdfReader(BytesIO(pdf))
        resultat = []
        for page in lecteur.pages:
            refs = set()

            def parcourir(ressources):
                xobjets = (ressources or {}).get('/XObject') or {}
                for xo in xobjets.values():
                    obj = xo.get_object()
                    if obj.get('/Subtype') == '/Image':
                        refs.add(xo.idnum)
                    elif obj.get('/Subtype') == '/Form':
                        parcourir(obj.get('/Resources'))
            parcourir(page.get('/Resources'))
            resultat.append(refs)
        return resultat

    def test_le_cachet_est_pose_sur_chaque_page_et_embarque_une_fois(self):
        pdf = self._pdf([(595, 842), (842, 595), (595, 842)])     # portrait, paysage…
        tamponne = cachet_mod.apposer_sur_pdf(pdf, options())

        images = self._images_par_page(tamponne)
        self.assertTrue(all(images), images)
        self.assertEqual(len(set().union(*images)), 1, 'image dupliquée par page')

    def test_sauf_garde_epargne_la_page_de_garde(self):
        pdf = self._pdf([(595, 842), (595, 842)])
        tamponne = cachet_mod.apposer_sur_pdf(pdf, options(pages='sauf-garde'), pages_garde=1)
        images = self._images_par_page(tamponne)
        self.assertEqual(images[0], set())
        self.assertTrue(images[1])

    def test_sans_cachet_le_pdf_est_inchange(self):
        pdf = self._pdf([(595, 842)])
        self.assertIs(cachet_mod.apposer_sur_pdf(pdf, None), pdf)


# =========================================================================== API

# Hachage rapide : quatre comptes par test, le PBKDF2 de production coûterait des minutes.
@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class CachetsBaseTest(TestCase):
    def setUp(self):
        self._media = tempfile.mkdtemp()
        self._override = override_settings(MEDIA_ROOT=self._media)
        self._override.enable()
        self.client = APIClient()
        self.org = Organization.objects.create(code='ORG-CS', name='Org Cachets')
        self.agent = self._user('agent@sdgps.ma', 'ROLE_ORGANISATION_AGENT')
        self.collegue = self._user('collegue@sdgps.ma', 'ROLE_ORGANISATION_AGENT')
        self.admin_org = self._user('adminorg@sdgps.ma', 'ROLE_ORGANISATION_ADMIN')
        self.super_admin = User.objects.create_superuser(
            username='super@sdgps.ma', email='super@sdgps.ma', password='Passw0rd!')
        self.client.force_authenticate(self.agent)

    def tearDown(self):
        self._override.disable()
        shutil.rmtree(self._media, ignore_errors=True)

    def _user(self, email, role):
        user = User.objects.create_user(username=email, email=email, password='Passw0rd!')
        Membership.objects.create(user=user, organization=self.org, role=role)
        return user

    def creer(self, nom='Cabinet', client=None, **extra):
        data = {'nom': nom, 'fichier': fichier(), **extra}
        return (client or self.client).post(URL, data, format='multipart')

    def cachet_en_base(self, proprietaire, nom='Cachet'):
        c = CachetSignature(proprietaire=proprietaire, nom=nom, created_by=proprietaire)
        c.image_originale.save('o.jpg', ContentFile(jpeg_type()), save=False)
        c.image.save('c.png', ContentFile(png_type()), save=False)
        c.save()
        return c


class CreationCachetTests(CachetsBaseTest):
    def test_creation_traite_et_enregistre(self):
        resp = self.creer(parametres=json.dumps({'couleur': 'bleu', 'sensibilite': 60}))

        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertTrue(resp.data['image'].startswith('data:image/png;base64,'))
        self.assertEqual(resp.data['parametres']['couleur'], 'bleu')
        self.assertEqual(resp.data['parametres']['sensibilite'], 60)
        self.assertGreater(resp.data['largeur_px'], 0)
        cachet = CachetSignature.objects.get(pk=resp.data['id'])
        self.assertEqual(cachet.proprietaire, self.agent)
        self.assertEqual(cachet.created_by, self.agent)
        self.assertTrue(cachet.image_originale.name)
        # L'image enregistrée est bien le PNG détouré.
        with cachet.image.open('rb') as f:
            self.assertEqual(Image.open(f).mode, 'RGBA')

    def test_le_premier_cachet_devient_le_defaut(self):
        self.assertTrue(self.creer().data['par_defaut'])
        self.assertFalse(self.creer('Second').data['par_defaut'])

    def test_un_seul_defaut(self):
        premier = self.creer().data
        second = self.creer('Second', par_defaut='true').data
        self.assertTrue(second['par_defaut'])
        self.assertFalse(CachetSignature.objects.get(pk=premier['id']).par_defaut)

    def test_nom_et_fichier_requis(self):
        self.assertEqual(self.client.post(URL, {'nom': 'X'}, format='multipart').status_code, 400)
        resp = self.client.post(URL, {'nom': ' ', 'fichier': fichier()}, format='multipart')
        self.assertEqual(resp.status_code, 400)

    def test_image_sans_encre_refusee_avec_message(self):
        resp = self.client.post(URL, {
            'nom': 'Vide',
            'fichier': fichier(photo_de_cachet(encre=False, quadrillage=False)),
        }, format='multipart')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('Aucune encre', resp.data['detail'])
        self.assertFalse(CachetSignature.objects.exists())

    def test_parametres_invalides(self):
        resp = self.creer(parametres='{pas du json')
        self.assertEqual(resp.status_code, 400)
        resp = self.creer(parametres=json.dumps({'couleur': 'vert'}))
        self.assertEqual(resp.status_code, 400)

    @patch('pieces.views_cachets.CACHETS_MAX', 2)
    def test_plafond_par_operateur(self):
        self.creer()
        self.creer('B')
        resp = self.creer('C')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('nombre maximal', resp.data['detail'])

    def test_non_authentifie(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(URL).status_code, 401)


class ApercuCachetTests(CachetsBaseTest):
    def test_apercu_ne_persiste_rien(self):
        resp = self.client.post(URL + 'apercu/', {
            'fichier': fichier(), 'parametres': json.dumps({'couleur': 'noir'}),
        }, format='multipart')

        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertTrue(resp.data['image'].startswith('data:image/png;base64,'))
        self.assertEqual(resp.data['parametres']['couleur'], 'noir')
        self.assertGreater(resp.data['couverture'], 0)
        self.assertFalse(CachetSignature.objects.exists())

    def test_apercu_depuis_l_original_d_un_cachet(self):
        cachet = self.cachet_en_base(self.agent)
        resp = self.client.post(URL + 'apercu/', {
            'source': str(cachet.pk), 'parametres': json.dumps({'rotation': 90}),
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_apercu_sur_l_original_d_un_autre_refuse(self):
        cachet = self.cachet_en_base(self.collegue)
        resp = self.client.post(URL + 'apercu/', {'source': str(cachet.pk)}, format='json')
        self.assertEqual(resp.status_code, 404)

    def test_apercu_sans_source(self):
        self.assertEqual(self.client.post(URL + 'apercu/', {}, format='json').status_code, 400)


class ModificationCachetTests(CachetsBaseTest):
    def test_renommer(self):
        cachet = self.cachet_en_base(self.agent)
        resp = self.client.patch(f'{URL}{cachet.pk}/', {'nom': 'Nouveau'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        cachet.refresh_from_db()
        self.assertEqual((cachet.nom, cachet.updated_by), ('Nouveau', self.agent))

    def test_reprendre_le_traitement_depuis_l_original(self):
        cachet = self.cachet_en_base(self.agent)
        ancien = cachet.image.name
        resp = self.client.patch(f'{URL}{cachet.pk}/', {
            'parametres': {'couleur': 'noir', 'rotation': 90}}, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)
        cachet.refresh_from_db()
        self.assertEqual(cachet.parametres['couleur'], 'noir')
        self.assertNotEqual(cachet.image.name, ancien)
        self.assertFalse(cachet.image.storage.exists(ancien), "l'ancien PNG doit être retiré")
        self.assertGreater(cachet.hauteur_px, cachet.largeur_px)        # tourné de 90°

    def test_remplacer_l_image(self):
        cachet = self.cachet_en_base(self.agent)
        ancien_original = cachet.image_originale.name
        resp = self.client.patch(f'{URL}{cachet.pk}/', {'fichier': fichier()},
                                 format='multipart')
        self.assertEqual(resp.status_code, 200, resp.data)
        cachet.refresh_from_db()
        self.assertNotEqual(cachet.image_originale.name, ancien_original)

    def test_definir_par_defaut(self):
        a = self.cachet_en_base(self.agent, 'A')
        a.par_defaut = True
        a.save()
        b = self.cachet_en_base(self.agent, 'B')
        self.client.patch(f'{URL}{b.pk}/', {'par_defaut': True}, format='json')
        a.refresh_from_db()
        b.refresh_from_db()
        self.assertEqual((a.par_defaut, b.par_defaut), (False, True))

    def test_originale(self):
        cachet = self.cachet_en_base(self.agent)
        resp = self.client.get(f'{URL}{cachet.pk}/originale/')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data['image'].startswith('data:image/jpeg;base64,'))


class SuppressionCachetTests(CachetsBaseTest):
    def test_suppression_logique_avec_auteur(self):
        cachet = self.cachet_en_base(self.agent)
        resp = self.client.delete(f'{URL}{cachet.pk}/')
        self.assertEqual(resp.status_code, 204)
        cachet.refresh_from_db()
        self.assertTrue(cachet.is_deleted)
        self.assertEqual(cachet.deleted_by, self.agent)
        self.assertIsNotNone(cachet.deleted_at)
        self.assertEqual(self.client.get(URL).data, [])

    def test_le_defaut_passe_au_suivant(self):
        a = self.cachet_en_base(self.agent, 'A')
        b = self.cachet_en_base(self.agent, 'B')
        b.par_defaut = True
        b.save()
        self.client.delete(f'{URL}{b.pk}/')
        a.refresh_from_db()
        self.assertTrue(a.par_defaut)


class ConfidentialiteCachetTests(CachetsBaseTest):
    """Un cachet engage celui qui le porte : il n'est visible et utilisable que par lui."""

    def setUp(self):
        super().setUp()
        self.cachet = self.cachet_en_base(self.collegue, 'Cachet du collègue')

    def test_la_liste_ne_montre_que_ses_propres_cachets(self):
        mien = self.cachet_en_base(self.agent, 'Le mien')
        ids = [c['id'] for c in self.client.get(URL).data]
        self.assertEqual(ids, [str(mien.pk)])

    def test_ni_un_admin_organisation_ni_le_super_admin_ne_le_voient(self):
        for qui in (self.admin_org, self.super_admin):
            self.client.force_authenticate(qui)
            self.assertEqual(self.client.get(URL).data, [], qui.email)
            self.assertEqual(self.client.get(f'{URL}{self.cachet.pk}/').status_code, 404)

    def test_le_cachet_d_un_autre_est_introuvable(self):
        base = f'{URL}{self.cachet.pk}/'
        self.assertEqual(self.client.get(base).status_code, 404)
        self.assertEqual(self.client.get(base + 'originale/').status_code, 404)
        self.assertEqual(self.client.patch(base, {'nom': 'Volé'}, format='json').status_code, 404)
        self.assertEqual(self.client.delete(base).status_code, 404)
        self.cachet.refresh_from_db()
        self.assertEqual((self.cachet.nom, self.cachet.is_deleted), ('Cachet du collègue', False))

    def test_on_ne_peut_pas_apposer_le_cachet_d_un_autre(self):
        with self.assertRaisesMessage(cachet_mod.OptionsCachetInvalides, 'introuvable'):
            cachet_mod.lire_options({'cachet': str(self.cachet.pk)}, self.agent)
        with self.assertRaisesMessage(cachet_mod.OptionsCachetInvalides, 'introuvable'):
            cachet_mod.lire_options({'cachet': str(self.cachet.pk)}, self.super_admin)

    def test_un_cachet_supprime_n_est_plus_apposable(self):
        self.cachet.is_deleted = True
        self.cachet.save()
        with self.assertRaises(cachet_mod.OptionsCachetInvalides):
            cachet_mod.lire_options({'cachet': str(self.cachet.pk)}, self.collegue)

    def test_identifiant_mal_forme(self):
        with self.assertRaises(cachet_mod.OptionsCachetInvalides):
            cachet_mod.lire_options({'cachet': 'pas-un-uuid'}, self.agent)

    def test_sans_cachet_aucune_option(self):
        self.assertIsNone(cachet_mod.lire_options({}, self.agent))


# =========================================================================== rapport

class RapportAvecCachetTests(CachetsBaseTest):
    """Les options circulent par la résolution commune de portée vers les trois chemins
    de rendu. Le rendu WeasyPrint est bouché (cf. `tests_rapport_async`)."""

    def setUp(self):
        super().setUp()
        projet = Projet.objects.create(nom_projet='P', code_projet='P-CS-1',
                                       organization=self.org, created_by=self.agent)
        propriete = Propriete.objects.create(nom_propriete='X', id_titre='T1/A', projet=projet)
        affaire = Affaire.objects.create(
            numero_sd_affaire=1, nature_procedure_affaire='IFF', nature_affaire='BI',
            date_bornage=datetime(2023, 4, 9, tzinfo=dt_timezone.utc), propriete=propriete)
        self.ssdgps = Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=1,
                                            type_ssdgps='mono-session', affaire=affaire)
        Piece.objects.create(ssdgps=self.ssdgps, type_piece='LPA', ordre=0,
                             statut=Piece.Statut.VALIDE, payload={'rows': [{'a': 1}]})
        self.cachet = self.cachet_en_base(self.agent, 'Cabinet Géo')

    def _query(self, **extra):
        params = {'ssdgps': self.ssdgps.pk, 'cachet': self.cachet.pk,
                  'cachet_position': 'bas-centre', 'cachet_taille': 50,
                  'cachet_pages': 'sauf-garde', **extra}
        return '&'.join(f'{k}={v}' for k, v in params.items())

    @patch('pieces.views.render_report_pdf', return_value=PDF_FACTICE)
    def test_rapport_synchrone_recoit_le_cachet_et_le_journalise(self, rendu):
        resp = self.client.get(f'/api/v1/pieces/report/?{self._query()}')

        self.assertEqual(resp.status_code, 200, getattr(resp, 'data', None))
        options = rendu.call_args.kwargs['cachet']
        self.assertEqual((options.position, options.largeur_mm, options.pages, options.nom),
                         ('bas-centre', 50.0, 'sauf-garde', 'Cabinet Géo'))
        self.assertTrue(options.image_png.startswith(b'\x89PNG'))
        evenement = AuditEvent.objects.filter(action=AuditEvent.ACTION_RAPPORT_GENERE).last()
        self.assertEqual(evenement.details['cachet']['nom'], 'Cabinet Géo')
        self.cachet.refresh_from_db()
        self.assertIsNotNone(self.cachet.derniere_utilisation)

    @patch('pieces.views.render_report_pdf', return_value=PDF_FACTICE)
    def test_sans_cachet_rien_n_est_appose(self, rendu):
        resp = self.client.get(f'/api/v1/pieces/report/?ssdgps={self.ssdgps.pk}')
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(rendu.call_args.kwargs['cachet'])

    @patch('pieces.views.render_cover_pdf', return_value=PDF_FACTICE)
    def test_apercu_de_la_garde_recoit_le_cachet(self, rendu):
        resp = self.client.get(f'/api/v1/pieces/report-cover/?{self._query()}')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(rendu.call_args.kwargs['cachet'].cachet_id, str(self.cachet.pk))

    @patch('pieces.views.render_report_pdf', return_value=PDF_FACTICE)
    def test_reglages_invalides_refuses_avant_rendu(self, rendu):
        for extra in ({'cachet_taille': 500}, {'cachet_position': 'haut'},
                      {'cachet_pages': 'paires'}):
            resp = self.client.get(f'/api/v1/pieces/report/?{self._query(**extra)}')
            self.assertEqual(resp.status_code, 400, extra)
        rendu.assert_not_called()

    @patch('pieces.views.render_report_pdf', return_value=PDF_FACTICE)
    def test_cachet_d_un_autre_refuse(self, rendu):
        autre = self.cachet_en_base(self.collegue)
        resp = self.client.get(f'/api/v1/pieces/report/?{self._query(cachet=autre.pk)}')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['detail'], 'Cachet introuvable.')
        rendu.assert_not_called()

    @patch('pieces.tasks.render_report_pdf', return_value=PDF_FACTICE)
    def test_tache_de_fond_garde_et_applique_le_cachet(self, rendu):
        resp = self.client.post(f'/api/v1/pieces/report-async/?{self._query()}')

        self.assertEqual(resp.status_code, 202, resp.data)
        self.assertEqual(resp.data['statut'], 'termine', resp.data)
        self.assertEqual(resp.data['cachet_options']['position'], 'bas-centre')
        generation = RapportGeneration.objects.get(pk=resp.data['id'])
        self.assertEqual(generation.cachet, self.cachet)
        options = rendu.call_args.kwargs['cachet']
        self.assertEqual((options.position, options.largeur_mm, options.pages),
                         ('bas-centre', 50, 'sauf-garde'))

    @patch('pieces.tasks.render_report_pdf', return_value=PDF_FACTICE)
    def test_tache_sans_cachet(self, rendu):
        resp = self.client.post(f'/api/v1/pieces/report-async/?ssdgps={self.ssdgps.pk}')
        self.assertEqual(resp.data['statut'], 'termine')
        self.assertIsNone(rendu.call_args.kwargs['cachet'])

    @patch('pieces.tasks.render_report_pdf', return_value=PDF_FACTICE)
    def test_cachet_supprime_avant_le_rendu_fait_echouer_clairement(self, rendu):
        from pieces.tasks import generer_rapport
        generation = RapportGeneration.objects.create(
            ssdgps=self.ssdgps, created_by=self.agent, cachet=self.cachet,
            cachet_options={'cachet': str(self.cachet.pk), 'position': 'bas-droite',
                            'taille': 45, 'pages': 'toutes'})
        self.cachet.is_deleted = True
        self.cachet.save()

        generer_rapport(str(generation.pk))

        generation.refresh_from_db()
        self.assertEqual(generation.statut, RapportGeneration.Statut.ECHEC)
        self.assertIn('cachet choisi a été supprimé', generation.erreur)
        rendu.assert_not_called()
