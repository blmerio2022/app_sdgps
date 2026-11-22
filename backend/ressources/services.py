"""
Règles des ressources TBC : quelle ressource un utilisateur télécharge, qui peut en déposer.

Résolution (`ressource_effective`) pour chaque type : la ressource de l'organisation
PRINCIPALE de l'utilisateur, à défaut celle d'une autre de ses organisations actives, à
défaut celle de l'APPLICATION. Retirer la ressource d'une organisation fait donc revenir
ses membres sur celle de l'application.

Droits de dépôt (`peut_gerer`) :
- ressource de l'application : Super Admin ou Admin Système (`is_application_admin`) ;
- ressource d'une organisation : ces mêmes administrateurs, ou un Admin Organisation
  ACTIF de cette organisation.
"""
import os

from accounts.models import Membership, Organization
from accounts.permissions import is_application_admin
from analytics.quotas import organization_of_user

from .models import RessourceTbc

ROLE_ADMIN_ORG = 'ROLE_ORGANISATION_ADMIN'
TAILLE_MAX = 200 * 1024 * 1024          # 200 Mo
# Extensions acceptées par type (étude TBC : modèle .vct, projet .vce / .vcv, ou archive).
EXTENSIONS = {
    RessourceTbc.Type.ETUDE_MODELE: ('.vct', '.vce', '.vcv', '.zip'),
    RessourceTbc.Type.RUBAN: ('.bin', '.xml', '.zip'),
}
CONSEILS = {
    RessourceTbc.Type.ETUDE_MODELE: (
        "Modèle de projet TBC : enregistrez-le dans le dossier des modèles de TBC (ou ouvrez-le "
        "puis « Enregistrer sous » un nouveau projet) pour démarrer chaque étude avec les mêmes "
        "réglages."),
    RessourceTbc.Type.RUBAN: (
        "Personnalisation du ruban : dans TBC, Fichier › Options › Personnaliser le ruban, puis "
        "« Importer » et choisissez ce fichier."),
}


def org_ids_actives(user) -> list:
    return list(Membership.objects.filter(user=user, is_active=True).values_list('organization_id', flat=True))


def orgs_administrees(user):
    """Organisations dont l'utilisateur peut gérer les ressources."""
    if is_application_admin(user):
        return Organization.objects.filter(is_deleted=False).order_by('name')
    ids = Membership.objects.filter(user=user, is_active=True, role=ROLE_ADMIN_ORG).values_list('organization_id', flat=True)
    return Organization.objects.filter(id__in=list(ids), is_deleted=False).order_by('name')


def peut_gerer(user, organization_id) -> bool:
    if is_application_admin(user):
        return True
    if organization_id is None:
        return False
    return Membership.objects.filter(user=user, organization_id=organization_id, is_active=True,
                                     role=ROLE_ADMIN_ORG).exists()


def peut_gerer_quelque_chose(user) -> bool:
    return is_application_admin(user) or Membership.objects.filter(
        user=user, is_active=True, role=ROLE_ADMIN_ORG).exists()


def actives():
    return RessourceTbc.objects.filter(is_deleted=False).select_related('organization', 'created_by', 'updated_by')


def ressource_effective(user, type_ressource):
    qs = actives().filter(type_ressource=type_ressource)
    principale = organization_of_user(user)
    if principale is not None:
        r = qs.filter(organization=principale).first()
        if r:
            return r
    ids = org_ids_actives(user)
    if ids:
        r = qs.filter(organization_id__in=ids).order_by('organization__name').first()
        if r:
            return r
    return qs.filter(organization__isnull=True).first()


def peut_telecharger(user, ressource) -> bool:
    if ressource.organization_id is None:
        return True
    return ressource.organization_id in org_ids_actives(user) or peut_gerer(user, ressource.organization_id)


def extension_valide(type_ressource, nom) -> bool:
    return os.path.splitext(nom or '')[1].lower() in EXTENSIONS[type_ressource]
