from django.apps import AppConfig


class PiecesConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'pieces'
    verbose_name = "Pièces SSDGPS/Session"

    def ready(self):
        # Historique des versions : archive le contenu remplacé avant chaque changement.
        from . import versions  # noqa: F401
