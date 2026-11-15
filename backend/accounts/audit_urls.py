from django.urls import path

from .audit_views import (AuditActionsView, AuditEventListView, AuditExportView,
                          AuditFiltresView, AuditSyntheseView)

# Journal d'audit — LECTURE SEULE (le modèle interdit toute écriture via l'API).
urlpatterns = [
    path('', AuditEventListView.as_view(), name='audit-events'),
    path('actions/', AuditActionsView.as_view(), name='audit-event-actions'),
    path('filtres/', AuditFiltresView.as_view(), name='audit-events-filtres'),
    path('synthese/', AuditSyntheseView.as_view(), name='audit-events-synthese'),
    path('export/', AuditExportView.as_view(), name='audit-events-export'),
]
