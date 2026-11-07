"""
Validation et normalisation des photos de profil (`CustomUser.profile_picture`).

Pendant longtemps ce champ n'avait **ni plafond ni redimensionnement**, contrairement aux
images de pièces (`pieces/validators.py` + `pieces/imaging.py`). Conséquence mesurée sur
la base de développement : 15 photos pesaient 18 Mo — 64 % de tous les médias de l'app
pour 4 % des fichiers, dont des captures d'écran et des cartes de plusieurs Mo.

Ce module applique aux avatars les mêmes garde-fous que les images de pièces :
extension autorisée, contenu réellement décodable, plafond du fichier reçu — puis
réduit l'image à `settings.PROFILE_PICTURE_MAX_DIMENSIONS` et la ré-encode. Une photo
de profil ne s'affiche jamais plus grande qu'une vignette : conserver l'original est
du stockage payé pour rien.
"""
import os
from io import BytesIO

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile

# Alignée sur `allowedPhotoExtensions` du composant de profil Angular : toute divergence
# ferait accepter un fichier par le front pour le voir rejeté par le serveur. Les formats
# non affichables en <img> (TIFF) sont acceptés car la normalisation les ré-encode.
ALLOWED_AVATAR_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.tif', '.tiff', '.webp'}


def validate_avatar_extension(value):
    ext = os.path.splitext(value.name)[1].lower()
    if ext not in ALLOWED_AVATAR_EXTENSIONS:
        raise ValidationError(
            f"Extension « {ext} » non autorisée pour une photo de profil. "
            f"Formats acceptés : {', '.join(sorted(ALLOWED_AVATAR_EXTENSIONS))}."
        )


def validate_avatar_size(value):
    """Plafond du fichier REÇU. Large à dessein : l'image est de toute façon réduite
    ensuite, ce contrôle ne sert qu'à rejeter tôt un envoi manifestement abusif."""
    max_mb = getattr(settings, 'PROFILE_PICTURE_MAX_UPLOAD_MB', 5)
    if value.size > max_mb * 1024 * 1024:
        taille = value.size / (1024 * 1024)
        raise ValidationError(
            f"Photo de profil trop volumineuse ({taille:.1f} Mo) : maximum {max_mb} Mo."
        )


def validate_avatar_content(value):
    """Vérifie que le fichier est réellement une image décodable (défense en profondeur,
    au-delà de l'extension — même approche que `pieces.validators.validate_image_content`)."""
    from PIL import Image, UnidentifiedImageError
    try:
        value.seek(0)
        Image.open(value).verify()
    except (UnidentifiedImageError, OSError):
        raise ValidationError("Le fichier fourni n'est pas une image valide.")
    finally:
        try:
            value.seek(0)
        except Exception:
            pass


def validate_avatar(value):
    """Les trois contrôles, dans l'ordre du moins au plus coûteux."""
    validate_avatar_extension(value)
    validate_avatar_size(value)
    validate_avatar_content(value)


def normalize_avatar(django_file):
    """Réduit la photo à `PROFILE_PICTURE_MAX_DIMENSIONS` et la ré-encode.

    Renvoie `(ContentFile, nom_de_fichier)`, ou `None` si l'image n'est pas exploitable —
    l'appelant conserve alors le fichier d'origine plutôt que de perdre la photo.

    Encodage : PNG si l'image a de la transparence (préserver un logo/avatar détouré),
    JPEG sinon — bien plus compact pour une photographie. Les proportions sont toujours
    conservées (`thumbnail` n'agrandit jamais : une petite photo reste intacte)."""
    from PIL import Image

    max_size = getattr(settings, 'PROFILE_PICTURE_MAX_DIMENSIONS', (512, 512))
    quality = getattr(settings, 'PROFILE_PICTURE_JPEG_QUALITY', 85)
    base = os.path.splitext(os.path.basename(getattr(django_file, 'name', 'avatar')))[0]

    try:
        django_file.seek(0)
        with Image.open(django_file) as im:
            transparent = im.mode in ('RGBA', 'LA') or (
                im.mode == 'P' and 'transparency' in im.info)
            out = im.convert('RGBA') if transparent else im.convert('RGB')
            out.thumbnail(max_size)          # proportions conservées, jamais d'agrandissement

            buf = BytesIO()
            if transparent:
                out.save(buf, format='PNG', optimize=True)
                nom = f'{base}.png'
            else:
                out.save(buf, format='JPEG', quality=quality, optimize=True)
                nom = f'{base}.jpg'
            return ContentFile(buf.getvalue()), nom
    except Exception:
        return None
    finally:
        try:
            django_file.seek(0)
        except Exception:
            pass
