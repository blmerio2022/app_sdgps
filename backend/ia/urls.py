"""Routes de l'intelligence artificielle — montées sous /api/v1/ia/."""
from django.urls import path

from . import views, views_config, views_conversations, views_observations

urlpatterns = [
    path('statut/', views.StatutView.as_view(), name='ia-statut'),
    path('mapping-colonnes/', views.MappingColonnesView.as_view(), name='ia-mapping'),
    path('observations/', views.ObservationsView.as_view(), name='ia-observations'),
    path('observations/appliquer/', views_observations.AppliquerView.as_view(),
         name='ia-observations-appliquer'),
    path('observations/supprimer/', views_observations.SupprimerView.as_view(),
         name='ia-observations-supprimer'),
    path('observations/historique/', views_observations.HistoriqueView.as_view(),
         name='ia-observations-historique'),
    path('observations/restaurer/', views_observations.RestaurerView.as_view(),
         name='ia-observations-restaurer'),
    path('synthese/', views.SyntheseView.as_view(), name='ia-synthese'),
    path('assistant/', views.AssistantView.as_view(), name='ia-assistant'),
    # Discussions de l'assistant (personnelles).
    path('conversations/', views_conversations.ConversationsView.as_view(), name='ia-conversations'),
    path('conversations/<str:pk>/', views_conversations.ConversationView.as_view(),
         name='ia-conversation'),
    path('conversations/<str:pk>/messages/', views_conversations.MessagesView.as_view(),
         name='ia-conversation-messages'),
    path('conversations/<str:pk>/regenerer/', views_conversations.RegenererView.as_view(),
         name='ia-conversation-regenerer'),
    path('conversations/<str:pk>/export/', views_conversations.ExportView.as_view(),
         name='ia-conversation-export'),
    # Configuration (lecture : tous ; modification : administration de l'application).
    path('config/', views_config.ConfigView.as_view(), name='ia-config'),
    path('config/reinitialiser/', views_config.ConfigReinitialiserView.as_view(),
         name='ia-config-reinitialiser'),
    path('config/tester/', views_config.ConfigTesterView.as_view(), name='ia-config-tester'),
    path('modeles/', views_config.ModelesView.as_view(), name='ia-modeles'),
    path('preferences/', views_config.PreferencesView.as_view(), name='ia-preferences'),
]
