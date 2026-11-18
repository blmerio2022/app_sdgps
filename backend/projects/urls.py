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


@api_view(['GET'])
def corbeille(request):
    """GET /api/v1/corbeille/ — tout ce qui est en corbeille (projets → pièces), visible de
    l'appelant (portée RBAC), du plus récemment supprimé au plus ancien."""
    from .suppressions import lister
    elements = lister(request.user)
    return Response({'total': len(elements), 'resultats': elements})


@api_view(['POST'])
def corbeille_restaurer(request):
    """POST /api/v1/corbeille/restaurer/ — {"elements": [{"type", "id"}]}. Journalisé."""
    from .suppressions import restaurer
    return Response(restaurer(request, request.data.get('elements')))


@api_view(['POST'])
def corbeille_purger(request):
    """POST /api/v1/corbeille/purger/ — {"elements": [{"type", "id"}]} : suppression
    DÉFINITIVE (feuilles d'abord ; un parent encore garni est refusé). Journalisé avec
    l'instantané de ce qui est emporté."""
    from .suppressions import purger
    return Response(purger(request, request.data.get('elements')))


@api_view(['GET'])
def carte_dossiers(request):
    """GET /api/v1/carte-dossiers/ — position (WGS84) de chaque SDGPS visible, d'après le
    centre de ses points anciens ; portée RBAC, corbeille exclue."""
    from .carte import dossiers
    return Response(dossiers(request.user))


urlpatterns = [path('recherche/', recherche_globale, name='recherche-globale'),
               path('carte-dossiers/', carte_dossiers, name='carte-dossiers'),
               path('reprise/', reprendre, name='reprise'),
               path('corbeille/', corbeille, name='corbeille'),
               path('corbeille/restaurer/', corbeille_restaurer, name='corbeille-restaurer'),
               path('corbeille/purger/', corbeille_purger, name='corbeille-purger')] + router.urls
