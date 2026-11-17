from django.urls import path

from .views import ActiviteView, MonStockageView, StorageOverviewView, StorageEvolutionView

urlpatterns = [
    path('storage/overview/', StorageOverviewView.as_view(), name='storage-overview'),
    path('storage/evolution/', StorageEvolutionView.as_view(), name='storage-evolution'),
    path('activite/', ActiviteView.as_view(), name='activite'),
    path('mon-stockage/', MonStockageView.as_view(), name='mon-stockage'),
]
