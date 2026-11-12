"""
Limitation de débit des endpoints d'authentification.

Pourquoi : les flux d'authentification sont les seuls points de l'API joignables sans
jeton. Sans limite, un attaquant peut tenter des mots de passe à volonté, énumérer les
codes de réinitialisation à 6 chiffres (1 000 000 de combinaisons, triviales à épuiser à
vitesse réseau) et déclencher autant d'envois SendGrid qu'il le souhaite — aux frais de
l'ANCFCC.

Deux axes complémentaires, car aucun ne suffit seul :
- **par adresse IP** : freine un attaquant unique qui vise plusieurs comptes ;
- **par identifiant visé** (l'email de la requête) : freine une attaque distribuée sur un
  seul compte, que la limite par IP ne verrait pas passer.

Les débits eux-mêmes sont déclarés dans `settings.REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']`
sous les noms de portée (`scope`) ci-dessous.

⚠️ Le compteur vit dans le cache Django. Avec plusieurs processus (gunicorn lance
plusieurs workers), un cache local par processus multiplie de fait les limites par le
nombre de workers : en environnement serveur, le cache DOIT être partagé (cf. `CACHES`
dans `settings.py`).
"""
import hashlib

from rest_framework.throttling import AnonRateThrottle, SimpleRateThrottle


def _email_de_la_requete(request):
    """Email visé par la requête, normalisé ; `None` s'il est absent."""
    data = getattr(request, 'data', None)
    if not isinstance(data, dict):
        return None
    email = data.get('email')
    if not isinstance(email, str):
        return None
    email = email.strip().lower()
    return email or None


class _ThrottleParEmail(SimpleRateThrottle):
    """Base des limites portant sur l'email visé plutôt que sur l'appelant.

    L'email est haché : la clé de cache ne doit pas exposer d'adresse en clair dans un
    cache partagé. Une requête sans email n'est pas limitée ici — la limite par IP et la
    validation de la vue s'en chargent.
    """

    def get_cache_key(self, request, view):
        email = _email_de_la_requete(request)
        if email is None:
            return None
        empreinte = hashlib.sha256(email.encode('utf-8')).hexdigest()
        return self.cache_format % {'scope': self.scope, 'ident': empreinte}


class LoginIPThrottle(AnonRateThrottle):
    """Tentatives de connexion depuis une même adresse IP."""
    scope = 'login_ip'


class LoginEmailThrottle(_ThrottleParEmail):
    """Tentatives de connexion visant un même compte, toutes origines confondues."""
    scope = 'login_email'


class ForgotPasswordIPThrottle(AnonRateThrottle):
    """Demandes de réinitialisation depuis une même IP (chaque envoi coûte un email)."""
    scope = 'forgot_password_ip'


class ForgotPasswordEmailThrottle(_ThrottleParEmail):
    """Demandes de réinitialisation visant un même compte (anti-harcèlement par email)."""
    scope = 'forgot_password_email'


class VerifyCodeIPThrottle(AnonRateThrottle):
    """Essais de code à 6 chiffres depuis une même IP."""
    scope = 'verify_code_ip'


class VerifyCodeEmailThrottle(_ThrottleParEmail):
    """Essais de code visant un même compte : rend l'énumération du code irréalisable."""
    scope = 'verify_code_email'


class ResetPasswordIPThrottle(AnonRateThrottle):
    """Essais de jeton de réinitialisation depuis une même IP."""
    scope = 'reset_password_ip'


class ResetPasswordEmailThrottle(_ThrottleParEmail):
    """Essais de jeton de réinitialisation visant un même compte."""
    scope = 'reset_password_email'
