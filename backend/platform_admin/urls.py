"""
URLs pour la gestion du profil Super Admin
"""
from django.urls import path
from .views import SuperAdminProfileView, ChangePasswordView
from .views_sauvegardes import SauvegardeDetailView, SauvegardeRestaurerView, SauvegardesView

app_name = 'platform_admin'

urlpatterns = [
    # Profil Super Admin
    path(
        'me/profile/',
        SuperAdminProfileView.as_view(),
        name='superadmin-profile'
    ),
    
    # Changement de mot de passe
    path(
        'me/change-password/',
        ChangePasswordView.as_view(),
        name='change-password'
    ),

    # Sauvegardes (administration de l'application ; suppression / restauration : Super Admin)
    path('sauvegardes/', SauvegardesView.as_view(), name='sauvegardes'),
    path('sauvegardes/<str:nom>/', SauvegardeDetailView.as_view(), name='sauvegarde-detail'),
    path('sauvegardes/<str:nom>/restaurer/', SauvegardeRestaurerView.as_view(), name='sauvegarde-restaurer'),
]
