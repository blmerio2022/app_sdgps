"""Routes du module « Réseau de triangulation GNSS » — montées sous /api/v1/reseau-gps/."""
from django.urls import path

from . import views_etudes

from .views import (
    AnalyserEcartsView, DensifierView, EvaluerView, GenererView, GenererZoneView, ImporterZonesView, ReferentielView, SourceLpaDetailView,
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
    path('evaluer/', EvaluerView.as_view(), name='reseau-gps-evaluer'),
    path('zones/importer/', ImporterZonesView.as_view(), name='reseau-gps-zones'),
    path('generer-zone/', GenererZoneView.as_view(), name='reseau-gps-generer-zone'),
    path('etudes/', views_etudes.etudes, name='reseau-gps-etudes'),
    path('etudes/<uuid:pk>/', views_etudes.etude, name='reseau-gps-etude'),
    path('etudes/<uuid:pk>/dupliquer/', views_etudes.dupliquer, name='reseau-gps-etude-dupliquer'),
]
