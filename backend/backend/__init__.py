"""Paquet de configuration du projet.

L'application Celery est importée ici pour être initialisée dès le démarrage de Django :
c'est ce qui rend le décorateur `@shared_task` opérationnel dans les apps (cf.
`backend/celery.py`).
"""
from .celery import app as celery_app

__all__ = ('celery_app',)
