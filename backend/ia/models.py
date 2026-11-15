"""
Données de l'intelligence artificielle.

- `ConfigurationIa` : configuration de l'IA saisie DANS l'application (fournisseur,
  modèle, clé chiffrée…) par l'administration de l'application. Chaque champ vide
  retombe sur la variable d'environnement correspondante : une instance sans
  configuration en base se comporte exactement comme avant ;
- `PreferenceIa` : choix personnel d'un utilisateur (modèle de son assistant) ;
- `Conversation` / `MessageConversation` : discussions de l'assistant, propres à leur
  auteur, renommables, épinglables, archivables, supprimables (logiquement) ;
- `ObservationArchive` : historique des observations de pièces remplacées, supprimées
  ou restaurées — rien n'est perdu, tout se restaure.
"""
import uuid

from django.conf import settings
from django.db import models


class ConfigurationIa(models.Model):
    """Configuration UNIQUE (une seule ligne, `pk=1`) — cf. `instance()`."""

    actif = models.BooleanField(
        null=True, blank=True, verbose_name="IA activée",
        help_text="Vide : suit la variable IA_ACTIVE.")
    fournisseur = models.CharField(max_length=40, blank=True, verbose_name="Fournisseur")
    base_url = models.CharField(max_length=300, blank=True, verbose_name="Adresse du service")
    protocole = models.CharField(max_length=20, blank=True, verbose_name="Protocole forcé")
    modele = models.CharField(max_length=200, blank=True, verbose_name="Modèle par défaut")
    modeles_secours = models.TextField(blank=True, verbose_name="Modèles de secours",
                                       help_text="Un identifiant par ligne ou séparés par des virgules.")
    cle_chiffree = models.TextField(blank=True, verbose_name="Clé d'API (chiffrée)")
    cle_indice = models.CharField(max_length=12, blank=True, verbose_name="Fin de la clé",
                                  help_text="4 derniers caractères, pour la reconnaître.")
    delai = models.PositiveIntegerField(null=True, blank=True, verbose_name="Délai (s)")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Modifié le")
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                   null=True, blank=True, related_name='+',
                                   verbose_name="Modifié par")

    class Meta:
        verbose_name = "Configuration de l'IA"

    @classmethod
    def instance(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class PreferenceIa(models.Model):
    utilisateur = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                       related_name='preference_ia', verbose_name="Utilisateur")
    modele_assistant = models.CharField(max_length=200, blank=True,
                                        verbose_name="Modèle de l'assistant",
                                        help_text="Vide : modèle par défaut de l'application.")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Préférence d'IA"


class Conversation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    proprietaire = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                     related_name='conversations_ia', verbose_name="Propriétaire")
    titre = models.CharField(max_length=160, verbose_name="Titre")
    epinglee = models.BooleanField(default=False, verbose_name="Épinglée")
    archivee = models.BooleanField(default=False, db_index=True, verbose_name="Archivée")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Créée le")
    updated_at = models.DateTimeField(auto_now=True, db_index=True, verbose_name="Modifiée le")
    is_deleted = models.BooleanField(default=False, verbose_name="Supprimée")
    deleted_at = models.DateTimeField(null=True, blank=True, verbose_name="Supprimée le")

    class Meta:
        ordering = ['-epinglee', '-updated_at']
        verbose_name = "Discussion avec l'assistant"
        verbose_name_plural = "Discussions avec l'assistant"

    def __str__(self):
        return self.titre


class MessageConversation(models.Model):
    ROLES = [('user', 'Utilisateur'), ('assistant', 'Assistant')]

    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE,
                                     related_name='messages', verbose_name="Discussion")
    role = models.CharField(max_length=10, choices=ROLES, verbose_name="Rôle")
    contenu = models.TextField(verbose_name="Contenu")
    actions = models.JSONField(default=list, blank=True, verbose_name="Actions proposées")
    outils = models.JSONField(default=list, blank=True, verbose_name="Outils utilisés")
    modele = models.CharField(max_length=200, blank=True, verbose_name="Modèle")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Envoyé le")

    class Meta:
        ordering = ['created_at', 'id']
        verbose_name = "Message de discussion"


class ObservationArchive(models.Model):
    MOTIFS = [
        ('remplacee', 'Remplacée'),
        ('supprimee', 'Supprimée'),
        ('restauree', 'Remplacée par une restauration'),
    ]

    piece = models.ForeignKey('pieces.Piece', on_delete=models.CASCADE,
                              related_name='observations_archivees', verbose_name="Pièce")
    texte = models.TextField(verbose_name="Observation")
    motif = models.CharField(max_length=12, choices=MOTIFS, verbose_name="Motif")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Archivée le")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                   null=True, blank=True, related_name='+',
                                   verbose_name="Archivée par")

    class Meta:
        ordering = ['-created_at', '-id']
        verbose_name = "Observation archivée"
        verbose_name_plural = "Observations archivées"
