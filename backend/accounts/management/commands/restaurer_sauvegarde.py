"""
Restaure une sauvegarde — REMPLACE TOUTE LA BASE. Une sauvegarde de sécurité de l'état
courant est créée d'abord.

    python manage.py restaurer_sauvegarde sdgps-production-20261116-020000.zip --confirm-environment production
"""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from accounts.audit import journaliser
from accounts.models import AuditEvent
from platform_admin import sauvegardes


class Command(BaseCommand):
    help = "DESTRUCTIF — remplace la base par une sauvegarde (confirmation : nom exact de l'environnement)."

    def add_arguments(self, parser):
        parser.add_argument('nom', help='Nom du fichier de sauvegarde.')
        parser.add_argument('--confirm-environment', dest='confirmation', required=True,
                            help="Nom EXACT de l'environnement courant.")

    def handle(self, *args, **opts):
        try:
            res = sauvegardes.restaurer(opts['nom'], opts['confirmation'])
        except sauvegardes.SauvegardeErreur as exc:
            raise CommandError(str(exc))
        journaliser(AuditEvent.ACTION_SAUVEGARDE_RESTAUREE, fichier=res['restauree'],
                    sauvegarde_securite=res['sauvegarde_securite'], environnement=settings.ENVIRONMENT)
        self.stdout.write(f"Base restaurée depuis {res['restauree']} "
                          f"(état précédent sauvegardé dans {res['sauvegarde_securite']}).")
