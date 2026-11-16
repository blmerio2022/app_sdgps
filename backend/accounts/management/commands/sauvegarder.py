"""
Crée une sauvegarde de la base (et des fichiers avec --avec-medias), puis applique la
rétention. À planifier une fois par jour (cron Railway, tâche planifiée…).

    python manage.py sauvegarder
    python manage.py sauvegarder --avec-medias --retention 30
"""
from django.conf import settings
from django.core.management.base import BaseCommand

from accounts.audit import journaliser
from accounts.models import AuditEvent
from platform_admin import sauvegardes


class Command(BaseCommand):
    help = 'Crée une sauvegarde (base, et fichiers en option) puis purge les plus anciennes.'

    def add_arguments(self, parser):
        parser.add_argument('--avec-medias', action='store_true', help='Inclure les fichiers déposés.')
        parser.add_argument('--retention', type=int, default=None,
                            help='Nombre de sauvegardes conservées (défaut : SAUVEGARDE_RETENTION).')

    def handle(self, *args, **opts):
        res = sauvegardes.creer(avec_medias=opts['avec_medias'])
        journaliser(AuditEvent.ACTION_SAUVEGARDE, fichier=res['nom'], objets=res['objets'],
                    medias=res['medias'], planifiee=True)
        retention = opts['retention'] if opts['retention'] is not None else getattr(settings, 'SAUVEGARDE_RETENTION', 14)
        purgees = sauvegardes.purger(retention)
        self.stdout.write(f"Sauvegarde créée : {res['nom']} ({res['objets']} objets, {res['medias']} fichier(s)).")
        if purgees:
            self.stdout.write(f'{len(purgees)} ancienne(s) sauvegarde(s) supprimée(s).')
