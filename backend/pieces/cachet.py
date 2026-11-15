"""
Apposition du cachet + signature sur les pages du rapport PDF.

Après impression, l'opérateur tamponnait et signait chaque page à la main — des dizaines
par SDGPS. L'application appose désormais elle-même, s'il le demande, le cachet qu'il a
enregistré (cf. `CachetSignature`, image détourée par `signature_image.traiter`).

Le cachet est posé dans la **surimpression finale** (`report._overlay_global_pagination`),
celle qui imprime déjà la pagination globale « Page i/n », et **par-dessus** le contenu,
comme un vrai tampon. L'image, ramenée à 300 dpi pour la taille demandée, n'est
embarquée qu'**une seule fois** : un calque unique est fusionné sur chaque page avec la
transformation propre à son format (portrait, paysage) — le PDF ne grossit pas avec le
nombre de pages.

Options de la demande de rapport (paramètres de requête, cf. `lire_options`) :
- `cachet`          : identifiant du cachet (obligatoirement celui de l'appelant) ;
- `cachet_position` : `bas-droite` (défaut) | `bas-centre` | `bas-gauche` ;
- `cachet_taille`   : largeur en mm (25 à 90, défaut 45) ;
- `cachet_pages`    : `toutes` (défaut) | `sauf-garde` (pas sur la page de garde du SDGPS).
Les pages blanches de calage du recto-verso ne reçoivent jamais de cachet.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from io import BytesIO

POSITIONS = ('bas-droite', 'bas-centre', 'bas-gauche')
PAGES = ('toutes', 'sauf-garde')
TAILLE_MIN_MM, TAILLE_MAX_MM, TAILLE_DEFAUT_MM = 25, 90, 45

#: Hauteur maximale du cachet (mm) : au-delà, la largeur est réduite pour conserver les
#: proportions. Un cachet très haut mangerait le bas du tableau.
HAUTEUR_MAX_MM = 60
#: Retrait depuis le bord latéral de la page (mm).
MARGE_LATERALE_MM = 12
#: Bas du cachet au-dessus du bord bas (mm) : le pied de page (identification +
#: pagination) occupe les 10 derniers millimètres ; le cachet se pose juste au-dessus.
MARGE_BASSE_MM = 12

_MM_TO_PT = 72.0 / 25.4


@dataclass
class OptionsCachet:
    image_png: bytes
    position: str = 'bas-droite'
    largeur_mm: float = TAILLE_DEFAUT_MM
    pages: str = 'toutes'
    nom: str = ''
    cachet_id: str = ''
    _calques: dict = field(default_factory=dict, repr=False)

    def resume(self) -> dict:
        """Ce que l'on garde d'une demande (suivi asynchrone, journal d'audit)."""
        return {'cachet': self.cachet_id, 'nom': self.nom, 'position': self.position,
                'taille': self.largeur_mm, 'pages': self.pages}


class OptionsCachetInvalides(ValueError):
    pass


def valider_reglages(position=None, taille=None, pages=None) -> dict:
    """Valide les réglages d'apposition (hors choix du cachet). Lève
    `OptionsCachetInvalides` avec un message en français."""
    position = (position or 'bas-droite').strip()
    if position not in POSITIONS:
        raise OptionsCachetInvalides(
            'Position du cachet inconnue : bas-droite, bas-centre ou bas-gauche.')
    pages = (pages or 'toutes').strip()
    if pages not in PAGES:
        raise OptionsCachetInvalides("Pages du cachet inconnues : « toutes » ou « sauf-garde ».")
    if taille in (None, ''):
        largeur = float(TAILLE_DEFAUT_MM)
    else:
        try:
            largeur = float(taille)
        except (TypeError, ValueError):
            raise OptionsCachetInvalides('La taille du cachet doit être un nombre de millimètres.')
        if not TAILLE_MIN_MM <= largeur <= TAILLE_MAX_MM:
            raise OptionsCachetInvalides(
                f'La taille du cachet doit être comprise entre {TAILLE_MIN_MM} et '
                f'{TAILLE_MAX_MM} mm.')
    return {'position': position, 'largeur_mm': round(largeur, 1), 'pages': pages}


def lire_options(params, utilisateur):
    """Options de cachet d'une demande de rapport, ou `None` si aucun cachet n'est demandé.

    Le cachet doit appartenir à l'appelant : une signature est personnelle, nul ne peut
    apposer celle d'un autre — pas même un administrateur. Un identifiant étranger est
    traité comme introuvable (on ne confirme pas son existence)."""
    from .models import CachetSignature

    cachet_id = (params.get('cachet') or '').strip()
    if not cachet_id:
        return None
    reglages = valider_reglages(params.get('cachet_position'), params.get('cachet_taille'),
                                params.get('cachet_pages'))
    try:
        cachet = CachetSignature.objects.filter(
            pk=cachet_id, proprietaire=utilisateur, is_deleted=False).first()
    except Exception:  # identifiant mal formé (UUID invalide)
        cachet = None
    if cachet is None or not cachet.image:
        raise OptionsCachetInvalides('Cachet introuvable.')
    return depuis_cachet(cachet, **reglages)


def depuis_cachet(cachet, position='bas-droite', largeur_mm=TAILLE_DEFAUT_MM, pages='toutes'):
    with cachet.image.open('rb') as f:
        image_png = f.read()
    return OptionsCachet(image_png=image_png, position=position, largeur_mm=float(largeur_mm),
                         pages=pages, nom=cachet.nom, cachet_id=str(cachet.pk))


def geometrie(options: OptionsCachet, largeur_page_pt: float, hauteur_page_pt: float,
              ratio: float) -> tuple[float, float, float, float]:
    """(x, y, l, h) du cachet en points PDF, origine en bas à gauche.

    `ratio` = hauteur / largeur de l'image. La hauteur est plafonnée (`HAUTEUR_MAX_MM`),
    la largeur suit pour garder les proportions."""
    l = options.largeur_mm * _MM_TO_PT
    h = l * ratio
    h_max = HAUTEUR_MAX_MM * _MM_TO_PT
    if h > h_max:
        h, l = h_max, h_max / ratio
    marge = MARGE_LATERALE_MM * _MM_TO_PT
    if options.position == 'bas-gauche':
        x = marge
    elif options.position == 'bas-centre':
        x = (largeur_page_pt - l) / 2
    else:
        x = largeur_page_pt - marge - l
    return x, MARGE_BASSE_MM * _MM_TO_PT, l, h


#: Résolution d'apposition : celle d'une impression de qualité. Au-delà, du poids mort.
DPI_APPOSITION = 300


def _calque_unitaire(options: OptionsCachet):
    """(page, largeur_px, hauteur_px) — page PDF portant SEULEMENT l'image du cachet, à
    raison d'un point par pixel. Construite une fois par demande, puis fusionnée sur
    chaque page avec la transformation qui la met en place (`apposer`).

    L'image est d'abord ramenée à `DPI_APPOSITION` pour la taille demandée : un cachet
    de 45 mm n'a besoin que d'environ 530 px de large."""
    if 'unitaire' in options._calques:
        return options._calques['unitaire']

    from PIL import Image
    from pypdf import PdfReader
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    image = Image.open(BytesIO(options.image_png))
    image.load()
    image = image.convert('RGBA')
    cible = max(1, round(TAILLE_MAX_MM / 25.4 * DPI_APPOSITION))
    cible = min(cible, round(options.largeur_mm / 25.4 * DPI_APPOSITION))
    if image.width > cible:
        image = image.resize((cible, max(1, round(image.height * cible / image.width))),
                             Image.LANCZOS)
    largeur_px, hauteur_px = image.size

    tampon = BytesIO()
    c = canvas.Canvas(tampon, pagesize=(largeur_px, hauteur_px))
    # `mask='auto'` : la couche alpha du PNG devient un masque doux — seule l'encre est
    # posée, les bords restent lissés, le contenu de la page transparaît partout ailleurs.
    c.drawImage(ImageReader(image), 0, 0, width=largeur_px, height=hauteur_px, mask='auto')
    c.showPage()
    c.save()
    tampon.seek(0)
    resultat = (PdfReader(tampon).pages[0], largeur_px, hauteur_px)
    options._calques['unitaire'] = resultat
    return resultat


def apposer(page, options: OptionsCachet, largeur_page_pt: float, hauteur_page_pt: float):
    """Fusionne le cachet PAR-DESSUS `page` (pypdf), à sa place sur ce format de page.

    Toutes les pages fusionnent le MÊME calque (transformé différemment selon le
    format) : l'image n'est embarquée qu'une seule fois dans le PDF final, quel que soit
    le nombre de pages et le mélange portrait / paysage."""
    from pypdf import Transformation

    unitaire, largeur_px, hauteur_px = _calque_unitaire(options)
    x, y, l, h = geometrie(options, largeur_page_pt, hauteur_page_pt,
                           hauteur_px / float(largeur_px or 1))
    page.merge_transformed_page(
        unitaire,
        Transformation().scale(l / largeur_px, h / hauteur_px).translate(x, y),
    )


def doit_apposer(options: OptionsCachet | None, index_page: int, pages_garde: int,
                 blanche: bool) -> bool:
    """Le cachet va-t-il sur cette page (index 0-based du document final) ?"""
    if options is None or blanche:
        return False
    if options.pages == 'sauf-garde' and index_page < pages_garde:
        return False
    return True


def apposer_sur_pdf(pdf_bytes: bytes, options: OptionsCachet | None, pages_garde: int = 0) -> bytes:
    """Appose le cachet sur un PDF déjà rendu (aperçu de la page de garde)."""
    if options is None:
        return pdf_bytes
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(BytesIO(pdf_bytes))
    writer = PdfWriter()
    for index, page in enumerate(reader.pages):
        if doit_apposer(options, index, pages_garde, blanche=False):
            if page.rotation:
                page.transfer_rotation_to_content()
            apposer(page, options, float(page.mediabox.width), float(page.mediabox.height))
        writer.add_page(page)
    sortie = BytesIO()
    writer.write(sortie)
    return sortie.getvalue()
