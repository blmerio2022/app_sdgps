"""Routes des pièces — montées sous /api/v1/."""
from rest_framework.routers import DefaultRouter

from .views import PieceViewSet, RapportGenerationViewSet

router = DefaultRouter()
router.register('pieces', PieceViewSet, basename='piece')
# Suivi des générations de rapport menées en tâche de fond (lecture seule).
router.register('rapports', RapportGenerationViewSet, basename='rapport')

urlpatterns = router.urls
