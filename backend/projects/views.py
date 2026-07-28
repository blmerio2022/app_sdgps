"""
Vues API du domaine métier — CRUD avec scoping RBAC par organisation.

Portée : Admin Système / Super Admin → tout ; Admin Org & Agent → entités de leur(s)
organisation(s). Suppression = soft-delete. `created_by` renseigné automatiquement.
"""
from django.db.models import Count, F, Q, QuerySet
from django.utils import timezone
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from .models import Projet, Propriete, Affaire, Ssdgps, Session
from .serializers import (
    ProjetSerializer, ProprieteSerializer, AffaireSerializer,
    SsdgpsSerializer, SessionSerializer,
)


def user_org_ids(user):
    """Retourne l'ensemble des org_id de l'utilisateur, ou None s'il voit tout."""
    if user.is_superuser or user.is_platform_admin():
        return None
    return set(
        user.memberships.filter(is_active=True).values_list('organization_id', flat=True)
    )


def _creator_lookup(org_lookup):
    """Dérive le chemin vers `created_by` du projet à partir du chemin vers son org.

    Ex. 'projet__organization_id' → 'projet__created_by_id'. Les deux partagent le même
    préfixe (chemin jusqu'au projet racine) ; seul le champ terminal diffère.
    """
    return org_lookup[: -len('organization_id')] + 'created_by_id'


def scope_queryset(qs, user, org_lookup):
    """Filtre `qs` selon la visibilité RBAC.

    Un utilisateur voit une entité si elle appartient à l'une de ses organisations
    ACTIVES **ou** si elle est rattachée à un projet qu'il a lui-même créé — de sorte
    que les projets « suivent » leur créateur même après un changement d'organisation.
    Les admins plateforme / superusers ne sont pas filtrés (voient tout).
    """
    ids = user_org_ids(user)
    if ids is None:
        return qs
    return qs.filter(
        Q(**{f'{org_lookup}__in': ids}) | Q(**{_creator_lookup(org_lookup): user.id})
    )


def is_scope_visible(user, org_id, creator_id):
    """Version « objet unique » de `scope_queryset` : l'org de l'entité est-elle
    accessible à l'utilisateur, ou en est-il le créateur du projet ?"""
    ids = user_org_ids(user)
    if ids is None:
        return True
    return org_id in ids or creator_id == user.id


def cumul_pieces_annotations(prefix=''):
    """Annotations du compteur de pièces CUMULÉ sur les sessions, pour un niveau donné.

    Règle métier : le nombre de pièces d'un SSDGPS est le **cumul** des nombres de pièces de
    toutes ses sessions ; les niveaux supérieurs (affaire, propriété, projet) somment ceux de
    leurs SSDGPS. Comme une pièce de portée SSDGPS (`session` nulle, dite « commune ») figure
    dans le rapport de CHAQUE session, elle est comptée une fois **par session** — c'est ce qui
    fait du total une somme exacte des lignes Session affichées. Aucun filtre sur `statut` :
    brouillon, validée et rejetée comptent toutes.

    Décomposition (par SSDGPS) : `cumul = A + C × N` où
      - `A` = pièces rattachées à une session active,
      - `C` = pièces communes (session nulle),
      - `N` = nombre de sessions actives.

    `A` est un `COUNT(DISTINCT)` classique. `C × N` s'obtient en comptant **sans `distinct`**
    les lignes du produit pièces × sessions : la jointure sur `sessions` (créée par la condition
    du filtre) duplique chaque pièce commune une fois par session. Les autres compteurs du même
    queryset restent justes car ils utilisent tous `distinct=True`.

    `prefix` est le chemin de relation menant au SSDGPS depuis le modèle annoté
    (ex. `'affaires__ssdgps_set__'` depuis une propriété ; `''` depuis le SSDGPS lui-même).
    """
    pieces, sessions = f'{prefix}pieces', f'{prefix}sessions'
    # Exclut les niveaux intermédiaires supprimés (propriété / affaire / SSDGPS traversés) :
    # 'proprietes__affaires__ssdgps_set__' → les 3 paliers doivent être actifs.
    segments = [s for s in prefix.split('__') if s]
    intermediaires = {
        '__'.join(segments[:i + 1]) + '__is_deleted': False for i in range(len(segments))
    }
    return {
        '_pieces_de_session': Count(pieces, distinct=True, filter=Q(**{
            **intermediaires,
            f'{pieces}__is_deleted': False,
            # Implique `session` non nulle : une pièce commune n'a aucune ligne jointe ici.
            f'{pieces}__session__is_deleted': False,
        })),
        '_pieces_communes_par_session': Count(pieces, distinct=False, filter=Q(**{
            **intermediaires,
            f'{pieces}__is_deleted': False,
            f'{pieces}__session__isnull': True,
            f'{sessions}__is_deleted': False,
        })),
    }


#: Total exposé par les sérialiseurs, dérivé des deux annotations ci-dessus.
CUMUL_PIECES_TOTAL = F('_pieces_de_session') + F('_pieces_communes_par_session')


class BaseOrgScopedViewSet(viewsets.ModelViewSet):
    """Base : scoping RBAC, soft-delete, created_by, filtre parent optionnel."""
    permission_classes = [permissions.IsAuthenticated]

    # À définir dans les sous-classes :
    org_lookup = None          # ex. 'projet__organization_id'
    parent_query_param = None  # ex. ('projet', 'projet_id')
    child_relations = ()       # accesseurs inverses des enfants immédiats (ex. ('proprietes',))

    def _annotate_counts(self, qs: QuerySet) -> QuerySet:
        """
        Point d'extension : les sous-classes y ajoutent leurs compteurs agrégés
        (`Count(..., filter=..., distinct=True)`). Appelé à la fois par `get_queryset()`
        et `_org_scoped_queryset()` afin que les compteurs soient toujours présents,
        y compris sur l'objet renvoyé par `restore`/`bulk_restore`.
        """
        return qs

    def get_queryset(self):
        show_deleted = self.request.query_params.get('show_deleted', '').lower() in ('true', '1', 'yes')
        qs = self.queryset.filter(is_deleted=True) if show_deleted else self.queryset.filter(is_deleted=False)
        qs = scope_queryset(qs, self.request.user, self.org_lookup)
        if self.parent_query_param:
            param, field = self.parent_query_param
            value = self.request.query_params.get(param)
            if value:
                qs = qs.filter(**{field: value})
        return self._annotate_counts(qs)

    def _org_scoped_queryset(self):
        """Queryset filtré par visibilité RBAC, SANS filtre is_deleted (pour la restauration)."""
        qs = scope_queryset(self.queryset, self.request.user, self.org_lookup)
        return self._annotate_counts(qs)

    def _org_id_of_validated(self, serializer):
        """Org cible d'une création — à surcharger."""
        raise NotImplementedError

    def _project_creator_of_validated(self, serializer):
        """`created_by` du projet racine de la ressource créée.

        Renvoie None pour un `Projet` neuf (pas de projet parent). Surchargé par les
        sous-classes enfants pour autoriser le créateur d'un projet à y ajouter des
        ressources, même après avoir changé d'organisation.
        """
        return None

    def perform_create(self, serializer):
        ids = user_org_ids(self.request.user)
        if ids is not None:
            target_org = self._org_id_of_validated(serializer)
            creator = self._project_creator_of_validated(serializer)
            if target_org not in ids and creator != self.request.user.id:
                raise PermissionDenied(
                    "Vous ne pouvez créer une ressource que dans votre organisation "
                    "ou dans un projet que vous avez créé."
                )
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    def perform_destroy(self, instance):
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.deleted_by = self.request.user
        instance.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by'])

    @action(detail=True, methods=['post'])
    def restore(self, request, pk=None):
        """POST /…/{id}/restore/ — annule la suppression logique (scopé à l'organisation)."""
        instance = self._org_scoped_queryset().filter(pk=pk, is_deleted=True).first()
        if instance is None:
            return Response({'detail': 'Élément non trouvé ou non supprimé.'}, status=status.HTTP_404_NOT_FOUND)
        instance.is_deleted = False
        instance.deleted_at = None
        instance.deleted_by = None
        instance.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by'])
        serializer = self.get_serializer(instance)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=False, methods=['post'], url_path='bulk-restore')
    def bulk_restore(self, request):
        """POST /…/bulk-restore/ — {"ids": [...]} — restaure plusieurs éléments (scopé)."""
        ids = request.data.get('ids', [])
        if not isinstance(ids, list) or not ids:
            return Response({'detail': 'La liste ids est requise.'}, status=status.HTTP_400_BAD_REQUEST)
        qs = self._org_scoped_queryset().filter(pk__in=ids, is_deleted=True)
        restored_count = qs.count()
        qs.update(is_deleted=False, deleted_at=None, deleted_by=None)
        return Response({'restored_count': restored_count}, status=status.HTTP_200_OK)

    def _child_count(self, instance):
        """Nombre de sous-éléments immédiats ENCORE ACTIFS (non supprimés) : bloque la purge
        d'un parent tant qu'il contient des enfants visibles (purge « bottom-up »). Les
        enfants déjà en corbeille (is_deleted=True) sont logiquement supprimés et seront
        cascadés — ils ne bloquent pas un parent qui paraît vide dans l'UI."""
        return sum(getattr(instance, rel).filter(is_deleted=False).count()
                   for rel in self.child_relations)

    @action(detail=True, methods=['delete'], url_path='permanent')
    def permanent_delete(self, request, pk=None):
        """DELETE /…/{id}/permanent/ — suppression DÉFINITIVE (irréversible), scopée.

        Autorisée uniquement sur un élément en corbeille (is_deleted=True) et SANS sous-données.
        """
        instance = self._org_scoped_queryset().filter(pk=pk, is_deleted=True).first()
        if instance is None:
            return Response({'detail': 'Élément non trouvé ou non supprimé.'},
                            status=status.HTTP_404_NOT_FOUND)
        blocking = self._child_count(instance)
        if blocking:
            return Response(
                {'detail': f"Suppression définitive impossible : {blocking} sous-élément(s) "
                           f"rattaché(s). Supprimez-les d'abord."},
                status=status.HTTP_400_BAD_REQUEST)
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['post'], url_path='permanent-delete')
    def bulk_permanent_delete(self, request):
        """POST /…/permanent-delete/ — {"ids": [...]} — purge en masse (scopée, corbeille)."""
        ids = request.data.get('ids', [])
        if not isinstance(ids, list) or not ids:
            return Response({'detail': 'La liste ids est requise.'}, status=status.HTTP_400_BAD_REQUEST)
        qs = self._org_scoped_queryset().filter(pk__in=ids, is_deleted=True)
        deleted_count = 0
        errors = []
        for instance in qs:
            blocking = self._child_count(instance)
            if blocking:
                errors.append({'id': str(instance.pk), 'detail': f"{blocking} sous-élément(s) rattaché(s)."})
                continue
            instance.delete()
            deleted_count += 1
        return Response({'deleted_count': deleted_count, 'errors': errors}, status=status.HTTP_200_OK)


class ProjetViewSet(BaseOrgScopedViewSet):
    queryset = Projet.objects.all()
    serializer_class = ProjetSerializer
    org_lookup = 'organization_id'
    child_relations = ('proprietes',)

    def _org_id_of_validated(self, serializer):
        return serializer.validated_data['organization'].id

    def perform_create(self, serializer):
        # Un projet appartient TOUJOURS à l'organisation courante de son créateur : on force
        # `organization` sur l'organisation active de l'agent, indépendamment de la valeur
        # envoyée. Les administrateurs (super admin / admin système), qui n'ont pas
        # d'organisation, conservent l'organisation fournie dans la requête (contrôle RBAC de
        # base via super().perform_create).
        org = self.request.user.get_primary_organization()
        if org is not None:
            serializer.save(created_by=self.request.user, organization=org)
        else:
            super().perform_create(serializer)

    def _annotate_counts(self, qs):
        # Compteurs agrégés annotés au niveau du queryset (une seule requête, pas de N+1),
        # en excluant les éléments supprimés à chaque niveau traversé.
        return qs.annotate(
            nbr_total_proprietes=Count(
                'proprietes', filter=Q(proprietes__is_deleted=False), distinct=True),
            nbr_total_affaires=Count(
                'proprietes__affaires',
                filter=Q(proprietes__is_deleted=False, proprietes__affaires__is_deleted=False),
                distinct=True),
            nbr_total_ssdgps=Count(
                'proprietes__affaires__ssdgps_set',
                filter=Q(
                    proprietes__is_deleted=False,
                    proprietes__affaires__is_deleted=False,
                    proprietes__affaires__ssdgps_set__is_deleted=False,
                ),
                distinct=True),
            # Seuls les SSDGPS multi-session ont des sessions : les mono-session sont exclus
            # (leur session implicite ne compte pas comme une « vraie » session).
            nbr_total_sessions=Count(
                'proprietes__affaires__ssdgps_set__sessions',
                filter=Q(
                    proprietes__is_deleted=False,
                    proprietes__affaires__is_deleted=False,
                    proprietes__affaires__ssdgps_set__is_deleted=False,
                    proprietes__affaires__ssdgps_set__sessions__is_deleted=False,
                    proprietes__affaires__ssdgps_set__type_ssdgps=Ssdgps.TypeSSDGPS.MULTI,
                ),
                distinct=True),
            **cumul_pieces_annotations('proprietes__affaires__ssdgps_set__'),
        ).annotate(nbr_total_pieces=CUMUL_PIECES_TOTAL)


class ProprieteViewSet(BaseOrgScopedViewSet):
    queryset = Propriete.objects.select_related(
        'projet', 'organisme_niveau1', 'organisme_niveau2')
    serializer_class = ProprieteSerializer
    org_lookup = 'projet__organization_id'
    child_relations = ('affaires',)
    parent_query_param = ('projet', 'projet_id')

    def _org_id_of_validated(self, serializer):
        return serializer.validated_data['projet'].organization_id

    def _project_creator_of_validated(self, serializer):
        return serializer.validated_data['projet'].created_by_id

    def _annotate_counts(self, qs):
        return qs.annotate(
            nbr_total_affaires=Count(
                'affaires', filter=Q(affaires__is_deleted=False), distinct=True),
            nbr_total_ssdgps=Count(
                'affaires__ssdgps_set',
                filter=Q(affaires__is_deleted=False, affaires__ssdgps_set__is_deleted=False),
                distinct=True),
            nbr_total_sessions=Count(
                'affaires__ssdgps_set__sessions',
                filter=Q(
                    affaires__is_deleted=False,
                    affaires__ssdgps_set__is_deleted=False,
                    affaires__ssdgps_set__sessions__is_deleted=False,
                    affaires__ssdgps_set__type_ssdgps=Ssdgps.TypeSSDGPS.MULTI,
                ),
                distinct=True),
            **cumul_pieces_annotations('affaires__ssdgps_set__'),
        ).annotate(nbr_total_pieces=CUMUL_PIECES_TOTAL)


class AffaireViewSet(BaseOrgScopedViewSet):
    queryset = Affaire.objects.select_related('propriete__projet')
    serializer_class = AffaireSerializer
    org_lookup = 'propriete__projet__organization_id'
    child_relations = ('ssdgps_set',)
    parent_query_param = ('propriete', 'propriete_id')

    def _org_id_of_validated(self, serializer):
        return serializer.validated_data['propriete'].projet.organization_id

    def _project_creator_of_validated(self, serializer):
        return serializer.validated_data['propriete'].projet.created_by_id

    def _annotate_counts(self, qs):
        return qs.annotate(
            nbr_total_ssdgps=Count(
                'ssdgps_set', filter=Q(ssdgps_set__is_deleted=False), distinct=True),
            nbr_total_sessions=Count(
                'ssdgps_set__sessions',
                filter=Q(
                    ssdgps_set__is_deleted=False,
                    ssdgps_set__sessions__is_deleted=False,
                    ssdgps_set__type_ssdgps=Ssdgps.TypeSSDGPS.MULTI,
                ),
                distinct=True),
            **cumul_pieces_annotations('ssdgps_set__'),
        ).annotate(nbr_total_pieces=CUMUL_PIECES_TOTAL)


class SsdgpsViewSet(BaseOrgScopedViewSet):
    queryset = Ssdgps.objects.select_related('affaire__propriete__projet')
    serializer_class = SsdgpsSerializer
    org_lookup = 'affaire__propriete__projet__organization_id'
    child_relations = ('sessions', 'pieces')
    parent_query_param = ('affaire', 'affaire_id')

    def get_queryset(self):
        """En plus du filtre `affaire` hérité : filtres à plat optionnels par projet ou
        propriété — permet de lister TOUS les SSDGPS d'un projet sans parcourir la
        hiérarchie (Projet > Propriété > Affaire > SSDGPS)."""
        qs = super().get_queryset()
        projet = self.request.query_params.get('projet')
        if projet:
            qs = qs.filter(affaire__propriete__projet_id=projet)
        propriete = self.request.query_params.get('propriete')
        if propriete:
            qs = qs.filter(affaire__propriete_id=propriete)
        return qs

    def _org_id_of_validated(self, serializer):
        return serializer.validated_data['affaire'].propriete.projet.organization_id

    def _project_creator_of_validated(self, serializer):
        return serializer.validated_data['affaire'].propriete.projet.created_by_id

    def _child_count(self, instance):
        """Sous-données réelles (encore actives) qui bloquent la purge. La session n°1
        auto-créée d'un SSDGPS mono-session est structurelle (invisible dans l'UI) et ne
        doit PAS bloquer : seules ses pièces comptent. Un SSDGPS multi-session est bloqué
        par ses sessions comme par ses pièces (cohérent avec `_annotate_counts`)."""
        n = instance.pieces.filter(is_deleted=False).count()
        if instance.type_ssdgps == Ssdgps.TypeSSDGPS.MULTI:
            n += instance.sessions.filter(is_deleted=False).count()
        return n

    def _annotate_counts(self, qs):
        return qs.annotate(
            # Mono-session : pas de sessions (la session implicite ne compte pas) → 0.
            nbr_total_sessions=Count(
                'sessions',
                filter=Q(sessions__is_deleted=False, type_ssdgps=Ssdgps.TypeSSDGPS.MULTI),
                distinct=True),
            **cumul_pieces_annotations(),
        ).annotate(nbr_total_pieces=CUMUL_PIECES_TOTAL)


class SessionViewSet(BaseOrgScopedViewSet):
    queryset = Session.objects.select_related('ssdgps__affaire__propriete__projet')
    serializer_class = SessionSerializer
    org_lookup = 'ssdgps__affaire__propriete__projet__organization_id'
    child_relations = ('pieces',)
    parent_query_param = ('ssdgps', 'ssdgps_id')

    def _org_id_of_validated(self, serializer):
        return serializer.validated_data['ssdgps'].affaire.propriete.projet.organization_id

    def _project_creator_of_validated(self, serializer):
        return serializer.validated_data['ssdgps'].affaire.propriete.projet.created_by_id

    def _annotate_counts(self, qs):
        """Pièces d'une session = ses pièces PROPRES + les pièces COMMUNES du SSDGPS parent.

        Une pièce de portée SSDGPS (`session` nulle) a un contenu unique partagé par toutes
        les sessions du rapport : elle appartient donc au rapport de CHAQUE session et doit
        être comptée dans chacune. Même règle que la page des pièces côté front
        (`scopeBySession` : `!p.session || p.session === currentSessionId`) — sans quoi la
        colonne « Pièces » d'une session sous-compte son rapport.

        Deux `Count(distinct=True)` séparés puis additionnés : chacun dédoublonne sur l'id de
        la pièce, ce qui neutralise le produit cartésien des deux jointures.
        """
        return qs.annotate(
            _nbr_pieces_propres=Count(
                'pieces', filter=Q(pieces__is_deleted=False), distinct=True),
            _nbr_pieces_communes=Count(
                'ssdgps__pieces',
                filter=Q(ssdgps__pieces__is_deleted=False,
                         ssdgps__pieces__session__isnull=True),
                distinct=True),
        ).annotate(
            nbr_total_pieces=F('_nbr_pieces_propres') + F('_nbr_pieces_communes'),
        )
