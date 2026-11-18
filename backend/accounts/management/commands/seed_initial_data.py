"""Amorce les données de référence de la plateforme (idempotent).

Injecte : 1 super-admin + 2 admins d'application, les organisations prédéfinies et les
organismes (ANCFCC + services). Ces mêmes données sont réinjectées automatiquement à chaque
`migrate` via le signal post_migrate (cf. accounts/apps.py) ; cette commande permet un
lancement manuel explicite.

`--donnees-metier` rejoue AUSSI le snapshot métier (`business_data.json` : projets → images).
Jamais automatique : rejoué à chaque démarrage, il faisait réapparaître les éléments
supprimés et écrasait les modifications. À réserver à une base neuve.

    python manage.py seed_initial_data
    python manage.py seed_initial_data --donnees-metier
"""
from django.core.management.base import BaseCommand

from accounts.seeding import run_seed


class Command(BaseCommand):
    help = "Amorce les données de référence (super-admin, admins app, organisations, organismes)."

    def add_arguments(self, parser):
        parser.add_argument(
            '--donnees-metier', action='store_true',
            help="Rejoue aussi le snapshot métier (projets, affaires, SDGPS, pièces…) — base neuve uniquement.")

    def handle(self, *args, **options):
        summary = run_seed(stdout=self.stdout, avec_metier=options['donnees_metier'])
        self.stdout.write(self.style.SUCCESS(
            f"✅ Seed terminé : {summary['users_created']} utilisateur(s), "
            f"{summary['organizations_created']} organisation(s), "
            f"{summary['organismes_created']} organisme(s) créés."
        ))
