"""
Observabilité et infrastructure de cache, isolées des réglages.

Pourquoi un module à part plutôt que du code dans `settings.py` : les réglages ne
s'exécutent qu'une fois, au démarrage, et ne se testent qu'en rechargeant le module —
ce qui écraserait l'état global du processus de test. Les deux décisions ci-dessous
(activer Sentry ? quel backend de cache ?) sont des fonctions pures appelées par
`settings.py`, donc vérifiables directement.
"""


def configurer_sentry(dsn, environnement, release='', traces_sample_rate=0.0) -> bool:
    """Initialise Sentry si un DSN est fourni.

    Sans télémétrie, une erreur en production n'est connue que si un opérateur la
    raconte. Entièrement INERTE tant que `dsn` est vide : ni client, ni appel réseau,
    ni import de `sentry_sdk`.

    Confidentialité : `send_default_pii` reste à False. L'application manipule des
    données foncières nominatives ; ni cookies, ni corps de requête, ni adresse IP ne
    partent chez un tiers. L'identifiant de l'utilisateur suffit à diagnostiquer.

    Returns:
        True si la télémétrie a été activée.
    """
    if not (dsn or '').strip():
        return False

    import sentry_sdk
    from sentry_sdk.integrations.django import DjangoIntegration

    sentry_sdk.init(
        dsn=dsn.strip(),
        integrations=[DjangoIntegration()],
        environment=environnement,
        release=release or None,
        traces_sample_rate=float(traces_sample_rate or 0.0),
        send_default_pii=False,
    )
    return True


def configuration_du_cache(redis_url) -> dict:
    """Backend de cache à utiliser, selon qu'une URL Redis est fournie ou non.

    Le cache porte les compteurs de limitation de débit (`accounts/throttling.py`) et
    les verrous de compte (`accounts/lockout.py`). Avec plusieurs workers gunicorn, un
    cache local au processus multiplie les limites par le nombre de workers et rend le
    verrouillage contournable : en environnement serveur, un Redis partagé est requis.
    """
    if (redis_url or '').strip():
        return {
            'default': {
                'BACKEND': 'django.core.cache.backends.redis.RedisCache',
                'LOCATION': redis_url.strip(),
            }
        }
    return {
        'default': {
            'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
            'LOCATION': 'sdgps-local',
        }
    }
