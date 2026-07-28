from rest_framework import serializers
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken
from .models import Organization, Membership
from accounts.fields import AuthorDisplayField

User = get_user_model()


class OrganizationSerializer(serializers.ModelSerializer):
    """
    Sérialiseur complet pour afficher toutes les informations d'une organisation.
    Inclut les champs calculés avec labels personnalisés.
    """
    # Champs calculés
    type_display = serializers.CharField(
        source='get_type_display',
        read_only=True,
        label="Type (affiché)",
        help_text="Libellé lisible du type d'organisation"
    )
    member_count = serializers.SerializerMethodField(
        label="Nombre de membres",
        help_text="Nombre total de membres actifs dans cette organisation"
    )
    created_by_email = AuthorDisplayField(source='created_by')
    full_path = serializers.CharField(
        read_only=True,
        label="Chemin hiérarchique",
        help_text="Chemin complet dans la hiérarchie (ex: Ministère > Direction > Division)"
    )
    
    class Meta:
        model = Organization
        fields = [
            'id', 'code', 'name', 'type', 'type_display', 'legal_id',
            'address', 'phone', 'email', 'website', 'logo',
            'parent', 'member_count', 'created_by_email', 'full_path',
            'is_active', 'created_at', 'updated_at', 'created_by'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']
    
    def get_member_count(self, obj):
        """Retourne le nombre de membres actifs dans l'organisation."""
        return obj.members.filter(is_active=True).count()


class RegisterSerializer(serializers.ModelSerializer):
    """
    Sérialiseur pour l'inscription des utilisateurs avec support RBAC multi-organisations.
    Supporte deux modes :
    1. Création d'une nouvelle organisation (sans organization_code)
    2. Rejoindre une organisation existante (avec organization_code)
    """
    password = serializers.CharField(write_only=True, min_length=8)
    confirmPassword = serializers.CharField(write_only=True)
    nomSociete = serializers.CharField(write_only=True, required=False, source='nom_societe')
    organizationCode = serializers.CharField(
        write_only=True, 
        required=False,
        help_text="Code d'organisation pour rejoindre une organisation existante. Laissez vide pour créer votre propre organisation."
    )

    class Meta:
        model = User
        fields = ['first_name', 'last_name', 'nomSociete', 'email', 'password', 'confirmPassword', 'organizationCode']

    def validate(self, data):
        """
        Vérifie que les mots de passe correspondent et valide le code d'organisation si fourni.
        """
        if data['password'] != data['confirmPassword']:
            raise serializers.ValidationError({"confirmPassword": "Les mots de passe ne correspondent pas."})
        
        # Validation du code d'organisation si fourni
        org_code = data.get('organizationCode')
        if org_code:
            try:
                organization = Organization.objects.get(code=org_code, is_active=True)
                data['_organization'] = organization  # Stocke pour utilisation dans create()
            except Organization.DoesNotExist:
                raise serializers.ValidationError({
                    "organizationCode": "Le code d'organisation est invalide ou l'organisation n'existe plus."
                })
        
        return data

    def create(self, validated_data):
        """
        Crée un nouvel utilisateur avec son organisation et son rôle RBAC.
        """
        validated_data.pop('confirmPassword')
        organization_code = validated_data.pop('organizationCode', None)
        organization = validated_data.pop('_organization', None)
        
        # Création de l'utilisateur
        user = User.objects.create_user(
            username=validated_data['email'],
            email=validated_data['email'],
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
            nom_societe=validated_data.get('nom_societe', '')
        )
        
        # Gestion de l'organisation et du rôle RBAC
        if organization:
            # Mode 2: Rejoindre une organisation existante avec rôle USER
            Membership.objects.create(
                user=user,
                organization=organization,
                role='ROLE_ORGANISATION_AGENT'
            )
        else:
            # Mode 1: Créer une nouvelle organisation avec l'utilisateur comme ADMIN
            org_name = validated_data.get('nom_societe') or f"{validated_data.get('first_name', '')} {validated_data.get('last_name', '')}"
            
            # Générer un code unique basé sur le nom de l'organisation
            import random
            import string
            base_code = ''.join(e for e in org_name.upper() if e.isalnum())[:8]
            suffix = ''.join(random.choices(string.digits, k=4))
            org_code = f"{base_code}-{suffix}"
            
            # S'assurer que le code est unique
            while Organization.objects.filter(code=org_code).exists():
                suffix = ''.join(random.choices(string.digits, k=4))
                org_code = f"{base_code}-{suffix}"
            
            organization = Organization.objects.create(
                name=org_name,
                code=org_code,
                description=f"Organisation créée par {user.email}"
            )
            
            # Créer l'adhésion avec rôle ADMIN
            Membership.objects.create(
                user=user,
                organization=organization,
                role='ROLE_ORGANISATION_ADMIN'
            )
        
        return user


class LoginSerializer(serializers.Serializer):
    """
    Sérialiseur pour la connexion des utilisateurs.
    """
    email = serializers.EmailField()
    password = serializers.CharField()


class AuthResponseSerializer(serializers.Serializer):
    """
    Sérialiseur pour la réponse d'authentification avec informations RBAC.
    Inclut le token JWT, les infos utilisateur et les données d'organisation/rôle.
    """
    token = serializers.CharField()
    user = serializers.DictField()
    organization_id = serializers.UUIDField(required=False, allow_null=True)
    organization_name = serializers.CharField(required=False, allow_null=True)
    role = serializers.CharField(required=False, allow_null=True)
