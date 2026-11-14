"""Routes du module « Réseau de triangulation GPS » — montées sous /api/v1/reseau-gps/."""
from django.urls import path

from .views import (
    AnalyserEcartsView, DensifierView, GenererView, ReferentielView, SourceLpaDetailView,
    SourceRcDetailView, SourcesLpaView, SourcesRcView,
)

urlpatterns = [
    path('referentiel/', ReferentielView.as_view(), name='reseau-gps-referentiel'),
    path('generer/', GenererView.as_view(), name='reseau-gps-generer'),
    path('sources-lpa/', SourcesLpaView.as_view(), name='reseau-gps-sources'),
    path('sources-lpa/<uuid:ssdgps_id>/', SourceLpaDetailView.as_view(), name='reseau-gps-source'),
    path('analyser-ecarts/', AnalyserEcartsView.as_view(), name='reseau-gps-ecarts'),
    path('sources-rc/', SourcesRcView.as_view(), name='reseau-gps-sources-rc'),
    path('sources-rc/<uuid:ssdgps_id>/', SourceRcDetailView.as_view(), name='reseau-gps-source-rc'),
    path('densifier/', DensifierView.as_view(), name='reseau-gps-densifier'),
]
