from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Membership, Organization
from .rbac import count_other_active_org_admins, MIN_ACTIVE_ORG_ADMINS
import secrets
import string
from accounts.fields import AuthorDisplayField

User = get_user_model()


class AuditEmailsMixin(serializers.Serializer):
    """Colonnes d'audit standard exposées par l'API pour les utilisateurs (cf. CLAUDE.md).

    `date_joined` tient lieu de date de création : il est aliasé en `created_at` pour rester
    homogène avec les autres tableaux de l'app.
    """
    created_at = serializers.DateTimeField(source='date_joined', read_only=True)
    created_by_email = AuthorDisplayField(source='created_by')
    updated_by_email = AuthorDisplayField(source='updated_by')
    deleted_by_email = AuthorDisplayField(source='deleted_by')


class UserListSerializer(AuditEmailsMixin, serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    role_display = serializers.SerializerMethodField()
    organization_name = serializers.SerializerMethodField()
    organization_id = serializers.SerializerMethodField()
    is_superuser = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = [
            'id', 'email', 'first_name', 'last_name', 'nom_societe',
            'is_active', 'is_superuser', 'platform_role',
            'role', 'role_display', 'organization_name', 'organization_id',
            'last_connection_at', 'password_changed_at',
            'must_change_password', 'date_joined',
            # Colonnes d'audit standard (cf. CLAUDE.md).
            'created_at', 'updated_at', 'is_deleted', 'deleted_at',
            'created_by_email', 'updated_by_email', 'deleted_by_email',
        ]

    def get_role(self, obj):
        return obj.get_primary_role()

    def get_role_display(self, obj):
        return obj.get_primary_role_display()

    def get_organization_name(self, obj):
        org = obj.get_primary_organization()
        return org.name if org else None

    def get_organization_id(self, obj):
        org = obj.get_primary_organization()
        return str(org.id) if org else None


class UserDetailSerializer(AuditEmailsMixin, serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    role_display = serializers.SerializerMethodField()
    organization_name = serializers.SerializerMethodField()
    organization_id = serializers.SerializerMethodField()
    memberships = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'email', 'first_name', 'last_name', 'nom_societe',
            'is_active', 'is_superuser', 'platform_role',
            'role', 'role_display', 'organization_name', 'organization_id',
            'memberships',
            'last_connection_at', 'password_changed_at',
            'must_change_password', 'date_joined',
            # Colonnes d'audit standard (cf. CLAUDE.md).
            'created_at', 'updated_at', 'is_deleted', 'deleted_at',
            'created_by_email', 'updated_by_email', 'deleted_by_email',
        ]
        read_only_fields = ['id', 'email', 'date_joined', 'last_connection_at',
                           'password_changed_at', 'deleted_at', 'is_superuser',
                           'created_at', 'updated_at']

    def get_role(self, obj):
        return obj.get_primary_role()

    def get_role_display(self, obj):
        return obj.get_primary_role_display()

    def get_organization_name(self, obj):
        org = obj.get_primary_organization()
        return org.name if org else None

    def get_organization_id(self, obj):
        org = obj.get_primary_organization()
        return str(org.id) if org else None

    def get_memberships(self, obj):
        memberships = obj.memberships.filter(is_active=True).select_related('organization')
        return [
            {
                'organization_id': str(m.organization.id),
                'organization_name': m.organization.name,
                'role': m.role,
                'role_display': m.get_role_display(),
                'joined_at': m.joined_at,
            }
            for m in memberships
        ]


class BlankableUUIDField(serializers.UUIDField):
    """
    UUIDField that accepts empty strings as None.
    """
    def to_internal_value(self, data):
        if data == '':
            return None
        return super().to_internal_value(data)


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    role = serializers.ChoiceField(
        choices=['ROLE_ORGANISATION_ADMIN', 'ROLE_ORGANISATION_AGENT', 'ROLE_ADMIN_SYSTEME'],
        default='ROLE_ORGANISATION_AGENT'
    )
    organization_id = BlankableUUIDField(required=False, allow_null=True)
    must_change_password = serializers.BooleanField(default=True)

    class Meta:
        model = User
        fields = [
            'email', 'first_name', 'last_name', 'nom_societe',
            'password', 'role', 'organization_id', 'must_change_password',
        ]

    def validate_email(self, value):
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("Cet email est déjà utilisé.")
        return value

    def validate_role(self, value):
        request = self.context.get('request')
        if request and hasattr(request, 'user'):
            if request.user.is_superuser:
                return value
            if value == 'ROLE_ADMIN_SYSTEME':
                raise serializers.ValidationError(
                    "Seul un Super Admin peut créer un compte Admin Système."
                )
            if value == 'ROLE_ORGANISATION_ADMIN':
                raise serializers.ValidationError(
                    "Seuls les Super Admins et Admins Système peuvent créer un compte Admin Organisation."
                )
        return value

    def validate_organization_id(self, value):
        role = self.initial_data.get('role', 'ROLE_ORGANISATION_AGENT')
        if role == 'ROLE_ADMIN_SYSTEME':
            return None
        if not value:
            raise serializers.ValidationError("Ce champ est obligatoire.")
        if not Organization.objects.filter(id=value, is_active=True, is_deleted=False).exists():
            raise serializers.ValidationError("L'organisation spécifiée n'existe pas.")

        # Un Admin Organisation ne peut créer un utilisateur que dans SA propre organisation.
        request = self.context.get('request')
        author = getattr(request, 'user', None)
        if author and not author.is_superuser and not author.is_platform_admin():
            admin_org_ids = {
                str(oid) for oid in author.memberships.filter(
                    is_active=True,
                    role='ROLE_ORGANISATION_ADMIN',
                ).values_list('organization_id', flat=True)
            }
            if str(value) not in admin_org_ids:
                raise serializers.ValidationError(
                    "Vous ne pouvez créer un utilisateur que dans votre organisation."
                )
        return value

    def create(self, validated_data):
        role = validated_data.pop('role')
        organization_id = validated_data.pop('organization_id', None)
        must_change_password = validated_data.pop('must_change_password', True)

        is_app_admin = role == 'ROLE_ADMIN_SYSTEME'

        user = User.objects.create_user(
            username=validated_data['email'],
            email=validated_data['email'],
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
            nom_societe=validated_data.get('nom_societe', ''),
            is_superuser=False,
            platform_role='ROLE_ADMIN_SYSTEME' if is_app_admin else None,
            must_change_password=must_change_password,
        )

        if organization_id and not is_app_admin:
            organization = Organization.objects.get(id=organization_id)
            Membership.objects.create(
                user=user,
                organization=organization,
                role=role,
            )

        return user


class UserUpdateSerializer(serializers.ModelSerializer):
    role = serializers.ChoiceField(
        choices=['ROLE_ORGANISATION_ADMIN', 'ROLE_ORGANISATION_AGENT', 'ROLE_ADMIN_SYSTEME'],
        required=False
    )
    organization_id = BlankableUUIDField(required=False, allow_null=True)

    class Meta:
        model = User
        fields = [
            'first_name', 'last_name', 'nom_societe',
            'is_active', 'role', 'organization_id',
        ]

    def validate_role(self, value):
        request = self.context.get('request')
        if request and hasattr(request, 'user'):
            is_superuser = request.user.is_superuser
            is_admin_systeme = request.user.is_platform_admin()
            if value == 'ROLE_ADMIN_SYSTEME' and not is_superuser:
                raise serializers.ValidationError(
                    "Seul un Super Admin peut attribuer le rôle Admin Système."
                )
            if value == 'ROLE_ORGANISATION_ADMIN' and not is_superuser and not is_admin_systeme:
                raise serializers.ValidationError(
                    "Seuls les Super Admins et Admins Système peuvent attribuer le rôle Admin Organisation."
                )
            if self.instance and self.instance.pk == request.user.pk:
                if is_superuser or is_admin_systeme:
                    if value != self.instance.get_primary_role():
                        raise serializers.ValidationError(
                            "Vous ne pouvez pas modifier votre propre rôle."
                        )
        return value

    @staticmethod
    def _guard_org_admin_demotion(instance, membership, new_role):
        """
        Empêche de rétrograder le dernier administrateur actif d'une organisation.

        Lève une ValidationError si `membership` est actuellement un admin d'org, que
        `new_role` n'est plus admin, et qu'aucun autre admin actif ne resterait.
        """
        if (membership.role == 'ROLE_ORGANISATION_ADMIN'
                and new_role != 'ROLE_ORGANISATION_ADMIN'
                and count_other_active_org_admins(membership.organization, instance)
                < MIN_ACTIVE_ORG_ADMINS):
            raise serializers.ValidationError({
                'role': (
                    f"Impossible de rétrograder : {instance.email} est le dernier "
                    f"administrateur actif de {membership.organization.name}. "
                    f"Nommez un autre administrateur avant."
                )
            })

    def update(self, instance, validated_data):
        role = validated_data.pop('role', None)
        organization_id = validated_data.pop('organization_id', None)

        # Un Admin Organisation ne peut JAMAIS changer l'organisation d'un utilisateur
        # (ni la sienne, ni celle d'un agent de son organisation).
        request = self.context.get('request')
        author = getattr(request, 'user', None)
        author_is_org_admin = bool(
            author and not author.is_superuser and not author.is_platform_admin()
        )
        if author_is_org_admin and organization_id:
            current_org = instance.get_primary_organization()
            current_org_id = str(current_org.id) if current_org else None
            if str(organization_id) != current_org_id:
                raise serializers.ValidationError({
                    'organization_id': "Vous ne pouvez pas changer l'organisation d'un utilisateur."
                })

        if instance.is_superuser:
            if role is not None:
                raise serializers.ValidationError(
                    {'role': 'Impossible de modifier le rôle d\'un super administrateur.'}
                )
            organization_id = None  # Les super admins n'ont pas d'organisation

        if instance.is_platform_admin():
            if role is not None:
                request = self.context.get('request')
                if request and request.user.pk == instance.pk:
                    raise serializers.ValidationError(
                        {'role': 'Vous ne pouvez pas modifier votre propre rôle.'}
                    )

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        is_app_admin = role == 'ROLE_ADMIN_SYSTEME'

        if is_app_admin:
            instance.platform_role = 'ROLE_ADMIN_SYSTEME'
            organization_id = None  # Les admins système n'ont pas d'organisation
        elif role and instance.is_platform_admin() and role != 'ROLE_ADMIN_SYSTEME':
            active_count = User.objects.filter(
                platform_role='ROLE_ADMIN_SYSTEME', is_active=True, is_deleted=False
            ).count()
            if active_count <= 2:
                raise serializers.ValidationError(
                    {'role': 'Impossible de changer le rôle : cela laisserait moins de deux administrateurs système actifs.'}
                )
            instance.platform_role = None

        if organization_id:
            organization = Organization.objects.get(id=organization_id)
            membership, created = Membership.objects.get_or_create(
                user=instance,
                organization=organization,
                defaults={'role': role or 'ROLE_ORGANISATION_AGENT', 'is_active': True},
            )
            if not created:
                if role and not is_app_admin:
                    self._guard_org_admin_demotion(instance, membership, role)
                    membership.role = role
                membership.is_active = True
                membership.save()

            # Un utilisateur a UNE organisation principale : on désactive ses autres
            # appartenances actives, sinon `get_primary_organization` (première adhésion
            # active par `joined_at`) continue de renvoyer l'ANCIENNE organisation — le
            # changement d'organisation semblait alors sans effet. Garde : ne pas orpheliner
            # une organisation de son dernier administrateur actif.
            others = list(instance.memberships.filter(is_active=True).exclude(pk=membership.pk))
            for other in others:
                if (other.role == 'ROLE_ORGANISATION_ADMIN'
                        and count_other_active_org_admins(other.organization, instance) < MIN_ACTIVE_ORG_ADMINS):
                    raise serializers.ValidationError({
                        'organization_id': (
                            f"Impossible de retirer {instance.email} de "
                            f"{other.organization.name} : il en est le dernier administrateur actif. "
                            f"Nommez un autre administrateur avant."
                        )
                    })
            if others:
                instance.memberships.filter(is_active=True).exclude(pk=membership.pk).update(is_active=False)

            # Les projets suivent leur créateur : tous les projets créés par cet utilisateur
            # sont rattachés à sa nouvelle organisation courante (y compris les projets en
            # corbeille, pour rester cohérent en cas de restauration).
            from projects.models import Projet
            Projet.objects.filter(created_by=instance).update(organization=organization)
        elif role and not is_app_admin:
            membership = instance.memberships.filter(is_active=True).first()
            if membership:
                self._guard_org_admin_demotion(instance, membership, role)
                membership.role = role
                membership.save()

        instance.save()
        return instance


class RoleSerializer(serializers.Serializer):
    id = serializers.CharField()
    name = serializers.CharField()
    description = serializers.CharField()
    permissions = serializers.ListField(child=serializers.CharField())
    user_count = serializers.IntegerField()


class ResetPasswordSerializer(serializers.Serializer):
    new_password = serializers.CharField(min_length=8, required=False)
    must_change_password = serializers.BooleanField(default=True)

    def generate_password(self):
        alphabet = string.ascii_letters + string.digits + '!@#$%^&*'
        password = ''.join(secrets.choice(alphabet) for _ in range(12))
        return password
