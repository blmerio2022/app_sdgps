"""
Sérialiseurs pour la gestion des organisations
"""
from rest_framework import serializers
from accounts.models import Organization, Membership
from accounts.fields import AuthorDisplayField


class OrganizationSerializer(serializers.ModelSerializer):
    """Serializer pour l'affichage et la création d'organisations"""
    
    type_display = serializers.CharField(source='get_type_display', read_only=True)
    full_path = serializers.CharField(source='get_full_path', read_only=True)
    member_count = serializers.SerializerMethodField()
    # Nom complet de l'auteur (repli : email) — cf. `AuthorDisplayField`.
    created_by_email = AuthorDisplayField(source='created_by')
    modified_by_email = AuthorDisplayField(source='modified_by')
    # Alias unifié dans toute l'app (le champ DB historique reste `modified_by`).
    updated_by_email = AuthorDisplayField(source='modified_by')
    deleted_by_email = AuthorDisplayField(source='deleted_by')

    class Meta:
        model = Organization
        fields = [
            'id',
            'code',
            'name',
            'type',
            'type_display',
            'legal_id',
            'address',
            'phone',
            'email',
            'website',
            'logo',
            'parent',
            'full_path',
            'is_active',
            'member_count',
            # Colonnes d'audit standard (cf. CLAUDE.md).
            'created_at',
            'updated_at',
            'is_deleted',
            'deleted_at',
            'created_by_email',
            'modified_by_email',
            'updated_by_email',
            'deleted_by_email',
            'is_test_data',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'member_count', 'full_path']

    def get_member_count(self, obj):
        return obj.get_member_count()

    def validate_code(self, value):
        """Valide que le code est unique (sauf pour l'organisation en cours de modification)"""
        # Normaliser le code en majuscules
        normalized_value = value.upper()
        
        # Vérifier si une autre organisation utilise déjà ce code
        queryset = Organization.objects.filter(code=normalized_value)
        
        # Si on met à jour une organisation existante, exclure cette organisation de la vérification
        if self.instance:
            queryset = queryset.exclude(id=self.instance.id)
        
        if queryset.exists():
            raise serializers.ValidationError("Ce code d'organisation existe déjà.")
        
        return normalized_value


class OrganizationListSerializer(serializers.ModelSerializer):
    """Serializer léger pour les listes (sans détails complets)"""
    
    type_display = serializers.CharField(source='get_type_display', read_only=True)
    member_count = serializers.IntegerField(source='get_member_count', read_only=True)
    # Nom complet de l'auteur (repli : email) — cf. `AuthorDisplayField`.
    created_by_email = AuthorDisplayField(source='created_by')
    modified_by_email = AuthorDisplayField(source='modified_by')
    # Alias unifié dans toute l'app (le champ DB historique reste `modified_by`).
    updated_by_email = AuthorDisplayField(source='modified_by')
    deleted_by_email = AuthorDisplayField(source='deleted_by')

    class Meta:
        model = Organization
        fields = [
            'id',
            'code',
            'name',
            'type',
            'type_display',
            'legal_id',
            'address',
            'phone',
            'email',
            'website',
            'is_active',
            'member_count',
            # Colonnes d'audit standard (cf. CLAUDE.md).
            'created_at',
            'updated_at',
            'is_deleted',
            'deleted_at',
            'created_by_email',
            'modified_by_email',
            'updated_by_email',
            'deleted_by_email',
        ]


class MembershipSerializer(serializers.ModelSerializer):
    """Serializer pour les adhésions utilisateurs-organisations"""
    
    user_email = serializers.EmailField(source='user.email', read_only=True)
    user_name = serializers.SerializerMethodField()
    organization_name = serializers.CharField(source='organization.name', read_only=True)
    organization_code = serializers.CharField(source='organization.code', read_only=True)
    role_display = serializers.CharField(source='get_role_display', read_only=True)

    class Meta:
        model = Membership
        fields = [
            'id',
            'user',
            'user_email',
            'user_name',
            'organization',
            'organization_name',
            'organization_code',
            'role',
            'role_display',
            'joined_at',
            'is_active',
        ]
        read_only_fields = ['id', 'joined_at', 'user_email', 'user_name', 'organization_name', 'role_display']

    def get_user_name(self, obj):
        return f"{obj.user.first_name} {obj.user.last_name}".strip()

    def validate(self, attrs):
        """Vérifie que l'utilisateur n'a pas déjà un rôle dans cette organisation"""
        user = attrs.get('user')
        organization = attrs.get('organization')
        
        if user and organization:
            existing = Membership.objects.filter(
                user=user, 
                organization=organization
            ).exclude(id=self.instance.id if self.instance else None)
            
            if existing.exists():
                raise serializers.ValidationError(
                    "Cet utilisateur a déjà un rôle dans cette organisation."
                )
        
        return attrs
