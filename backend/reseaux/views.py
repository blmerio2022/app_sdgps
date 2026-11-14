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

from pieces import tolerances as T

from . import densification as D
from . import fonds as F
from . import normes as N
from .ecarts import TOLERANCE_MAX_M, TOLERANCE_MIN_M, ErreurEcarts, analyser_ecarts
from .generation import TYPES_RESEAU, VARIANTES, ErreurReseau, generer_reseau
from .projection import ZONE_DEFAUT, ZONES, deviner_zone

CHAMPS_RC = ('id', 'nom_point_fixe', 'nom_point_calcule', 'x_m_fixe', 'y_m_fixe', 'x_m_calcule',
             'y_m_calcule', 'delta_x_m', 'delta_y_m', 'delta_d_m')
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
    origine = serializers.ChoiceField(choices=['manuel', 'propose'], required=False)


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


def tolerance_rc_utilisateur(user):
    """ΔD maximal du rapport de contrôle réglé par l'opérateur (Paramètres › Tolérances)."""
    regle = T.effectives(getattr(user, 'tolerances_config', None))['rc_ecarts']
    return float(regle['max_m'])


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
            'fonds': {
                'categories': F.CATEGORIES,
                'catalogue': F.CATALOGUE,
                'par_defaut': F.FONDS_PAR_DEFAUT,
                'aide_personnalise': F.AIDE_FOND_PERSONNALISE,
            },
            'defauts': {
                'tolerance_rc_m': tolerance_rc_utilisateur(request.user),
                'rayon_couverture_km': D.RAYON_KM_DEFAUT,
                'points_couverture_min': D.POINTS_MIN_DEFAUT,
                'nouveaux_max': D.NOUVEAUX_MAX,
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


# --------------------------------------------------------------------------- écarts (RC)

class AnalyseEcartsSerializer(serializers.Serializer):
    lignes = serializers.ListField(child=serializers.DictField(), allow_empty=False, max_length=5000)
    tolerance_m = serializers.FloatField(min_value=TOLERANCE_MIN_M, max_value=TOLERANCE_MAX_M,
                                         required=False)
    noms_reseau = serializers.ListField(child=serializers.CharField(allow_blank=True), required=False)


class AnalyserEcartsView(APIView):
    """`POST` : analyse les écarts d'un RC et détecte les points anciens homogènes."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = AnalyseEcartsSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        tol = d.get('tolerance_m', tolerance_rc_utilisateur(request.user))
        try:
            return Response(analyser_ecarts(d['lignes'], tol, d.get('noms_reseau')))
        except ErreurEcarts as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


def _rc_visibles(user):
    qs = Piece.objects.filter(type_piece='RC', is_deleted=False, ssdgps__is_deleted=False)         .select_related('ssdgps__affaire__propriete__projet')
    return scope_queryset(qs, user, ORG_LOOKUP)


class SourcesRcView(APIView):
    """SDGPS visibles par l'utilisateur qui possèdent un rapport de contrôle (RC)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response([{
            'ssdgps_id': str(p.ssdgps_id), 'piece_id': str(p.id), 'libelle': _libelle_ssdgps(p.ssdgps),
            'nature_ssdgps': p.ssdgps.nature_ssdgps,
            'nb_lignes': len((p.payload or {}).get('rows') or []),
        } for p in _rc_visibles(request.user).order_by('-updated_at')[:500]])


class SourceRcDetailView(APIView):
    """Lignes du RC d'un SDGPS (portée RBAC)."""
    permission_classes = [IsAuthenticated]

    def get(self, request, ssdgps_id):
        piece = _rc_visibles(request.user).filter(ssdgps_id=ssdgps_id).order_by('-updated_at').first()
        if piece is None:
            raise NotFound('Aucun rapport de contrôle accessible pour ce SDGPS.')
        return Response({
            'ssdgps_id': str(piece.ssdgps_id), 'libelle': _libelle_ssdgps(piece.ssdgps),
            'lignes': [{k: row.get(k, '') for k in CHAMPS_RC} for row in (piece.payload or {}).get('rows') or []],
        })


# --------------------------------------------------------------------------- densification

class DensificationSerializer(serializers.Serializer):
    anciens = PointSerializer(many=True)
    nouveaux = PointSerializer(many=True, required=False, default=list)
    nb_nouveaux = serializers.IntegerField(min_value=0, max_value=D.NOUVEAUX_MAX, default=0)
    proposer = serializers.BooleanField(default=True)
    zone = serializers.ChoiceField(choices=list(ZONES), default=ZONE_DEFAUT)
    longueur_max_km = serializers.FloatField(
        min_value=0.1, max_value=N.LONGUEUR_MAX_KM_LIMITE, default=N.LONGUEUR_MAX_KM_DEFAUT)
    rayon_couverture_km = serializers.FloatField(min_value=0.1, max_value=50, default=D.RAYON_KM_DEFAUT)
    points_couverture_min = serializers.IntegerField(min_value=1, max_value=10, default=D.POINTS_MIN_DEFAUT)

    def validate(self, data):
        if len(data['anciens']) + len(data.get('nouveaux') or []) > N.POINTS_MAX:
            raise serializers.ValidationError(f'Au plus {N.POINTS_MAX} points.')
        return data


class DensifierView(APIView):
    """`POST` : propose les points nouveaux (`proposer=true`) ou évalue le réseau tel que
    l'opérateur l'a modifié (`proposer=false`)."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = DensificationSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        try:
            return Response(D.densifier(
                d['anciens'], d.get('nouveaux') or [], nb_nouveaux=d['nb_nouveaux'], zone=d['zone'],
                longueur_max_km=d['longueur_max_km'], rayon_km=d['rayon_couverture_km'],
                points_min=d['points_couverture_min'], proposer=d['proposer']))
        except D.ErreurDensification as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
