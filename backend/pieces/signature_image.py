"""
Traitement de l'image d'un cachet + signature : ne garder QUE l'encre.

L'opérateur photographie (ou numérise) une feuille portant son cachet et sa signature.
L'image brute porte tout ce qui nuirait une fois apposée sur le rapport : le blanc — ou
plutôt le gris, le jaune, le bleuté — du papier, une ombre portée par le téléphone, un
éclairage inégal, du grain, le quadrillage d'un cahier. Apposée telle quelle, elle
dessinerait un rectangle sale sur chaque page.

Le traitement produit un PNG **transparent** où seule l'encre subsiste :

1. orientation EXIF, rotation et recadrage demandés par l'opérateur ;
2. **estimation du fond** : le papier est ce qui reste quand on « efface » l'encre — un
   filtre maximum à basse résolution (l'encre est plus sombre que le papier, le maximum
   local la fait disparaître), lissé puis remis à l'échelle. On obtient une carte de
   l'éclairage, ombres et dégradés compris ;
3. **force de l'encre** = écart au fond, canal par canal, le plus fort l'emporte : une
   encre bleue claire (tampon) ressort par son canal rouge, une encre noire par tous ;
4. **seuil automatique** calé sur le bruit du papier (la grande majorité des pixels) et
   ajusté par la *sensibilité* choisie ; rampe douce entre deux seuils → bords lissés,
   sans crénelage ni halo ;
5. couleur : encre d'origine (« dé-mélangée » du blanc pour retrouver sa vraie teinte),
   ou encre bleue / noire uniforme ;
6. nettoyage des points isolés, recadrage automatique sur l'encre.

Pillow seul — ni numpy ni OpenCV : l'image de production n'embarque que Pillow, et le
traitement doit donner le même résultat partout (aperçu interactif comme enregistrement).
Les opérations reposent sur `ImageChops`, `ImageFilter` et `ImageMath.lambda_eval`
(disponible dès Pillow 10.3), toutes vectorisées en C.
"""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

from PIL import Image, ImageChops, ImageFilter, ImageMath, ImageOps, UnidentifiedImageError

#: Côté maximal traité (px). Au-delà, l'image est réduite : 2 400 px couvrent largement
#: une feuille A5 photographiée, et bornent le temps d'un aperçu interactif.
COTE_MAX_TRAITEMENT = 2400

#: Côté maximal du PNG enregistré (px) : 1 200 px ≈ 300 dpi sur 100 mm, la plus grande
#: taille d'apposition proposée. Plus serait du poids mort dans chaque rapport.
COTE_MAX_RESULTAT = 1200

#: Taille maximale du fichier source accepté (octets).
TAILLE_MAX_SOURCE = 15 * 1024 * 1024

COULEURS = ('origine', 'bleu', 'noir')
ROTATIONS = (0, 90, 180, 270)

#: Teintes des encres uniformes — celles d'un stylo et d'un tampon réels, pas des
#: primaires criardes : apposées, elles doivent passer pour de l'encre.
TEINTES = {
    'bleu': (24, 52, 148),
    'noir': (22, 22, 26),
}

PARAMETRES_DEFAUT = {
    'sensibilite': 50,      # 0 = ne garde que l'encre franche, 100 = garde les traits pâles
    'couleur': 'origine',
    'lissage': True,
    'rotation': 0,
    'cadre': None,          # {x, y, l, h} en fractions [0, 1] de l'image orientée
}


class ImageSignatureInvalide(ValueError):
    """Fichier illisible, vide, trop volumineux ou sans encre détectable."""


@dataclass
class ResultatTraitement:
    image: Image.Image          # RGBA, fond transparent, recadrée sur l'encre
    seuil: int                  # seuil bas retenu (0–255), utile au diagnostic
    couverture: float           # part de pixels d'encre dans le résultat (0–1)

    @property
    def largeur(self) -> int:
        return self.image.width

    @property
    def hauteur(self) -> int:
        return self.image.height

    def png(self) -> bytes:
        tampon = BytesIO()
        self.image.save(tampon, format='PNG', optimize=True)
        return tampon.getvalue()


# --------------------------------------------------------------------------- paramètres

def normaliser_parametres(brut) -> dict:
    """Valide et complète les paramètres de traitement. Lève `ValueError` (message en
    français) sur une valeur hors domaine ; ignore les clés inconnues."""
    brut = brut or {}
    if not isinstance(brut, dict):
        raise ValueError('Les paramètres de traitement doivent être un objet.')
    p = dict(PARAMETRES_DEFAUT)

    if brut.get('sensibilite') is not None:
        try:
            s = int(round(float(brut['sensibilite'])))
        except (TypeError, ValueError):
            raise ValueError('La sensibilité doit être un nombre entre 0 et 100.')
        if not 0 <= s <= 100:
            raise ValueError('La sensibilité doit être comprise entre 0 et 100.')
        p['sensibilite'] = s

    if brut.get('couleur') is not None:
        if brut['couleur'] not in COULEURS:
            raise ValueError("Couleur d'encre inconnue : choisissez origine, bleu ou noir.")
        p['couleur'] = brut['couleur']

    if brut.get('lissage') is not None:
        p['lissage'] = bool(brut['lissage'])

    if brut.get('rotation') is not None:
        try:
            r = int(brut['rotation']) % 360
        except (TypeError, ValueError):
            raise ValueError('La rotation doit valoir 0, 90, 180 ou 270.')
        if r not in ROTATIONS:
            raise ValueError('La rotation doit valoir 0, 90, 180 ou 270.')
        p['rotation'] = r

    cadre = brut.get('cadre')
    if cadre:
        try:
            x, y = float(cadre['x']), float(cadre['y'])
            l, h = float(cadre['l']), float(cadre['h'])
        except (TypeError, ValueError, KeyError):
            raise ValueError('Le cadre doit porter x, y, l et h (fractions de 0 à 1).')
        x, y = max(0.0, min(x, 1.0)), max(0.0, min(y, 1.0))
        l, h = min(l, 1.0 - x), min(h, 1.0 - y)
        if l < 0.02 or h < 0.02:
            raise ValueError('Le cadre de recadrage est trop petit.')
        p['cadre'] = {'x': round(x, 4), 'y': round(y, 4), 'l': round(l, 4), 'h': round(h, 4)}
    else:
        p['cadre'] = None
    return p


# --------------------------------------------------------------------------- ouverture

def ouvrir_image(source) -> Image.Image:
    """Ouvre la source (bytes ou fichier) en RGB orienté, fond aplati sur du blanc."""
    try:
        if isinstance(source, (bytes, bytearray)):
            if len(source) > TAILLE_MAX_SOURCE:
                raise ImageSignatureInvalide('Image trop volumineuse (15 Mo au maximum).')
            image = Image.open(BytesIO(source))
        else:
            taille = getattr(source, 'size', None)
            if taille and taille > TAILLE_MAX_SOURCE:
                raise ImageSignatureInvalide('Image trop volumineuse (15 Mo au maximum).')
            if hasattr(source, 'seek'):
                source.seek(0)
            image = Image.open(source)
        image.load()
    except ImageSignatureInvalide:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise ImageSignatureInvalide(
            "Image illisible : déposez une photo ou un scan (JPEG, PNG, WebP, TIFF…).")

    image = ImageOps.exif_transpose(image)
    if image.mode in ('RGBA', 'LA', 'PA') or (image.mode == 'P' and 'transparency' in image.info):
        # Une image déjà détourée : sa transparence devient du papier blanc, que le
        # traitement retirera comme le reste.
        rgba = image.convert('RGBA')
        fond = Image.new('RGBA', rgba.size, (255, 255, 255, 255))
        image = Image.alpha_composite(fond, rgba)
    return image.convert('RGB')


def _orienter_et_recadrer(image: Image.Image, p: dict) -> Image.Image:
    if p['rotation']:
        # PIL tourne dans le sens trigonométrique : 90° « horaire » = -90°.
        image = image.rotate(-p['rotation'], expand=True)
    cadre = p.get('cadre')
    if cadre:
        w, h = image.size
        gauche, haut = int(cadre['x'] * w), int(cadre['y'] * h)
        droite = max(gauche + 1, int(round((cadre['x'] + cadre['l']) * w)))
        bas = max(haut + 1, int(round((cadre['y'] + cadre['h']) * h)))
        image = image.crop((gauche, haut, droite, bas))
    cote = max(image.size)
    if cote > COTE_MAX_TRAITEMENT:
        facteur = COTE_MAX_TRAITEMENT / cote
        image = image.resize((max(1, round(image.width * facteur)),
                              max(1, round(image.height * facteur))), Image.LANCZOS)
    return image


# --------------------------------------------------------------------------- étapes

def _estimer_fond(image: Image.Image) -> Image.Image:
    """Carte d'éclairage du papier (RGB, même taille que l'image).

    Filtre MAXIMUM à basse résolution : l'encre, plus sombre que le papier, disparaît au
    profit du papier qui l'entoure. Le noyau couvre ~6 % du plus grand côté — plus large
    que le trait d'une signature ou d'un cadre de tampon, plus étroit qu'une ombre.
    Deux passes croisées (max puis flou) donnent une surface lisse, sans marches."""
    w, h = image.size
    echelle = max(1, max(w, h) // 160)          # ~160 px de côté pour l'estimation
    petit = image.resize((max(1, w // echelle), max(1, h // echelle)), Image.BOX)
    noyau = max(3, (max(petit.size) * 6 // 100) | 1)
    petit = petit.filter(ImageFilter.MaxFilter(noyau))
    petit = petit.filter(ImageFilter.GaussianBlur(noyau / 2))
    return petit.resize((w, h), Image.BILINEAR)


def _force_encre(image: Image.Image, fond: Image.Image):
    """(force, ecarts) — `force` (L) = écart au papier sur le canal le plus marqué ;
    `ecarts` = les écarts par canal (R, G, B), qui servent à retrouver la teinte."""
    ecart = ImageChops.subtract(fond, image)            # fond - pixel, borné à 0
    r, g, b = ecart.split()
    force = ImageChops.lighter(ImageChops.lighter(r, g), b)
    return force, (r, g, b)


def _percentile(histogramme, fraction: float) -> int:
    total = sum(histogramme)
    if not total:
        return 0
    cible, cumul = total * fraction, 0
    for valeur, compte in enumerate(histogramme):
        cumul += compte
        if cumul >= cible:
            return valeur
    return 255


def _seuils(force: Image.Image, sensibilite: int) -> tuple[int, int]:
    """Seuils bas/haut de la rampe d'opacité.

    Le papier occupe la grande majorité de l'image : son bruit se lit sur la médiane et
    le 90e centile de la force. Le seuil bas se pose juste au-dessus, d'une marge que
    règle la sensibilité (50 → marge standard ; 100 → au ras du bruit, pour un tampon
    pâle ; 0 → seule l'encre franche passe). Le seuil haut ouvre une rampe de transition
    dont la largeur donne des bords doux."""
    histo = force.histogram()
    p50 = _percentile(histo, 0.50)
    p90 = _percentile(histo, 0.90)
    bruit = max(p90, p50 + 2)
    marge = 4 + (100 - sensibilite) * 0.55              # 59 px … 4 px
    bas = int(round(min(200, bruit + marge)))
    haut = int(round(min(255, bas + 28 + (100 - sensibilite) * 0.25)))
    return bas, max(haut, bas + 8)


def _rampe(bas: int, haut: int):
    etendue = float(haut - bas)

    def f(v):
        if v <= bas:
            return 0
        if v >= haut:
            return 255
        t = (v - bas) / etendue
        return int(round(255 * t * t * (3 - 2 * t)))   # smoothstep : sans cassure
    return f


def _couleur_origine(ecarts, alpha: Image.Image, force: Image.Image) -> Image.Image:
    """Teinte réelle de l'encre, « dé-mélangée » du papier.

    Un pixel de bord (encre partielle) a une teinte délavée par le blanc. On ramène
    chaque canal à la proportion de l'encre pure : composante = 255 − écart × 255 / force,
    puis on assombrit légèrement (×0,85) — l'encre apposée sur un rapport imprimé doit
    tenir la comparaison avec un vrai tampon, pas paraître pastel."""
    canaux = []
    for ecart in ecarts:
        # Arithmétique entière (mode « I ») : `lambda_eval` refuse les flottants.
        canal = ImageMath.lambda_eval(
            lambda a: a['convert'](
                a['max'](a['min'](255 - a['e'] * 255 / a['max'](a['f'], 1), 255), 0)
                * 85 / 100, 'L'),
            e=ecart, f=force,
        )
        canaux.append(canal)
    return Image.merge('RGBA', (*canaux, alpha))


def _recadrer_sur_encre(image: Image.Image) -> Image.Image:
    alpha = image.getchannel('A')
    boite = alpha.point(lambda v: 255 if v > 48 else 0).getbbox()
    if not boite:
        return image
    g, h, d, b = boite
    marge = max(4, round(max(d - g, b - h) * 0.03))
    return image.crop((max(0, g - marge), max(0, h - marge),
                       min(image.width, d + marge), min(image.height, b + marge)))


# --------------------------------------------------------------------------- traitement

def traiter(source, parametres=None) -> ResultatTraitement:
    """Traite une image de cachet + signature. `source` : bytes ou fichier.

    Lève `ImageSignatureInvalide` si l'image est illisible ou ne porte aucune encre."""
    p = normaliser_parametres(parametres)
    image = _orienter_et_recadrer(ouvrir_image(source), p)
    if image.width < 16 or image.height < 16:
        raise ImageSignatureInvalide("Image trop petite : la zone retenue doit faire au moins 16 px.")

    fond = _estimer_fond(image)
    force_brute, ecarts = _force_encre(image, fond)
    bas, haut = _seuils(force_brute, p['sensibilite'])

    force = force_brute
    if p['lissage']:
        # Le grain du capteur et la texture du papier font des points isolés que le
        # seuil laisserait passer : un médian 3×3 les efface sans entamer les traits.
        force = force.filter(ImageFilter.MedianFilter(3))
    alpha = force.point(_rampe(bas, haut))
    if p['lissage']:
        alpha = alpha.filter(ImageFilter.GaussianBlur(0.6))

    if p['couleur'] == 'origine':
        resultat = _couleur_origine(ecarts, alpha, force_brute)
    else:
        resultat = Image.new('RGBA', image.size, TEINTES[p['couleur']] + (255,))
        resultat.putalpha(alpha)

    # Là où il n'y a pas d'encre, la couleur est invisible mais bien présente — et
    # bruitée (mode « origine ») : on l'uniformise, ce qui divise le poids du PNG.
    vide = Image.new('RGBA', resultat.size, (0, 0, 0, 0))
    resultat = Image.composite(resultat, vide, alpha.point(lambda v: 255 if v else 0))

    resultat = _recadrer_sur_encre(resultat)
    if max(resultat.size) > COTE_MAX_RESULTAT:
        facteur = COTE_MAX_RESULTAT / max(resultat.size)
        resultat = resultat.resize((max(1, round(resultat.width * facteur)),
                                    max(1, round(resultat.height * facteur))), Image.LANCZOS)

    histo_alpha = resultat.getchannel('A').histogram()
    encre = sum(histo_alpha[64:])
    couverture = encre / float(resultat.width * resultat.height or 1)
    if encre < 40:
        raise ImageSignatureInvalide(
            "Aucune encre détectée : vérifiez le cadrage ou augmentez la sensibilité.")
    return ResultatTraitement(image=resultat, seuil=bas, couverture=round(couverture, 4))
