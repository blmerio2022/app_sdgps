"""
API des cachets + signatures de l'opérateur — `/api/v1/cachets-signatures/`.

- `GET    /`                 — ses cachets (le défaut en tête) ;
- `POST   /`                 — dépôt d'une image (multipart : `fichier`, `nom`,
                               `parametres` JSON, `par_defaut`) → traitée et enregistrée ;
- `PATCH  /<id>/`            — renommer, changer le défaut, reprendre le traitement
                               (`parametres`, re-calculé depuis l'original) ou remplacer
                               l'image (`fichier`) ;
- `DELETE /<id>/`            — suppression logique ;
- `POST   /apercu/`          — traitement À BLANC, rien n'est enregistré : `fichier` (ou
                               `source=<id>` pour repartir de l'original d'un cachet) +
                               `parametres`. Alimente l'aperçu interactif de l'éditeur ;
- `GET    /<id>/originale/`  — l'image d'origine, pour reprendre le traitement.

Tout est **strictement personnel** : le queryset est celui du seul appelant, quel que
soit son rôle. Un identifiant étranger répond 404 — on ne confirme pas son existence.
"""
import base64
import json

from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone
from rest_framework import mixins, parsers, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import CachetSignature
from .serializers import CachetSignatureSerializer
from .signature_image import ImageSignatureInvalide, normaliser_parametres, traiter

#: Nombre maximal de cachets vivants par opérateur.
CACHETS_MAX = 20


def _data_url(png: bytes) -> str:
    return 'data:image/png;base64,' + base64.b64encode(png).decode('ascii')


def _lire_parametres(request):
    """Paramètres de traitement : objet JSON (corps JSON) ou chaîne JSON (multipart)."""
    brut = request.data.get('parametres')
    if isinstance(brut, str):
        brut = brut.strip()
        if not brut:
            return normaliser_parametres(None)
        try:
            brut = json.loads(brut)
        except ValueError:
            raise ValueError('Paramètres de traitement illisibles (JSON attendu).')
    return normaliser_parametres(brut)


def _booleen(valeur):
    if isinstance(valeur, bool):
        return valeur
    return str(valeur or '').strip().lower() in ('1', 'true', 'oui', 'yes', 'on')


class CachetSignatureViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin,
                             mixins.DestroyModelMixin, viewsets.GenericViewSet):
    serializer_class = CachetSignatureSerializer
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [parsers.MultiPartParser, parsers.FormParser, parsers.JSONParser]
    pagination_class = None

    def get_queryset(self):
        # Personnel, sans exception de rôle (cf. docstring du module).
        return CachetSignature.objects.filter(
            proprietaire=self.request.user, is_deleted=False,
        ).select_related('created_by', 'updated_by', 'deleted_by')

    # ------------------------------------------------------------------ helpers

    def _erreur(self, message, code=status.HTTP_400_BAD_REQUEST):
        return Response({'detail': message}, status=code)

    def _definir_defaut(self, cachet):
        """Un seul cachet par défaut par opérateur."""
        CachetSignature.objects.filter(
            proprietaire=cachet.proprietaire, par_defaut=True,
        ).exclude(pk=cachet.pk).update(par_defaut=False)

    @staticmethod
    def _enregistrer_resultat(cachet, resultat):
        cachet.image.save('cachet.png', ContentFile(resultat.png()), save=False)
        cachet.largeur_px, cachet.hauteur_px = resultat.largeur, resultat.hauteur

    # ------------------------------------------------------------------ CRUD

    def create(self, request, *args, **kwargs):
        fichier = request.FILES.get('fichier')
        nom = (request.data.get('nom') or '').strip()
        if not fichier:
            return self._erreur("Déposez l'image du cachet et de la signature.")
        if not nom:
            return self._erreur('Donnez un nom à ce cachet.')
        if len(nom) > 120:
            return self._erreur('Le nom ne doit pas dépasser 120 caractères.')
        if self.get_queryset().count() >= CACHETS_MAX:
            return self._erreur(
                f'Vous avez atteint le nombre maximal de cachets ({CACHETS_MAX}). '
                'Supprimez-en un avant d\'en ajouter un autre.')
        try:
            parametres = _lire_parametres(request)
            resultat = traiter(fichier, parametres)
        except (ValueError, ImageSignatureInvalide) as exc:
            return self._erreur(str(exc))

        premier = not self.get_queryset().exists()
        with transaction.atomic():
            cachet = CachetSignature(
                proprietaire=request.user, nom=nom, parametres=parametres,
                par_defaut=premier or _booleen(request.data.get('par_defaut')),
                created_by=request.user, updated_by=request.user,
            )
            fichier.seek(0)
            cachet.image_originale.save(fichier.name or 'original', fichier, save=False)
            self._enregistrer_resultat(cachet, resultat)
            cachet.save()
            if cachet.par_defaut:
                self._definir_defaut(cachet)
        return Response(self.get_serializer(cachet).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        cachet = self.get_object()
        champs = ['updated_by', 'updated_at']

        if 'nom' in request.data:
            nom = (request.data.get('nom') or '').strip()
            if not nom:
                return self._erreur('Donnez un nom à ce cachet.')
            if len(nom) > 120:
                return self._erreur('Le nom ne doit pas dépasser 120 caractères.')
            cachet.nom = nom
            champs.append('nom')

        fichier = request.FILES.get('fichier')
        if fichier is not None or 'parametres' in request.data:
            try:
                parametres = (_lire_parametres(request) if 'parametres' in request.data
                              else normaliser_parametres(cachet.parametres))
                if fichier is not None:
                    resultat = traiter(fichier, parametres)
                else:
                    with cachet.image_originale.open('rb') as f:
                        resultat = traiter(f.read(), parametres)
            except (ValueError, ImageSignatureInvalide) as exc:
                return self._erreur(str(exc))
            except (OSError, FileNotFoundError):
                return self._erreur("L'image d'origine de ce cachet est introuvable : "
                                    'déposez-la à nouveau.')
            ancien_png = cachet.image.name
            ancien_original = cachet.image_originale.name if fichier is not None else None
            if fichier is not None:
                fichier.seek(0)
                cachet.image_originale.save(fichier.name or 'original', fichier, save=False)
                champs.append('image_originale')
            self._enregistrer_resultat(cachet, resultat)
            cachet.parametres = parametres
            champs += ['image', 'largeur_px', 'hauteur_px', 'parametres']
        else:
            ancien_png = ancien_original = None

        if 'par_defaut' in request.data:
            cachet.par_defaut = _booleen(request.data.get('par_defaut'))
            champs.append('par_defaut')

        cachet.updated_by = request.user
        with transaction.atomic():
            cachet.save(update_fields=list(dict.fromkeys(champs)))
            if cachet.par_defaut:
                self._definir_defaut(cachet)
        # Les fichiers remplacés ne servent plus à rien : on ne les laisse pas traîner.
        for nom_fichier in (ancien_png, ancien_original):
            if nom_fichier:
                try:
                    cachet.image.storage.delete(nom_fichier)
                except Exception:  # noqa: BLE001 - un fichier orphelin n'est pas bloquant
                    pass
        return Response(self.get_serializer(cachet).data)

    def destroy(self, request, *args, **kwargs):
        cachet = self.get_object()
        cachet.is_deleted = True
        cachet.deleted_at = timezone.now()
        cachet.deleted_by = request.user
        etait_defaut = cachet.par_defaut
        cachet.par_defaut = False
        cachet.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by', 'par_defaut'])
        if etait_defaut:
            # Le plus récent prend le relais : l'opérateur garde toujours un défaut.
            suivant = self.get_queryset().order_by('-updated_at').first()
            if suivant:
                suivant.par_defaut = True
                suivant.save(update_fields=['par_defaut'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ------------------------------------------------------------------ actions

    @action(detail=False, methods=['post'], url_path='apercu')
    def apercu(self, request):
        """Traitement à blanc : renvoie le PNG détouré sans rien enregistrer."""
        try:
            parametres = _lire_parametres(request)
        except ValueError as exc:
            return self._erreur(str(exc))

        fichier = request.FILES.get('fichier')
        source = (request.data.get('source') or '').strip()
        if fichier is not None:
            entree = fichier
        elif source:
            cachet = self.get_queryset().filter(pk=source).first() if _uuid_valide(source) else None
            if cachet is None:
                return self._erreur('Cachet introuvable.', status.HTTP_404_NOT_FOUND)
            try:
                with cachet.image_originale.open('rb') as f:
                    entree = f.read()
            except (OSError, FileNotFoundError):
                return self._erreur("L'image d'origine de ce cachet est introuvable.")
        else:
            return self._erreur("Déposez l'image du cachet et de la signature.")

        try:
            resultat = traiter(entree, parametres)
        except (ValueError, ImageSignatureInvalide) as exc:
            return self._erreur(str(exc))
        return Response({
            'image': _data_url(resultat.png()),
            'largeur': resultat.largeur,
            'hauteur': resultat.hauteur,
            'seuil': resultat.seuil,
            'couverture': resultat.couverture,
            'parametres': parametres,
        })

    @action(detail=True, methods=['get'], url_path='originale')
    def originale(self, request, pk=None):
        cachet = self.get_object()
        try:
            with cachet.image_originale.open('rb') as f:
                contenu = f.read()
        except (OSError, FileNotFoundError, ValueError):
            return self._erreur("L'image d'origine de ce cachet est introuvable.",
                                status.HTTP_404_NOT_FOUND)
        nom = (cachet.image_originale.name or '').lower()
        type_mime = ('image/png' if nom.endswith('.png') else
                     'image/webp' if nom.endswith('.webp') else
                     'image/jpeg' if nom.endswith(('.jpg', '.jpeg')) else
                     'application/octet-stream')
        # Format non affichable par un navigateur (TIFF, BMP…) : on livre un PNG.
        if type_mime == 'application/octet-stream':
            from io import BytesIO
            from .signature_image import ouvrir_image
            try:
                tampon = BytesIO()
                ouvrir_image(contenu).save(tampon, format='PNG')
                contenu, type_mime = tampon.getvalue(), 'image/png'
            except ImageSignatureInvalide:
                pass
        return Response({
            'image': f'data:{type_mime};base64,' + base64.b64encode(contenu).decode('ascii'),
        })


def _uuid_valide(valeur) -> bool:
    import uuid
    try:
        uuid.UUID(str(valeur))
        return True
    except ValueError:
        return False
