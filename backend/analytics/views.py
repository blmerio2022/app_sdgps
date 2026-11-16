"""
Endpoints d'analytique de stockage (réservés aux administrateurs de l'app).

- `GET /api/v1/analytics/storage/overview/[?organization=<id>][&top=<n>]`
  Ventilation COURANTE : total + répartition par nature de fichier / organisation / projet /
  utilisateur (à la volée, mise en cache).
- `GET /api/v1/analytics/storage/evolution/[?limit=<n>]`
  Série temporelle des instantanés (`StorageSnapshot`) pour la courbe d'évolution.
"""
from rest_framework.views import APIView
from rest_framework.response import Response

from .models import StorageSnapshot
from .permissions import IsAppAdmin
from .services import cached_storage_overview, TYPE_LABELS


def _ranked(mapping: dict, top=None):
    """Transforme {libellé: octets} en liste triée décroissante [{label, bytes}]."""
    items = sorted(mapping.items(), key=lambda kv: kv[1], reverse=True)
    if top:
        items = items[:top]
    return [{'label': label, 'bytes': size} for label, size in items]


def _typed(mapping: dict):
    """Répartition par nature avec libellé lisible, triée décroissante."""
    items = sorted(mapping.items(), key=lambda kv: kv[1], reverse=True)
    return [{'key': k, 'label': TYPE_LABELS.get(k, k.capitalize()), 'bytes': v} for k, v in items]


class StorageOverviewView(APIView):
    permission_classes = [IsAppAdmin]

    def get(self, request):
        organization_id = request.query_params.get('organization') or None
        try:
            top = int(request.query_params.get('top', 15))
        except (TypeError, ValueError):
            top = 15

        data = cached_storage_overview(organization_id)
        return Response({
            'total_bytes': data['total_bytes'],
            'total_files': data['total_files'],
            'by_type': _typed(data['by_type']),
            'by_organization': _ranked(data['by_organization'], top),
            'by_project': _ranked(data['by_project'], top),
            'by_user': _ranked(data['by_user'], top),
        })


class StorageEvolutionView(APIView):
    permission_classes = [IsAppAdmin]

    def get(self, request):
        try:
            limit = int(request.query_params.get('limit', 200))
        except (TypeError, ValueError):
            limit = 200

        # Les plus récents d'abord (limite), puis on remet en ordre chronologique croissant.
        snaps = list(StorageSnapshot.objects.order_by('-taken_at')[:limit])
        snaps.reverse()
        points = [{
            'taken_at': s.taken_at.isoformat(),
            'total_bytes': s.total_bytes,
            'total_files': s.total_files,
            'by_type': s.by_type or {},
            'by_organization': s.by_organization or {},
            'by_project': s.by_project or {},
            'by_role': s.by_role or {},
            'by_user': s.by_user or {},
            'is_backfill': s.is_backfill,
        } for s in snaps]
        return Response({'points': points})


class ActiviteView(APIView):
    """
    GET /api/v1/analytics/activite/?depuis=&jusqu_a=&organisation= — tableau de bord
    d'activité (`analytics/activite.py`). Administration de l'application : tout ;
    Admin Organisation : ses organisations ; Agent : 403.
    """

    def get(self, request):
        from django.utils.dateparse import parse_date
        from rest_framework import status as http
        from .activite import calculer, organisations_visibles

        orgs = organisations_visibles(request.user)
        if orgs is not None and not orgs:
            return Response({'detail': "Le tableau de bord d'activité est réservé à l'encadrement."},
                            status=http.HTTP_403_FORBIDDEN)
        depuis = parse_date(request.query_params.get('depuis') or '') if request.query_params.get('depuis') else None
        jusqu_a = parse_date(request.query_params.get('jusqu_a') or '') if request.query_params.get('jusqu_a') else None
        if depuis and jusqu_a and depuis > jusqu_a:
            return Response({'detail': 'Période invalide.'}, status=http.HTTP_400_BAD_REQUEST)
        return Response(calculer(request.user, depuis, jusqu_a, request.query_params.get('organisation') or None))
