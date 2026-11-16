"""
Désactive les comptes restés sans connexion depuis N jours.

    python manage.py desactiver_comptes_inactifs            # N = settings.COMPTES_INACTIFS_JOURS
    python manage.py desactiver_comptes_inactifs --jours 90 --simuler

Un compte oublié est une porte ouverte : ses identifiants peuvent fuiter sans que personne
ne s'en aperçoive. Règles :
- dernière activité = dernière connexion (`last_connection_at`, posée à chaque connexion
  réussie ; à défaut `last_login`), sinon la date de création ;
- les Super Admins ne sont JAMAIS désactivés (il faut toujours pouvoir administrer) ;
- un compte désactivé voit ses sessions révoquées ; chaque désactivation est journalisée
  (`ACTION_COMPTE_DESACTIVE`) et l'administration est prévenue (une notification).
Réactivation : par l'administration, depuis la gestion des utilisateurs.
À planifier (cron Railway, tâche planifiée…) une fois par jour.
"""
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q
from django.utils import timezone


def comptes_inactifs(jours, maintenant=None):
    maintenant = maintenant or timezone.now()
    limite = maintenant - timedelta(days=jours)
    User = get_user_model()
    return (User.objects.filter(is_active=True, is_superuser=False)
            .filter(Q(last_connection_at__lt=limite)
                    | Q(last_connection_at__isnull=True, last_login__lt=limite)
                    | Q(last_connection_at__isnull=True, last_login__isnull=True, date_joined__lt=limite)))


def desactiver(jours, simuler=False):
    from accounts.audit import journaliser
    from accounts.models import AuditEvent, SessionConnexion
    from accounts.securite import models_q_admins, revoquer

    comptes = list(comptes_inactifs(jours))
    if simuler or not comptes:
        return comptes
    User = get_user_model()
    for u in comptes:
        u.is_active = False
        u.save(update_fields=['is_active'])
        revoquer(SessionConnexion.objects.filter(utilisateur=u))
        journaliser(AuditEvent.ACTION_COMPTE_DESACTIVE, cible=u, cible_libelle=u.email,
                    jours_inactivite=jours,
                    derniere_connexion=(u.last_connection_at or u.last_login).isoformat()
                    if (u.last_connection_at or u.last_login) else None)
    try:
        from notifications.models import Notification
        from notifications.services import notifier
        liste = ', '.join(u.email for u in comptes[:10]) + (' …' if len(comptes) > 10 else '')
        notifier(User.objects.filter(is_active=True).filter(models_q_admins()), Notification.TYPE_SECURITE,
                 f'{len(comptes)} compte(s) désactivé(s) pour inactivité',
                 f'Sans connexion depuis plus de {jours} jours : {liste}.', lien='utilisateurs/liste')
    except Exception:  # noqa: BLE001
        pass
    return comptes


class Command(BaseCommand):
    help = "Désactive les comptes sans connexion depuis N jours (Super Admins exclus)."

    def add_arguments(self, parser):
        parser.add_argument('--jours', type=int, default=None,
                            help='Seuil d\'inactivité (défaut : COMPTES_INACTIFS_JOURS).')
        parser.add_argument('--simuler', action='store_true', help='Liste sans rien modifier.')

    def handle(self, *args, **opts):
        jours = opts['jours'] if opts['jours'] is not None else getattr(settings, 'COMPTES_INACTIFS_JOURS', 0)
        if not jours:
            self.stdout.write('Désactivation des comptes inactifs non configurée (COMPTES_INACTIFS_JOURS = 0).')
            return
        if jours < 7:
            raise CommandError('Seuil trop court : au moins 7 jours.')
        comptes = desactiver(jours, simuler=opts['simuler'])
        verbe = 'seraient désactivés' if opts['simuler'] else 'désactivé(s)'
        self.stdout.write(f'{len(comptes)} compte(s) {verbe} (inactifs depuis plus de {jours} jours).')
        for u in comptes:
            self.stdout.write(f'  - {u.email} (dernière connexion : {u.last_connection_at or u.last_login or "jamais"})')
