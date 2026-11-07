"""
Quotas de stockage par organisation.

Le quota plafonne la volumétrie **attribuée** à une organisation, au sens exact de
`analytics.services.compute_storage_overview` : un fichier appartient à l'organisation
PRINCIPALE de son propriétaire (première adhésion active), et les projets « suivent »
leur créateur. Déplacer un utilisateur d'organisation réattribue donc sa volumétrie —
quota compris — sans migration de données.

Pourquoi un module séparé de `services.py` : la ventilation du tableau de bord parcourt
TOUS les fichiers de l'app pour les répartir par type / projet / rôle / utilisateur. La
vérification de quota, elle, est appelée à CHAQUE téléversement : elle doit répondre en
quelques requêtes agrégées sur une seule organisation. Les deux comptent les mêmes
octets, mais par des chemins différents — `tests_quotas.py` verrouille leur cohérence.

Sémantique du champ `Organization.storage_quota_bytes` :
    NULL  → non arbitré, on retombe sur `settings.DEFAULT_ORGANIZATION_STORAGE_QUOTA_BYTES`
    0     → illimité (décision explicite)
    N > 0 → plafond de N octets
"""
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db.models import Sum

from accounts.models import CustomUser, Membership, Organization
from pieces.models import Piece, PieceImage

from .services import _file_size


class QuotaExceeded(ValidationError):
    """Dépassement de quota. Sous-classe de `ValidationError` pour que les serializers
    DRF la transforment naturellement en 400 avec le message métier."""

    def __init__(self, message, *, quota_bytes=0, used_bytes=0, incoming_bytes=0):
        super().__init__(message)
        self.quota_bytes = quota_bytes
        self.used_bytes = used_bytes
        self.incoming_bytes = incoming_bytes


def human_bytes(value) -> str:
    """Taille lisible (« 1,5 Go »), en unités françaises — utilisée dans les messages
    d'erreur destinés à l'opérateur."""
    value = float(value or 0)
    for unit in ('octets', 'Ko', 'Mo', 'Go', 'To'):
        if value < 1024 or unit == 'To':
            affiche = f'{value:.1f}'.replace('.0', '').replace('.', ',')
            return f'{affiche} {unit}' if unit != 'octets' else f'{int(value)} octets'
        value /= 1024
    return f'{value} To'


def organization_user_ids(organization_id) -> list:
    """Identifiants des utilisateurs dont l'organisation PRINCIPALE est celle-ci.

    « Principale » = première adhésion active par `joined_at`, exactement comme
    `analytics.services._primary_org_map` et `CustomUser.get_primary_organization`.
    Un utilisateur membre de plusieurs organisations n'est donc compté qu'une fois,
    dans la première — sans quoi son volume serait imputé deux fois."""
    primary = {}
    rows = (Membership.objects.filter(is_active=True)
            .order_by('user_id', 'joined_at')
            .values_list('user_id', 'organization_id'))
    for user_id, org_id in rows:
        primary.setdefault(user_id, org_id)
    return [uid for uid, org_id in primary.items() if str(org_id) == str(organization_id)]


def organization_usage_bytes(organization_id) -> int:
    """Octets actuellement consommés par l'organisation.

    Agrégé en SQL pour les deux gros postes (fichiers de pièces et images de pièces,
    dont la taille est figée à l'upload dans `taille_octets`). Les aperçus, avatars et
    logos sont rares : leur taille est lue sur le stockage, mais seulement pour les
    lignes qui en portent un (`exclude(... = '')`), ce qui borne le nombre d'accès."""
    user_ids = organization_user_ids(organization_id)
    if not user_ids:
        # Aucun membre : seul le logo de l'organisation peut peser.
        return _organization_logo_bytes(organization_id)

    projet_filter = {'ssdgps__affaire__propriete__projet__created_by_id__in': user_ids}

    pieces = (Piece.objects.filter(is_deleted=False, **projet_filter)
              .exclude(fichier='')
              .aggregate(total=Sum('taille_octets'))['total'] or 0)

    images = (PieceImage.objects
              .filter(piece__is_deleted=False,
                      **{f'piece__{k}': v for k, v in projet_filter.items()})
              .aggregate(total=Sum('taille_octets'))['total'] or 0)

    # Aperçus PNG (générés pour les formats non affichables en <img>, p. ex. TIFF).
    apercus = sum(
        _file_size(img.apercu)
        for img in PieceImage.objects
        .filter(piece__is_deleted=False,
                **{f'piece__{k}': v for k, v in projet_filter.items()})
        .exclude(apercu='').only('apercu')
    )

    avatars = sum(
        _file_size(u.profile_picture)
        for u in CustomUser.objects.filter(id__in=user_ids)
        .exclude(profile_picture='').only('profile_picture')
    )

    return int(pieces + images + apercus + avatars
               + _organization_logo_bytes(organization_id))


def _organization_logo_bytes(organization_id) -> int:
    org = (Organization.all_objects.filter(pk=organization_id)
           .only('logo').first())
    return _file_size(org.logo) if org and org.logo else 0


def effective_quota_bytes(organization) -> int:
    """Plafond applicable, en octets. `0` = illimité (cf. sémantique du champ)."""
    if organization is None:
        return 0
    if organization.storage_quota_bytes is None:
        return int(getattr(settings, 'DEFAULT_ORGANIZATION_STORAGE_QUOTA_BYTES', 0) or 0)
    return int(organization.storage_quota_bytes)


def quota_state(organization) -> dict:
    """État complet du quota d'une organisation — base de l'API et de l'écran super admin."""
    quota = effective_quota_bytes(organization)
    used = organization_usage_bytes(organization.pk)
    unlimited = quota <= 0
    return {
        'organization_id': str(organization.pk),
        'organization_name': organization.name,
        'quota_bytes': organization.storage_quota_bytes,   # valeur BRUTE (None = non arbitré)
        'effective_quota_bytes': quota,
        'used_bytes': used,
        'remaining_bytes': None if unlimited else max(0, quota - used),
        'usage_percent': None if unlimited else round(used * 100 / quota, 2) if quota else None,
        'is_unlimited': unlimited,
        'is_exceeded': (not unlimited) and used >= quota,
    }


def ensure_within_quota(organization, incoming_bytes) -> None:
    """Lève `QuotaExceeded` si ajouter `incoming_bytes` dépasserait le quota.

    Sans organisation (super admin hors organisation, compte isolé) ou avec un quota
    illimité, la fonction ne fait rien : on ne bloque jamais un envoi faute de pouvoir
    l'imputer à quelqu'un."""
    if organization is None:
        return
    quota = effective_quota_bytes(organization)
    if quota <= 0:
        return

    used = organization_usage_bytes(organization.pk)
    incoming = int(incoming_bytes or 0)
    if used + incoming <= quota:
        return

    raise QuotaExceeded(
        f"Quota de stockage dépassé pour l'organisation « {organization.name} » : "
        f"{human_bytes(used)} utilisés sur {human_bytes(quota)}, et ce fichier ajoute "
        f"{human_bytes(incoming)}. Libérez de l'espace ou demandez au super "
        f"administrateur de relever le quota.",
        quota_bytes=quota, used_bytes=used, incoming_bytes=incoming,
    )


def organization_of_user(user):
    """Organisation PRINCIPALE d'un utilisateur, ou `None`. Point d'entrée unique des
    appelants qui doivent imputer un téléversement à une organisation."""
    if user is None or not getattr(user, 'is_authenticated', False):
        return None
    membership = (Membership.objects.filter(user=user, is_active=True)
                  .select_related('organization')
                  .order_by('joined_at').first())
    return membership.organization if membership else None
