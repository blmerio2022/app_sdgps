import uuid
from django.db import models
from django.contrib.auth.models import AbstractUser
from django.utils import timezone
from datetime import timedelta
from .managers import OrganizationManager
from .piece_defaults import default_piece_sort_config, default_piece_fields_config, default_ssdgps_sort_config, default_org_sort_config, default_organisme_niveau1_sort_config, default_organisme_niveau2_sort_config


class Organization(models.Model):
    """
    Modèle central pour les organisations (Cabinets privés et Entités publiques).
    
    Supporte deux types :
    - PRIVATE: Cabinets privés (SARL, SA, Auto-entrepreneur, etc.)
    - PUBLIC: Entités publiques (Directions, Divisions, Services, etc.)
    """
    
    # Types d'organisations
    class OrgType(models.TextChoices):
        PRIVATE = 'PRIVATE', 'Cabinet Privé / Entreprise'
        PUBLIC = 'PUBLIC', 'Entité Publique / Administration'
    
    # Rôles disponibles dans l'organisation (hiérarchie)
    ROLE_CHOICES = [
        ('ROLE_ORGANISATION_ADMIN', 'Admin Organisation'),
        ('ROLE_ORGANISATION_AGENT', 'Agent Organisation'),
    ]

    # Identifiants
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Manager personnalisé pour filtrage automatique des données de test
    objects = OrganizationManager()
    
    # Manager sans filtrage (pour accès complet si besoin)
    all_objects = models.Manager()
    code = models.CharField(
        max_length=50, 
        unique=True, 
        db_index=True, 
        verbose_name="Code Organisation",
        help_text="Code unique d'identification de l'organisation (ex: CAB-001, DIR-FIN)"
    )
    name = models.CharField(
        max_length=255, 
        verbose_name="Nom de l'organisation",
        help_text="Nom officiel ou raison sociale de l'organisation"
    )
    type = models.CharField(
        max_length=10, 
        choices=OrgType.choices, 
        default=OrgType.PRIVATE,
        verbose_name="Type d'organisation",
        help_text="Catégorie : Cabinet privé/entreprise ou entité publique/administration"
    )

    # Informations légales / Structurelles
    legal_id = models.CharField(
        max_length=100, 
        blank=True, 
        null=True, 
        verbose_name="Identifiant légal (RC/ICE/Décret)",
        help_text="Numéro de registre de commerce pour les privés ou numéro de décret pour les publics"
    )
    
    # Adresse et Contact
    address = models.TextField(
        blank=True, 
        verbose_name="Adresse physique",
        help_text="Adresse postale complète de l'organisation"
    )
    phone = models.CharField(
        max_length=20, 
        blank=True, 
        verbose_name="Téléphone",
        help_text="Numéro de téléphone principal de contact"
    )
    email = models.EmailField(
        blank=True, 
        verbose_name="Email officiel",
        help_text="Adresse email principale pour les communications officielles"
    )
    website = models.URLField(
        blank=True, 
        verbose_name="Site web",
        help_text="URL du site internet de l'organisation"
    )

    # Logo et Branding
    logo = models.ImageField(
        upload_to='org_logos/%Y/%m/', 
        blank=True, 
        null=True, 
        verbose_name="Logo",
        help_text="Image du logo de l'organisation (formats: PNG, JPG)"
    )

    # Gestion Hiérarchique (Pour les entités publiques : Direction > Division > Service)
    parent = models.ForeignKey(
        'self', 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True, 
        related_name='children',
        verbose_name="Organisation parente",
        help_text="Organisation de niveau supérieur dans la hiérarchie (ex: Ministère pour une Direction)"
    )

    # Métadonnées
    is_active = models.BooleanField(
        default=True, 
        verbose_name="Statut",
        help_text="Indique si l'organisation est active et accessible dans le système"
    )
    is_deleted = models.BooleanField(
        default=False,
        verbose_name="Supprimé",
        help_text="Indique si l'organisation a été supprimée logiquement (soft delete). Ne plus l'afficher dans l'application."
    )
    deleted_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Supprimé le",
        help_text="Date et heure de la suppression logique de l'organisation"
    )
    is_test_data = models.BooleanField(
        default=False,
        verbose_name="Données de test",
        help_text="Indique si cette organisation est une donnée de test (True) ou réelle (False)"
    )
    created_at = models.DateTimeField(
        auto_now_add=True,
        verbose_name="Créé le",
        help_text="Date et heure de création de l'organisation dans le système"
    )
    updated_at = models.DateTimeField(
        auto_now=True,
        verbose_name="Modifié le",
        help_text="Date et heure de la dernière modification des informations"
    )
    created_by = models.ForeignKey(
        'CustomUser', 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True,
        related_name='created_organizations',
        verbose_name="Créé par",
        help_text="Utilisateur ayant créé cette organisation"
    )
    modified_by = models.ForeignKey(
        'CustomUser',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='modified_organizations',
        verbose_name="Modifié par",
        help_text="Utilisateur ayant effectué la dernière modification de cette organisation"
    )
    # NB : le champ historique s'appelle `modified_by` ; l'API expose l'alias `updated_by_email`
    # (nom unifié dans toute l'app) en plus de `modified_by_email` conservé pour compatibilité.
    deleted_by = models.ForeignKey(
        'CustomUser',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='deleted_organizations',
        verbose_name="Supprimé par",
        help_text="Utilisateur ayant supprimé (logiquement) cette organisation"
    )

    class Meta:
        ordering = ['name']
        verbose_name = "Organisation"
        verbose_name_plural = "Organisations"
        indexes = [
            models.Index(fields=['type']),
            models.Index(fields=['code']),
            models.Index(fields=['is_test_data']),
        ]

    def __str__(self):
        return f"{self.name} ({self.get_type_display()})"

    def get_full_path(self):
        """
        Retourne le chemin hiérarchique complet.
        Exemple: Ministère de l'Économie > Direction Générale > Division Financière
        """
        if self.parent:
            return f"{self.parent.get_full_path()} > {self.name}"
        return self.name

    def get_member_count(self):
        """Retourne le nombre de membres actifs dans l'organisation"""
        return self.members.filter(is_active=True).count()


class Membership(models.Model):
    """
    Table de liaison entre les Utilisateurs et les Organisations.
    
    Permet à un utilisateur d'appartenir à plusieurs organisations 
    avec des rôles différents (Multi-tenancy).
    """
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        'CustomUser',
        on_delete=models.CASCADE,
        related_name='memberships',
        verbose_name="Utilisateur"
    )
    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name='members',
        verbose_name="Organisation"
    )
    role = models.CharField(
        max_length=30,
        choices=Organization.ROLE_CHOICES,
        default='ROLE_ORGANISATION_AGENT',
        verbose_name="Rôle"
    )
    joined_at = models.DateTimeField(auto_now_add=True, verbose_name="Date d'adhésion")
    is_active = models.BooleanField(default=True, verbose_name="Actif")

    class Meta:
        unique_together = ('user', 'organization')  # Un utilisateur n'a qu'un seul rôle par org
        verbose_name = "Adhésion"
        verbose_name_plural = "Adhésions"
        ordering = ['-joined_at']

    def __str__(self):
        return f"{self.user.email} - {self.organization.name} ({self.get_role_display()})"

    def is_admin_or_higher(self):
        """Vérifie si l'utilisateur a un rôle admin ou supérieur"""
        return self.role == 'ROLE_ORGANISATION_ADMIN'


class CustomUser(AbstractUser):
    """
    Modèle utilisateur personnalisé avec support RBAC multi-organisations.
    Hérite de AbstractUser pour compatibilité Django Auth.
    
    Champs standards Django utilisés:
    - first_name: Prénom de l'utilisateur
    - last_name: Nom de famille de l'utilisateur
    - email: Adresse email (identifiant unique)
    """
    
    # Champ personnalisé : Nom de société
    nom_societe = models.CharField(max_length=200, blank=True)

    # Champ pour rôle plateforme (Admin App)
    PLATFORM_ROLE_CHOICES = [
        ('ROLE_ADMIN_SYSTEME', 'Admin Système'),
    ]
    platform_role = models.CharField(
        max_length=30,
        choices=PLATFORM_ROLE_CHOICES,
        null=True,
        blank=True,
        verbose_name="Rôle plateforme",
        help_text="Rôle global sur la plateforme (hors organisations). ROLE_ADMIN_PLATEFORME pour les admins d'application."
    )

    # Email comme identifiant principal (au lieu de username)
    email = models.EmailField(unique=True, verbose_name="Adresse email")
    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = []  # Username n'est plus requis
    
    # Champs pour gestion sécurité mot de passe
    must_change_password = models.BooleanField(
        default=False,
        verbose_name="Doit changer le mot de passe",
        help_text="L'utilisateur doit changer son mot de passe à la prochaine connexion"
    )
    password_changed_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Date dernier changement MDP"
    )
    
    # Champ pour suivi dernière connexion
    last_connection_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Dernière connexion",
        help_text="Date et heure de la dernière connexion réussie"
    )
    
    # Soft-delete
    is_deleted = models.BooleanField(
        default=False,
        verbose_name="Supprimé",
        help_text="Indique si l'utilisateur a été supprimé logiquement"
    )
    deleted_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Supprimé le",
        help_text="Date et heure de la suppression logique de l'utilisateur"
    )

    # --- Colonnes d'audit standard (cf. CLAUDE.md « Colonnes d'audit obligatoires ») ---
    # `date_joined` (hérité d'AbstractUser) tient lieu de date de création : il est exposé par
    # l'API sous l'alias `created_at` pour rester homogène avec les autres tableaux.
    updated_at = models.DateTimeField(
        auto_now=True,
        verbose_name="Modifié le",
        help_text="Date et heure de la dernière modification de la fiche utilisateur"
    )
    created_by = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_users',
        verbose_name="Créé par",
        help_text="Utilisateur ayant créé ce compte"
    )
    updated_by = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_users',
        verbose_name="Modifié par",
        help_text="Utilisateur ayant effectué la dernière modification de ce compte"
    )
    deleted_by = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='deleted_users',
        verbose_name="Supprimé par",
        help_text="Utilisateur ayant supprimé (logiquement) ce compte"
    )

    # Photo de profil
    profile_picture = models.ImageField(
        upload_to='profile_pictures/%Y/%m/',
        blank=True,
        null=True,
        verbose_name="Photo de profil",
        help_text="Image de profil de l'utilisateur"
    )

    # Préférences de tri par défaut des tableaux de pièces, PAR TYPE de pièce.
    # Forme : { '<TYPE_PIECE>': {'field': '<nom_champ>', 'dir': 'asc'|'desc'} }.
    # Utilisé comme tri par défaut des tableaux (table interactive) ET pour ordonner les
    # lignes des tableaux dans le rapport PDF généré par cet opérateur.
    # Défaut = configuration de référence (copiée depuis « agent1@sdgps.ma »), appliquée à TOUT
    # compte nouvellement créé (opérateur, admin org, admin app, super admin). Cf. piece_defaults.
    piece_sort_config = models.JSONField(
        default=default_piece_sort_config, blank=True,
        verbose_name="Tri par défaut des tableaux de pièces",
        help_text="Champ de tri par défaut par type de pièce (tableaux de données)."
    )

    # Champs (colonnes) par défaut à AFFICHER, PAR TYPE de pièce et PAR VUE.
    # Deux vues distinctes : 'app' (affichage des données dans l'app) et 'pdf'
    # (rapport PDF généré). Chaque vue comporte une version 'brut' et, pour les
    # types à écarts (RDL/RDN/RDIA), une version 'ecarts'. Forme :
    #   { '<TYPE>': { 'app': {'brut': [<noms ordonnés>], 'ecarts': [...]},
    #                 'pdf': {'brut': [...],            'ecarts': [...]} } }
    # Une liste = colonnes VISIBLES, dans cet ORDRE. Type / vue / version ABSENT =
    # tous les champs du catalogue, dans l'ordre du catalogue.
    # Défaut = configuration de colonnes du super admin (source), appliquée à TOUT compte
    # nouvellement créé ; repli sur {} si aucune source. Cf. piece_defaults.
    piece_fields_config = models.JSONField(
        default=default_piece_fields_config, blank=True,
        verbose_name="Champs par défaut des tableaux de pièces",
        help_text="Colonnes affichées (et leur ordre) par type de pièce et par vue (app / rapport PDF)."
    )

    # Tri MULTI-NIVEAUX par défaut du tableau de la LISTE DES SSDGPS (vue à plat d'un projet).
    # Forme : liste ordonnée `[{'field': '<colonne>', 'dir': 'asc'|'desc'}, ..]` (niveau 1 =
    # prioritaire). Défaut = config du super admin (source), repli sur le tri par numéro.
    ssdgps_sort_config = models.JSONField(
        default=default_ssdgps_sort_config, blank=True,
        verbose_name="Tri multi-niveaux de la liste des SSDGPS",
        help_text="Niveaux de tri (champ + sens) par défaut du tableau de la liste des SSDGPS."
    )

    # Tri MULTI-NIVEAUX par défaut du tableau de la LISTE DES ORGANISATIONS (miroir SSDGPS).
    # Forme : liste ordonnée `[{'field': '<colonne>', 'dir': 'asc'|'desc'}, ..]` (niveau 1 =
    # prioritaire). Défaut = config du super admin (source), repli sur le tri par nom.
    org_sort_config = models.JSONField(
        default=default_org_sort_config, blank=True,
        verbose_name="Tri multi-niveaux de la liste des organisations",
        help_text="Niveaux de tri (champ + sens) par défaut du tableau de la liste des organisations."
    )

    # Tri MULTI-NIVEAUX par défaut des tableaux des LISTES D'ORGANISMES (niveau 1 et niveau 2,
    # miroir des organisations). Deux configs distinctes car les colonnes triables diffèrent.
    organisme_niveau1_sort_config = models.JSONField(
        default=default_organisme_niveau1_sort_config, blank=True,
        verbose_name="Tri multi-niveaux des organismes de premier niveau",
        help_text="Niveaux de tri (champ + sens) par défaut du tableau des organismes de premier niveau."
    )
    organisme_niveau2_sort_config = models.JSONField(
        default=default_organisme_niveau2_sort_config, blank=True,
        verbose_name="Tri multi-niveaux des organismes de deuxième niveau",
        help_text="Niveaux de tri (champ + sens) par défaut du tableau des organismes de deuxième niveau."
    )

    # Tri MULTI-NIVEAUX par défaut, GÉNÉRIQUE, des autres tableaux de l'app (utilisateurs, projets,
    # explorateur de projet, pièces d'un SSDGPS, ...). Dictionnaire
    # `{ '<clé_table>': [{'field','dir'}, ..], .. }` : une entrée par tableau, même forme que les
    # configs dédiées ci-dessus. Vide par défaut ; la config source (super admin) reste récupérable
    # via l'action « Réinitialiser avec la configuration source ». Mutualise le mécanisme pour éviter
    # un champ + une migration par nouvelle liste.
    table_sort_configs = models.JSONField(
        default=dict, blank=True,
        verbose_name="Tri multi-niveaux par tableau (générique)",
        help_text="Niveaux de tri (champ + sens) par défaut, par tableau, pour les listes génériques."
    )

    # Configuration des COLONNES par défaut, GÉNÉRIQUE, des tableaux de l'app (colonnes affichées /
    # masquées + ordre), propre à l'utilisateur. Dictionnaire `{ '<clé_table>': [{'field','visible'}, ..], .. }`
    # : une entrée par tableau, l'ordre de la liste étant l'ordre d'affichage des colonnes. Vide par
    # défaut ; la config source (super admin) reste récupérable via « Réinitialiser avec la
    # configuration source ». Miroir de `table_sort_configs` (un seul champ pour tous les tableaux).
    table_columns_configs = models.JSONField(
        default=dict, blank=True,
        verbose_name="Colonnes par tableau (générique)",
        help_text="Colonnes affichées/masquées et leur ordre, par tableau, propres à l'utilisateur."
    )

    class Meta:
        verbose_name = "Utilisateur"
        verbose_name_plural = "Utilisateurs"
        indexes = [
            models.Index(fields=['email']),
            models.Index(fields=['is_deleted']),
        ]

    def __str__(self):
        return self.email
    
    def get_primary_organization(self):
        """Retourne l'organisation principale de l'utilisateur (première adhésion active)."""
        membership = self.memberships.filter(is_active=True).order_by('joined_at').first()
        return membership.organization if membership else None
    
    def get_role_in_organization(self, organization):
        """Retourne le rôle de l'utilisateur dans une organisation spécifique."""
        try:
            membership = self.memberships.get(organization=organization, is_active=True)
            return membership.role
        except Membership.DoesNotExist:
            return None
    
    def has_role_in_any_org(self, role):
        """Vérifie si l'utilisateur a un rôle spécifique dans au moins une organisation."""
        return self.memberships.filter(role=role, is_active=True).exists()
    
    def is_admin_in_any_org(self):
        """Vérifie si l'utilisateur est administrateur dans au moins une organisation."""
        return self.has_role_in_any_org('ROLE_ORGANISATION_ADMIN')
    
    def requires_password_change(self):
        """
        Vérifie si l'utilisateur doit changer son mot de passe.
        
        Returns:
            bool: True si changement requis, False sinon
        """
        # Si flag must_change_password est activé
        if self.must_change_password:
            return True
        
        # Si jamais changé (première connexion)
        if not self.password_changed_at:
            return False  # On ne force que si explicitement demandé
        
        # Optionnel: Forcer rotation tous les 90 jours
        # from django.utils import timezone
        # from datetime import timedelta
        # return (timezone.now() - self.password_changed_at) > timedelta(days=90)
        
        return False
    
    def mark_password_changed(self):
        """
        Marque le mot de passe comme changé (après succès du changement).
        """
        from django.utils import timezone
        self.must_change_password = False
        self.password_changed_at = timezone.now()
        self.save(update_fields=['must_change_password', 'password_changed_at'])
    
    def update_last_connection(self):
        """
        Met à jour la date et heure de dernière connexion.
        À appeler après chaque connexion réussie.
        """
        from django.utils import timezone
        self.last_connection_at = timezone.now()
        self.save(update_fields=['last_connection_at'])
    
    def is_platform_admin(self):
        return bool(self.platform_role == 'ROLE_ADMIN_SYSTEME')

    def is_super_admin(self):
        return self.is_superuser

    def get_primary_role(self):
        """
        Retourne le rôle principal de l'utilisateur.
        Hiérarchie : Super Admin > Admin App > Admin Org > Agent.
        """
        if self.is_superuser:
            return 'ROLE_SUPER_ADMIN'
        if self.is_platform_admin():
            return 'ROLE_ADMIN_SYSTEME'

        membership = self.memberships.filter(is_active=True).order_by('joined_at').first()
        if membership:
            return membership.role

        return 'ROLE_ORGANISATION_AGENT'

    def get_primary_role_display(self):
        """
        Retourne l'affichage du rôle principal.
        """
        role = self.get_primary_role()
        role_map = {
            'ROLE_SUPER_ADMIN': 'Super Admin',
            'ROLE_ADMIN_SYSTEME': 'Admin Système',
            'ROLE_ORGANISATION_ADMIN': 'Admin Org',
            'ROLE_ORGANISATION_AGENT': 'Agent Org',
        }
        return role_map.get(role, role.replace('_', ' ').title())


class PasswordResetToken(models.Model):
    """
    Modèle pour gérer les tokens de réinitialisation de mot de passe.
    Utilisé pour la première connexion du super admin et les resets de mot de passe.
    """
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name='reset_tokens',
        verbose_name="Utilisateur"
    )
    token = models.CharField(max_length=255, unique=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used = models.BooleanField(default=False)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    
    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Token de Réinitialisation'
        verbose_name_plural = 'Tokens de Réinitialisation'
    
    def __str__(self):
        return f"Token pour {self.user.email} - {'Utilisé' if self.used else 'Actif'}"
    
    def is_valid(self):
        """Vérifie si le token est encore valide (non expiré et non utilisé)."""
        return not self.used and timezone.now() < self.expires_at
    
    def invalidate(self):
        """Invalide le token (marque comme utilisé)."""
        self.used = True
        self.save(update_fields=['used'])
    
    @staticmethod
    def create_token(user, expiration_hours=24):
        """
        Crée un nouveau token pour un utilisateur.
        
        Args:
            user: L'utilisateur pour qui créer le token
            expiration_hours: Durée de validité en heures (défaut: 24h)
        
        Returns:
            PasswordResetToken: Le token créé
        """
        # Invalider tous les anciens tokens actifs de cet utilisateur
        PasswordResetToken.objects.filter(
            user=user,
            used=False,
            expires_at__gt=timezone.now()
        ).update(used=True)
        
        # Générer un token sécurisé
        import secrets
        token_value = secrets.token_urlsafe(32)  # 256 bits de sécurité
        
        # Créer le token
        reset_token = PasswordResetToken.objects.create(
            user=user,
            token=token_value,
            expires_at=timezone.now() + timedelta(hours=expiration_hours)
        )
        
        return reset_token
