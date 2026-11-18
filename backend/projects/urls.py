"""Routes du domaine métier — montées sous /api/v1/."""
from rest_framework.routers import DefaultRouter

from .views import (
    ProjetViewSet, ProprieteViewSet, AffaireViewSet, SsdgpsViewSet, SessionViewSet,
    ModeleSsdgpsViewSet,
)

router = DefaultRouter()
router.register('projets', ProjetViewSet, basename='projet')
router.register('proprietes', ProprieteViewSet, basename='propriete')
router.register('affaires', AffaireViewSet, basename='affaire')
router.register('ssdgps', SsdgpsViewSet, basename='ssdgps')
router.register('sessions', SessionViewSet, basename='session')
# Modèles (gabarits) de SDGPS — de l'application et personnels.
router.register('modeles-ssdgps', ModeleSsdgpsViewSet, basename='modele-ssdgps')

from django.urls import path
from rest_framework.decorators import api_view
from rest_framework.response import Response


@api_view(['GET'])
def recherche_globale(request):
    """GET /api/v1/recherche/?q= — recherche globale (Ctrl+K), filtrée par la portée RBAC."""
    from .recherche import rechercher
    return Response(rechercher(request.user, request.query_params.get('q')))


@api_view(['GET'])
def reprendre(request):
    """GET /api/v1/reprise/?limite= — travaux commencés et non terminés de l'appelant, du plus
    récent au plus ancien (tableau de bord « Reprendre mon travail »)."""
    from .reprise import LIMITE_DEFAUT, travaux_a_reprendre
    try:
        limite = min(50, int(request.query_params.get('limite') or LIMITE_DEFAUT))
    except ValueError:
        limite = LIMITE_DEFAUT
    return Response(travaux_a_reprendre(request.user, limite))


urlpatterns = [path('recherche/', recherche_globale, name='recherche-globale'),
               path('reprise/', reprendre, name='reprise')] + router.urls
