"""Routes de l'intelligence artificielle — montées sous /api/v1/ia/."""
from django.urls import path

from . import views

urlpatterns = [
    path('statut/', views.StatutView.as_view(), name='ia-statut'),
    path('mapping-colonnes/', views.MappingColonnesView.as_view(), name='ia-mapping'),
    path('observations/', views.ObservationsView.as_view(), name='ia-observations'),
    path('synthese/', views.SyntheseView.as_view(), name='ia-synthese'),
    path('assistant/', views.AssistantView.as_view(), name='ia-assistant'),
]
