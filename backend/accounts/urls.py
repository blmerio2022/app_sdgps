from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from .views import LoginView, ForgotPasswordView, VerifyCodeView, ResetPasswordView, ChangePasswordView, UserProfileView, PieceSortConfigView, PieceSortConfigResetView, PieceFieldsConfigView, PieceFieldsConfigResetView, SsdgpsSortConfigView, SsdgpsSortConfigResetView, OrgSortConfigView, OrgSortConfigResetView, OrganismeSortConfigView, OrganismeSortConfigResetView, TableSortConfigView, TableSortConfigResetView, TableColumnsConfigView, TableColumnsConfigResetView, TolerancesConfigView, TolerancesConfigResetView

# Aucune route d'inscription publique : un compte ne peut être créé que par un
# administrateur de l'application via POST /api/v1/users/ (cf. `IsApplicationAdmin`).
urlpatterns = [
    path('login/', LoginView.as_view(), name='login'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token-refresh'),
    path('forgot-password/', ForgotPasswordView.as_view(), name='forgot-password'),
    path('verify-code/', VerifyCodeView.as_view(), name='verify-code'),
    path('reset-password/', ResetPasswordView.as_view(), name='reset-password'),
    path('change-password/', ChangePasswordView.as_view(), name='change-password'),  # ← Nouveau endpoint
    path('me/', UserProfileView.as_view(), name='user-profile'),  # ← Profil utilisateur
    path('me/piece-sort-config/', PieceSortConfigView.as_view(), name='piece-sort-config'),
    path('me/piece-sort-config/reset/', PieceSortConfigResetView.as_view(), name='piece-sort-config-reset'),
    path('me/piece-fields-config/', PieceFieldsConfigView.as_view(), name='piece-fields-config'),
    path('me/piece-fields-config/reset/', PieceFieldsConfigResetView.as_view(), name='piece-fields-config-reset'),
    path('me/tolerances/', TolerancesConfigView.as_view(), name='tolerances-config'),
    path('me/tolerances/reset/', TolerancesConfigResetView.as_view(), name='tolerances-config-reset'),
    path('me/ssdgps-sort-config/', SsdgpsSortConfigView.as_view(), name='ssdgps-sort-config'),
    path('me/ssdgps-sort-config/reset/', SsdgpsSortConfigResetView.as_view(), name='ssdgps-sort-config-reset'),
    path('me/org-sort-config/', OrgSortConfigView.as_view(), name='org-sort-config'),
    path('me/org-sort-config/reset/', OrgSortConfigResetView.as_view(), name='org-sort-config-reset'),
    path('me/organisme-sort-config/<int:niveau>/', OrganismeSortConfigView.as_view(), name='organisme-sort-config'),
    path('me/organisme-sort-config/<int:niveau>/reset/', OrganismeSortConfigResetView.as_view(), name='organisme-sort-config-reset'),
    path('me/table-sort-config/<str:key>/', TableSortConfigView.as_view(), name='table-sort-config'),
    path('me/table-sort-config/<str:key>/reset/', TableSortConfigResetView.as_view(), name='table-sort-config-reset'),
    path('me/table-columns-config/<str:key>/', TableColumnsConfigView.as_view(), name='table-columns-config'),
    path('me/table-columns-config/<str:key>/reset/', TableColumnsConfigResetView.as_view(), name='table-columns-config-reset'),
]
