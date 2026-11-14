"""Routes du module « Réseau de triangulation GPS » — montées sous /api/v1/reseau-gps/."""
from django.urls import path

from .views import GenererView, ReferentielView, SourceLpaDetailView, SourcesLpaView

urlpatterns = [
    path('referentiel/', ReferentielView.as_view(), name='reseau-gps-referentiel'),
    path('generer/', GenererView.as_view(), name='reseau-gps-generer'),
    path('sources-lpa/', SourcesLpaView.as_view(), name='reseau-gps-sources'),
    path('sources-lpa/<uuid:ssdgps_id>/', SourceLpaDetailView.as_view(), name='reseau-gps-source'),
]
