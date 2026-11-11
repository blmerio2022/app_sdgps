"""Permissions DRF partagées de l'app `accounts`."""
from rest_framework import permissions


def is_application_admin(user):
    """Vrai pour un administrateur de l'APPLICATION : Super Admin ou Admin Système.

    Un Admin Organisation et un Agent Organisation n'en relèvent pas, quel que soit le
    nombre d'organisations qu'ils administrent.
    """
    return bool(
        user
        and user.is_authenticated
        and (user.is_superuser or user.is_platform_admin())
    )


class IsApplicationAdmin(permissions.BasePermission):
    """Réserve l'action à un administrateur de l'application.

    Appliquée à la création de comptes : AUCUN compte — admin système, admin
    d'organisation ou agent — ne peut être créé par quelqu'un d'autre que le Super Admin
    ou l'Admin Système. Il n'existe par ailleurs aucune inscription publique.
    """

    message = (
        "La création de comptes est réservée au Super Admin et à l'Admin Système "
        "de l'application."
    )

    def has_permission(self, request, view):
        return is_application_admin(request.user)
