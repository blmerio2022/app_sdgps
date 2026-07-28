"""Sérialiseurs DRF du domaine métier, avec validations conditionnelles."""
from rest_framework import serializers

from organismes.models import OrganismeNiveau1, OrganismeNiveau2
from .models import Projet, Propriete, Affaire, Ssdgps, Session
from .validators import validate_affaire_coherence
from accounts.fields import AuthorDisplayField


class ProjetSerializer(serializers.ModelSerializer):
    statut_display = serializers.CharField(source='get_statut_display', read_only=True)
    organization_name = serializers.CharField(source='organization.name', read_only=True)
    # Alimentés par l'annotation de queryset dans ProjetViewSet._annotate_counts
    nbr_total_proprietes = serializers.IntegerField(read_only=True)
    nbr_total_affaires = serializers.IntegerField(read_only=True)
    nbr_total_ssdgps = serializers.IntegerField(read_only=True)
    nbr_total_sessions = serializers.IntegerField(read_only=True)
    nbr_total_pieces = serializers.IntegerField(read_only=True)
    created_by_email = AuthorDisplayField(source='created_by')
    updated_by_email = AuthorDisplayField(source='updated_by')
    deleted_by_email = AuthorDisplayField(source='deleted_by')

    class Meta:
        model = Projet
        fields = [
            'id', 'nom_projet', 'description_projet', 'code_projet',
            'organization', 'organization_name', 'statut', 'statut_display',
            'nbr_total_proprietes', 'nbr_total_affaires', 'nbr_total_ssdgps', 'nbr_total_sessions',
            'nbr_total_pieces',
            'created_at', 'updated_at', 'is_deleted', 'deleted_at',
            'created_by_email', 'updated_by_email', 'deleted_by_email',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'is_deleted', 'deleted_at']

    def validate_code_projet(self, value):
        qs = Projet.objects.filter(code_projet=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Ce code projet est déjà utilisé.")
        return value


class ProprieteSerializer(serializers.ModelSerializer):
    nbr_total_affaires = serializers.IntegerField(read_only=True)
    nbr_total_ssdgps = serializers.IntegerField(read_only=True)
    nbr_total_sessions = serializers.IntegerField(read_only=True)
    nbr_total_pieces = serializers.IntegerField(read_only=True)
    # Identifiant métier de la propriété : le titre foncier s'il est renseigné, sinon la
    # réquisition (même règle d'affichage que `itemLabel`/`proprieteLabel` côté front).
    id_propriete = serializers.SerializerMethodField()
    # Organismes : requis à l'écriture (le modèle les autorise null pour la migration).
    organisme_niveau1 = serializers.PrimaryKeyRelatedField(
        queryset=OrganismeNiveau1.objects.filter(is_deleted=False), required=True)
    organisme_niveau2 = serializers.PrimaryKeyRelatedField(
        queryset=OrganismeNiveau2.objects.filter(is_deleted=False), required=True)
    organisme_niveau1_nom = serializers.CharField(source='organisme_niveau1.nom', read_only=True)
    organisme_niveau2_nom = serializers.CharField(source='organisme_niveau2.nom', read_only=True)
    created_by_email = AuthorDisplayField(source='created_by')
    updated_by_email = AuthorDisplayField(source='updated_by')
    deleted_by_email = AuthorDisplayField(source='deleted_by')

    class Meta:
        model = Propriete
        fields = [
            'id', 'nom_propriete', 'id_requisition', 'id_titre', 'id_propriete', 'projet',
            'organisme_niveau1', 'organisme_niveau2',
            'organisme_niveau1_nom', 'organisme_niveau2_nom',
            'nbr_total_affaires', 'nbr_total_ssdgps', 'nbr_total_sessions', 'nbr_total_pieces',
            'created_at', 'updated_at', 'is_deleted', 'deleted_at',
            'created_by_email', 'updated_by_email', 'deleted_by_email',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'is_deleted', 'deleted_at']

    def get_id_propriete(self, obj) -> str:
        """Titre foncier prioritaire, repli sur la réquisition ('' si aucun des deux)."""
        return obj.id_titre or obj.id_requisition or ''

    def validate(self, attrs):
        req = attrs.get('id_requisition', getattr(self.instance, 'id_requisition', ''))
        titre = attrs.get('id_titre', getattr(self.instance, 'id_titre', ''))
        if not req and not titre:
            raise serializers.ValidationError(
                "Renseignez au moins la réquisition ou le titre foncier."
            )
        # Cohérence : le 2e niveau doit être rattaché au 1er niveau choisi.
        n1 = attrs.get('organisme_niveau1', getattr(self.instance, 'organisme_niveau1', None))
        n2 = attrs.get('organisme_niveau2', getattr(self.instance, 'organisme_niveau2', None))
        if n1 and n2 and n2.niveau1_id != n1.id:
            raise serializers.ValidationError({
                'organisme_niveau2':
                    "L'organisme de deuxième niveau doit dépendre de l'organisme de "
                    "premier niveau choisi."
            })
        return attrs


class AffaireSerializer(serializers.ModelSerializer):
    nbr_total_ssdgps = serializers.IntegerField(read_only=True)
    nbr_total_sessions = serializers.IntegerField(read_only=True)
    nbr_total_pieces = serializers.IntegerField(read_only=True)
    created_by_email = AuthorDisplayField(source='created_by')
    updated_by_email = AuthorDisplayField(source='updated_by')
    deleted_by_email = AuthorDisplayField(source='deleted_by')

    class Meta:
        model = Affaire
        fields = [
            'id', 'numero_sd_affaire', 'nature_procedure_affaire', 'nature_affaire',
            'date_bornage', 'propriete', 'nbr_total_ssdgps', 'nbr_total_sessions',
            'nbr_total_pieces',
            'created_at', 'updated_at', 'is_deleted', 'deleted_at',
            'created_by_email', 'updated_by_email', 'deleted_by_email',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'is_deleted', 'deleted_at']

    def validate(self, attrs):
        inst = self.instance
        procedure = attrs.get('nature_procedure_affaire', getattr(inst, 'nature_procedure_affaire', None))
        nature = attrs.get('nature_affaire', getattr(inst, 'nature_affaire', None))
        date_bornage = attrs.get('date_bornage', getattr(inst, 'date_bornage', None))
        # Réutilise la règle métier partagée (lève ValidationError avec dict de champs)
        validate_affaire_coherence(procedure, nature, date_bornage)
        return attrs


class SsdgpsSerializer(serializers.ModelSerializer):
    nbr_total_sessions = serializers.IntegerField(read_only=True)
    nbr_total_pieces = serializers.IntegerField(read_only=True)
    # Contexte parent dénormalisé (via select_related, sans requête supplémentaire) : sert à
    # la vue « tous les SSDGPS d'un projet » (affichage + navigation vers les pièces).
    propriete = serializers.UUIDField(source='affaire.propriete.id', read_only=True)
    propriete_nom = serializers.CharField(source='affaire.propriete.nom_propriete', read_only=True)
    propriete_id_titre = serializers.CharField(source='affaire.propriete.id_titre', read_only=True)
    propriete_id_requisition = serializers.CharField(source='affaire.propriete.id_requisition', read_only=True)
    affaire_numero = serializers.CharField(source='affaire.numero_sd_affaire', read_only=True)
    created_by_email = AuthorDisplayField(source='created_by')
    updated_by_email = AuthorDisplayField(source='updated_by')
    deleted_by_email = AuthorDisplayField(source='deleted_by')

    class Meta:
        model = Ssdgps
        fields = [
            'id', 'nature_ssdgps', 'numero_ssdgps', 'type_ssdgps', 'affaire',
            'propriete', 'propriete_nom', 'propriete_id_titre', 'propriete_id_requisition',
            'affaire_numero',
            'nbr_total_sessions', 'nbr_total_pieces', 'created_at', 'updated_at', 'is_deleted', 'deleted_at',
            'created_by_email', 'updated_by_email', 'deleted_by_email',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'is_deleted', 'deleted_at']

    def validate(self, attrs):
        # Unicité (affaire, numero_ssdgps) : garantie en base par une UniqueConstraint. On la
        # valide explicitement ici pour un 400 DÉTERMINISTE quelle que soit la version de DRF
        # (la génération auto de validateurs à partir des UniqueConstraint varie selon les
        # versions ; sans cela, un doublon partirait jusqu'à l'IntegrityError → 500).
        affaire = attrs.get('affaire', getattr(self.instance, 'affaire', None))
        numero = attrs.get('numero_ssdgps', getattr(self.instance, 'numero_ssdgps', None))
        if affaire is not None and numero is not None:
            qs = Ssdgps.objects.filter(affaire=affaire, numero_ssdgps=numero)
            if self.instance is not None:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError({
                    'numero_ssdgps': "Un SSDGPS portant ce numéro existe déjà pour cette affaire."
                })
        return attrs


class SessionSerializer(serializers.ModelSerializer):
    nbr_total_pieces = serializers.IntegerField(read_only=True)
    created_by_email = AuthorDisplayField(source='created_by')
    updated_by_email = AuthorDisplayField(source='updated_by')
    deleted_by_email = AuthorDisplayField(source='deleted_by')

    class Meta:
        model = Session
        fields = [
            'id', 'ssdgps', 'numero_session', 'date_session', 'nbr_total_pieces',
            'created_at', 'updated_at', 'is_deleted', 'deleted_at',
            'created_by_email', 'updated_by_email', 'deleted_by_email',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'is_deleted', 'deleted_at']
