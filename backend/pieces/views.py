"""
Vues API des pièces (Phase 6.5) — CRUD + import CSV/Excel en deux phases + ordre.

`Piece.ssdgps` est toujours renseigné (c'est la portée du rapport et de l'`ordre`) ;
le scoping RBAC ne passe donc que par ce chemin unique, contrairement au design
précédent (dual ssdgps/session) — mais `PieceViewSet` n'hérite toujours pas de
`projects.views.BaseOrgScopedViewSet` car les actions `reorder`/`catalog`/`import`
et l'auto-incrémentation d'`ordre` sont spécifiques aux pièces.
"""
import json
import logging

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Max, Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import viewsets, permissions, status, parsers
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from analytics.quotas import ensure_within_quota, organization_of_user
from accounts.audit import journaliser
from accounts.models import AuditEvent
from projects.models import Session, Ssdgps
from projects.views import scope_queryset, is_scope_visible
from .catalog import (serialize_catalog, get_piece_def, champs_with_meta, valid_field_names,
                      import_visible_names)
from .report import (EXCLUDED_TYPES, PHOTO_TYPES, order_pieces_for_synthesis,
                     render_report_pdf, report_filename,
                     _sorted_only, _sorted_renumbered, sort_versions)
from .imaging import extract_image_metadata, make_png_preview, NON_WEB_FORMATS
from .models import Piece, PieceImage
from .parsing import (parse_uploaded_table, apply_mapping, auto_map_columns,
                      parse_rdl_tbc_html, TBC_HTML_PARSERS)
from .rc import (compute_rapport_controle, compute_ecarts_vs_definitive,
                 compute_ecarts_assembled, assemble_determinations,
                 determinations_from_rdia)
from .serializers import PieceSerializer

logger = logging.getLogger(__name__)


class PieceViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = PieceSerializer
    parser_classes = [parsers.MultiPartParser, parsers.FormParser, parsers.JSONParser]
    queryset = Piece.objects.select_related(
        'ssdgps__affaire__propriete__projet', 'session').prefetch_related('images')

    def _scope(self, qs):
        # Visibilité RBAC : pièces des organisations actives de l'utilisateur OU rattachées
        # à un projet qu'il a créé (les projets « suivent » leur créateur — cf. projects.views).
        return scope_queryset(
            qs, self.request.user, 'ssdgps__affaire__propriete__projet__organization_id')

    def get_queryset(self):
        show_deleted = self.request.query_params.get('show_deleted', '').lower() in ('true', '1', 'yes')
        qs = self._scope(self.queryset.filter(is_deleted=show_deleted))
        ssdgps_id = self.request.query_params.get('ssdgps')
        if ssdgps_id:
            # Ensemble unifié : renvoie toutes les pièces du SSDGPS, qu'elles soient
            # de niveau SSDGPS, communes, ou spécifiques à l'une de ses sessions —
            # puisque `ssdgps_id` est désormais toujours renseigné sur chaque pièce.
            qs = qs.filter(ssdgps_id=ssdgps_id)
        session_id = self.request.query_params.get('session')
        if session_id:
            qs = qs.filter(session_id=session_id)
        return qs

    def _org_scoped_queryset(self):
        """Queryset filtré par organisation, SANS filtre is_deleted (pour la restauration)."""
        return self._scope(self.queryset)

    def _check_scope(self, ssdgps):
        projet = ssdgps.affaire.propriete.projet
        if not is_scope_visible(self.request.user, projet.organization_id, projet.created_by_id):
            raise PermissionDenied(
                "Vous ne pouvez créer une pièce que dans votre organisation "
                "ou dans un projet que vous avez créé.")

    def perform_create(self, serializer):
        ssdgps = serializer.validated_data.get('ssdgps')
        self._check_scope(ssdgps)
        max_ordre = Piece.objects.filter(ssdgps=ssdgps, is_deleted=False).aggregate(m=Max('ordre'))['m']
        serializer.save(created_by=self.request.user, ordre=(max_ordre + 1) if max_ordre is not None else 0)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    def perform_destroy(self, instance):
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.deleted_by = self.request.user
        instance.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by'])

    @action(detail=True, methods=['post'])
    def restore(self, request, pk=None):
        instance = self._org_scoped_queryset().filter(pk=pk, is_deleted=True).first()
        if instance is None:
            return Response({'detail': 'Pièce non trouvée ou non supprimée.'}, status=status.HTTP_404_NOT_FOUND)
        instance.is_deleted = False
        instance.deleted_at = None
        instance.deleted_by = None
        instance.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by'])
        return Response(self.get_serializer(instance).data)

    @action(detail=False, methods=['post'], url_path='bulk-restore')
    def bulk_restore(self, request):
        ids = request.data.get('ids', [])
        if not isinstance(ids, list) or not ids:
            return Response({'detail': 'La liste ids est requise.'}, status=status.HTTP_400_BAD_REQUEST)
        qs = self._org_scoped_queryset().filter(pk__in=ids, is_deleted=True)
        restored_count = qs.count()
        qs.update(is_deleted=False, deleted_at=None, deleted_by=None)
        return Response({'restored_count': restored_count})

    @action(detail=True, methods=['delete'], url_path='permanent')
    def permanent_delete(self, request, pk=None):
        """DELETE /…/{id}/permanent/ — suppression DÉFINITIVE d'une pièce en corbeille (scopée).

        La pièce est une feuille : ses images sont supprimées en cascade.
        """
        instance = self._org_scoped_queryset().filter(pk=pk, is_deleted=True).first()
        if instance is None:
            return Response({'detail': 'Pièce non trouvée ou non supprimée.'}, status=status.HTTP_404_NOT_FOUND)
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['post'], url_path='permanent-delete')
    def bulk_permanent_delete(self, request):
        """POST /…/permanent-delete/ — {"ids": [...]} — purge en masse (scopée, corbeille)."""
        ids = request.data.get('ids', [])
        if not isinstance(ids, list) or not ids:
            return Response({'detail': 'La liste ids est requise.'}, status=status.HTTP_400_BAD_REQUEST)
        qs = self._org_scoped_queryset().filter(pk__in=ids, is_deleted=True)
        deleted_count = qs.count()
        for instance in qs:
            instance.delete()
        return Response({'deleted_count': deleted_count, 'errors': []})

    @action(detail=False, methods=['get'])
    def catalog(self, request):
        """GET /api/v1/pieces/catalog/ — registre statique des types de pièces."""
        return Response(serialize_catalog())

    @action(detail=False, methods=['get', 'put'], url_path='field-descriptions')
    def field_descriptions(self, request):
        """GET/PUT /api/v1/pieces/field-descriptions/

        Descriptions détaillées + infobulles des champs (colonnes) des types de pièces.
        Contenu COMMUN à tous, éditable UNIQUEMENT par le rôle App Admin
        (ROLE_ADMIN_SYSTEME / super-admin).

        - GET : renvoie le catalogue enrichi (mêmes données que `catalog/`, avec
          `description` / `tooltip` / `custom` par champ) — base de l'écran d'édition.
        - PUT : par type, upsert des descriptions ET réconciliation des champs
          PERSONNALISÉS (colonnes ajoutées par l'App Admin). Corps par type :
          `{ '<TYPE>': {
               'fields': { '<field_name>': {'description', 'tooltip'} },   # descriptions
               'custom': [ {'name','label','type','description','tooltip'} ]  # jeu complet des champs perso
          } }`.
          La liste `custom` REMPLACE les champs personnalisés du type (les absents sont
          supprimés). Un `field_name` de `fields` doit exister (champ statique OU perso).
          Description+infobulle vides ⇒ métadonnée supprimée.
        """
        user = request.user
        if not (user.is_superuser or getattr(user, 'is_platform_admin', lambda: False)()):
            raise PermissionDenied("Réservé à l'administrateur de l'application.")

        if request.method == 'GET':
            return Response(serialize_catalog())

        import re
        from .models import PieceFieldMeta, PieceCustomField
        from .catalog import effective_champs
        NAME_RE = re.compile(r'^[a-z][a-z0-9_]*$')

        data = request.data or {}
        if not isinstance(data, dict):
            return Response({'detail': "Un objet { type: { fields, custom } } est attendu."},
                            status=status.HTTP_400_BAD_REQUEST)

        def _err(msg):
            return Response({'detail': msg}, status=status.HTTP_400_BAD_REQUEST)

        for type_piece, entry in data.items():
            try:
                piece_def = get_piece_def(type_piece)
            except KeyError:
                return _err(f"Type de pièce inconnu : « {type_piece} ».")
            if not isinstance(entry, dict):
                return _err(f"Configuration invalide pour « {type_piece} ».")

            # Ancienne forme tolérée : { field_name: {description, tooltip} }.
            fields = entry.get('fields') if ('fields' in entry or 'custom' in entry) else entry
            custom = entry.get('custom')
            fields = fields or {}

            # Noms réservés = champs STATIQUES (brut + écarts) — un champ perso ne peut pas
            # écraser un champ du catalogue.
            static_names = {c['name'] for c in (piece_def.get('champs') or [])} \
                | {c['name'] for c in (piece_def.get('ecarts_champs') or [])}

            # --- Réconciliation des champs personnalisés (si 'custom' fourni) ---
            if custom is not None:
                if not isinstance(custom, list):
                    return _err(f"« custom » doit être une liste pour « {type_piece} ».")
                seen, keep = set(), []
                for i, cf in enumerate(custom):
                    if not isinstance(cf, dict):
                        return _err(f"Champ personnalisé invalide pour « {type_piece} ».")
                    name = (cf.get('name') or '').strip()
                    label = (cf.get('label') or '').strip()
                    ftype = (cf.get('type') or 'text').strip()
                    if not NAME_RE.match(name):
                        return _err(f"Nom de champ « {name} » invalide (minuscules, chiffres, _ ; "
                                    f"doit commencer par une lettre) pour « {type_piece} ».")
                    if name in static_names:
                        return _err(f"Le nom « {name} » est réservé (champ du catalogue) pour "
                                    f"« {type_piece} ».")
                    if name in seen:
                        return _err(f"Nom de champ personnalisé en double : « {name} » pour "
                                    f"« {type_piece} ».")
                    if not label:
                        return _err(f"Le libellé du champ « {name} » est requis pour « {type_piece} ».")
                    if ftype not in dict(PieceCustomField.FieldType.choices):
                        ftype = 'text'
                    seen.add(name)
                    keep.append({'name': name, 'label': label, 'type': ftype, 'ordre': i})
                # Supprime les champs perso disparus (+ leurs descriptions).
                stale = list(PieceCustomField.objects.filter(type_piece=type_piece)
                             .exclude(name__in=seen).values_list('name', flat=True))
                if stale:
                    PieceCustomField.objects.filter(type_piece=type_piece, name__in=stale).delete()
                    PieceFieldMeta.objects.filter(type_piece=type_piece, field_name__in=stale).delete()
                for cf in keep:
                    PieceCustomField.objects.update_or_create(
                        type_piece=type_piece, name=cf['name'],
                        defaults={'label': cf['label'], 'field_type': cf['type'], 'ordre': cf['ordre']})
                # Descriptions portées directement par les entrées custom.
                for cf in custom:
                    nm = (cf.get('name') or '').strip()
                    if nm in seen and ('description' in cf or 'tooltip' in cf):
                        fields.setdefault(nm, {'description': cf.get('description', ''),
                                               'tooltip': cf.get('tooltip', '')})

            # --- Descriptions (champs statiques + perso désormais persistés) ---
            valid = valid_field_names(type_piece, 'brut') | valid_field_names(type_piece, 'ecarts')
            if not isinstance(fields, dict):
                return _err(f"« fields » doit être un objet pour « {type_piece} ».")
            for field_name, meta in fields.items():
                if field_name not in valid:
                    return _err(f"Champ « {field_name} » invalide pour « {type_piece} ».")
                meta = meta or {}
                description = (meta.get('description') or '').strip()
                tooltip = (meta.get('tooltip') or '').strip()[:255]
                if not description and not tooltip:
                    # Ne pas supprimer une ligne marquée obligatoire (le flag `required` est géré
                    # par l'écran « Champs par défaut ») : on vide seulement description/infobulle.
                    obj = PieceFieldMeta.objects.filter(type_piece=type_piece, field_name=field_name).first()
                    if obj and obj.required:
                        if obj.description or obj.tooltip:
                            obj.description = ''
                            obj.tooltip = ''
                            obj.save(update_fields=['description', 'tooltip'])
                    elif obj:
                        obj.delete()
                else:
                    # `required` n'est PAS dans `defaults` → préservé sur une ligne existante.
                    PieceFieldMeta.objects.update_or_create(
                        type_piece=type_piece, field_name=field_name,
                        defaults={'description': description, 'tooltip': tooltip})
        return Response(serialize_catalog())

    @action(detail=False, methods=['put'], url_path='required-fields')
    def required_fields(self, request):
        """PUT /api/v1/pieces/required-fields/

        Champs OBLIGATOIRES (verrouillés) de la vue « Import des données » par type de pièce.
        Contenu COMMUN à tous, éditable UNIQUEMENT par le rôle App Admin (ROLE_ADMIN_SYSTEME /
        super-admin). Persistés dans PieceFieldMeta.required.

        Corps : `{ '<TYPE>': ['<field_name>', ...] }` — pour chaque type, l'ENSEMBLE EXACT des
        champs bruts obligatoires (les absents repassent non obligatoires). Seuls les champs
        bruts effectifs (statiques + personnalisés) sont acceptés. Renvoie le catalogue à jour.
        """
        user = request.user
        if not (user.is_superuser or getattr(user, 'is_platform_admin', lambda: False)()):
            raise PermissionDenied("Réservé à l'administrateur de l'application.")

        from .models import PieceFieldMeta
        from .catalog import effective_champs
        data = request.data or {}
        if not isinstance(data, dict):
            return Response({'detail': "Un objet { type: [field, ...] } est attendu."},
                            status=status.HTTP_400_BAD_REQUEST)

        for type_piece, names in data.items():
            try:
                get_piece_def(type_piece)
            except KeyError:
                return Response({'detail': f"Type de pièce inconnu : « {type_piece} »."},
                                status=status.HTTP_400_BAD_REQUEST)
            if not isinstance(names, list):
                return Response({'detail': f"Liste de champs attendue pour « {type_piece} »."},
                                status=status.HTTP_400_BAD_REQUEST)
            valid = {c['name'] for c in effective_champs(type_piece)}
            wanted = {n for n in names if isinstance(n, str) and n in valid}
            # Marque obligatoires les champs voulus (upsert).
            for field_name in wanted:
                PieceFieldMeta.objects.update_or_create(
                    type_piece=type_piece, field_name=field_name, defaults={'required': True})
            # Retire l'obligation des autres (et nettoie les lignes devenues vides).
            for obj in PieceFieldMeta.objects.filter(type_piece=type_piece, required=True).exclude(field_name__in=wanted):
                if obj.description or obj.tooltip:
                    obj.required = False
                    obj.save(update_fields=['required'])
                else:
                    obj.delete()
        return Response(serialize_catalog())

    @action(detail=False, methods=['post'])
    def reorder(self, request):
        """
        POST /api/v1/pieces/reorder/  {ssdgps: <uuid>, ordered_ids: [<uuid>, ...]}
        Réordonne, en une transaction, TOUTES les pièces actives d'un SSDGPS (y
        compris celles issues de ses sessions) selon la liste ordered_ids fournie.
        """
        ssdgps_id = request.data.get('ssdgps')
        ordered_ids = request.data.get('ordered_ids')
        if not ssdgps_id or not isinstance(ordered_ids, list) or not ordered_ids:
            return Response({'detail': 'ssdgps et ordered_ids (liste) sont requis.'}, status=400)
        qs = self._scope(self.queryset.filter(ssdgps_id=ssdgps_id, is_deleted=False))
        pieces_by_id = {str(p.id): p for p in qs}
        if set(pieces_by_id) != {str(i) for i in ordered_ids}:
            return Response(
                {'detail': "ordered_ids doit contenir exactement l'ensemble des pièces actives de ce SSDGPS."},
                status=400,
            )
        with transaction.atomic():
            for index, pid in enumerate(ordered_ids):
                piece = pieces_by_id[str(pid)]
                if piece.ordre != index:
                    piece.ordre = index
                    piece.save(update_fields=['ordre'])
        return Response(self.get_serializer(qs.order_by('ordre'), many=True).data)

    @action(detail=True, methods=['post'])
    def move(self, request, pk=None):
        """
        POST /api/v1/pieces/{id}/move/  {position: <entier, 0-based>}
        Déplace une seule pièce à la position indiquée dans le rapport de son SSDGPS,
        en réindexant les autres pièces actives en conséquence (même mécanique que
        `reorder`, mais sans devoir renvoyer l'ensemble complet des ids depuis le client
        — pratique pour un champ de position isolé dans un formulaire d'ajout/édition).
        """
        instance = self._org_scoped_queryset().filter(pk=pk, is_deleted=False).first()
        if instance is None:
            return Response({'detail': 'Pièce non trouvée.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            new_index = int(request.data.get('position'))
        except (TypeError, ValueError):
            return Response({'detail': 'position (entier) requise.'}, status=status.HTTP_400_BAD_REQUEST)

        qs = self._scope(self.queryset.filter(ssdgps_id=instance.ssdgps_id, is_deleted=False)).order_by('ordre')
        pieces_by_id = {str(p.id): p for p in qs}
        ordered_ids = list(pieces_by_id.keys())
        ordered_ids.remove(str(instance.id))
        new_index = max(0, min(new_index, len(ordered_ids)))
        ordered_ids.insert(new_index, str(instance.id))

        with transaction.atomic():
            for index, pid in enumerate(ordered_ids):
                piece = pieces_by_id[pid]
                if piece.ordre != index:
                    piece.ordre = index
                    piece.save(update_fields=['ordre'])
        instance.refresh_from_db()
        return Response(self.get_serializer(instance).data)

    # ------------------------------------------------------------------
    # Application du tri par défaut (config opérateur) aux tableaux STOCKÉS
    # ------------------------------------------------------------------
    @staticmethod
    def _ssdgps_label(ssdgps):
        """Libellé lisible d'un SSDGPS pour la sélection (titre|réquisition + n° SD +
        n° SDGPS + nature)."""
        affaire = ssdgps.affaire
        propriete = affaire.propriete
        ident = (propriete.id_titre or propriete.id_requisition or '').strip()
        parts = [p for p in (
            ident,
            f'SD{affaire.numero_sd_affaire}',
            f'SDGPS N°{ssdgps.numero_ssdgps}',
            (ssdgps.nature_ssdgps or '').strip(),
        ) if p]
        return ' · '.join(parts)

    @staticmethod
    def _apply_sort_to_piece(piece, sort_config, user):
        """Réordonne physiquement les lignes stockées d'une pièce selon le tri configuré
        pour son type et l'enregistre comme tri PROPRE de la pièce (`payload['sort']` =
        dernier tri appliqué → suivi par le rapport PDF et l'affichage). Les deux versions
        (brute / écarts) des pièces RDL/RDN/RDIA sont traitées avec leur tri respectif.
        Renvoie True si la pièce a été modifiée. Les tableaux tabulaires voient leur colonne
        ID renumérotée 1..n ; les points PPA/PPN NE sont PAS renumérotés (photos rattachées
        par l'id d'origine)."""
        cfg = sort_versions((sort_config or {}).get(piece.type_piece))
        sort_brut = cfg['brut']
        # L'écarts sans tri propre configuré retombe sur le tri de la version brute.
        sort_ecarts = cfg['ecarts'] or sort_brut
        if not sort_brut and not sort_ecarts:
            return False
        payload = dict(piece.payload or {})
        is_photo = piece.type_piece in PHOTO_TYPES
        has_ecarts = bool(get_piece_def(piece.type_piece).get('ecarts'))
        sort_fn = _sorted_only if is_photo else _sorted_renumbered

        changed = False
        rows = payload.get('rows') or []
        if rows and sort_brut:
            new_rows = sort_fn(rows, sort_brut)
            if new_rows != rows:
                payload['rows'] = new_rows
                changed = True
        rows_ecarts = payload.get('rows_ecarts') or []
        if rows_ecarts and sort_ecarts:
            new_ecarts = sort_fn(rows_ecarts, sort_ecarts)
            if new_ecarts != rows_ecarts:
                payload['rows_ecarts'] = new_ecarts
                changed = True
        # Mémorise le tri appliqué comme tri propre de la pièce (prime sur le tri du type) :
        # forme à deux versions pour les types RDL/RDN/RDIA, liste simple sinon.
        new_sort = {'brut': sort_brut, 'ecarts': cfg['ecarts']} if has_ecarts else sort_brut
        if payload.get('sort') != new_sort:
            payload['sort'] = new_sort
            changed = True

        if not changed:
            return False
        piece.payload = payload
        piece.updated_by = user
        piece.save(update_fields=['payload', 'updated_by', 'updated_at'])
        return True

    @action(detail=True, methods=['post'], url_path='set-sort')
    def set_sort(self, request, pk=None):
        """
        POST /api/v1/pieces/{id}/set-sort/  {sort: [{field, dir}, …], version: 'brut'|'ecarts'}
        Enregistre le tri PROPRE de la pièce pour UNE version de sa table (dernier tri appliqué —
        ex. tri manuel par clic sur un en-tête). `version` vaut 'brut' (défaut) ou 'ecarts'
        (pièces RDL/RDN/RDIA). Ce tri est suivi par le rapport PDF et l'affichage,
        INDÉPENDAMMENT du tri par défaut du type (`/tri-pieces`). Une liste vide retire le tri
        propre de cette version. Ne réordonne PAS physiquement les lignes.
        """
        piece = self._org_scoped_queryset().filter(pk=pk, is_deleted=False).first()
        if piece is None:
            return Response({'detail': 'Pièce non trouvée.'}, status=status.HTTP_404_NOT_FOUND)
        piece_def = get_piece_def(piece.type_piece)
        has_ecarts = bool(piece_def.get('ecarts'))
        version = (request.data.get('version') or 'brut').strip().lower()
        if version not in ('brut', 'ecarts') or (version == 'ecarts' and not has_ecarts):
            version = 'brut'
        champs = piece_def.get('ecarts_champs') if version == 'ecarts' else piece_def.get('champs')
        valid = {c['name'] for c in (champs or [])}
        raw = request.data.get('sort')
        levels = raw if isinstance(raw, list) else ([raw] if raw else [])
        out, seen = [], set()
        for lv in levels:
            if not isinstance(lv, dict):
                continue
            field = (lv.get('field') or '').strip()
            if not field or field in seen:
                continue
            if field not in valid:
                return Response(
                    {'detail': f"Champ de tri « {field} » invalide pour la version « {version} » "
                               f"du type « {piece.type_piece} »."},
                    status=status.HTTP_400_BAD_REQUEST)
            seen.add(field)
            direction = (lv.get('dir') or 'asc').strip().lower()
            out.append({'field': field, 'dir': direction if direction in ('asc', 'desc') else 'asc'})

        payload = dict(piece.payload or {})
        current = sort_versions(payload.get('sort'))
        current[version] = out
        if has_ecarts:
            # Forme à deux versions ; retirée entièrement si les deux sont vides.
            if current['brut'] or current['ecarts']:
                payload['sort'] = {'brut': current['brut'], 'ecarts': current['ecarts']}
            else:
                payload.pop('sort', None)
        else:
            if out:
                payload['sort'] = out
            else:
                payload.pop('sort', None)
        piece.payload = payload
        piece.updated_by = request.user
        piece.save(update_fields=['payload', 'updated_by', 'updated_at'])
        return Response(self.get_serializer(piece).data)

    @action(detail=False, methods=['get'])
    def sortable(self, request):
        """
        GET /api/v1/pieces/sortable/
        Liste, dans la portée de l'utilisateur connecté, les pièces tabulaires dont le
        type possède un tri par défaut configuré (`piece_sort_config`) ET qui ont des
        données — candidates à l'application du tri sur leur tableau stocké. Renvoie de
        quoi bâtir la sélection (une/plusieurs/toutes) côté client, groupée par SSDGPS.
        """
        sort_config = getattr(request.user, 'piece_sort_config', None) or {}
        configured = set(sort_config.keys())
        if not configured:
            return Response({'items': [], 'configured_types': []})

        qs = self._scope(self.queryset.filter(is_deleted=False, type_piece__in=configured)) \
            .order_by('ssdgps__numero_ssdgps', 'ordre', 'type_piece', 'numero')
        items = []
        for piece in qs:
            rows = (piece.payload or {}).get('rows') or []
            if not rows:
                continue  # rien à trier
            piece_def = get_piece_def(piece.type_piece)
            items.append({
                'id': str(piece.id),
                'type_piece': piece.type_piece,
                'type_nom': piece_def.get('nom', piece.type_piece),
                'numero': piece.numero,
                'row_count': len(rows),
                'ssdgps_id': str(piece.ssdgps_id),
                'ssdgps_label': self._ssdgps_label(piece.ssdgps),
                'session_numero': piece.session.numero_session if piece.session_id else None,
            })
        return Response({'items': items, 'configured_types': sorted(configured)})

    @action(detail=False, methods=['post'], url_path='apply-sort-config')
    def apply_sort_config(self, request):
        """
        POST /api/v1/pieces/apply-sort-config/
        Applique le tri par défaut configuré (`piece_sort_config`) aux tableaux STOCKÉS
        des pièces de l'utilisateur connecté — pour une, plusieurs, ou toutes les pièces.
        Corps :
        - `piece_ids` : liste d'UUID de pièces à traiter (portée = organisation) ; OU
        - `all: true` : toutes les pièces des types configurés dans la portée.
        Seules les pièces d'un type disposant d'un tri configuré sont réordonnées ;
        les autres sont comptées en « ignorées ». Renvoie {updated, skipped, total}.
        """
        sort_config = getattr(request.user, 'piece_sort_config', None) or {}
        if not sort_config:
            return Response(
                {'detail': "Aucun tri par défaut n'est configuré : définissez-en un avant "
                           "de l'appliquer aux tableaux existants."},
                status=status.HTTP_400_BAD_REQUEST)

        apply_all = str(request.data.get('all', '')).lower() in ('1', 'true', 'yes') \
            or request.data.get('all') is True
        piece_ids = request.data.get('piece_ids')

        qs = self._scope(self.queryset.filter(is_deleted=False))
        if apply_all:
            qs = qs.filter(type_piece__in=sort_config.keys())
        else:
            if not isinstance(piece_ids, list) or not piece_ids:
                return Response(
                    {'detail': 'Fournissez piece_ids (liste) ou all=true.'},
                    status=status.HTTP_400_BAD_REQUEST)
            qs = qs.filter(pk__in=[str(i) for i in piece_ids])

        updated = skipped = 0
        with transaction.atomic():
            for piece in qs:
                if self._apply_sort_to_piece(piece, sort_config, request.user):
                    updated += 1
                else:
                    skipped += 1
        return Response({'updated': updated, 'skipped': skipped, 'total': updated + skipped})

    # ------------------------------------------------------------------
    # Galerie multi-images d'une pièce (RDC, CLC, PPA…)
    # ------------------------------------------------------------------
    @action(detail=True, methods=['post'], url_path='images',
            parser_classes=[parsers.MultiPartParser, parsers.FormParser])
    def add_images(self, request, pk=None):
        """POST {id}/images/ (multipart) — champs : `fichiers` (multiple),
        `last_modified` (multiple, epoch ms navigateur, aligné sur `fichiers`)."""
        piece = self._org_scoped_queryset().filter(pk=pk, is_deleted=False).first()
        if piece is None:
            return Response({'detail': 'Pièce non trouvée.'}, status=status.HTTP_404_NOT_FOUND)
        files = request.FILES.getlist('fichiers')
        if not files:
            return Response({'detail': 'Aucun fichier fourni (champ « fichiers »).'}, status=400)
        last_modified = request.data.getlist('last_modified')

        # Quota de l'organisation : vérifié sur le LOT ENTIER avant d'écrire quoi que ce
        # soit. Fichier par fichier, un lot pourrait franchir le plafond à mi-parcours et
        # laisser la pièce à moitié constituée. L'imputation suit le créateur du projet
        # (cf. analytics.quotas), pas l'utilisateur qui téléverse.
        try:
            ensure_within_quota(
                organization_of_user(piece.ssdgps.affaire.propriete.projet.created_by),
                sum(f.size for f in files),
            )
        except DjangoValidationError as e:
            return Response({'detail': e.messages[0] if e.messages else str(e)},
                            status=status.HTTP_400_BAD_REQUEST)

        # Rattachement optionnel à un point (PPA/PPN) : appliqué à tout le lot.
        point_ref = (request.data.get('point_ref') or '').strip()
        max_ordre = piece.images.aggregate(m=Max('ordre'))['m']
        next_ordre = (max_ordre + 1) if max_ordre is not None else 0
        try:
            with transaction.atomic():
                for idx, f in enumerate(files):
                    lm = last_modified[idx] if idx < len(last_modified) else None
                    meta = extract_image_metadata(f, lm)
                    img = PieceImage(piece=piece, fichier=f, ordre=next_ordre + idx,
                                     point_ref=point_ref, **meta)
                    img.full_clean()
                    img.save()
                    # Aperçu PNG pour les formats non affichables nativement (TIFF).
                    if (img.format or '').upper() in NON_WEB_FORMATS:
                        preview = make_png_preview(img.fichier)
                        if preview:
                            img.apercu.save(f'{img.pk}.png', preview, save=True)
        except DjangoValidationError as e:
            detail = e.message_dict if hasattr(e, 'message_dict') else e.messages
            return Response({'detail': detail}, status=status.HTTP_400_BAD_REQUEST)
        piece.refresh_from_db()
        return Response(self.get_serializer(piece).data, status=status.HTTP_201_CREATED)

    # NB : id numérique explicite — sinon le regex générique capterait aussi
    # « images/reorder » (ordre alphabétique des actions DRF) et le POST de
    # réordonnancement tomberait sur cette route DELETE (→ 405).
    @action(detail=True, methods=['delete'], url_path=r'images/(?P<image_id>[0-9]+)')
    def delete_image(self, request, pk=None, image_id=None):
        """DELETE {id}/images/{image_id}/ — supprime une image (fichier + ligne)."""
        piece = self._org_scoped_queryset().filter(pk=pk).first()
        if piece is None:
            return Response({'detail': 'Pièce non trouvée.'}, status=status.HTTP_404_NOT_FOUND)
        img = piece.images.filter(pk=image_id).first()
        if img is None:
            return Response({'detail': 'Image non trouvée.'}, status=status.HTTP_404_NOT_FOUND)
        img.fichier.delete(save=False)
        img.delete()
        piece.refresh_from_db()
        return Response(self.get_serializer(piece).data)

    # id numérique explicite (même raison que delete_image).
    @action(detail=True, methods=['post'], url_path=r'images/(?P<image_id>[0-9]+)/assign')
    def assign_image(self, request, pk=None, image_id=None):
        """POST {id}/images/{image_id}/assign  {point_ref} — (ré)assigne la photo à un
        point (PPA/PPN) ; `point_ref` vide = désassigner (retour au bac « à assigner »)."""
        piece = self._org_scoped_queryset().filter(pk=pk).first()
        if piece is None:
            return Response({'detail': 'Pièce non trouvée.'}, status=status.HTTP_404_NOT_FOUND)
        img = piece.images.filter(pk=image_id).first()
        if img is None:
            return Response({'detail': 'Image non trouvée.'}, status=status.HTTP_404_NOT_FOUND)
        img.point_ref = (request.data.get('point_ref') or '').strip()
        img.save(update_fields=['point_ref'])
        piece.refresh_from_db()
        return Response(self.get_serializer(piece).data)

    @action(detail=True, methods=['post'], url_path='images/assign-bulk')
    def assign_images_bulk(self, request, pk=None):
        """POST {id}/images/assign-bulk  {image_ids: [...], point_ref} — (ré)assigne en une
        transaction plusieurs photos à un point (point_ref vide = désassigner)."""
        piece = self._org_scoped_queryset().filter(pk=pk).first()
        if piece is None:
            return Response({'detail': 'Pièce non trouvée.'}, status=status.HTTP_404_NOT_FOUND)
        image_ids = request.data.get('image_ids')
        if not isinstance(image_ids, list) or not image_ids:
            return Response({'detail': 'image_ids (liste) requis.'}, status=400)
        point_ref = (request.data.get('point_ref') or '').strip()
        with transaction.atomic():
            piece.images.filter(pk__in=image_ids).update(point_ref=point_ref)
        piece.refresh_from_db()
        return Response(self.get_serializer(piece).data)

    @action(detail=True, methods=['post'], url_path='images/reorder')
    def reorder_images(self, request, pk=None):
        """POST {id}/images/reorder/  {ordered_ids: [...]} — réindexe l'ordre de la galerie."""
        piece = self._org_scoped_queryset().filter(pk=pk).first()
        if piece is None:
            return Response({'detail': 'Pièce non trouvée.'}, status=status.HTTP_404_NOT_FOUND)
        ordered_ids = request.data.get('ordered_ids')
        if not isinstance(ordered_ids, list) or not ordered_ids:
            return Response({'detail': 'ordered_ids (liste) requis.'}, status=400)
        images_by_id = {str(i.id): i for i in piece.images.all()}
        if set(images_by_id) != {str(i) for i in ordered_ids}:
            return Response(
                {'detail': "ordered_ids doit contenir exactement les images de la pièce."},
                status=400,
            )
        with transaction.atomic():
            for index, iid in enumerate(ordered_ids):
                im = images_by_id[str(iid)]
                if im.ordre != index:
                    im.ordre = index
                    im.save(update_fields=['ordre'])
        piece.refresh_from_db()
        return Response(self.get_serializer(piece).data)

    @action(detail=False, methods=['post'], url_path='import-html', parser_classes=[parsers.MultiPartParser])
    def import_html(self, request):
        """
        POST /api/v1/pieces/import-html/  (multipart) — RFB : rapport HTML TBC
        « Résultats de fermeture de boucle GNSS » → table de données auto-générée.
        Champs : fichier (.html requis), type_piece (requis).
        - Sans `ssdgps` : APERÇU — parse et retourne les lignes, NE PERSISTE RIEN.
        - Avec `ssdgps` : CONFIRMATION — crée la pièce (source « import »), payload =
          lignes éditées (`payload` JSON) sinon re-parse, et attache le fichier HTML.
        """
        f = request.FILES.get('fichier')
        type_piece = request.data.get('type_piece')
        if not f or not type_piece:
            return Response({'detail': 'fichier et type_piece sont requis.'}, status=400)
        try:
            piece_def = get_piece_def(type_piece)
        except KeyError:
            return Response({'detail': 'Type de pièce inconnu.'}, status=400)
        parse_tbc_html = TBC_HTML_PARSERS.get(type_piece)
        if parse_tbc_html is None:
            return Response({'detail': f"Le type « {type_piece} » n'a pas d'import HTML TBC."}, status=400)

        ssdgps_id = request.data.get('ssdgps')
        piece_id = request.data.get('piece_id')

        # --- Aperçu : parse requis ---
        if not ssdgps_id and not piece_id:
            try:
                rows = parse_tbc_html(f)
            except ValueError as e:
                return Response({'detail': str(e)}, status=400)
            return Response({
                'rows': rows,
                'champs': piece_def['champs'],
                'total_rows': len(rows),
            })

        # --- Ré-import : remplace données + fichier d'une pièce existante, identité
        # (ssdgps/session/numéro/type) inchangée — même principe que import_file. ---
        if piece_id:
            instance = self._org_scoped_queryset().filter(pk=piece_id, is_deleted=False).first()
            if instance is None:
                return Response({'detail': 'Pièce introuvable.'}, status=status.HTTP_404_NOT_FOUND)
            rows = None
            payload_raw = request.data.get('payload')
            if payload_raw:
                try:
                    edited = json.loads(payload_raw)
                    if isinstance(edited, dict):
                        edited = edited.get('rows')
                    if isinstance(edited, list):
                        rows = edited
                except (json.JSONDecodeError, TypeError):
                    rows = None
            if rows is None:
                try:
                    rows = parse_tbc_html(f)
                except ValueError as e:
                    return Response({'detail': str(e)}, status=400)
            f.seek(0)
            update_data = {'payload': {'rows': rows}, 'source_saisie': 'import', 'fichier': f}
            serializer = self.get_serializer(instance, data=update_data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save(updated_by=request.user)
            return Response(serializer.data)

        # --- Confirmation : on privilégie les lignes éditées (payload). On NE re-parse
        # le fichier QUE si aucun payload n'est fourni (sinon un fichier joint non conforme
        # bloquerait la création alors que les données sont déjà là). ---
        rows = None
        payload_raw = request.data.get('payload')
        if payload_raw:
            try:
                edited = json.loads(payload_raw)
                if isinstance(edited, dict):
                    edited = edited.get('rows')
                if isinstance(edited, list):
                    rows = edited
            except (json.JSONDecodeError, TypeError):
                rows = None
        if rows is None:
            try:
                rows = parse_tbc_html(f)
            except ValueError as e:
                return Response({'detail': str(e)}, status=400)

        f.seek(0)
        data = {
            'type_piece': type_piece,
            'ssdgps': ssdgps_id,
            'session': request.data.get('session') or None,
            'numero': request.data.get('numero') or None,
            'payload': {'rows': rows},
            'source_saisie': 'import',
            'fichier': f,
        }
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        ssdgps = serializer.validated_data.get('ssdgps')
        self._check_scope(ssdgps)
        max_ordre = Piece.objects.filter(ssdgps=ssdgps, is_deleted=False).aggregate(m=Max('ordre'))['m']
        serializer.save(created_by=request.user, ordre=(max_ordre + 1) if max_ordre is not None else 0)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='import-html-bulk',
            parser_classes=[parsers.MultiPartParser])
    def import_html_bulk(self, request):
        """
        POST /api/v1/pieces/import-html-bulk/  (multipart)
        Création EN MASSE de pièces répétables (ex. RDN — déterminations intermédiaires)
        à partir de PLUSIEURS rapports HTML TBC. Le numéro de chaque pièce est déduit de
        l'ORDRE des fichiers reçus : n° = (max numéro existant du même parent) + rang.
        Champs : type_piece (répétable + import HTML), ssdgps (requis),
        session (optionnelle), fichiers (>= 1, dans l'ordre voulu).
        Tout est créé dans une seule transaction : l'échec d'un fichier n'en crée aucun.
        """
        type_piece = request.data.get('type_piece')
        files = request.FILES.getlist('fichiers')
        if not type_piece or not files:
            return Response({'detail': 'type_piece et au moins un fichier sont requis.'}, status=400)
        try:
            piece_def = get_piece_def(type_piece)
        except KeyError:
            return Response({'detail': 'Type de pièce inconnu.'}, status=400)
        if not piece_def.get('repeatable'):
            return Response(
                {'detail': f"Le type « {type_piece} » n'est pas répétable : création en masse impossible."},
                status=400)
        parse_tbc_html = TBC_HTML_PARSERS.get(type_piece)
        if parse_tbc_html is None:
            return Response({'detail': f"Le type « {type_piece} » n'a pas d'import HTML TBC."}, status=400)
        ssdgps_id = request.data.get('ssdgps')
        if not ssdgps_id:
            return Response({'detail': 'ssdgps est requis pour la création en masse.'}, status=400)
        session_id = request.data.get('session') or None

        # 1) Parse TOUS les fichiers d'abord — un échec n'entraîne aucune création.
        parsed = []
        for idx, f in enumerate(files):
            try:
                rows = parse_tbc_html(f)
            except ValueError as e:
                return Response({'detail': f"Fichier n°{idx + 1} « {f.name} » : {e}"}, status=400)
            parsed.append((f, rows))

        # 2) Création atomique ; numéro et ordre déduits du rang dans la liste.
        created = []
        with transaction.atomic():
            max_num = Piece.objects.filter(
                type_piece=type_piece, ssdgps_id=ssdgps_id, session_id=session_id, is_deleted=False,
            ).aggregate(m=Max('numero'))['m'] or 0
            max_ordre = Piece.objects.filter(
                ssdgps_id=ssdgps_id, is_deleted=False).aggregate(m=Max('ordre'))['m']
            next_ordre = (max_ordre + 1) if max_ordre is not None else 0
            for i, (f, rows) in enumerate(parsed):
                f.seek(0)
                data = {
                    'type_piece': type_piece,
                    'ssdgps': ssdgps_id,
                    'session': session_id,
                    'numero': max_num + 1 + i,
                    'payload': {'rows': rows},
                    'source_saisie': 'import',
                    'fichier': f,
                }
                serializer = self.get_serializer(data=data)
                serializer.is_valid(raise_exception=True)
                if i == 0:
                    self._check_scope(serializer.validated_data.get('ssdgps'))
                serializer.save(created_by=request.user, ordre=next_ordre + i)
                created.append(serializer.data)
        return Response({'created': created, 'count': len(created)}, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='compute-rc',
            parser_classes=[parsers.MultiPartParser, parsers.FormParser])
    def compute_rc(self, request):
        """
        POST /api/v1/pieces/compute-rc/
        Génère le tableau de la pièce « Rapport de contrôle » (RC) en croisant la
        « Liste des points anciens » (LPA, coordonnées fixes) avec, au choix, les
        « Rapports de la détermination N°k » (RDN) OU le « Rapport des déterminations
        intermédiaires assemblé » (RDIA) du même SSDGPS (et de la session, si précisée) —
        cf. pieces/rc.py.

        Sources de déterminations (coordonnées calculées) :
        - `rdn`  : une ou plusieurs pièces RDN (comportement historique) ;
        - `rdia` : les blocs `determination` d'une pièce RDIA assemblée.
        La source est choisie via le champ `source` ; par défaut on privilégie les RDN
        s'ils existent, sinon on se rabat sur la RDIA. Quand LES DEUX sont disponibles, le
        client peut proposer le choix (la réponse d'aperçu expose `available_sources`).

        Champs : ssdgps (requis) ; session (optionnelle) ; source (`rdn`/`rdia`, optionnelle) ;
        commit (« 1 » → crée la pièce, sinon APERÇU sans persistance) ; payload (JSON des
        lignes éditées, au commit). La pièce ne peut être générée que si la LPA et au moins
        une source de déterminations existent avec des données.
        """
        type_piece = request.data.get('type_piece') or 'RC'
        ssdgps_id = request.data.get('ssdgps')
        if not ssdgps_id:
            return Response({'detail': 'ssdgps est requis.'}, status=400)
        session_id = request.data.get('session') or None
        commit = str(request.data.get('commit', '')).lower() in ('1', 'true', 'yes')

        scope = self._org_scoped_queryset().filter(ssdgps_id=ssdgps_id, is_deleted=False)
        lpa = scope.filter(type_piece='LPA').first()
        rdn_qs = scope.filter(type_piece='RDN')
        rdia_qs = scope.filter(type_piece='RDIA')
        if session_id:
            rdn_qs = rdn_qs.filter(session_id=session_id)
            rdia_qs = rdia_qs.filter(session_id=session_id)
        rdn_list = list(rdn_qs.order_by('numero', 'ordre'))
        rdia = rdia_qs.order_by('ordre').first()
        rdia_rows = (rdia.payload or {}).get('rows') if rdia else None

        # Sources de déterminations disponibles, dans l'ordre de préférence (RDN puis RDIA).
        available = []
        if rdn_list:
            available.append('rdn')
        if rdia_rows:
            available.append('rdia')

        missing = []
        if lpa is None or not (lpa.payload or {}).get('rows'):
            missing.append("« Liste des points anciens » (LPA)")
        if not available:
            missing.append("« Rapport de la détermination N°k » (RDN) ou « Rapport des "
                           "déterminations intermédiaires assemblé » (RDIA)")
        if missing:
            return Response({'detail': (
                'Sources manquantes : ' + ' et '.join(missing) + '. Ajoutez-les avec leurs '
                'données avant de générer le rapport de contrôle.')}, status=400)

        # Choix de la source : champ `source` s'il est valide/disponible, sinon la préférée.
        source = str(request.data.get('source') or '').strip().lower()
        if source not in available:
            source = available[0]

        lpa_rows = (lpa.payload or {}).get('rows') or []
        if source == 'rdia':
            determinations = determinations_from_rdia(rdia_rows)
        else:
            determinations = [{'numero': p.numero, 'rows': (p.payload or {}).get('rows') or []}
                              for p in rdn_list]
        rows = compute_rapport_controle(lpa_rows, determinations)
        if not rows:
            return Response({'detail': (
                "Aucun point de contrôle commun entre la LPA et les déterminations : "
                "vérifiez que les points anciens tenus fixes figurent bien dans la LPA.")},
                status=400)

        piece_def = get_piece_def(type_piece)
        if not commit:
            return Response({'rows': rows, 'champs': piece_def['champs'], 'total_rows': len(rows),
                             'source': source, 'available_sources': available})

        # Commit : privilégier les lignes éditées transmises, sinon les lignes calculées.
        payload_raw = request.data.get('payload')
        if payload_raw:
            try:
                edited = json.loads(payload_raw)
                if isinstance(edited, dict):
                    edited = edited.get('rows')
                if isinstance(edited, list) and edited:
                    rows = edited
            except (json.JSONDecodeError, TypeError):
                pass

        data = {
            'type_piece': type_piece,
            'ssdgps': ssdgps_id,
            'session': session_id,
            'payload': {'rows': rows},
            'source_saisie': 'ui',
        }
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        ssdgps = serializer.validated_data.get('ssdgps')
        self._check_scope(ssdgps)
        max_ordre = Piece.objects.filter(ssdgps=ssdgps, is_deleted=False).aggregate(m=Max('ordre'))['m']
        serializer.save(created_by=request.user, ordre=(max_ordre + 1) if max_ordre is not None else 0)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='compute-ecarts')
    def compute_ecarts(self, request, pk=None):
        """
        POST /api/v1/pieces/<id>/compute-ecarts/
        Calcule la DEUXIÈME version « écarts » d'une pièce RDL/RDN : pour chaque point,
        écart entre la coordonnée définitive (RDD) et la coordonnée calculée de la pièce.
        Résultat stocké dans payload['rows_ecarts'] (la version brute payload['rows'] est
        conservée). Requiert : données brutes de la pièce présentes + une pièce RDD (avec
        données) dans le même SSDGPS (et la même session, si la pièce en a une).
        """
        piece = self.get_object()
        piece_def = get_piece_def(piece.type_piece)
        if not piece_def.get('ecarts'):
            return Response(
                {'detail': f"Le type « {piece.type_piece} » n'a pas de version « écarts »."}, status=400)

        piece_rows = (piece.payload or {}).get('rows') or []
        if not piece_rows:
            return Response({'detail': (
                'Les données brutes de cette pièce sont absentes : importez ou saisissez-les '
                'avant de calculer les écarts.')}, status=400)

        rdd_qs = self._org_scoped_queryset().filter(
            type_piece='RDD', ssdgps_id=piece.ssdgps_id, is_deleted=False)
        if piece.session_id:
            rdd_qs = rdd_qs.filter(session_id=piece.session_id)
        rdd = rdd_qs.first()
        if rdd is None or not (rdd.payload or {}).get('rows'):
            return Response({'detail': (
                'Pièce « Rapport de la détermination définitive » (RDD) absente ou sans données : '
                'ajoutez-la avec son tableau avant de calculer les écarts.')}, status=400)

        rdd_rows = (rdd.payload or {}).get('rows') or []
        if piece_def.get('assemble'):
            rows_ecarts = compute_ecarts_assembled(piece_rows, rdd_rows)
        else:
            rows_ecarts = compute_ecarts_vs_definitive(piece_rows, rdd_rows)
        if not rows_ecarts:
            return Response({'detail': (
                'Aucun point commun entre cette pièce et la détermination définitive.')}, status=400)

        payload = dict(piece.payload or {})
        payload['rows_ecarts'] = rows_ecarts
        serializer = self.get_serializer(piece, data={'payload': payload}, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        return Response(serializer.data)

    @action(detail=False, methods=['post'], url_path='parse-determinations',
            parser_classes=[parsers.MultiPartParser])
    def parse_determinations(self, request):
        """
        POST /api/v1/pieces/parse-determinations/  (multipart, fichiers multiples)
        Analyse plusieurs fichiers de déterminations (CSV/Excel/HTML TBC) et renvoie, pour
        chacun, ses lignes au schéma RDL/RDN (nom_point, x_m, σx, y_m, σy) + un indicateur
        `has_fixe` (présence d'un point fixe → RDN, sinon détermination libre). Ne persiste
        rien : l'assemblage/ordre se fait ensuite côté client. CSV/Excel : mappage auto des
        colonnes par libellé (« Nom Point / X (m) / σx (m) … »).
        """
        files = request.FILES.getlist('fichiers')
        if not files:
            return Response({'detail': 'Au moins un fichier est requis.'}, status=400)
        rdx_champs = get_piece_def('RDL')['champs']
        out = []
        for f in files:
            name = f.name
            lower = name.lower()
            try:
                if lower.endswith('.html') or lower.endswith('.htm'):
                    parsed = parse_rdl_tbc_html(f)
                    rows = [{'nom_point': r.get('nom_point', ''), 'x_m': r.get('x_m', ''),
                             'sigma_x_m': r.get('sigma_x_m', ''), 'y_m': r.get('y_m', ''),
                             'sigma_y_m': r.get('sigma_y_m', '')} for r in parsed]
                else:
                    columns, data = parse_uploaded_table(f)
                    mapping = auto_map_columns(columns, rdx_champs)
                    mapped = apply_mapping(columns, data, mapping)
                    rows = [{'nom_point': r.get('nom_point') or '', 'x_m': r.get('x_m') or '',
                             'sigma_x_m': r.get('sigma_x_m') or '', 'y_m': r.get('y_m') or '',
                             'sigma_y_m': r.get('sigma_y_m') or ''}
                            for r in mapped if (r.get('nom_point') or '').strip()]
            except ValueError as e:
                return Response({'detail': f"« {name} » : {e}"}, status=400)
            if not rows:
                return Response({'detail': (
                    f"« {name} » : aucune donnée exploitable (colonnes non reconnues ?).")}, status=400)
            fixes = []
            for r in rows:
                if (str(r.get('sigma_x_m', '')).strip().upper() == 'FIXE'
                        or str(r.get('sigma_y_m', '')).strip().upper() == 'FIXE'):
                    pt = str(r.get('nom_point', '')).strip()
                    if pt and pt not in fixes:
                        fixes.append(pt)
            out.append({'filename': name, 'count': len(rows),
                        'has_fixe': bool(fixes), 'fixes': fixes, 'rows': rows})
        return Response({'determinations': out})

    @staticmethod
    def _det_label(piece):
        """Étiquette de bloc d'une détermination : « Libre » (RDL) / « N°k » (RDN)."""
        if piece.type_piece == 'RDL':
            return 'Libre'
        if piece.type_piece == 'RDN':
            return f'N°{piece.numero}' if piece.numero else 'N°?'
        return piece.type_piece

    @action(detail=False, methods=['post'], url_path='assemble-rdi',
            parser_classes=[parsers.MultiPartParser, parsers.FormParser, parsers.JSONParser])
    def assemble_rdi(self, request):
        """
        POST /api/v1/pieces/assemble-rdi/
        Assemble la RDL + les RDNₖ d'un SSDGPS/session en une pièce « Rapport des
        déterminations intermédiaires » (RDIA), avec une colonne « Détermination »
        (Libre / N°1 / N°2…).
        - `source_ids` (liste ordonnée d'IDs RDL/RDN) : ordre d'assemblage ; à défaut, toutes
          les déterminations du scope (RDL puis RDN par numéro).
        - Sans `commit`/`piece_id` : APERÇU. `commit=1` : crée la pièce. `piece_id` :
          réassemble (met à jour) une pièce RDIA existante (et invalide ses écarts).
        Champs : ssdgps (requis sauf si piece_id), session (optionnelle).
        """
        type_piece = 'RDIA'
        piece_id = request.data.get('piece_id')
        commit = str(request.data.get('commit', '')).lower() in ('1', 'true', 'yes')

        if piece_id:
            target = self._org_scoped_queryset().filter(pk=piece_id, is_deleted=False).first()
            if target is None:
                return Response({'detail': 'Pièce introuvable.'}, status=status.HTTP_404_NOT_FOUND)
            ssdgps_id = str(target.ssdgps_id)
            session_id = str(target.session_id) if target.session_id else None
        else:
            ssdgps_id = request.data.get('ssdgps')
            if not ssdgps_id:
                return Response({'detail': 'ssdgps est requis.'}, status=400)
            session_id = request.data.get('session') or None

        # Ordre des sources : IDs fournis, sinon auto (RDL puis RDN par numéro).
        raw_ids = request.data.get('source_ids')
        ids = []
        if raw_ids:
            try:
                ids = json.loads(raw_ids) if isinstance(raw_ids, str) else list(raw_ids)
            except (json.JSONDecodeError, TypeError):
                ids = []
        ordered = []
        if ids:
            by_id = {str(p.id): p for p in self._org_scoped_queryset().filter(
                pk__in=[str(i) for i in ids], ssdgps_id=ssdgps_id, is_deleted=False,
                type_piece__in=['RDL', 'RDN'])}
            ordered = [by_id[str(i)] for i in ids if str(i) in by_id]
        if not ordered:
            scope = self._org_scoped_queryset().filter(
                ssdgps_id=ssdgps_id, is_deleted=False, type_piece__in=['RDL', 'RDN'])
            if session_id:
                scope = scope.filter(session_id=session_id)
            ordered = (list(scope.filter(type_piece='RDL').order_by('ordre'))
                       + list(scope.filter(type_piece='RDN').order_by('numero', 'ordre')))

        if not ordered:
            return Response({'detail': (
                'Aucune détermination (RDL / RDNₖ) trouvée dans ce SSDGPS/session : '
                'ajoutez-en avant d\'assembler.')}, status=400)

        sources = [{'label': self._det_label(p), 'rows': (p.payload or {}).get('rows') or []}
                   for p in ordered]
        rows = assemble_determinations(sources)
        if not rows:
            return Response(
                {'detail': 'Les déterminations sélectionnées ne contiennent aucune donnée.'}, status=400)

        piece_def = get_piece_def(type_piece)
        if not commit and not piece_id:
            return Response({
                'rows': rows, 'champs': piece_def['champs'], 'total_rows': len(rows),
                'sources': [{'id': str(p.id), 'label': self._det_label(p),
                             'count': len((p.payload or {}).get('rows') or [])} for p in ordered],
            })

        # Lignes éventuellement éditées après aperçu.
        payload_raw = request.data.get('payload')
        if payload_raw:
            try:
                edited = json.loads(payload_raw) if isinstance(payload_raw, str) else payload_raw
                if isinstance(edited, dict):
                    edited = edited.get('rows')
                if isinstance(edited, list) and edited:
                    rows = edited
            except (json.JSONDecodeError, TypeError):
                pass

        if piece_id:
            payload = dict(target.payload or {})
            payload['rows'] = rows
            payload.pop('rows_ecarts', None)  # écarts invalidés → à recalculer
            serializer = self.get_serializer(target, data={'payload': payload}, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save(updated_by=request.user)
            return Response(serializer.data)

        data = {
            'type_piece': type_piece, 'ssdgps': ssdgps_id, 'session': session_id,
            'payload': {'rows': rows}, 'source_saisie': 'import',
        }
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        ssdgps = serializer.validated_data.get('ssdgps')
        self._check_scope(ssdgps)
        max_ordre = Piece.objects.filter(ssdgps=ssdgps, is_deleted=False).aggregate(m=Max('ordre'))['m']
        serializer.save(created_by=request.user, ordre=(max_ordre + 1) if max_ordre is not None else 0)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], url_path='report')
    def report(self, request):
        """
        GET /api/v1/pieces/report/?ssdgps=<uuid>[&session=<uuid>]
        GET /api/v1/pieces/report/?ssdgps=<uuid>&session_from=<uuid>&session_to=<uuid>

        Génère le rapport PDF du SSDGPS : page de garde (liste des pièces valides) +
        contenu de chaque pièce valide (tableaux / images / photos), dans l'ordre du
        rapport (`ordre`). Seules les pièces `statut == 'valide'` non supprimées sont
        retenues.

        Trois portées :
        - sans paramètre de session : tout le SSDGPS ;
        - `session` : les pièces de CETTE session plus les pièces communes (session nulle) ;
        - `session_from` / `session_to` : rapport de **synthèse** sur une plage de
          sessions. Les pièces communes n'y figurent qu'UNE fois ; les pièces spécifiques
          sont regroupées par pièce puis déclinées session par session
          (cf. `report.order_pieces_for_synthesis`). Les deux bornes sont incluses et
          peuvent être données dans n'importe quel ordre.
        """
        ssdgps_id = request.query_params.get('ssdgps')
        if not ssdgps_id:
            return Response({'detail': 'Le paramètre ssdgps est requis.'}, status=400)

        # Portée organisationnelle : vérifie l'appartenance de l'organisation du SSDGPS
        # aux droits de l'utilisateur (les admins système / super-admins ne sont pas filtrés).
        ssdgps = Ssdgps.objects.select_related(
            'affaire__propriete__projet__organization').filter(pk=ssdgps_id).first()
        if ssdgps is None:
            return Response({'detail': 'SSDGPS introuvable.'}, status=status.HTTP_404_NOT_FOUND)
        projet = ssdgps.affaire.propriete.projet
        if not is_scope_visible(request.user, projet.organization_id, projet.created_by_id):
            raise PermissionDenied("Ce SSDGPS n'appartient pas à votre organisation.")

        session_id = request.query_params.get('session') or None
        session = None
        if session_id:
            session = Session.objects.filter(pk=session_id, ssdgps_id=ssdgps_id).first()
            if session is None:
                return Response({'detail': 'Session introuvable pour ce SSDGPS.'}, status=400)

        # Plage de sessions (rapport de synthèse). Les deux bornes sont requises ensemble
        # et peuvent être fournies dans n'importe quel ordre : on les remet d'aplomb.
        sessions_plage = None
        from_id = request.query_params.get('session_from') or None
        to_id = request.query_params.get('session_to') or None
        if from_id or to_id:
            if session_id:
                return Response({'detail': "Choisissez soit une session unique, soit une "
                                           "plage de sessions, pas les deux."}, status=400)
            if not (from_id and to_id):
                return Response({'detail': "Une plage de sessions exige « session_from » "
                                           "ET « session_to »."}, status=400)
            bornes = {str(s.pk): s for s in Session.objects.filter(
                pk__in=[from_id, to_id], ssdgps_id=ssdgps_id, is_deleted=False)}
            debut, fin = bornes.get(str(from_id)), bornes.get(str(to_id))
            if debut is None or fin is None:
                return Response(
                    {'detail': 'Session de début ou de fin introuvable pour ce SSDGPS.'},
                    status=400)
            bas, haut = sorted((debut.numero_session, fin.numero_session))
            sessions_plage = list(Session.objects.filter(
                ssdgps_id=ssdgps_id, is_deleted=False,
                numero_session__gte=bas, numero_session__lte=haut,
            ).order_by('numero_session'))

        qs = self._scope(self.queryset.filter(
            ssdgps_id=ssdgps_id, is_deleted=False, statut=Piece.Statut.VALIDE,
        )).exclude(type_piece__in=EXCLUDED_TYPES)
        if session_id:
            qs = qs.filter(Q(session_id=session_id) | Q(session__isnull=True))
        elif sessions_plage is not None:
            # Pièces des sessions de la plage + pièces communes (une seule fois).
            qs = qs.filter(Q(session__in=sessions_plage) | Q(session__isnull=True))

        if sessions_plage is not None:
            # Regroupement « une pièce, puis ses sessions » (cf. report.py).
            pieces = order_pieces_for_synthesis(
                list(qs.select_related('session').order_by('ordre', 'type_piece', 'numero')))
        else:
            pieces = list(qs.order_by('ordre', 'type_piece', 'numero'))

        if not pieces:
            return Response(
                {'detail': 'Aucune pièce valide à inclure dans le rapport.'}, status=400)

        # Mode d'impression : recto-verso (calage des pages de garde sur page droite +
        # pied de page en miroir) si `duplex` vaut 1/true, recto seul sinon.
        duplex = str(request.query_params.get('duplex', '')).strip().lower() in ('1', 'true', 'yes')

        try:
            sort_config = getattr(request.user, 'piece_sort_config', None) or {}
            fields_config = getattr(request.user, 'piece_fields_config', None) or {}
            pdf_bytes = render_report_pdf(ssdgps, session, pieces,
                                          sort_config=sort_config, fields_config=fields_config,
                                          duplex=duplex)
        except RuntimeError as exc:
            # Chaîne PDF indisponible (dépendance / bibliothèque native manquante) :
            # message actionnable, levé AVANT le rendu par `check_pdf_toolchain`.
            logger.error('Rapport PDF indisponible (SSDGPS %s) : %s', ssdgps.pk, exc)
            return Response({'detail': str(exc)}, status=status.HTTP_501_NOT_IMPLEMENTED)
        except Exception as exc:
            # Garde-fou : toute autre défaillance du rendu (donnée de pièce inattendue,
            # image illisible, mémoire…) doit renvoyer un `detail` exploitable et tracer
            # la pile côté serveur, et NON une 500 opaque — la modale de génération
            # n'afficherait alors qu'un message générique sans piste de diagnostic.
            logger.exception('Échec de génération du rapport PDF (SSDGPS %s)', ssdgps.pk)
            return Response(
                {'detail': 'Échec de la génération du rapport PDF : '
                           f'{type(exc).__name__} — {exc}. '
                           'Le détail complet figure dans les journaux du serveur.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        filename = report_filename(ssdgps, session, sessions=sessions_plage)

        # Consultation/export journalisé : pour des données foncières, savoir QUI a
        # sorti QUEL rapport et QUAND fait partie de la traçabilité attendue — les
        # colonnes d'audit des tables n'en gardent aucune trace (rien n'est modifié).
        journaliser(
            AuditEvent.ACTION_RAPPORT_GENERE, request=request, cible=ssdgps,
            cible_libelle=str(ssdgps), fichier=filename,
            sessions=([s.numero_session for s in sessions_plage]
                      if sessions_plage else None),
            octets=len(pdf_bytes),
        )

        # Réponse JSON base64 (par défaut pour le front) : le PDF est transporté encodé
        # dans un JSON, puis reconstruit en Blob côté client. On évite ainsi qu'un
        # gestionnaire de téléchargement externe (ex. Internet Download Manager) n'intercepte
        # la requête XHR d'un flux « application/pdf » — ce qui la faisait échouer / rejouer
        # sans en-tête Authorization. Le paramètre `format=raw` sert l'ancien flux binaire
        # (accès direct navigateur / autres clients).
        if request.query_params.get('format', 'base64') != 'raw':
            import base64
            return Response({
                'filename': filename,
                'content_type': 'application/pdf',
                'data': base64.b64encode(pdf_bytes).decode('ascii'),
            })

        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = f'inline; filename="{filename}"'
        response['X-Content-Type-Options'] = 'nosniff'
        return response

    @action(detail=False, methods=['post'], url_path='import', parser_classes=[parsers.MultiPartParser])
    def import_file(self, request):
        """
        POST /api/v1/pieces/import/  (multipart)
        Champs : fichier (requis), type_piece (requis), ssdgps (requis en phase 2),
        session (optionnelle — spécifique si renseignée, commune sinon), numero
        (requis si type répétable), mapping (JSON, absent en phase 1),
        piece_id (optionnel — met à jour cette pièce existante au lieu d'en créer une).
        - Sans `mapping` : PHASE 1 — parse et retourne un aperçu, NE PERSISTE RIEN.
        - Avec `mapping` : PHASE 2 — parse intégralement, applique le mapping,
          valide (cohérence + doublons), crée (ou met à jour si `piece_id`) la Piece.
        """
        f = request.FILES.get('fichier')
        type_piece = request.data.get('type_piece')
        if not f or not type_piece:
            return Response({'detail': 'fichier et type_piece sont requis.'}, status=400)
        try:
            piece_def = get_piece_def(type_piece)
        except KeyError:
            return Response({'detail': 'Type de pièce inconnu.'}, status=400)
        try:
            columns, rows = parse_uploaded_table(f)
        except ValueError as e:
            return Response({'detail': str(e)}, status=400)

        mapping_raw = request.data.get('mapping')
        if not mapping_raw:
            # --- Phase 1 : aperçu ---
            # Champs proposés au mapping = FILTRE-MAÎTRE « import » de l'opérateur : seuls les
            # champs activés (dans son ordre) sont importables ; les champs désactivés ne sont
            # pas mappés (donc jamais présents dans les données, ni affichés, ni imprimés).
            champs = champs_with_meta(type_piece)
            fields_config = getattr(request.user, 'piece_fields_config', None) or {}
            visible = import_visible_names(type_piece, fields_config)
            if visible is not None:
                by_name = {c['name']: c for c in champs}
                champs = [by_name[n] for n in visible if n in by_name]
            return Response({
                'columns': columns,
                'preview_rows': rows[:20],
                'total_rows': len(rows),
                # Champs enrichis des descriptions/infobulles → aide à la correspondance
                # des colonnes dans le mapping d'import.
                'champs': champs,
            })

        # --- Phase 2 : confirmation ---
        try:
            mapping = json.loads(mapping_raw)
        except (json.JSONDecodeError, TypeError):
            return Response({'detail': 'mapping invalide (JSON attendu).'}, status=400)

        mapped_rows = apply_mapping(columns, rows, mapping)
        payload = {'rows': mapped_rows}

        data = {
            'type_piece': type_piece,
            'ssdgps': request.data.get('ssdgps') or None,
            'session': request.data.get('session') or None,
            'numero': request.data.get('numero') or None,
            'payload': payload,
            'source_saisie': 'import',
            'fichier': f,
        }

        piece_id = request.data.get('piece_id')
        if piece_id:
            # Ré-import : on remplace uniquement les données et le fichier ; l'identité
            # de la pièce (ssdgps/session/numéro/type) reste inchangée. Ne PAS repasser
            # `ssdgps` ici — le front ne le renvoie pas, et un `ssdgps=None` ferait
            # échouer la validation du FK non-null.
            instance = self._org_scoped_queryset().filter(pk=piece_id, is_deleted=False).first()
            if instance is None:
                return Response({'detail': 'Pièce introuvable.'}, status=status.HTTP_404_NOT_FOUND)
            update_data = {'payload': payload, 'source_saisie': 'import', 'fichier': f}
            serializer = self.get_serializer(instance, data=update_data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save(updated_by=request.user)
            return Response(serializer.data)

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        ssdgps = serializer.validated_data.get('ssdgps')
        self._check_scope(ssdgps)
        max_ordre = Piece.objects.filter(ssdgps=ssdgps, is_deleted=False).aggregate(m=Max('ordre'))['m']
        serializer.save(created_by=request.user, ordre=(max_ordre + 1) if max_ordre is not None else 0)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
