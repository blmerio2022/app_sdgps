"""
Verrouillage temporaire d'un compte après des échecs de connexion répétés.

Complément indispensable à la limitation de débit (`throttling.py`) : une limite par
minute laisse passer une attaque lente — quelques essais par minute, des milliers par
jour, sans jamais déclencher le compteur. Le verrouillage, lui, compte les ÉCHECS sur une
fenêtre glissante et bloque le compte quand ils s'accumulent, quelle que soit la cadence.

Choix assumés :
- on verrouille le **compte visé**, pas l'adresse IP : une attaque distribuée change d'IP
  à volonté, pas de cible ;
- le verrou est **temporaire** (pas de désactivation du compte) : un attaquant pourrait
  sinon neutraliser durablement n'importe quel utilisateur en se trompant exprès ;
- une connexion réussie **efface** le compteur ;
- l'état vit dans le cache Django, comme les codes de réinitialisation (cf. `views.py`).
  Il DOIT être partagé entre les workers en environnement serveur (cf. `CACHES`).
"""
import hashlib

from django.core.cache import cache

# Nombre d'échecs consécutifs tolérés avant verrouillage.
MAX_TENTATIVES = 5
# Durée de vie du compteur d'échecs (fenêtre d'observation), en secondes.
FENETRE_ECHECS = 15 * 60
# Durée du verrouillage une fois le seuil atteint, en secondes.
DUREE_VERROU = 15 * 60


def _cle(prefixe, email):
    """Clé de cache pour `email`, haché : pas d'adresse en clair dans un cache partagé."""
    empreinte = hashlib.sha256(email.strip().lower().encode('utf-8')).hexdigest()
    return f'{prefixe}_{empreinte}'


def est_verrouille(email):
    """Vrai si le compte visé est actuellement bloqué."""
    if not email:
        return False
    return bool(cache.get(_cle('login_lock', email)))


def secondes_restantes(email):
    """Secondes restantes avant déverrouillage (0 si le compte n'est pas verrouillé).

    Le backend de cache n'expose pas toujours le TTL ; on stocke donc l'échéance plutôt
    que de l'interroger.
    """
    if not email:
        return 0
    from django.utils import timezone

    echeance = cache.get(_cle('login_lock', email))
    if not echeance:
        return 0
    return max(0, int((echeance - timezone.now()).total_seconds()))


def enregistrer_echec(email):
    """Compte un échec et verrouille le compte si le seuil est atteint.

    Returns:
        (verrouille: bool, tentatives_restantes: int)
    """
    if not email:
        return False, MAX_TENTATIVES

    from django.utils import timezone

    cle = _cle('login_fail', email)
    tentatives = (cache.get(cle) or 0) + 1
    # `set` plutôt qu'`incr` : réarme la fenêtre d'observation à chaque échec et
    # fonctionne sur tous les backends de cache (y compris ceux sans `incr` atomique).
    cache.set(cle, tentatives, timeout=FENETRE_ECHECS)

    if tentatives >= MAX_TENTATIVES:
        echeance = timezone.now() + timezone.timedelta(seconds=DUREE_VERROU)
        cache.set(_cle('login_lock', email), echeance, timeout=DUREE_VERROU)
        cache.delete(cle)
        return True, 0

    return False, MAX_TENTATIVES - tentatives


def effacer_echecs(email):
    """Remet les compteurs à zéro : appelé après une connexion réussie."""
    if not email:
        return
    cache.delete(_cle('login_fail', email))
    cache.delete(_cle('login_lock', email))
