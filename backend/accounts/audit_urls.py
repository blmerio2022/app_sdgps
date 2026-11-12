from django.urls import path

from .audit_views import AuditActionsView, AuditEventListView

# Journal d'audit — LECTURE SEULE (le modèle interdit toute écriture via l'API).
urlpatterns = [
    path('', AuditEventListView.as_view(), name='audit-events'),
    path('actions/', AuditActionsView.as_view(), name='audit-event-actions'),
]
