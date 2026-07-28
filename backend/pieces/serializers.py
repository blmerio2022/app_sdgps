from rest_framework import serializers

from .models import Piece, PieceImage
from .validators import validate_piece_coherence, points_without_photo
from accounts.fields import AuthorDisplayField


class PieceImageSerializer(serializers.ModelSerializer):
    fichier_url = serializers.SerializerMethodField()
    apercu_url = serializers.SerializerMethodField()

    class Meta:
        model = PieceImage
        fields = [
            'id', 'fichier_url', 'apercu_url', 'ordre', 'point_ref', 'format',
            'taille_octets', 'largeur', 'hauteur', 'mode_couleur', 'compression',
            'date_creation', 'date_modification', 'created_at',
        ]

    def _abs_url(self, field):
        request = self.context.get('request')
        if field and request:
            return request.build_absolute_uri(field.url)
        return field.url if field else None

    def get_fichier_url(self, obj):
        return self._abs_url(obj.fichier)

    def get_apercu_url(self, obj):
        return self._abs_url(obj.apercu)


class PieceSerializer(serializers.ModelSerializer):
    type_piece_display = serializers.CharField(source='get_type_piece_display', read_only=True)
    fichier_url = serializers.SerializerMethodField()
    organization_id = serializers.UUIDField(read_only=True)
    session_numero = serializers.IntegerField(
        source='session.numero_session', read_only=True, allow_null=True, default=None)
    niveau = serializers.SerializerMethodField()
    portee = serializers.SerializerMethodField()
    created_by_email = AuthorDisplayField(source='created_by')
    updated_by_email = AuthorDisplayField(source='updated_by')
    deleted_by_email = AuthorDisplayField(source='deleted_by')
    images = PieceImageSerializer(many=True, read_only=True)
    orientation_effective = serializers.SerializerMethodField()

    class Meta:
        model = Piece
        fields = [
            'id', 'type_piece', 'type_piece_display', 'numero', 'ssdgps', 'session',
            'session_numero', 'niveau', 'portee', 'ordre',
            'fichier', 'fichier_url', 'taille_octets', 'images', 'payload', 'source_saisie', 'statut',
            'orientation', 'orientation_effective', 'versions_rapport',
            'commentaire', 'organization_id', 'created_at', 'updated_at', 'is_deleted',
            'deleted_at', 'created_by_email', 'updated_by_email', 'deleted_by_email',
        ]
        read_only_fields = ['id', 'ordre', 'taille_octets', 'created_at', 'updated_at', 'is_deleted', 'deleted_at']

    def create(self, validated_data):
        instance = super().create(validated_data)
        self._capture_taille(instance, validated_data.get('fichier'))
        return instance

    def update(self, instance, validated_data):
        file_in_request = 'fichier' in validated_data
        instance = super().update(instance, validated_data)
        if file_in_request:
            self._capture_taille(instance, validated_data.get('fichier'))
        return instance

    @staticmethod
    def _capture_taille(instance, uploaded):
        """Fige `taille_octets` depuis le fichier fraîchement uploadé (taille lue localement,
        donc SANS requête réseau — important sur un backend de stockage objet)."""
        if uploaded is not None:
            size = getattr(uploaded, 'size', 0) or 0
        elif not instance.fichier:
            size = 0
        else:
            return  # Pas de nouveau fichier : on ne relit pas la taille (éviterait un HEAD).
        if instance.taille_octets != size:
            instance.taille_octets = size
            instance.save(update_fields=['taille_octets'])

    def get_orientation_effective(self, obj):
        """Orientation réellement appliquée au contenu (résout le mode « auto »)."""
        from .report import resolve_orientation
        if not obj.ssdgps_id:
            return 'portrait'
        return resolve_orientation(obj, obj.ssdgps)

    def get_fichier_url(self, obj):
        request = self.context.get('request')
        if obj.fichier and request:
            return request.build_absolute_uri(obj.fichier.url)
        return obj.fichier.url if obj.fichier else None

    def get_niveau(self, obj):
        """
        Niveau réel de CETTE pièce — un choix libre de l'utilisateur (matérialisé par
        la présence ou non de `session`), indépendant du niveau par défaut suggéré par
        le catalogue pour son `type_piece` (cf. `validators.validate_piece_coherence`).
        """
        return 'session' if obj.session_id else 'ssdgps'

    def get_portee(self, obj):
        return self.get_niveau(obj)

    def validate(self, attrs):
        inst = self.instance
        type_piece = attrs.get('type_piece', getattr(inst, 'type_piece', None))
        ssdgps = attrs.get('ssdgps', getattr(inst, 'ssdgps', None))
        session = attrs.get('session', getattr(inst, 'session', None))
        numero = attrs.get('numero', getattr(inst, 'numero', None))
        source_saisie = attrs.get('source_saisie', getattr(inst, 'source_saisie', None))
        validate_piece_coherence(
            type_piece, ssdgps, session, numero, source_saisie,
            exclude_pk=inst.pk if inst else None,
        )

        # PPA/PPN : le passage du statut à « valide » exige qu'au moins une photo soit
        # rattachée à chaque point. On ne contrôle qu'à la TRANSITION vers `valide`.
        statut = attrs.get('statut', getattr(inst, 'statut', None))
        was_valide = getattr(inst, 'statut', None) == 'valide'
        if inst and statut == 'valide' and not was_valide:
            payload = attrs.get('payload', inst.payload)
            refs = list(inst.images.values_list('point_ref', flat=True))
            missing = points_without_photo(type_piece, payload, refs)
            if missing:
                shown = ', '.join(missing[:10]) + ('…' if len(missing) > 10 else '')
                raise serializers.ValidationError({'statut': (
                    f"Validation impossible : {len(missing)} point(s) sans photo ({shown}). "
                    "Chaque point doit avoir au moins une photo."
                )})
        return attrs
