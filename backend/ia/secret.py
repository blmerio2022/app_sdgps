"""
Chiffrement de la clé d'API saisie dans l'application.

La clé n'est jamais stockée en clair ni renvoyée par l'API : elle est chiffrée
(Fernet — AES-128-CBC + HMAC-SHA256) avec une clé dérivée de `SECRET_KEY`.

⚠ Changer `SECRET_KEY` rend les clés enregistrées illisibles : `dechiffrer` renvoie
alors '' et l'écran de configuration invite à ressaisir la clé — rien ne plante.
"""
import base64
import hashlib

from django.conf import settings


def _fernet():
    from cryptography.fernet import Fernet
    derivee = hashlib.sha256(('sdgps-ia:' + settings.SECRET_KEY).encode('utf-8')).digest()
    return Fernet(base64.urlsafe_b64encode(derivee))


def chiffrer(cle: str) -> str:
    return _fernet().encrypt(cle.encode('utf-8')).decode('ascii') if cle else ''


def dechiffrer(jeton: str) -> str:
    if not jeton:
        return ''
    from cryptography.fernet import InvalidToken
    try:
        return _fernet().decrypt(jeton.encode('ascii')).decode('utf-8')
    except (InvalidToken, ValueError):
        return ''


def indice(cle: str) -> str:
    """Fin de clé affichable (« …ab12 ») pour la reconnaître sans la révéler."""
    return cle[-4:] if cle and len(cle) >= 12 else ''
