"""Sérialiseurs DRF du domaine métier, avec validations conditionnelles."""
from rest_framework import serializers

from organismes.models import OrganismeNiveau1, OrganismeNiveau2
from .models import Projet, Propriete, Affaire, Ssdgps, Session, ModeleSsdgps
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
    # Contexte parent (vue « toutes les affaires » d'un projet) — sans requête de plus.
    propriete_nom = serializers.CharField(source='propriete.nom_propriete', read_only=True)
    propriete_id_titre = serializers.CharField(source='propriete.id_titre', read_only=True)
    propriete_id_requisition = serializers.CharField(source='propriete.id_requisition', read_only=True)
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
            'date_bornage', 'propriete', 'propriete_nom', 'propriete_id_titre',
            'propriete_id_requisition', 'nbr_total_ssdgps', 'nbr_total_sessions',
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
    # Cycle de vie (cf. projects/workflow.py). Le statut n'est PAS modifiable ici : il
    # ne change que par `POST /ssdgps/<id>/transition/`, qui porte les règles et les
    # contrôles de rôle. Un champ libre reviendrait à ne pas les avoir.
    statut_display = serializers.CharField(source='get_statut_display', read_only=True)
    statut_change_by_email = AuthorDisplayField(source='statut_change_by')
    verrouille = serializers.SerializerMethodField()
    transitions = serializers.SerializerMethodField()
    # Modèle d'origine (assistant de création) — posé une fois, à la création.
    modele_nom = serializers.CharField(source='modele.nom', read_only=True, default='')

    def get_verrouille(self, obj) -> bool:
        return obj.est_verrouille()

    def get_transitions(self, obj):
        """Transitions réellement ouvertes à l'appelant — garde **cosmétique** côté
        front : la décision est reprise à chaque appel de l'endpoint."""
        request = self.context.get('request')
        if request is None:
            return []
        from .workflow import transitions_possibles

        return transitions_possibles(
            obj, request.user, obj.affaire.propriete.projet.organization_id)

    class Meta:
        model = Ssdgps
        fields = [
            'id', 'nature_ssdgps', 'numero_ssdgps', 'type_ssdgps', 'affaire',
            'propriete', 'propriete_nom', 'propriete_id_titre', 'propriete_id_requisition',
            'affaire_numero',
            'statut', 'statut_display', 'statut_change_at', 'statut_change_by_email',
            'motif_statut', 'verrouille', 'transitions',
            'modele', 'modele_nom', 'pieces_prevues',
            'nbr_total_sessions', 'nbr_total_pieces', 'created_at', 'updated_at', 'is_deleted', 'deleted_at',
            'created_by_email', 'updated_by_email', 'deleted_by_email',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'is_deleted', 'deleted_at',
                            'statut', 'statut_change_at', 'motif_statut',
                            'modele', 'pieces_prevues']

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

        # Bascule vers « mono-session » : interdite s'il reste plus d'une session active.
        #
        # Un SSDGPS mono-session n'a qu'UNE session, implicite et structurelle : l'app ne
        # descend jamais au niveau session pour lui (le front va droit aux pièces) et
        # `nbr_total_sessions` l'expose à 0. Basculer un multi-session qui compte
        # plusieurs sessions produit donc des sessions ORPHELINES — invisibles et
        # inatteignables — et, plus grave, fait fusionner les pièces de toutes ces
        # sessions dans un seul rapport PDF, sans avertissement : la génération sans
        # portée de session retient toutes les pièces du SSDGPS.
        #
        # Observé en base : 2 SSDGPS sur 445 dans cet état, faute de ce contrôle.
        type_cible = attrs.get('type_ssdgps', getattr(self.instance, 'type_ssdgps', None))
        if (self.instance is not None
                and type_cible == Ssdgps.TypeSSDGPS.MONO
                and self.instance.type_ssdgps != Ssdgps.TypeSSDGPS.MONO):
            actives = self.instance.sessions.filter(is_deleted=False).count()
            if actives > 1:
                raise serializers.ValidationError({'type_ssdgps': (
                    f"Ce SSDGPS compte {actives} sessions actives : il ne peut pas devenir "
                    "mono-session, qui n'en admet qu'une (implicite). Supprimez d'abord "
                    f"les {actives - 1} sessions excédentaires."
                )})
        return attrs


class SessionSerializer(serializers.ModelSerializer):
    # Contexte parent (vue « toutes les sessions ») : SSDGPS, affaire, propriété.
    ssdgps_numero = serializers.IntegerField(source='ssdgps.numero_ssdgps', read_only=True)
    ssdgps_nature = serializers.CharField(source='ssdgps.nature_ssdgps', read_only=True)
    affaire = serializers.UUIDField(source='ssdgps.affaire_id', read_only=True)
    affaire_numero = serializers.IntegerField(source='ssdgps.affaire.numero_sd_affaire', read_only=True)
    propriete = serializers.UUIDField(source='ssdgps.affaire.propriete_id', read_only=True)
    propriete_nom = serializers.CharField(source='ssdgps.affaire.propriete.nom_propriete', read_only=True)
    propriete_id_titre = serializers.CharField(source='ssdgps.affaire.propriete.id_titre', read_only=True)
    propriete_id_requisition = serializers.CharField(
        source='ssdgps.affaire.propriete.id_requisition', read_only=True)
    nbr_total_pieces = serializers.IntegerField(read_only=True)
    created_by_email = AuthorDisplayField(source='created_by')
    updated_by_email = AuthorDisplayField(source='updated_by')
    deleted_by_email = AuthorDisplayField(source='deleted_by')

    class Meta:
        model = Session
        fields = [
            'id', 'ssdgps', 'numero_session', 'date_session', 'nbr_total_pieces',
            'ssdgps_numero', 'ssdgps_nature', 'affaire', 'affaire_numero', 'propriete',
            'propriete_nom', 'propriete_id_titre', 'propriete_id_requisition',
            'created_at', 'updated_at', 'is_deleted', 'deleted_at',
            'created_by_email', 'updated_by_email', 'deleted_by_email',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'is_deleted', 'deleted_at']

    def validate(self, attrs):
        """Interdit d'AJOUTER une session à un SSDGPS mono-session.

        Un mono-session possède déjà sa session n°1, créée automatiquement par
        `projects.signals.autocreate_mono_session`. Elle est structurelle : le front ne
        descend jamais au niveau session pour ce type, et `nbr_total_sessions` l'expose
        à 0. Toute session ajoutée est donc invisible et inatteignable — c'est ainsi que
        le SSDGPS n°4 s'est retrouvé avec 3 sessions, deux jours après sa création.

        Seule la CRÉATION est bloquée : modifier une session existante reste permis, ne
        serait-ce que pour renseigner la `date_session` de la session implicite (souvent
        nulle à l'auto-création), y compris sur les SSDGPS déjà incohérents.

        Le signal passe par l'ORM et non par ce sérialiseur : il n'est pas affecté.
        """
        if self.instance is None:
            ssdgps = attrs.get('ssdgps')
            if ssdgps is not None and ssdgps.type_ssdgps == Ssdgps.TypeSSDGPS.MONO:
                raise serializers.ValidationError({'ssdgps': (
                    "Ce SSDGPS est mono-session : il ne comporte qu'une seule session, "
                    "implicite, créée automatiquement. Pour gérer plusieurs sessions, "
                    "passez-le en multi-session."
                )})
        return attrs


class ModeleSsdgpsSerializer(serializers.ModelSerializer):
    """Modèle de SDGPS. La portée `systeme` n'est accordée qu'à l'administration de
    l'application ; tout autre créateur obtient un modèle PERSONNEL, à son nom."""
    nature_display = serializers.CharField(source='get_nature_ssdgps_display', read_only=True)
    type_display = serializers.CharField(source='get_type_ssdgps_display', read_only=True)
    portee_display = serializers.CharField(source='get_portee_display', read_only=True)
    proprietaire_email = AuthorDisplayField(source='proprietaire')
    pieces_detail = serializers.SerializerMethodField()
    nb_pieces = serializers.SerializerMethodField()
    modifiable = serializers.SerializerMethodField()
    created_by_email = AuthorDisplayField(source='created_by')
    updated_by_email = AuthorDisplayField(source='updated_by')
    deleted_by_email = AuthorDisplayField(source='deleted_by')

    class Meta:
        model = ModeleSsdgps
        fields = [
            'id', 'nom', 'description', 'nature_ssdgps', 'nature_display',
            'type_ssdgps', 'type_display', 'portee', 'portee_display', 'code_systeme',
            'proprietaire_email', 'pieces', 'pieces_detail', 'nb_pieces', 'modifiable',
            'created_at', 'updated_at', 'is_deleted', 'deleted_at',
            'created_by_email', 'updated_by_email', 'deleted_by_email',
        ]
        read_only_fields = ['id', 'code_systeme', 'created_at', 'updated_at',
                            'is_deleted', 'deleted_at']

    def get_pieces_detail(self, obj):
        from pieces.catalog import PIECE_CATALOG
        from .modeles import libelle_piece
        return [{**p, 'nom': libelle_piece(p.get('type_piece'), p.get('numero')),
                 'source': PIECE_CATALOG.get(p.get('type_piece'), {}).get('source', '')}
                for p in (obj.pieces or [])]

    def get_nb_pieces(self, obj) -> int:
        return len(obj.pieces or [])

    def get_modifiable(self, obj) -> bool:
        request = self.context.get('request')
        return bool(request) and peut_modifier_modele(request.user, obj)

    def validate_portee(self, value):
        from accounts.permissions import is_application_admin
        request = self.context.get('request')
        if value == ModeleSsdgps.Portee.SYSTEME and not (
                request and is_application_admin(request.user)):
            raise serializers.ValidationError(
                "Seule l'administration de l'application peut créer un modèle partagé.")
        return value

    def validate(self, attrs):
        from django.core.exceptions import ValidationError as DjangoValidationError
        from .modeles import normaliser_pieces
        nature = attrs.get('nature_ssdgps', getattr(self.instance, 'nature_ssdgps', None))
        pieces = attrs.get('pieces', getattr(self.instance, 'pieces', None))
        if 'pieces' in attrs or 'nature_ssdgps' in attrs or self.instance is None:
            try:
                attrs['pieces'] = normaliser_pieces(pieces, nature)
            except DjangoValidationError as exc:
                raise serializers.ValidationError({'pieces': exc.messages})
        return attrs


def peut_modifier_modele(user, modele) -> bool:
    """Un modèle système ne se modifie que par l'administration de l'application ; un
    modèle personnel, que par son propriétaire."""
    from accounts.permissions import is_application_admin
    if modele.portee == ModeleSsdgps.Portee.SYSTEME:
        return is_application_admin(user)
    return modele.proprietaire_id == user.id
