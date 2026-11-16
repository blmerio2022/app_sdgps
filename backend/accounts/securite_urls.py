"""Sécurité des comptes — actions de l'administration de l'application."""
from django.urls import path

from .views_securite import AdminSecuriteUtilisateurView

urlpatterns = [
    path('utilisateurs/<int:pk>/', AdminSecuriteUtilisateurView.as_view(), name='securite-utilisateur'),
    path('utilisateurs/<int:pk>/<str:operation>/', AdminSecuriteUtilisateurView.as_view(),
         name='securite-utilisateur-operation'),
]
