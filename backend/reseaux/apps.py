from django.apps import AppConfig


class ReseauxConfig(AppConfig):
    """Conception de réseaux de triangulation GPS (module indépendant, sans modèle)."""
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'reseaux'
    verbose_name = 'Réseaux de triangulation GPS'
