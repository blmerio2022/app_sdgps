"""
Consultation du journal d'audit (lecture seule).

Réservé à l'administration de l'application : le journal contient qui a consulté et
exporté quoi, ce qui est en soi une information sensible.

Aucune écriture, aucune suppression — le modèle lui-même l'interdit
(cf. `accounts.models.AuditEvent`). Cette API n'expose donc que `GET`.

- `GET audit-events/`          — événements filtrés ; paginés dès que `page` est fourni
                                 (`page_size` ≤ 200) — sans `page`, liste complète
                                 (compatibilité des appelants historiques) ;
- `GET audit-events/actions/`  — libellés des actions ;
- `GET audit-events/filtres/`  — actions ET types d'objets présents, pour les listes ;
- `GET audit-events/synthese/` — comptes par action, acteurs distincts, période ;
- `GET audit-events/export/`   — CSV des événements filtrés (Excel FR : `;`, UTF-8 BOM),
                                 lui-même JOURNALISÉ (`ACTION_JOURNAL_EXPORTE`).

Filtres communs (`filtrer`) : `action`, `acteur` (id), `acteur_email` (contient),
`cible_type`, `cible_id`, `q` (recherche libre : acteur, objet, IP), `depuis` /
`jusqu_a` (ISO 8601 — une date seule couvre toute la journée), `ordre` (`asc`|`desc`).
"""
import csv
import io
import json
from datetime import datetime, time

from django.contrib.auth import get_user_model
from django.db.models import Count, Max, Min, Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import generics, permissions, serializers
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from .models import AuditEvent
from .permissions import IsApplicationAdmin

User = get_user_model()

#: Plafond d'un export CSV : au-delà, affiner les filtres.
EXPORT_MAX = 20000


class AuditEventSerializer(serializers.ModelSerializer):
    action_display = serializers.CharField(source='get_action_display', read_only=True)
    acteur_nom = serializers.SerializerMethodField()

    class Meta:
        model = AuditEvent
        fields = [
            'id', 'created_at', 'action', 'action_display',
            'acteur', 'acteur_email', 'acteur_nom',
            'cible_type', 'cible_id', 'cible_libelle',
            'adresse_ip', 'details',
        ]
        read_only_fields = fields

    def get_acteur_nom(self, obj):
        """Nom complet de l'acteur, repli sur l'email consigné.

        L'email est un instantané : il reste lisible même si le compte a été supprimé.
        """
        if obj.acteur is None:
            return obj.acteur_email or None
        nom = f'{obj.acteur.first_name} {obj.acteur.last_name}'.strip()
        return nom or obj.acteur.email or obj.acteur_email or None


class PaginationFacultative(PageNumberPagination):
    """Paginée seulement si `page` est fourni : l'écran pagine, les appelants
    historiques reçoivent la liste complète comme avant."""
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 200

    def paginate_queryset(self, queryset, request, view=None):
        if 'page' not in request.query_params:
            return None
        return super().paginate_queryset(queryset, request, view)


def _borne(valeur, fin=False):
    """`2026-11-15` → début (ou fin) de cette journée ; une date-heure ISO passe telle quelle."""
    if not valeur:
        return None
    valeur = str(valeur).strip()
    if len(valeur) == 10:
        try:
            jour = datetime.strptime(valeur, '%Y-%m-%d').date()
        except ValueError:
            return None
        return timezone.make_aware(datetime.combine(jour, time.max if fin else time.min))
    return valeur


def filtrer(queryset, params):
    """Filtres communs à la liste, à la synthèse et à l'export."""
    if params.get('action'):
        queryset = queryset.filter(action__in=[a for a in params.get('action').split(',') if a])
    if params.get('acteur'):
        queryset = queryset.filter(acteur_id=params.get('acteur'))
    if params.get('acteur_email'):
        queryset = queryset.filter(acteur_email__icontains=params.get('acteur_email'))
    if params.get('cible_type'):
        queryset = queryset.filter(cible_type=params.get('cible_type'))
    if params.get('cible_id'):
        queryset = queryset.filter(cible_id=str(params.get('cible_id')))
    q = (params.get('q') or '').strip()
    if q:
        queryset = queryset.filter(
            Q(acteur_email__icontains=q) | Q(acteur__first_name__icontains=q)
            | Q(acteur__last_name__icontains=q) | Q(cible_libelle__icontains=q)
            | Q(cible_id__icontains=q) | Q(adresse_ip__icontains=q))
    depuis = _borne(params.get('depuis'))
    if depuis:
        queryset = queryset.filter(created_at__gte=depuis)
    jusqu_a = _borne(params.get('jusqu_a'), fin=True)
    if jusqu_a:
        queryset = queryset.filter(created_at__lte=jusqu_a)
    ordre = 'created_at' if params.get('ordre') == 'asc' else '-created_at'
    return queryset.order_by(ordre, 'id')


class AuditEventListView(generics.ListAPIView):
    """GET /api/v1/audit-events/ — cf. docstring du module."""
    serializer_class = AuditEventSerializer
    permission_classes = [permissions.IsAuthenticated, IsApplicationAdmin]
    pagination_class = PaginationFacultative

    def get_queryset(self):
        return filtrer(AuditEvent.objects.select_related('acteur'), self.request.query_params)


class AuditActionsView(generics.GenericAPIView):
    """GET /api/v1/audit-events/actions/ — libellés des actions, pour les filtres."""
    permission_classes = [permissions.IsAuthenticated, IsApplicationAdmin]

    def get(self, request):
        return Response([
            {'value': valeur, 'label': libelle} for valeur, libelle in AuditEvent.ACTIONS
        ])


class AuditFiltresView(generics.GenericAPIView):
    """GET /api/v1/audit-events/filtres/ — valeurs proposées par les listes de filtres."""
    permission_classes = [permissions.IsAuthenticated, IsApplicationAdmin]

    def get(self, request):
        types = (AuditEvent.objects.exclude(cible_type='').values_list('cible_type', flat=True)
                 .distinct().order_by('cible_type'))
        return Response({
            'actions': [{'value': v, 'label': l} for v, l in AuditEvent.ACTIONS],
            'types_cible': list(types),
        })


class AuditSyntheseView(generics.GenericAPIView):
    """GET /api/v1/audit-events/synthese/ — vue d'ensemble des événements filtrés."""
    permission_classes = [permissions.IsAuthenticated, IsApplicationAdmin]

    def get(self, request):
        qs = filtrer(AuditEvent.objects.all(), request.query_params).order_by()
        libelles = dict(AuditEvent.ACTIONS)
        par_action = [{'action': r['action'], 'label': libelles.get(r['action'], r['action']),
                       'total': r['total']}
                      for r in qs.values('action').annotate(total=Count('id')).order_by('-total')]
        bornes = qs.aggregate(premier=Min('created_at'), dernier=Max('created_at'))
        return Response({
            'total': sum(a['total'] for a in par_action),
            'par_action': par_action,
            'acteurs_distincts': qs.exclude(acteur_email='').values('acteur_email').distinct().count(),
            'echecs_connexion': next((a['total'] for a in par_action
                                      if a['action'] == AuditEvent.ACTION_CONNEXION_ECHEC), 0),
            **bornes,
        })


class AuditExportView(generics.GenericAPIView):
    """GET /api/v1/audit-events/export/ — CSV des événements filtrés (journalisé)."""
    permission_classes = [permissions.IsAuthenticated, IsApplicationAdmin]

    def get(self, request):
        from .audit import journaliser

        qs = filtrer(AuditEvent.objects.select_related('acteur'), request.query_params)
        total = qs.count()
        if total > EXPORT_MAX:
            return Response({'detail': f'{total} événements : affinez les filtres '
                                       f'(export limité à {EXPORT_MAX}).'}, status=400)
        tampon = io.StringIO()
        tampon.write('﻿')                      # BOM : Excel lit l'UTF-8 correctement
        ecrivain = csv.writer(tampon, delimiter=';')
        ecrivain.writerow(['Horodatage', 'Action', 'Acteur', 'Email', "Type d'objet",
                           'Identifiant', 'Objet', 'Adresse IP', 'Détails'])
        serialiseur = AuditEventSerializer()
        for e in qs.iterator(chunk_size=500):
            ecrivain.writerow([
                timezone.localtime(e.created_at).strftime('%d/%m/%Y %H:%M:%S'),
                e.get_action_display(), serialiseur.get_acteur_nom(e) or '', e.acteur_email,
                e.cible_type, e.cible_id, e.cible_libelle, e.adresse_ip or '',
                json.dumps(e.details, ensure_ascii=False) if e.details else '',
            ])
        filtres = {k: v for k, v in request.query_params.items() if k not in ('page', 'page_size')}
        journaliser(AuditEvent.ACTION_JOURNAL_EXPORTE, request=request,
                    nombre=total, filtres=filtres or None)
        nom = f"journal-audit-{timezone.localtime():%Y%m%d-%H%M}.csv"
        reponse = HttpResponse(tampon.getvalue(), content_type='text/csv; charset=utf-8')
        reponse['Content-Disposition'] = f'attachment; filename="{nom}"'
        return reponse
