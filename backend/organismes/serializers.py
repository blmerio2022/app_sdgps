"""Sérialiseurs DRF des organismes premier / deuxième niveau."""
from rest_framework import serializers

from .models import OrganismeNiveau1, OrganismeNiveau2
from accounts.fields import AuthorDisplayField


class _OrganismeBaseSerializer(serializers.ModelSerializer):
    """Champs communs + normalisation/unicité du `code` et méta d'audit en lecture."""
    # Nom complet de l'auteur (repli : email) — cf. `AuthorDisplayField`.
    created_by_email = AuthorDisplayField(source='created_by')
    updated_by_email = AuthorDisplayField(source='updated_by')
    deleted_by_email = AuthorDisplayField(source='deleted_by')

    # Modèle concret défini par les sous-classes.
    model = None

    class Meta:
        model = None
        fields = [
            'id', 'code', 'nom', 'sigle', 'is_active',
            'created_at', 'updated_at', 'is_deleted', 'deleted_at',
            'created_by_email', 'updated_by_email', 'deleted_by_email',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'is_deleted', 'deleted_at']

    def validate_code(self, value):
        value = (value or '').strip().upper()
        qs = self.Meta.model.objects.filter(code=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Ce code est déjà utilisé.")
        return value


class OrganismeNiveau1Serializer(_OrganismeBaseSerializer):
    nbr_niveaux2 = serializers.IntegerField(read_only=True)

    class Meta(_OrganismeBaseSerializer.Meta):
        model = OrganismeNiveau1
        fields = _OrganismeBaseSerializer.Meta.fields + ['nbr_niveaux2']


class OrganismeNiveau2Serializer(_OrganismeBaseSerializer):
    niveau1_nom = serializers.CharField(source='niveau1.nom', read_only=True)
    # Sigle de l'organisme de premier niveau de rattachement. `allow_null=True` est requis :
    # sans lui, DRF omet le champ quand le sigle est vide/absent et la colonne disparaît.
    niveau1_sigle = serializers.CharField(source='niveau1.sigle', read_only=True,
                                          allow_null=True)

    class Meta(_OrganismeBaseSerializer.Meta):
        model = OrganismeNiveau2
        fields = _OrganismeBaseSerializer.Meta.fields + [
            'niveau1', 'niveau1_nom', 'niveau1_sigle', 'ville',
        ]

    def validate_niveau1(self, value):
        if value.is_deleted:
            raise serializers.ValidationError(
                "Cet organisme de premier niveau est supprimé.")
        return value
