"""
Application Celery du projet.

Pourquoi une file de tâches : la génération d'un rapport PDF dure des dizaines de
secondes à plusieurs minutes. Tant qu'elle se faisait dans la requête HTTP, elle
immobilisait un worker gunicorn sur trois, finissait par dépasser le délai du serveur
sur un gros SDGPS, et ne pouvait montrer aucune progression réelle — la barre était
simulée.

⚠️ Sans broker configuré (`REDIS_URL` absent), Celery bascule en mode **eager** : les
tâches s'exécutent en ligne, dans le processus appelant (cf. `settings.py`). L'app
reste donc parfaitement fonctionnelle sur un poste de développement et en CI, sans
Redis ni worker — seul le bénéfice de l'asynchrone disparaît.
"""
import os

from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')

app = Celery('sdgps')

# Les réglages Celery vivent dans `settings.py`, préfixés `CELERY_`.
app.config_from_object('django.conf:settings', namespace='CELERY')

# Découverte automatique des `tasks.py` de chaque application installée.
app.autodiscover_tasks()
