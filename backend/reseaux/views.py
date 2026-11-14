"""API du module « Réseau de triangulation GPS ».

Module indépendant et sans état : rien n'est enregistré, le réseau est recalculé à chaque
demande. Ouvert à TOUS les rôles authentifiés (défaut DRF `IsAuthenticated`) ; seule la
reprise de la LPA d'un SDGPS est filtrée par la portée RBAC habituelle (`scope_queryset`).
"""
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from pieces.models import Piece
from projects.views import scope_queryset

from . import normes as N
from .generation import TYPES_RESEAU, VARIANTES, ErreurReseau, generer_reseau
from .projection import ZONE_DEFAUT, ZONES, deviner_zone

CHAMPS_LPA = ('id', 'nom_point', 'x_m', 'y_m', 'reference', 'nature_materialisation',
              'nature_signalisation')
ORG_LOOKUP = 'ssdgps__affaire__propriete__projet__organization_id'


class PointSerializer(serializers.Serializer):
    id = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=100)
    nom_point = serializers.CharField(required=False, allow_blank=True, max_length=100)
    x_m = serializers.FloatField()
    y_m = serializers.FloatField()
    reference = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=255)
    nature_materialisation = serializers.CharField(required=False, allow_blank=True,
                                                   allow_null=True, max_length=255)
    nature_signalisation = serializers.CharField(required=False, allow_blank=True,
                                                 allow_null=True, max_length=255)
    statut = serializers.ChoiceField(choices=['ancien', 'nouveau'], required=False, default='ancien')


class GenerationSerializer(serializers.Serializer):
    points = PointSerializer(many=True)
    type_reseau = serializers.ChoiceField(choices=list(TYPES_RESEAU), default='anciens')
    zone = serializers.ChoiceField(choices=list(ZONES), default=ZONE_DEFAUT)
    longueur_max_km = serializers.FloatField(
        min_value=0.1, max_value=N.LONGUEUR_MAX_KM_LIMITE, default=N.LONGUEUR_MAX_KM_DEFAUT)
    nb_suggestions_max = serializers.IntegerField(
        min_value=0, max_value=N.SUGGESTIONS_MAX, default=N.SUGGESTIONS_MAX_DEFAUT)

    def validate_points(self, value):
        if len(value) > N.POINTS_MAX:
            raise serializers.ValidationError(f'Au plus {N.POINTS_MAX} points par réseau.')
        return value


class ReferentielView(APIView):
    """Zones Lambert, types de réseau, variantes, normes appliquées et valeurs par défaut."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            'zones': [{'code': k, 'libelle': v['libelle'], 'epsg': v['epsg']} for k, v in ZONES.items()],
            'zone_defaut': ZONE_DEFAUT,
            'types_reseau': [{'code': k, 'libelle': v} for k, v in TYPES_RESEAU.items()],
            'variantes': [{'code': k, **v} for k, v in VARIANTES.items()],
            'normes': N.NORMES,
            'defauts': {
                'longueur_max_km': N.LONGUEUR_MAX_KM_DEFAUT,
                'nb_suggestions_max': N.SUGGESTIONS_MAX_DEFAUT,
                'points_max': N.POINTS_MAX,
                'suggestions_max': N.SUGGESTIONS_MAX,
            },
        })


class GenererView(APIView):
    """`POST` : calcule les variantes, la recommandation et la variante parfaite."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = GenerationSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        try:
            resultat = generer_reseau(
                d['points'], type_reseau=d['type_reseau'], zone=d['zone'],
                longueur_max_km=d['longueur_max_km'], nb_suggestions_max=d['nb_suggestions_max'])
        except ErreurReseau as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(resultat)


def _lpa_visibles(user):
    qs = Piece.objects.filter(type_piece='LPA', is_deleted=False, ssdgps__is_deleted=False) \
        .select_related('ssdgps__affaire__propriete__projet')
    return scope_queryset(qs, user, ORG_LOOKUP)


def _libelle_ssdgps(s):
    affaire = s.affaire
    projet = affaire.propriete.projet
    return (f"{projet.code_projet or projet.nom_projet} › {affaire.propriete.nom_propriete} › "
            f"SDGPS n°{s.numero_ssdgps or '?'} ({s.nature_ssdgps})")


class SourcesLpaView(APIView):
    """SDGPS visibles par l'utilisateur qui possèdent une LPA (Liste des points anciens)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        sources = []
        for piece in _lpa_visibles(request.user).order_by('-updated_at')[:500]:
            s = piece.ssdgps
            sources.append({
                'ssdgps_id': str(s.id),
                'piece_id': str(piece.id),
                'libelle': _libelle_ssdgps(s),
                'nature_ssdgps': s.nature_ssdgps,
                'nb_points': len((piece.payload or {}).get('rows') or []),
            })
        return Response(sources)


class SourceLpaDetailView(APIView):
    """Points de la LPA d'un SDGPS + zone de projection proposée (d'après PPA/PPN)."""
    permission_classes = [IsAuthenticated]

    def get(self, request, ssdgps_id):
        piece = _lpa_visibles(request.user).filter(ssdgps_id=ssdgps_id).order_by('-updated_at').first()
        if piece is None:
            raise NotFound('Aucune LPA accessible pour ce SDGPS.')
        points = [{k: row.get(k, '') for k in CHAMPS_LPA} | {'statut': 'ancien'}
                  for row in (piece.payload or {}).get('rows') or []]
        zone = None
        photos = Piece.objects.filter(ssdgps_id=ssdgps_id, type_piece__in=('PPA', 'PPN'),
                                      is_deleted=False)
        for ph in photos:
            for row in (ph.payload or {}).get('rows') or []:
                zone = deviner_zone(row.get('zone_projection')) or deviner_zone(
                    row.get('systeme_projection'))
                if zone:
                    break
            if zone:
                break
        return Response({
            'ssdgps_id': str(piece.ssdgps_id),
            'libelle': _libelle_ssdgps(piece.ssdgps),
            'nature_ssdgps': piece.ssdgps.nature_ssdgps,
            'points': points,
            'zone_proposee': zone,
        })
