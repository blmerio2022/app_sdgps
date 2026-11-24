"""
API des études du module Réseau GNSS — `/api/v1/reseau-gps/etudes/` (strictement personnelles).

- `GET    etudes/?q=&dossier=`  : liste SANS le contenu (nom, dossier, compteurs, dates) + les
                                  dossiers de l'appelant ;
- `POST   etudes/`              : création `{nom, description, dossier, epinglee, contenu}` ;
- `GET    etudes/<id>/`         : étude complète (contenu compris) ;
- `PATCH  etudes/<id>/`         : renommer, ranger, épingler, enregistrer le contenu ;
- `DELETE etudes/<id>/`         : suppression logique ;
- `POST   etudes/<id>/dupliquer/` : copie « <nom> (copie) ».
"""
import json

from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import EtudeReseau

TAILLE_MAX = 8 * 1024 * 1024        # 8 Mo de JSON
VERSION_SCHEMA = 1


def _nom(user):
    return (user.get_full_name() or user.email) if user else None


class EtudeSerializer(serializers.ModelSerializer):
    created_by_email = serializers.SerializerMethodField()
    updated_by_email = serializers.SerializerMethodField()

    class Meta:
        model = EtudeReseau
        fields = ['id', 'nom', 'description', 'dossier', 'epinglee', 'contenu', 'version_schema',
                  'nb_points', 'nb_zones', 'nb_nouveaux', 'taille',
                  'created_at', 'updated_at', 'created_by_email', 'updated_by_email']
        read_only_fields = ['id', 'version_schema', 'nb_points', 'nb_zones', 'nb_nouveaux', 'taille',
                            'created_at', 'updated_at']

    def get_created_by_email(self, o):
        return _nom(o.created_by)

    def get_updated_by_email(self, o):
        return _nom(o.updated_by)

    def validate_nom(self, v):
        v = (v or '').strip()
        if not v:
            raise serializers.ValidationError('Donnez un nom à l’étude.')
        return v

    def validate_dossier(self, v):
        return (v or '').strip()

    def validate_contenu(self, v):
        if not isinstance(v, dict):
            raise serializers.ValidationError('Contenu mal formé.')
        if len(json.dumps(v, ensure_ascii=False)) > TAILLE_MAX:
            raise serializers.ValidationError('Étude trop volumineuse (8 Mo au plus).')
        return v


class EtudeListeSerializer(EtudeSerializer):
    class Meta(EtudeSerializer.Meta):
        fields = [f for f in EtudeSerializer.Meta.fields if f != 'contenu']


def _compteurs(etude):
    c = etude.contenu or {}
    etude.nb_points = len(c.get('anciens') or [])
    etude.nb_zones = len(c.get('zones') or [])
    etude.nb_nouveaux = len(c.get('nouveaux') or [])
    etude.taille = len(json.dumps(c, ensure_ascii=False).encode('utf-8'))


def _mes_etudes(user):
    return EtudeReseau.objects.filter(proprietaire=user, is_deleted=False).select_related('created_by', 'updated_by')


INTROUVABLE = Response({'detail': 'Étude introuvable.'}, status=status.HTTP_404_NOT_FOUND)


@api_view(['GET', 'POST'])
def etudes(request):
    if request.method == 'POST':
        ser = EtudeSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        e = EtudeReseau(proprietaire=request.user, created_by=request.user, updated_by=request.user,
                        version_schema=VERSION_SCHEMA, **ser.validated_data)
        _compteurs(e)
        e.save()
        return Response(EtudeSerializer(e).data, status=201)
    qs = _mes_etudes(request.user)
    dossiers = sorted({d for d in qs.values_list('dossier', flat=True) if d}, key=str.lower)
    q = (request.query_params.get('q') or '').strip()
    if q:
        qs = qs.filter(Q(nom__icontains=q) | Q(description__icontains=q) | Q(dossier__icontains=q))
    dossier = request.query_params.get('dossier')
    if dossier is not None and dossier != '__tous__':
        qs = qs.filter(dossier=dossier)
    return Response({'etudes': EtudeListeSerializer(qs, many=True).data, 'dossiers': dossiers})


@api_view(['GET', 'PATCH', 'DELETE'])
def etude(request, pk):
    e = _mes_etudes(request.user).filter(pk=pk).first()
    if e is None:
        return INTROUVABLE
    if request.method == 'GET':
        return Response(EtudeSerializer(e).data)
    if request.method == 'DELETE':
        e.is_deleted, e.deleted_at, e.deleted_by = True, timezone.now(), request.user
        e.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by'])
        return Response(status=204)
    ser = EtudeSerializer(e, data=request.data, partial=True)
    ser.is_valid(raise_exception=True)
    for k, v in ser.validated_data.items():
        setattr(e, k, v)
    e.updated_by = request.user
    if 'contenu' in ser.validated_data:
        e.version_schema = VERSION_SCHEMA
        _compteurs(e)
    e.save()
    return Response(EtudeListeSerializer(e).data)


@api_view(['POST'])
def dupliquer(request, pk):
    e = _mes_etudes(request.user).filter(pk=pk).first()
    if e is None:
        return INTROUVABLE
    copie = EtudeReseau(proprietaire=request.user, nom=f'{e.nom} (copie)'[:150], description=e.description,
                        dossier=e.dossier, contenu=e.contenu, version_schema=e.version_schema,
                        created_by=request.user, updated_by=request.user)
    _compteurs(copie)
    copie.save()
    return Response(EtudeListeSerializer(copie).data, status=201)
