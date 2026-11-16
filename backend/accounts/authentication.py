"""
Authentification JWT tenant compte des sessions révoquées.

Un jeton porteur du claim `sid` (toute connexion depuis la gestion des sessions) est
refusé dès que sa session est révoquée — y compris un access token encore valide.
Les jetons émis avant cette fonctionnalité (sans `sid`) restent acceptés jusqu'à leur
expiration naturelle.
"""
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed

from .securite import session_revoquee, toucher_session


class JWTSessionAuthentication(JWTAuthentication):
    def get_validated_token(self, raw_token):
        jeton = super().get_validated_token(raw_token)
        sid = jeton.get('sid')
        if sid:
            if session_revoquee(sid):
                raise AuthenticationFailed('Session révoquée : reconnectez-vous.', code='session_revoked')
            toucher_session(sid)
        return jeton
