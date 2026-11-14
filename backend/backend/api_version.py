"""`GET /api/version/` : version de l'instance déployée, PUBLIQUE.

Lisible sans être connecté (pied de la page de connexion) et sondée par le frontend pour
annoncer qu'une nouvelle version est en ligne. N'expose rien de sensible : version,
commit court, dates et nom de l'environnement — ni chemin, ni configuration, ni secret.
"""
from django.conf import settings
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .version import version_info


class VersionView(APIView):
    permission_classes = [AllowAny]
    # Aucune authentification : un jeton expiré envoyé par le navigateur provoquerait
    # sinon une 401 sur une vue pourtant publique.
    authentication_classes = []

    def get(self, request):
        reponse = Response({**version_info(), 'environnement': settings.ENVIRONMENT})
        # Toujours la valeur courante : c'est elle qui révèle un nouveau déploiement.
        reponse['Cache-Control'] = 'no-store'
        return reponse
