"""Routes des pièces — montées sous /api/v1/."""
from rest_framework.routers import DefaultRouter

from .views import PieceViewSet, RapportGenerationViewSet
from .views_cachets import CachetSignatureViewSet

router = DefaultRouter()
router.register('pieces', PieceViewSet, basename='piece')
# Suivi des générations de rapport menées en tâche de fond (lecture seule).
router.register('rapports', RapportGenerationViewSet, basename='rapport')

# Cachets + signatures de l'opérateur, apposables sur les pages du rapport (personnels).
router.register('cachets-signatures', CachetSignatureViewSet, basename='cachet-signature')

urlpatterns = router.urls
