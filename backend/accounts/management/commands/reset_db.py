"""Réinitialise la base de données : vide TOUTES les données puis re-seed depuis les fichiers
d'initialisation (initial_data.json + business_data.json).

Action DESTRUCTIVE, disponible dans TOUS les environnements (dev, staging, preprod, production),
mais avec une **confirmation graduée** selon la sensibilité de l'environnement :

- development / staging (hors « type production ») : le flag ``--yes`` suffit.
- preprod / production (``settings.IS_PRODUCTION_LIKE``) : ``--yes`` NE SUFFIT PAS ; il faut
  passer ``--confirm-environment <nom EXACT>`` (ex. ``--confirm-environment production``). Taper
  le nom exact rend tout effacement accidentel quasi impossible.

⚠️  Avant de l'utiliser en preprod/production, faites TOUJOURS une sauvegarde/snapshot de la base
(la réinitialisation supprime définitivement toutes les données présentes).

Exemples :
    python manage.py reset_db --yes                              # dev / staging
    python manage.py reset_db --confirm-environment preprod      # preprod
    python manage.py reset_db --confirm-environment production   # production
"""
from django.apps import apps as django_apps
from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db.models.signals import post_migrate


class Command(BaseCommand):
    help = (
        "Vide la base puis re-seed depuis initial_data.json/business_data.json. "
        "DESTRUCTIF — confirmation graduée : --yes en dev/staging, "
        "--confirm-environment <nom> en preprod/production."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--yes', action='store_true',
            help="Confirme la réinitialisation (development / staging).")
        parser.add_argument(
            '--confirm-environment', dest='confirm_environment', default=None,
            help="Nom EXACT de l'environnement à réinitialiser. REQUIS en preprod/production.")

    def handle(self, *args, **options):
        env = getattr(settings, 'ENVIRONMENT', 'development')
        is_prod_like = getattr(settings, 'IS_PRODUCTION_LIKE', False)

        # --- Confirmation graduée ---
        if is_prod_like:
            if options.get('confirm_environment') != env:
                raise CommandError(
                    f"⛔ Réinitialisation d'un environnement TYPE PRODUCTION (« {env} »).\n"
                    f"   Le flag --yes ne suffit pas ici. Confirmez explicitement avec :\n"
                    f"       --confirm-environment {env}\n"
                    f"   ⚠️  Assurez-vous d'avoir une SAUVEGARDE de la base avant de continuer.")
        else:
            if not options.get('yes'):
                raise CommandError(
                    f"Action destructive sur « {env} ». Relancez avec --yes pour confirmer.")

        self.stdout.write(self.style.WARNING(
            f"⚠️  Réinitialisation de la base « {env} » : suppression de TOUTES les données…"))

        # `flush` réémet le signal post_migrate, qui déclencherait l'auto-seed (accounts.apps).
        # On neutralise ce récepteur le temps du flush pour maîtriser un unique seed explicite
        # ci-dessous (résumé fiable, et robuste même si SEED_INITIAL_DATA est désactivé).
        from accounts.apps import seed_reference_data
        accounts_config = django_apps.get_app_config('accounts')
        post_migrate.disconnect(seed_reference_data, sender=accounts_config)
        try:
            # Vide toutes les tables applicatives (garde le schéma + l'historique de migrations,
            # réinitialise les séquences). interactive=False : aucune invite.
            call_command('flush', verbosity=0, interactive=False)
        finally:
            post_migrate.connect(seed_reference_data, sender=accounts_config)

        # Reconstruit les données de référence exactement depuis les fichiers de seed.
        from accounts.seeding import run_seed
        # Base vidée juste avant : la cascade métier du snapshot est rejouée explicitement.
        summary = run_seed(stdout=self.stdout, avec_metier=True)

        self.stdout.write(self.style.SUCCESS(
            f"✅ Base « {env} » réinitialisée : "
            f"{summary.get('users_created', 0)} utilisateur(s), "
            f"{summary.get('organizations_created', 0)} organisation(s), "
            f"{summary.get('organismes_created', 0)} organisme(s) recréés depuis le seed."))
