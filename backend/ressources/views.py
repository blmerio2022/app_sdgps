"""
API des ressources TBC — `/api/v1/ressources-tbc/`.

- `GET    /`                  : ressources à télécharger pour l'appelant (une par type, avec sa
                                provenance : organisation ou application) — tous rôles ;
- `GET    gestion/`           : niveaux que l'appelant administre (application et / ou
                                organisations) et leurs ressources — administrateurs seulement ;
- `POST   /`                  : dépôt (multipart `type_ressource`, `fichier`, `organisation`
                                facultative — vide = application —, `description`) ; remplace la
                                ressource active du même niveau ;
- `PATCH  <id>/`              : description ;
- `DELETE <id>/`              : retrait (suppression logique) — les membres reviennent sur la
                                ressource de l'application ;
- `GET    <id>/fichier/`      : téléchargement.
"""
from django.db import transaction
from django.http import FileResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from accounts.audit import journaliser
from accounts.models import AuditEvent, Organization

from . import services
from .models import RessourceTbc

INTROUVABLE = Response({'detail': 'Ressource introuvable.'}, status=status.HTTP_404_NOT_FOUND)


def _nom(user):
    return (user.get_full_name() or user.email) if user else None


def serialiser(r: RessourceTbc | None, user=None) -> dict | None:
    if r is None:
        return None
    return {
        'id': str(r.id), 'type_ressource': r.type_ressource, 'libelle': r.get_type_ressource_display(),
        'nom_fichier': r.nom_fichier, 'taille': r.taille, 'description': r.description,
        'organisation': ({'id': str(r.organization_id), 'nom': r.organization.name} if r.organization_id else None),
        'source': 'organisation' if r.organization_id else 'application',
        'created_at': r.created_at.isoformat(), 'updated_at': r.updated_at.isoformat(),
        'created_by_email': _nom(r.created_by), 'updated_by_email': _nom(r.updated_by),
        'peut_gerer': services.peut_gerer(user, r.organization_id) if user else False,
    }


@api_view(['GET', 'POST'])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def ressources(request):
    if request.method == 'POST':
        return _deposer(request)
    user = request.user
    return Response({
        'ressources': [{'type_ressource': t.value, 'libelle': t.label, 'conseil': services.CONSEILS[t],
                        'ressource': serialiser(services.ressource_effective(user, t.value), user)}
                       for t in RessourceTbc.Type],
        'peut_gerer': services.peut_gerer_quelque_chose(user),
    })


@api_view(['GET'])
def gestion(request):
    user = request.user
    if not services.peut_gerer_quelque_chose(user):
        return Response({'detail': "Réservé aux administrateurs."}, status=status.HTTP_403_FORBIDDEN)
    actives = list(services.actives())

    def niveau(org):
        oid = org.id if org else None
        return {'organisation': {'id': str(org.id), 'nom': org.name} if org else None,
                'ressources': {t.value: serialiser(next((r for r in actives if r.organization_id == oid
                                                         and r.type_ressource == t.value), None), user)
                               for t in RessourceTbc.Type}}

    niveaux = [niveau(None)] if services.is_application_admin(user) else []
    niveaux += [niveau(o) for o in services.orgs_administrees(user)]
    return Response({'niveaux': niveaux,
                     'extensions': {t.value: list(services.EXTENSIONS[t]) for t in RessourceTbc.Type},
                     'taille_max': services.TAILLE_MAX})


def _deposer(request):
    user = request.user
    type_ressource = request.data.get('type_ressource')
    if type_ressource not in RessourceTbc.Type.values:
        return Response({'type_ressource': ['Type de ressource inconnu.']}, status=400)
    org_id = request.data.get('organisation') or None
    org = None
    if org_id:
        org = Organization.objects.filter(pk=org_id, is_deleted=False).first() if _uuid(org_id) else None
        if org is None:
            return Response({'organisation': ['Organisation introuvable.']}, status=400)
    if not services.peut_gerer(user, org.id if org else None):
        return Response({'detail': "Vous ne pouvez pas déposer de ressource à ce niveau."}, status=403)
    fichier = request.FILES.get('fichier')
    if not fichier:
        return Response({'fichier': ['Fichier requis.']}, status=400)
    if not services.extension_valide(type_ressource, fichier.name):
        attendues = ', '.join(services.EXTENSIONS[type_ressource])
        return Response({'fichier': [f'Format non accepté pour ce type ({attendues}).']}, status=400)
    if fichier.size > services.TAILLE_MAX:
        return Response({'fichier': ['Fichier trop volumineux (200 Mo au plus).']}, status=400)
    with transaction.atomic():
        anciennes = RessourceTbc.objects.select_for_update().filter(
            type_ressource=type_ressource, organization=org, is_deleted=False)
        remplacee = anciennes.first()
        anciennes.update(is_deleted=True, deleted_at=timezone.now(), deleted_by=user)
        r = RessourceTbc.objects.create(
            type_ressource=type_ressource, organization=org, fichier=fichier, nom_fichier=fichier.name[:255],
            taille=fichier.size, description=(request.data.get('description') or '').strip(),
            created_by=user, updated_by=user)
    journaliser(AuditEvent.ACTION_RESSOURCE_TBC, request=request, cible=r,
                **{'operation': 'remplacement' if remplacee else 'depot', 'type': type_ressource,
                         'niveau': org.name if org else 'application', 'fichier': r.nom_fichier})
    return Response(serialiser(r, user), status=201)


def _uuid(valeur):
    import uuid
    try:
        uuid.UUID(str(valeur))
        return True
    except ValueError:
        return False


def _ressource_visible(request, pk):
    r = services.actives().filter(pk=pk).first()
    if r is None or not (services.peut_telecharger(request.user, r) or services.peut_gerer(request.user, r.organization_id)):
        return None
    return r


@api_view(['PATCH', 'DELETE'])
def detail(request, pk):
    r = _ressource_visible(request, pk)
    if r is None:
        return INTROUVABLE
    if not services.peut_gerer(request.user, r.organization_id):
        return Response({'detail': "Vous ne pouvez pas modifier cette ressource."}, status=403)
    if request.method == 'PATCH':
        r.description = (request.data.get('description') or '').strip()
        r.updated_by = request.user
        r.save(update_fields=['description', 'updated_by', 'updated_at'])
        return Response(serialiser(r, request.user))
    r.is_deleted, r.deleted_at, r.deleted_by = True, timezone.now(), request.user
    r.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by'])
    journaliser(AuditEvent.ACTION_RESSOURCE_TBC, request=request, cible=r,
                **{'operation': 'retrait', 'type': r.type_ressource,
                         'niveau': r.organization.name if r.organization_id else 'application',
                         'fichier': r.nom_fichier})
    return Response(status=204)


@api_view(['GET'])
def fichier(request, pk):
    r = _ressource_visible(request, pk)
    if r is None:
        return INTROUVABLE
    try:
        flux = r.fichier.open('rb')
    except (FileNotFoundError, OSError):
        return Response({'detail': "Le fichier n'est plus disponible sur le serveur ; demandez à un "
                                   "administrateur de le déposer à nouveau."}, status=404)
    return FileResponse(flux, as_attachment=True, filename=r.nom_fichier)
