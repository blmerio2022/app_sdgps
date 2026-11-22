from django.urls import path

from . import views

urlpatterns = [
    path('', views.ressources, name='ressources-tbc'),
    path('gestion/', views.gestion, name='ressources-tbc-gestion'),
    path('<uuid:pk>/', views.detail, name='ressource-tbc-detail'),
    path('<uuid:pk>/fichier/', views.fichier, name='ressource-tbc-fichier'),
]
