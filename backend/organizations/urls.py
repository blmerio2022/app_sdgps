"""
URLs pour l'application organizations
"""
from django.urls import path
from . import views

urlpatterns = [
    # Liste et création d'organisations
    path('', views.OrganizationListView.as_view(), name='organization-list'),
    
    # Suppression en groupe d'organisations (logique)
    path('bulk-delete/', views.OrganizationBulkDeleteView.as_view(), name='organization-bulk-delete'),

    # Corbeille : restauration et suppression définitive (en masse)
    path('bulk-restore/', views.OrganizationBulkRestoreView.as_view(), name='organization-bulk-restore'),
    path('permanent-delete/', views.OrganizationBulkPermanentDeleteView.as_view(), name='organization-bulk-permanent-delete'),

    # Métadonnées des champs (descriptions, types, etc.)
    path('metadata/', views.OrganizationMetadataView.as_view(), name='organization-metadata'),

    # Quotas de stockage (super admin uniquement) — liste puis unitaire. La route
    # littérale précède la route à UUID : sinon « storage-quotas » ne matcherait rien.
    path('storage-quotas/', views.OrganizationStorageQuotaListView.as_view(),
         name='organization-storage-quota-list'),
    path('<uuid:pk>/storage-quota/', views.OrganizationStorageQuotaView.as_view(),
         name='organization-storage-quota'),

    # Corbeille : restauration et suppression définitive (unitaire)
    path('<uuid:pk>/restore/', views.OrganizationRestoreView.as_view(), name='organization-restore'),
    path('<uuid:pk>/permanent/', views.OrganizationPermanentDeleteView.as_view(), name='organization-permanent-delete'),

    # Détails d'une organisation
    path('<uuid:pk>/', views.OrganizationDetailView.as_view(), name='organization-detail'),
    
    # Mes organisations (utilisateur courant)
    path('my-organizations/', views.UserOrganizationsView.as_view(), name='user-organizations'),
    
    # Membres d'une organisation
    path('<uuid:pk>/members/', views.OrganizationMembersView.as_view(), name='organization-members'),
    
    # Ajouter un membre
    path('<uuid:pk>/add-member/', views.AddMemberView.as_view(), name='add-member'),
]
