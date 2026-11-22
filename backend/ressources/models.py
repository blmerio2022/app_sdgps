"""
Ressources TBC (Trimble Business Center) mises à disposition des opérateurs : l'ÉTUDE
MODÈLE (modèle de projet TBC) et le fichier de PERSONNALISATION DU RUBAN.

Deux niveaux de dépôt :
- `organization` renseignée : fichier déposé par un Admin de cette organisation (ou par
  l'administration de l'application pour elle) — c'est lui que téléchargent ses membres ;
- `organization` vide : fichier de l'APPLICATION, déposé par le Super Admin ou un Admin
  Système — repli de toute organisation qui n'a pas déposé le sien.

Une seule ressource active par (type, niveau) : un nouveau dépôt remplace l'ancien (mis en
corbeille, `is_deleted`). Règles de résolution et de droits : `ressources/services.py`.
"""
import os
import uuid

from django.conf import settings
from django.db import models


def chemin_ressource(instance, nom):
    portee = str(instance.organization_id) if instance.organization_id else 'application'
    return f'ressources_tbc/{portee}/{instance.type_ressource}/{uuid.uuid4().hex}{os.path.splitext(nom)[1].lower()}'


class RessourceTbc(models.Model):
    class Type(models.TextChoices):
        ETUDE_MODELE = 'etude_modele', 'Étude modèle TBC'
        RUBAN = 'ruban', 'Personnalisation du ruban TBC'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    type_ressource = models.CharField(max_length=20, choices=Type.choices, verbose_name="Type de ressource")
    organization = models.ForeignKey(
        'accounts.Organization', on_delete=models.CASCADE, null=True, blank=True,
        related_name='ressources_tbc', verbose_name="Organisation",
        help_text="Vide : ressource de l'application (repli de toutes les organisations).")
    fichier = models.FileField(upload_to=chemin_ressource, verbose_name="Fichier")
    nom_fichier = models.CharField(max_length=255, verbose_name="Nom du fichier")
    taille = models.BigIntegerField(default=0, verbose_name="Taille (octets)")
    description = models.TextField(blank=True, verbose_name="Description / mode d'emploi")

    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Créé le")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Modifié le")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='+', verbose_name="Créé par")
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='+', verbose_name="Modifié par")
    is_deleted = models.BooleanField(default=False, verbose_name="Supprimé")
    deleted_at = models.DateTimeField(null=True, blank=True, verbose_name="Supprimé le")
    deleted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='+', verbose_name="Supprimé par")

    class Meta:
        verbose_name = "Ressource TBC"
        verbose_name_plural = "Ressources TBC"
        ordering = ['type_ressource', '-created_at']
        constraints = [
            models.UniqueConstraint(fields=['type_ressource', 'organization'],
                                    condition=models.Q(is_deleted=False, organization__isnull=False),
                                    name='ressource_tbc_unique_par_organisation'),
            models.UniqueConstraint(fields=['type_ressource'],
                                    condition=models.Q(is_deleted=False, organization__isnull=True),
                                    name='ressource_tbc_unique_application'),
        ]

    def __str__(self):
        return f'{self.get_type_ressource_display()} — {self.organization or "application"}'
