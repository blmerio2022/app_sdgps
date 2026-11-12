"""
Consultation du journal d'audit (lecture seule).

Réservé à l'administration de l'application : le journal contient qui a consulté et
exporté quoi, ce qui est en soi une information sensible.

Aucune écriture, aucune suppression — le modèle lui-même l'interdit
(cf. `accounts.models.AuditEvent`). Cette API n'expose donc que `GET`.
"""
from django.contrib.auth import get_user_model
from rest_framework import generics, permissions, serializers

from .models import AuditEvent
from .permissions import IsApplicationAdmin

User = get_user_model()


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


class AuditEventListView(generics.ListAPIView):
    """
    GET /api/v1/audit-events/

    Filtres : `action`, `acteur` (id), `acteur_email` (contient), `cible_id`,
    `depuis` / `jusqu_a` (ISO 8601). Tri antichronologique.
    """
    serializer_class = AuditEventSerializer
    permission_classes = [permissions.IsAuthenticated, IsApplicationAdmin]

    def get_queryset(self):
        queryset = AuditEvent.objects.select_related('acteur')
        params = self.request.query_params

        action = params.get('action')
        if action:
            queryset = queryset.filter(action=action)

        acteur = params.get('acteur')
        if acteur:
            queryset = queryset.filter(acteur_id=acteur)

        acteur_email = params.get('acteur_email')
        if acteur_email:
            queryset = queryset.filter(acteur_email__icontains=acteur_email)

        cible_id = params.get('cible_id')
        if cible_id:
            queryset = queryset.filter(cible_id=str(cible_id))

        depuis = params.get('depuis')
        if depuis:
            queryset = queryset.filter(created_at__gte=depuis)

        jusqu_a = params.get('jusqu_a')
        if jusqu_a:
            queryset = queryset.filter(created_at__lte=jusqu_a)

        return queryset


class AuditActionsView(generics.GenericAPIView):
    """GET /api/v1/audit-events/actions/ — libellés des actions, pour les filtres."""
    permission_classes = [permissions.IsAuthenticated, IsApplicationAdmin]

    def get(self, request):
        from rest_framework.response import Response

        return Response([
            {'value': valeur, 'label': libelle} for valeur, libelle in AuditEvent.ACTIONS
        ])
