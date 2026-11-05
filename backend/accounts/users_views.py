from rest_framework import generics, status, permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from django.contrib.auth import get_user_model
from django.db import models
from django.utils import timezone
from .models import Membership, Organization
from .users_serializers import (
    UserListSerializer, UserDetailSerializer,
    UserCreateSerializer, UserUpdateSerializer,
    RoleSerializer, ResetPasswordSerializer,
)
from .rbac import check_org_admin_not_last
import logging

logger = logging.getLogger(__name__)
User = get_user_model()

ROLES_CONFIG = [
    {
        'id': 'ROLE_SUPER_ADMIN',
        'name': 'Super Admin',
        'description': 'Super administrateur technique avec accès complet à toute la plateforme.',
        'permissions': [
            'Accès complet à tous les modules',
            'Gérer les administrateurs d\'application',
            'Configuration système et supervision',
            'Audit et logs complets',
        ],
    },
    {
        'id': 'ROLE_ADMIN_SYSTEME',
        'name': 'Admin Système',
        'description': 'Administrateur d\'application. Gère les utilisateurs, organisations, configuration système et supervision.',
        'permissions': [
            'Voir tous les utilisateurs (hors Super Admins)',
            'Créer/Modifier/Supprimer tout utilisateur',
            'Réinitialiser le mot de passe de tout utilisateur',
            'Voir toutes les organisations',
            'Configurer le système',
            'Consulter les rapports consolidés',
        ],
    },
    {
        'id': 'ROLE_ORGANISATION_ADMIN',
        'name': 'Admin Organisation',
        'description': 'Gère les agents de son organisation. Valide les opérations et configure les paramètres spécifiques.',
        'permissions': [
            'Voir les agents de son organisation',
            'Créer/Modifier/Supprimer les agents',
            'Réinitialiser le mot de passe des agents',
            'Configurer les paramètres de l\'organisation',
            'Consulter les rapports de l\'organisation',
        ],
    },
    {
        'id': 'ROLE_ORGANISATION_AGENT',
        'name': 'Agent Organisation',
        'description': 'Profil opérationnel. Gère les projets, la saisie de données et la génération de documents.',
        'permissions': [
            'Gérer ses projets',
            'Saisir et importer des données',
            'Générer des rapports et documents',
            'Consulter l\'historique de ses actions',
            'Modifier son profil',
        ],
    },
]


def get_user_queryset_for_admin(admin_user, include_deleted=False):
    base_filter = {} if include_deleted else {'is_deleted': False}
    if admin_user.is_superuser:
        return User.objects.filter(**base_filter)
    if admin_user.is_platform_admin():
        return User.objects.filter(**base_filter).exclude(is_superuser=True)
    org_memberships = admin_user.memberships.filter(
        is_active=True,
        role='ROLE_ORGANISATION_ADMIN',
    ).values_list('organization_id', flat=True)
    filters = {
        'memberships__organization_id__in': org_memberships,
        'memberships__is_active': True,
        'memberships__role': 'ROLE_ORGANISATION_AGENT',
    }
    if not include_deleted:
        filters['is_deleted'] = False
    return User.objects.filter(**filters).distinct()


def can_manage_user(admin_user, target_user):
    if admin_user.is_superuser:
        return True, None
    if admin_user.is_platform_admin():
        if target_user.is_superuser:
            return False, "Vous ne pouvez pas gérer un super administrateur."
        if target_user.is_platform_admin() and admin_user.pk != target_user.pk:
            return False, "Vous ne pouvez pas gérer un autre administrateur d'application."
        return True, None
    if target_user.is_superuser:
        return False, "Vous ne pouvez pas gérer un super administrateur."
    if target_user.is_platform_admin():
        return False, "Vous ne pouvez pas gérer un administrateur d'application."
    admin_org_ids = set(
        admin_user.memberships.filter(
            is_active=True,
            role='ROLE_ORGANISATION_ADMIN',
        ).values_list('organization_id', flat=True)
    )
    target_org_ids = set(
        target_user.memberships.filter(
            is_active=True,
        ).values_list('organization_id', flat=True)
    )
    common_orgs = admin_org_ids & target_org_ids
    if not common_orgs:
        return False, "Vous ne pouvez gérer que les agents de votre organisation."
    target_role = target_user.get_primary_role()
    if target_role == 'ROLE_ORGANISATION_ADMIN':
        return False, "Vous ne pouvez pas gérer un responsable admin."
    return True, None


class UserListView(generics.ListCreateAPIView):
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.request.method == 'POST':
            return UserCreateSerializer
        return UserListSerializer

    def get_queryset(self):
        user = self.request.user
        if not (user.is_superuser or user.is_platform_admin() or user.memberships.filter(
            is_active=True,
            role='ROLE_ORGANISATION_ADMIN',
        ).exists()):
            return User.objects.none()

        show_deleted = self.request.query_params.get('show_deleted', '').lower() in ('true', '1', 'yes')
        queryset = get_user_queryset_for_admin(user, include_deleted=show_deleted)

        search = self.request.query_params.get('search', None)
        if search:
            queryset = queryset.filter(
                models.Q(first_name__icontains=search) |
                models.Q(last_name__icontains=search) |
                models.Q(email__icontains=search)
            )

        role = self.request.query_params.get('role', None)
        if role:
            if role == 'ROLE_SUPER_ADMIN':
                q = User.objects.filter(is_superuser=True)
                if not show_deleted:
                    q = q.filter(is_deleted=False)
                return q
            if role == 'ROLE_ADMIN_SYSTEME':
                q = User.objects.filter(platform_role='ROLE_ADMIN_SYSTEME')
                if not show_deleted:
                    q = q.filter(is_deleted=False)
                return q
            queryset = queryset.filter(memberships__role=role)

        is_active = self.request.query_params.get('is_active', None)
        if is_active is not None:
            is_active_bool = is_active.lower() == 'true'
            queryset = queryset.filter(is_active=is_active_bool)

        organization_id = self.request.query_params.get('organization_id', None)
        if organization_id:
            queryset = queryset.filter(
                memberships__organization_id=organization_id
            )

        return queryset.order_by('-date_joined')

    def perform_create(self, serializer):
        # Colonnes d'audit standard (cf. CLAUDE.md) : on trace l'auteur de la création.
        serializer.save(created_by=self.request.user, updated_by=self.request.user)
        logger.info(f"Utilisateur créé par: {self.request.user.email}")


class UserDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.request.method in ('PUT', 'PATCH'):
            return UserUpdateSerializer
        return UserDetailSerializer

    def get_queryset(self):
        user = self.request.user
        if user.is_superuser:
            return User.objects.filter(is_deleted=False)
        return get_user_queryset_for_admin(user)

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        allowed, msg = can_manage_user(request.user, obj)
        if not allowed:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied(msg)

    def perform_destroy(self, instance):
        from django.utils import timezone

        if instance.is_superuser:
            if instance.pk == self.request.user.pk:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied('Vous ne pouvez pas supprimer votre propre compte super administrateur.')
            active_super_count = User.objects.filter(is_superuser=True, is_active=True, is_deleted=False).count()
            if active_super_count <= 2:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied('Impossible de supprimer : cela laisserait moins de deux super administrateurs actifs.')

        if instance.is_platform_admin():
            if instance.pk == self.request.user.pk:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied('Vous ne pouvez pas supprimer votre propre compte administrateur système.')
            active_app_admin_count = User.objects.filter(platform_role='ROLE_ADMIN_SYSTEME', is_active=True, is_deleted=False).count()
            if active_app_admin_count <= 2:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied('Impossible de supprimer : cela laisserait moins de deux administrateurs système actifs.')

        allowed, msg = check_org_admin_not_last(instance)
        if not allowed:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied(msg)

        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.deleted_by = self.request.user
        instance.is_active = False
        instance.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by', 'is_active'])
        if instance.is_superuser:
            logger.warning(f"Super admin supprimé (soft delete): {instance.email} par {self.request.user.email}")
        else:
            logger.info(f"Utilisateur supprimé (soft delete): {instance.email} par {self.request.user.email}")

    def perform_update(self, serializer):
        instance = serializer.instance
        validated_data = serializer.validated_data

        if instance.is_superuser:
            if 'is_active' in validated_data:
                if validated_data['is_active'] != instance.is_active:
                    if instance.pk == self.request.user.pk:
                        from rest_framework.exceptions import PermissionDenied
                        raise PermissionDenied('Vous ne pouvez pas désactiver votre propre compte super administrateur.')
                    if instance.is_active:
                        active_super_count = User.objects.filter(is_superuser=True, is_active=True, is_deleted=False).count()
                        if active_super_count <= 2:
                            from rest_framework.exceptions import PermissionDenied
                            raise PermissionDenied('Impossible de désactiver : cela laisserait moins de deux super administrateurs actifs.')
                    logger.warning(
                        f"Super admin {'désactivé' if not validated_data['is_active'] else 'activé'} "
                        f"via PATCH: {instance.email} par {self.request.user.email}"
                    )

        if instance.is_platform_admin():
            if 'is_active' in validated_data:
                if validated_data['is_active'] != instance.is_active:
                    if instance.pk == self.request.user.pk:
                        from rest_framework.exceptions import PermissionDenied
                        raise PermissionDenied('Vous ne pouvez pas désactiver votre propre compte administrateur système.')
                    if instance.is_active:
                        active_app_admin_count = User.objects.filter(platform_role='ROLE_ADMIN_SYSTEME', is_active=True, is_deleted=False).count()
                        if active_app_admin_count <= 2:
                            from rest_framework.exceptions import PermissionDenied
                            raise PermissionDenied('Impossible de désactiver : cela laisserait moins de deux administrateurs système actifs.')
                    logger.warning(
                        f"Admin système {'désactivé' if not validated_data['is_active'] else 'activé'} "
                        f"via PATCH: {instance.email} par {self.request.user.email}"
                    )

        if validated_data.get('is_active') is False and instance.is_active:
            allowed, msg = check_org_admin_not_last(instance)
            if not allowed:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied(msg)

        # Colonnes d'audit standard (cf. CLAUDE.md) : on trace l'auteur de la modification.
        serializer.save(updated_by=self.request.user)

        if instance.is_superuser:
            logger.warning(f"Super admin modifié: {instance.email} par {self.request.user.email}")


class UserResetPasswordView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        try:
            user = User.objects.get(pk=pk, is_deleted=False)
        except User.DoesNotExist:
            return Response(
                {'detail': 'Utilisateur non trouvé.'},
                status=status.HTTP_404_NOT_FOUND
            )

        allowed, msg = can_manage_user(request.user, user)
        if not allowed:
            return Response({'detail': msg}, status=status.HTTP_403_FORBIDDEN)

        if user.pk == request.user.pk and (user.is_superuser or user.is_platform_admin()):
            return Response(
                {'detail': 'Vous ne pouvez pas réinitialiser votre propre mot de passe via cette interface. Utilisez la page de profil.'},
                status=status.HTTP_403_FORBIDDEN
            )

        serializer = ResetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        new_password = serializer.validated_data.get('new_password')
        if not new_password:
            new_password = serializer.generate_password()

        user.set_password(new_password)
        user.must_change_password = serializer.validated_data.get('must_change_password', True)
        user.save(update_fields=['password', 'must_change_password'])

        if user.is_superuser:
            logger.warning(f"Mot de passe réinitialisé pour le super admin {user.email} par {request.user.email}")
        else:
            logger.info(f"Mot de passe réinitialisé pour {user.email} par {request.user.email}")

        return Response({
            'detail': 'Mot de passe réinitialisé avec succès.',
            'new_password': new_password,
            'must_change_password': user.must_change_password,
        }, status=status.HTTP_200_OK)


class UserToggleActiveView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        try:
            user = User.objects.get(pk=pk, is_deleted=False)
        except User.DoesNotExist:
            return Response(
                {'detail': 'Utilisateur non trouvé.'},
                status=status.HTTP_404_NOT_FOUND
            )

        allowed, msg = can_manage_user(request.user, user)
        if not allowed:
            return Response({'detail': msg}, status=status.HTTP_403_FORBIDDEN)

        if user.is_superuser:
            if user.pk == request.user.pk:
                return Response(
                    {'detail': 'Vous ne pouvez pas désactiver votre propre compte super administrateur.'},
                    status=status.HTTP_403_FORBIDDEN
                )
            if user.is_active:
                active_super_count = User.objects.filter(is_superuser=True, is_active=True, is_deleted=False).count()
                if active_super_count <= 2:
                    return Response(
                        {'detail': 'Impossible de désactiver : cela laisserait moins de deux super administrateurs actifs.'},
                        status=status.HTTP_403_FORBIDDEN
                    )

        if user.is_platform_admin():
            if user.pk == request.user.pk:
                return Response(
                    {'detail': 'Vous ne pouvez pas désactiver votre propre compte administrateur système.'},
                    status=status.HTTP_403_FORBIDDEN
                )
            if user.is_active:
                active_app_admin_count = User.objects.filter(platform_role='ROLE_ADMIN_SYSTEME', is_active=True, is_deleted=False).count()
                if active_app_admin_count <= 2:
                    return Response(
                        {'detail': 'Impossible de désactiver : cela laisserait moins de deux administrateurs système actifs.'},
                        status=status.HTTP_403_FORBIDDEN
                    )

        # Désactivation d'un admin d'organisation : ne pas orpheliner l'org.
        if user.is_active:
            allowed, msg = check_org_admin_not_last(user)
            if not allowed:
                return Response({'detail': msg}, status=status.HTTP_403_FORBIDDEN)

        user.is_active = not user.is_active
        user.save(update_fields=['is_active'])

        status_text = 'activé' if user.is_active else 'désactivé'
        if user.is_superuser:
            logger.warning(f"Super admin {status_text}: {user.email} par {request.user.email}")
        else:
            logger.info(f"Utilisateur {status_text}: {user.email} par {request.user.email}")

        return Response({
            'detail': f"Utilisateur {status_text} avec succès.",
            'is_active': user.is_active,
        }, status=status.HTTP_200_OK)


class RolesListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        if not (user.is_superuser or user.is_platform_admin() or user.memberships.filter(
            is_active=True,
            role='ROLE_ORGANISATION_ADMIN',
        ).exists()):
            return Response(
                {'detail': 'Accès non autorisé.'},
                status=status.HTTP_403_FORBIDDEN
            )

        roles_data = []
        for role_config in ROLES_CONFIG:
            role_id = role_config['id']
            if role_id == 'ROLE_SUPER_ADMIN':
                count = User.objects.filter(is_superuser=True, is_deleted=False).count()
            elif role_id == 'ROLE_ADMIN_SYSTEME':
                count = User.objects.filter(platform_role='ROLE_ADMIN_SYSTEME', is_deleted=False).count()
            else:
                count = User.objects.filter(
                    memberships__role=role_id,
                    memberships__is_active=True,
                    is_deleted=False,
                ).distinct().count()

            roles_data.append({
                **role_config,
                'user_count': count,
            })

        return Response(roles_data, status=status.HTTP_200_OK)


class UserRestoreView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        try:
            user = User.objects.get(pk=pk, is_deleted=True)
        except User.DoesNotExist:
            return Response(
                {'detail': 'Utilisateur non trouvé ou n\'est pas supprimé.'},
                status=status.HTTP_404_NOT_FOUND
            )

        allowed, msg = can_manage_user(request.user, user)
        if not allowed:
            return Response({'detail': msg}, status=status.HTTP_403_FORBIDDEN)

        user.is_deleted = False
        user.is_active = True
        user.deleted_at = None
        user.save(update_fields=['is_deleted', 'is_active', 'deleted_at'])

        logger.warning(f"Compte restauré: {user.email} par {request.user.email}")

        serializer = UserDetailSerializer(user, context={'request': request})
        return Response(serializer.data, status=status.HTTP_200_OK)


class UserBulkRestoreView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        user_ids = request.data.get('user_ids', [])
        if not isinstance(user_ids, list) or not user_ids:
            return Response(
                {'detail': 'La liste user_ids est requise et doit être non vide.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        restored_count = 0
        errors = []

        for uid in user_ids:
            try:
                user = User.objects.get(pk=uid, is_deleted=True)
            except User.DoesNotExist:
                errors.append({'id': uid, 'detail': 'Utilisateur non trouvé ou n\'est pas supprimé.'})
                continue

            allowed, msg = can_manage_user(request.user, user)
            if not allowed:
                errors.append({'id': uid, 'detail': msg})
                continue

            user.is_deleted = False
            user.is_active = True
            user.deleted_at = None
            user.save(update_fields=['is_deleted', 'is_active', 'deleted_at'])

            logger.warning(f"Compte restauré (bulk): {user.email} par {request.user.email}")
            restored_count += 1

        return Response({
            'restored_count': restored_count,
            'errors': errors,
        }, status=status.HTTP_200_OK)


def _is_app_admin(user):
    """Vrai pour un Super Admin ou un Admin Système (administration de l'application)."""
    return user.is_superuser or user.get_primary_role() == 'ROLE_ADMIN_SYSTEME'


class UserPermanentDeleteView(APIView):
    """DELETE /api/v1/users/{id}/permanent/ — suppression DÉFINITIVE (irréversible).

    Autorisée uniquement sur un utilisateur déjà en corbeille (is_deleted=True), par un
    administrateur de l'application pouvant gérer la cible, et jamais sur soi-même.
    """
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, pk):
        if not _is_app_admin(request.user):
            return Response({'detail': "Action réservée à l'administrateur de l'application."},
                            status=status.HTTP_403_FORBIDDEN)
        try:
            user = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({'detail': 'Utilisateur non trouvé.'}, status=status.HTTP_404_NOT_FOUND)
        if user.pk == request.user.pk:
            return Response({'detail': 'Vous ne pouvez pas supprimer votre propre compte.'},
                            status=status.HTTP_403_FORBIDDEN)
        if not user.is_deleted:
            return Response({'detail': 'Seul un compte en corbeille peut être supprimé définitivement.'},
                            status=status.HTTP_400_BAD_REQUEST)
        allowed, msg = can_manage_user(request.user, user)
        if not allowed:
            return Response({'detail': msg}, status=status.HTTP_403_FORBIDDEN)

        email = user.email
        user.delete()
        logger.warning(f"Compte supprimé DÉFINITIVEMENT: {email} par {request.user.email}")
        return Response(status=status.HTTP_204_NO_CONTENT)


class UserBulkPermanentDeleteView(APIView):
    """POST /api/v1/users/permanent-delete/ — {user_ids} — purge en masse (corbeille)."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if not _is_app_admin(request.user):
            return Response({'detail': "Action réservée à l'administrateur de l'application."},
                            status=status.HTTP_403_FORBIDDEN)
        user_ids = request.data.get('user_ids', [])
        if not isinstance(user_ids, list) or not user_ids:
            return Response({'detail': 'La liste user_ids est requise et doit être non vide.'},
                            status=status.HTTP_400_BAD_REQUEST)

        deleted_count = 0
        errors = []
        for uid in user_ids:
            if str(uid) == str(request.user.pk):
                errors.append({'id': uid, 'detail': 'Auto-suppression interdite.'})
                continue
            try:
                user = User.objects.get(pk=uid, is_deleted=True)
            except User.DoesNotExist:
                errors.append({'id': uid, 'detail': "Utilisateur non trouvé ou n'est pas en corbeille."})
                continue
            allowed, msg = can_manage_user(request.user, user)
            if not allowed:
                errors.append({'id': uid, 'detail': msg})
                continue
            email = user.email
            user.delete()
            logger.warning(f"Compte supprimé DÉFINITIVEMENT (bulk): {email} par {request.user.email}")
            deleted_count += 1

        return Response({'deleted_count': deleted_count, 'errors': errors}, status=status.HTTP_200_OK)
