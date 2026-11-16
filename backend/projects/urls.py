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


urlpatterns = [path('recherche/', recherche_globale, name='recherche-globale')] + router.urls
