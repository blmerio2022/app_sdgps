"""
Études du module « Réseau de triangulation GNSS ».

Le calcul reste sans état (tout est recalculé à la demande) ; ce que l'opérateur ENREGISTRE,
c'est son espace de travail : points anciens (et leur activation), zones, points nouveaux,
paramètres, rapport de contrôle importé, réseaux personnalisés, fonds de carte, derniers
résultats. Le tout vit dans `contenu` (JSON produit par le navigateur, `version_schema`
pour le faire évoluer) ; quelques compteurs sont dénormalisés pour la liste.

Une étude est STRICTEMENT PERSONNELLE : seul son propriétaire la voit (404 sinon, admins
compris). Rangement : `dossier` (libre, regroupe les études dans la liste), `epinglee`.
Suppression logique (`is_deleted`).
"""
import uuid

from django.conf import settings
from django.db import models


class EtudeReseau(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    proprietaire = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                     related_name='etudes_reseau', verbose_name="Propriétaire")
    nom = models.CharField(max_length=150, verbose_name="Nom")
    description = models.TextField(blank=True, verbose_name="Description")
    dossier = models.CharField(max_length=100, blank=True, verbose_name="Dossier",
                               help_text="Regroupe les études dans la liste (ex. commune, projet).")
    epinglee = models.BooleanField(default=False, verbose_name="Épinglée")
    contenu = models.JSONField(default=dict, blank=True, verbose_name="Contenu de l'étude")
    version_schema = models.PositiveIntegerField(default=1, verbose_name="Version du format")
    nb_points = models.PositiveIntegerField(default=0, verbose_name="Points anciens")
    nb_zones = models.PositiveIntegerField(default=0, verbose_name="Zones")
    nb_nouveaux = models.PositiveIntegerField(default=0, verbose_name="Points nouveaux")
    taille = models.PositiveIntegerField(default=0, verbose_name="Taille (octets)")

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
        verbose_name = "Étude de réseau GNSS"
        verbose_name_plural = "Études de réseau GNSS"
        ordering = ['-epinglee', '-updated_at']
        indexes = [models.Index(fields=['proprietaire', 'is_deleted', '-updated_at'])]

    def __str__(self):
        return self.nom
