"""
Vues API pour la gestion des organisations
"""
from django.db.models import ProtectedError
from django.utils import timezone
from rest_framework import generics, status, permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from accounts.models import Organization, Membership
from .serializers import OrganizationSerializer, OrganizationListSerializer, MembershipSerializer
import logging

logger = logging.getLogger(__name__)


def is_app_admin(user):
    """Vrai pour un Super Admin ou un Admin Système (administration de l'application)."""
    return user.is_superuser or user.get_primary_role() == 'ROLE_ADMIN_SYSTEME'


class OrganizationBulkDeleteView(APIView):
    """
    Endpoint: POST /api/v1/organizations/bulk-delete/
    
    Supprime plusieurs organisations en une seule fois.
    Vérifie qu'aucune organisation ne contient des membres actifs.
    """
    permission_classes = [permissions.IsAuthenticated]
    
    def post(self, request):
        # Vérifier que l'utilisateur est Super Admin
        if not request.user.is_superuser and request.user.get_primary_role() != 'ROLE_ADMIN_SYSTEME':
            return Response(
                {'detail': 'Seul l\'administrateur de l\'application peut supprimer des organisations.'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        organization_ids = request.data.get('organization_ids', [])
        
        if not organization_ids:
            return Response(
                {'detail': 'Aucune organisation spécifiée.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Récupérer les organisations
        organizations = Organization.objects.filter(id__in=organization_ids)
        
        if organizations.count() == 0:
            return Response(
                {'detail': 'Aucune organisation trouvée.'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Vérifier chaque organisation pour les membres actifs
        deletable_orgs = []
        non_deletable_orgs = []
        
        for org in organizations:
            member_count = Membership.objects.filter(
                organization=org,
                is_active=True
            ).count()
            
            if member_count == 0:
                deletable_orgs.append(org)
            else:
                non_deletable_orgs.append({
                    'id': org.id,
                    'name': org.name,
                    'member_count': member_count
                })
        
        # Si aucune organisation ne peut être supprimée
        if len(deletable_orgs) == 0:
            return Response(
                {
                    'detail': 'Aucune organisation ne peut être supprimée.',
                    'non_deletable': non_deletable_orgs
                },
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Supprimer les organisations valides (soft delete)
        deleted_count = 0
        deleted_names = []
        
        from django.utils import timezone
        
        for org in deletable_orgs:
            try:
                org.is_deleted = True
                org.deleted_at = timezone.now()
                org.deleted_by = request.user
                org.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by'])
                
                logger.info(f"Organisation supprimée (bulk soft delete): {org.name} (ID: {org.id})")
                deleted_count += 1
                deleted_names.append(org.name)
            except Exception as e:
                logger.error(f"Erreur lors de la suppression de {org.name}: {str(e)}")
        
        # Préparer la réponse
        response_data = {
            'deleted_count': deleted_count,
            'deleted_names': deleted_names,
            'total_requested': len(organization_ids),
        }
        
        # Si certaines organisations n'ont pas pu être supprimées
        if len(non_deletable_orgs) > 0:
            response_data['non_deletable'] = non_deletable_orgs
            response_data['warning'] = f"{len(non_deletable_orgs)} organisation(s) n'ont pas pu être supprimées car elles contiennent des membres actifs."
        
        return Response(response_data, status=status.HTTP_200_OK)


class OrganizationListView(generics.ListCreateAPIView):
    """
    Endpoint: GET/POST /api/v1/organizations/
    
    GET: Liste toutes les organisations (filtrable par type)
    POST: Crée une nouvelle organisation (Super Admin uniquement)
    """
    permission_classes = [permissions.IsAuthenticated]
    
    def get_serializer_class(self):
        if self.request.method == 'POST':
            return OrganizationSerializer
        return OrganizationListSerializer
    
    def get_queryset(self):
        # Onglet « Corbeille » : organisations en suppression logique. Sinon, actives.
        show_deleted = str(self.request.query_params.get('show_deleted', '')).lower() in ('1', 'true', 'yes')
        if show_deleted:
            queryset = Organization.objects.filter(is_deleted=True)
        else:
            queryset = Organization.objects.filter(is_active=True, is_deleted=False)

        # Filtrage par type
        org_type = self.request.query_params.get('type', None)
        if org_type:
            queryset = queryset.filter(type=org_type)

        # Filtrage par recherche
        search = self.request.query_params.get('search', None)
        if search:
            queryset = queryset.filter(name__icontains=search)

        return queryset.order_by('name')
    
    def perform_create(self, serializer):
        """Ajoute l'utilisateur courant comme créateur.
        Seuls les Super Admins et Admins Système peuvent créer des organisations.
        """
        user = self.request.user
        if not user.is_superuser and user.get_primary_role() != 'ROLE_ADMIN_SYSTEME':
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Seuls les Super Admins et Admins Système peuvent créer des organisations.")
        serializer.save(created_by=self.request.user)
        logger.info(f"Organisation créée par: {self.request.user.email}")


class OrganizationDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    Endpoint: GET/PUT/PATCH/DELETE /api/v1/organizations/{id}/
    
    Permissions:
    - GET: Utilisateurs authentifiés
    - PUT/DELETE: Super Admin ou Admin de l'organisation
    """
    queryset = Organization.objects.all()
    serializer_class = OrganizationSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def check_object_permissions(self, request, obj):
        """Vérifie les permissions spécifiques à l'objet"""
        if request.method in ['PUT', 'PATCH', 'DELETE']:
            # Super Admin peut tout faire
            if request.user.is_superuser or request.user.get_primary_role() == 'ROLE_ADMIN_SYSTEME':
                return
            
            # Admin de l'organisation peut modifier
            membership = Membership.objects.filter(
                user=request.user,
                organization=obj,
                role='ROLE_ORGANISATION_ADMIN',
                is_active=True
            ).first()
            
            if not membership:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("Vous n'avez pas les droits pour modifier cette organisation.")
        
        super().check_object_permissions(request, obj)
    
    def perform_update(self, serializer):
        """Enregistre l'utilisateur qui effectue la modification"""
        serializer.save(modified_by=self.request.user)
        logger.info(f"Organisation modifiée par: {self.request.user.email}")
    
    def perform_destroy(self, instance):
        """
        Vérifie qu'aucun utilisateur n'est associé à l'organisation avant suppression.
        Effectue une suppression logique (soft delete) au lieu d'une suppression physique.
        """
        # Compter les membres actifs
        member_count = Membership.objects.filter(
            organization=instance,
            is_active=True
        ).count()
        
        if member_count > 0:
            from rest_framework.exceptions import ValidationError
            raise ValidationError(
                f"Impossible de supprimer l'organisation. "
                f"Elle contient encore {member_count} membre(s) actif(s). "
                f"Veuillez d'abord retirer tous les membres avant de supprimer cette organisation."
            )
        
        # Suppression logique (soft delete)
        from django.utils import timezone
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.deleted_by = self.request.user
        instance.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by'])

        logger.info(f"Organisation supprimée (soft delete): {instance.name} (ID: {instance.id})")


class OrganizationRestoreView(APIView):
    """POST /api/v1/organizations/{id}/restore/ — restaure une organisation en corbeille."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        if not is_app_admin(request.user):
            return Response({'detail': "Action réservée à l'administrateur de l'application."},
                            status=status.HTTP_403_FORBIDDEN)
        org = Organization.all_objects.filter(pk=pk, is_deleted=True).first()
        if not org:
            return Response({'detail': 'Organisation supprimée introuvable.'},
                            status=status.HTTP_404_NOT_FOUND)
        org.is_deleted = False
        org.deleted_at = None
        org.save(update_fields=['is_deleted', 'deleted_at'])
        logger.info(f"Organisation restaurée: {org.name} (ID: {org.id}) par {request.user.email}")
        return Response(OrganizationListSerializer(org).data, status=status.HTTP_200_OK)


class OrganizationBulkRestoreView(APIView):
    """POST /api/v1/organizations/bulk-restore/ — {organization_ids} — restaure en masse."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if not is_app_admin(request.user):
            return Response({'detail': "Action réservée à l'administrateur de l'application."},
                            status=status.HTTP_403_FORBIDDEN)
        ids = request.data.get('organization_ids', [])
        if not ids:
            return Response({'detail': 'Aucune organisation spécifiée.'},
                            status=status.HTTP_400_BAD_REQUEST)
        qs = Organization.all_objects.filter(pk__in=ids, is_deleted=True)
        restored_count = qs.count()
        qs.update(is_deleted=False, deleted_at=None)
        logger.info(f"{restored_count} organisation(s) restaurée(s) par {request.user.email}")
        return Response({'restored_count': restored_count}, status=status.HTTP_200_OK)


class OrganizationPermanentDeleteView(APIView):
    """DELETE /api/v1/organizations/{id}/permanent/ — suppression DÉFINITIVE (irréversible).

    Autorisée uniquement sur une organisation déjà en corbeille (is_deleted=True).
    """
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, pk):
        if not is_app_admin(request.user):
            return Response({'detail': "Action réservée à l'administrateur de l'application."},
                            status=status.HTTP_403_FORBIDDEN)
        org = Organization.all_objects.filter(pk=pk).first()
        if not org:
            return Response({'detail': 'Organisation introuvable.'}, status=status.HTTP_404_NOT_FOUND)
        if not org.is_deleted:
            return Response({'detail': 'Seule une organisation en corbeille peut être supprimée définitivement.'},
                            status=status.HTTP_400_BAD_REQUEST)
        # Blocage explicite : Projet.organization est en PROTECT — on refuse tant que des
        # projets sont rattachés (aucune donnée de projet n'est supprimée automatiquement).
        projet_count = org.projets.count()
        if projet_count:
            return Response(
                {'detail': f"Suppression définitive impossible : {projet_count} projet(s) "
                           f"rattaché(s) à cette organisation. Supprimez-les d'abord."},
                status=status.HTTP_400_BAD_REQUEST)
        name = org.name
        try:
            org.delete()
        except ProtectedError:
            return Response({'detail': 'Suppression définitive impossible : des données protégées y sont rattachées.'},
                            status=status.HTTP_400_BAD_REQUEST)
        logger.warning(f"Organisation supprimée DÉFINITIVEMENT: {name} par {request.user.email}")
        return Response(status=status.HTTP_204_NO_CONTENT)


class OrganizationBulkPermanentDeleteView(APIView):
    """POST /api/v1/organizations/permanent-delete/ — {organization_ids} — purge en masse."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if not is_app_admin(request.user):
            return Response({'detail': "Action réservée à l'administrateur de l'application."},
                            status=status.HTTP_403_FORBIDDEN)
        ids = request.data.get('organization_ids', [])
        if not ids:
            return Response({'detail': 'Aucune organisation spécifiée.'},
                            status=status.HTTP_400_BAD_REQUEST)
        # Uniquement les organisations en corbeille.
        qs = Organization.all_objects.filter(pk__in=ids, is_deleted=True)
        deleted_count = 0
        errors = []
        for org in qs:
            projet_count = org.projets.count()
            if projet_count:
                errors.append({'id': str(org.id), 'name': org.name,
                               'detail': f"{projet_count} projet(s) rattaché(s)."})
                continue
            try:
                org.delete()
                deleted_count += 1
            except ProtectedError:
                errors.append({'id': str(org.id), 'name': org.name,
                               'detail': 'Données protégées rattachées.'})
        logger.warning(f"{deleted_count} organisation(s) supprimée(s) DÉFINITIVEMENT par {request.user.email}")
        return Response({'deleted_count': deleted_count, 'errors': errors}, status=status.HTTP_200_OK)


class UserOrganizationsView(APIView):
    """
    Endpoint: GET /api/v1/organizations/my-organizations/
    
    Retourne toutes les organisations auxquelles l'utilisateur appartient
    """
    permission_classes = [permissions.IsAuthenticated]
    
    def get(self, request):
        memberships = Membership.objects.filter(
            user=request.user,
            is_active=True
        ).select_related('organization')
        
        serializer = MembershipSerializer(memberships, many=True)
        
        return Response({
            'count': memberships.count(),
            'organizations': serializer.data
        }, status=status.HTTP_200_OK)


class OrganizationMembersView(generics.ListAPIView):
    """
    Endpoint: GET /api/v1/organizations/{id}/members/
    
    Liste tous les membres d'une organisation
    """
    serializer_class = MembershipSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        org_id = self.kwargs['pk']
        user = self.request.user
        # Super Admin et Admin Système voient les membres de toutes les orgs
        if user.is_superuser or user.get_primary_role() == 'ROLE_ADMIN_SYSTEME':
            return Membership.objects.filter(
                organization_id=org_id,
                is_active=True
            ).select_related('user', 'organization')
        # Admin Organisation et Agent Organisation ne voient que les membres de leurs propres orgs
        user_org_ids = user.memberships.filter(
            is_active=True
        ).values_list('organization_id', flat=True)
        if org_id not in user_org_ids:
            return Membership.objects.none()
        return Membership.objects.filter(
            organization_id=org_id,
            is_active=True
        ).select_related('user', 'organization')


class AddMemberView(APIView):
    """
    Endpoint: POST /api/v1/organizations/{id}/add-member/
    
    Ajoute un membre à une organisation
    """
    permission_classes = [permissions.IsAuthenticated]
    
    def post(self, request, pk):
        try:
            organization = Organization.objects.get(pk=pk)
        except Organization.DoesNotExist:
            return Response(
                {'detail': 'Organisation non trouvée.'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Vérifier que l'utilisateur courant est admin
        membership = Membership.objects.filter(
            user=request.user,
            organization=organization,
            role='ROLE_ORGANISATION_ADMIN',
            is_active=True
        ).first()
        
        if not membership and not request.user.is_superuser:
            return Response(
                {'detail': 'Vous devez être administrateur pour ajouter des membres.'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        serializer = MembershipSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(organization=organization)
            logger.info(f"Membre ajouté à {organization.name} par {request.user.email}")
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class OrganizationMetadataView(APIView):
    """
    Endpoint: GET /api/v1/organizations/metadata/
    
    Retourne les métadonnées complètes des champs du modèle Organization,
    incluant les labels (verbose_name), descriptions (help_text), types,
    et visibilité par défaut pour configuration du tableau frontend.
    """
    permission_classes = [permissions.IsAuthenticated]
    
    def get(self, request):
        from accounts.models import Organization as OrgModel
        
        metadata = {}
        
        # 1. Champs du modèle (avec verbose_name comme label)
        for field in OrgModel._meta.get_fields():
            # Ignorer les relations inverses et champs techniques
            if field.name in ['id', 'children', 'password']:
                continue
            
            # Utiliser verbose_name comme label (source unique de vérité)
            label = str(field.verbose_name) if hasattr(field, 'verbose_name') else field.name
            
            # Déterminer la visibilité par défaut
            visible_by_default = field.name in [
                'code', 'name', 'type', 'email', 'phone', 
                'is_active', 'created_at'
            ]
            
            field_info = {
                'field': field.name,
                'label': label,  # ← Label depuis le modèle Django
                'description': field.help_text if hasattr(field, 'help_text') and field.help_text else '',
                'type': field.get_internal_type(),
                'required': not getattr(field, 'blank', True),
                'visible_by_default': visible_by_default,
            }
            
            # Ajouter les choices si disponibles
            if hasattr(field, 'choices') and field.choices:
                field_info['choices'] = [
                    {'value': choice[0], 'label': choice[1]}
                    for choice in field.choices
                ]
            
            metadata[field.name] = field_info
        
        # 2. Champs calculés/sérialisés (labels définis dans le serializer)
        computed_fields = {
            'type_display': {
                'field': 'type_display',
                'label': 'Type (affiché)',  # ← Label personnalisé
                'description': 'Libellé lisible du type d\'organisation (Cabinet Privé/Entreprise ou Entité Publique/Administration)',
                'type': 'CharField',
                'required': False,
                'visible_by_default': True,
            },
            'member_count': {
                'field': 'member_count',
                'label': 'Nombre de membres',
                'description': 'Nombre total de membres actifs appartenant à cette organisation',
                'type': 'IntegerField',
                'required': False,
                'visible_by_default': False,
            },
            'created_by_email': {
                'field': 'created_by_email',
                'label': 'Créé par',
                'description': 'Adresse email de l\'utilisateur ayant créé cette organisation dans le système',
                'type': 'EmailField',
                'required': False,
                'visible_by_default': False,
            },
            # Colonnes d'audit standard : libellés UNIFIÉS dans toute l'app (cf. CLAUDE.md).
            'modified_by_email': {
                'field': 'modified_by_email',
                'label': 'Modifié par',
                'description': 'Utilisateur ayant effectué la dernière modification',
                'type': 'EmailField',
                'required': False,
                'visible_by_default': False,
            },
            'updated_by_email': {
                'field': 'updated_by_email',
                'label': 'Modifié par',
                'description': 'Utilisateur ayant effectué la dernière modification',
                'type': 'EmailField',
                'required': False,
                'visible_by_default': False,
            },
            'deleted_by_email': {
                'field': 'deleted_by_email',
                'label': 'Supprimé par',
                'description': "Utilisateur ayant supprimé l'enregistrement",
                'type': 'EmailField',
                'required': False,
                'visible_by_default': False,
            },
            # NB : `is_test_data` n'est plus une colonne de l'app (retirée du tableau des
            # organisations et de la fiche de détail). Le champ reste en base : il pilote le
            # filtrage automatique des données de test en production (cf. `OrganizationManager`).
            'full_path': {
                'field': 'full_path',
                'label': 'Chemin hiérarchique',
                'description': 'Chemin complet dans la hiérarchie (ex: Ministère > Direction > Division)',
                'type': 'CharField',
                'required': False,
                'visible_by_default': False,
            },
        }
        
        # Fusionner avec les métadonnées du modèle
        metadata.update(computed_fields)
        
        return Response(metadata, status=status.HTTP_200_OK)
