from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Organization
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
