from django.urls import path

from . import views

urlpatterns = [
    path('', views.NotificationListView.as_view(), name='notifications'),
    path('compte/', views.NotificationCompteView.as_view(), name='notifications-compte'),
    path('tout-lu/', views.NotificationToutLuView.as_view(), name='notifications-tout-lu'),
    path('vider/', views.NotificationViderView.as_view(), name='notifications-vider'),
    path('preferences/', views.PreferenceView.as_view(), name='notifications-preferences'),
    path('<int:pk>/', views.NotificationDetailView.as_view(), name='notification-detail'),
    path('<int:pk>/lue/', views.NotificationDetailView.as_view(), name='notification-lue'),
]
