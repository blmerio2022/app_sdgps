"""
Notifications : prévenir la bonne personne au bon moment.

Sans elles, un dossier soumis restait invisible à l'Admin Organisation tant qu'il n'ouvrait
pas la liste, et un rédacteur ne découvrait le rejet (et son motif) qu'en rouvrant son
dossier. Une notification est PERSONNELLE (un destinataire) et peut être doublée d'un
e-mail, selon les préférences de son destinataire.

Écrire une notification : TOUJOURS via `notifications/services.py::notifier(...)`, qui
ne lève jamais — une notification en panne ne doit pas casser l'action qui la déclenche.
"""
from django.conf import settings
from django.db import models


class Notification(models.Model):
    TYPE_DOSSIER_SOUMIS = 'DOSSIER_SOUMIS'
    TYPE_DOSSIER_VALIDE = 'DOSSIER_VALIDE'
    TYPE_DOSSIER_REJETE = 'DOSSIER_REJETE'
    TYPE_DOSSIER_CLOS = 'DOSSIER_CLOS'
    TYPE_DOSSIER_ROUVERT = 'DOSSIER_ROUVERT'
    TYPE_RAPPORT_PRET = 'RAPPORT_PRET'
    TYPE_RAPPORT_ECHEC = 'RAPPORT_ECHEC'
    TYPE_SECURITE = 'SECURITE'

    TYPES = [
        (TYPE_DOSSIER_SOUMIS, 'Dossier soumis à validation'),
        (TYPE_DOSSIER_VALIDE, 'Dossier validé'),
        (TYPE_DOSSIER_REJETE, 'Dossier rejeté'),
        (TYPE_DOSSIER_CLOS, 'Dossier clos'),
        (TYPE_DOSSIER_ROUVERT, 'Dossier rouvert'),
        (TYPE_RAPPORT_PRET, 'Rapport prêt'),
        (TYPE_RAPPORT_ECHEC, 'Échec de génération du rapport'),
        (TYPE_SECURITE, 'Alerte de sécurité'),
    ]
    # Types doublés d'un e-mail par défaut (le destinataire peut changer chacun).
    EMAIL_PAR_DEFAUT = {TYPE_DOSSIER_SOUMIS, TYPE_DOSSIER_VALIDE, TYPE_DOSSIER_REJETE,
                        TYPE_DOSSIER_ROUVERT, TYPE_SECURITE}

    destinataire = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                     related_name='notifications', verbose_name='Destinataire')
    type = models.CharField(max_length=32, choices=TYPES, verbose_name='Type')
    titre = models.CharField(max_length=200, verbose_name='Titre')
    message = models.TextField(blank=True, default='', verbose_name='Message')
    lien = models.CharField(max_length=300, blank=True, default='', verbose_name='Lien',
                            help_text="Route RELATIVE de l'application (préfixe /admin ajouté par le front).")
    cible_type = models.CharField(max_length=40, blank=True, default='')
    cible_id = models.CharField(max_length=64, blank=True, default='')
    acteur_nom = models.CharField(max_length=200, blank=True, default='', verbose_name='Auteur')
    lue = models.BooleanField(default=False, verbose_name='Lue')
    lue_le = models.DateTimeField(null=True, blank=True)
    email_envoye = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Créée le')

    class Meta:
        ordering = ['-created_at', '-id']
        verbose_name = 'Notification'
        verbose_name_plural = 'Notifications'
        indexes = [models.Index(fields=['destinataire', 'lue', '-created_at'])]

    def __str__(self):
        return f'{self.get_type_display()} → {self.destinataire_id}'


class PreferenceNotification(models.Model):
    """Préférences d'un utilisateur : e-mails par type (la notification in-app est toujours créée)."""

    utilisateur = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                       related_name='preference_notification')
    emails_actifs = models.BooleanField(default=True, verbose_name='Recevoir des e-mails')
    # {type: bool} — seuls les écarts aux défauts (`Notification.EMAIL_PAR_DEFAUT`).
    emails_par_type = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Préférence de notification'

    def email_pour(self, type_):
        if not self.emails_actifs:
            return False
        if type_ in (self.emails_par_type or {}):
            return bool(self.emails_par_type[type_])
        return type_ in Notification.EMAIL_PAR_DEFAUT
