"""
Purge des rapports PDF générés au-delà de la durée de rétention.

Un rapport est un artefact **dérivé** : il se régénère à tout moment depuis les pièces.
Il n'est donc pas imputé au quota de l'organisation — mais il ne doit pas s'accumuler
indéfiniment sur le stockage pour autant.

Usage :
    python manage.py purger_rapports              # applique `RAPPORT_RETENTION_JOURS`
    python manage.py purger_rapports --jours 7
    python manage.py purger_rapports --simuler    # n'écrit rien, affiche ce qui partirait
"""
from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from pieces.models import RapportGeneration


class Command(BaseCommand):
    help = "Supprime les rapports générés plus anciens que la durée de rétention."

    def add_arguments(self, parser):
        parser.add_argument(
            '--jours', type=int, default=None,
            help="Durée de rétention en jours (défaut : settings.RAPPORT_RETENTION_JOURS).",
        )
        parser.add_argument(
            '--simuler', action='store_true',
            help="N'écrit rien : affiche seulement ce qui serait purgé.",
        )

    def handle(self, *args, **options):
        jours = options['jours']
        if jours is None:
            jours = getattr(settings, 'RAPPORT_RETENTION_JOURS', 30)
        limite = timezone.now() - timezone.timedelta(days=jours)

        anciens = RapportGeneration.objects.filter(created_at__lt=limite)
        total = anciens.count()
        if not total:
            self.stdout.write(f'Aucun rapport antérieur à {limite:%Y-%m-%d %H:%M}.')
            return

        octets = sum(r.octets for r in anciens)
        if options['simuler']:
            self.stdout.write(
                f'[simulation] {total} rapport(s) seraient purgés ({octets} octets).')
            return

        for rapport in anciens:
            # Le fichier est supprimé explicitement : `queryset.delete()` ne touche pas
            # au stockage et laisserait des orphelins sur le disque (ou sur S3).
            if rapport.fichier:
                rapport.fichier.delete(save=False)
            rapport.delete()

        self.stdout.write(self.style.SUCCESS(
            f'{total} rapport(s) purgé(s) ({octets} octets libérés).'))
