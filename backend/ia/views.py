"""
API de l'intelligence artificielle — `/api/v1/ia/`.

- `GET  statut/`            — l'IA est-elle activée ? (le front masque les boutons sinon)
- `POST mapping-colonnes/`  — N°4 : associations proposées pour un import de pièce ;
- `POST observations/`      — N°6 : brouillons d'observations des pièces d'un SDGPS ;
- `POST synthese/`          — N°6 : brouillon de note de synthèse d'un SDGPS ;
- `POST assistant/`         — N°5 : un tour de conversation avec l'assistant.

Toutes : `IsAuthenticated`, plafond de débit par utilisateur (`ia`), droits RBAC de
l'utilisateur sur le dossier visé. Codes d'erreur : 503 `IA_INACTIVE` (IA non activée),
502 (échec du service d'IA, message exploitable), 400 (demande invalide).
Rien n'est enregistré : l'IA propose, l'opérateur décide.
"""
import uuid

from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import assistant, client, mapping, redaction


class _IaView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'ia'

    @staticmethod
    def erreur(message, statut_http=status.HTTP_400_BAD_REQUEST, **extra):
        return Response({'detail': message, **extra}, status=statut_http)

    def executer(self, fonction):
        """Exécute `fonction()` et traduit les erreurs d'IA en réponses HTTP."""
        try:
            return Response(fonction())
        except client.IaIndisponible as exc:
            return self.erreur(str(exc), status.HTTP_503_SERVICE_UNAVAILABLE, code='IA_INACTIVE')
        except client.IaErreur as exc:
            return self.erreur(str(exc), status.HTTP_502_BAD_GATEWAY)
        except ValueError as exc:
            return self.erreur(str(exc))

    def dossier(self, request):
        """SDGPS visé (`ssdgps` du corps), dans la portée RBAC de l'utilisateur."""
        from projects.models import Ssdgps
        from projects.views import scope_queryset

        ssdgps_id = request.data.get('ssdgps')
        try:
            uuid.UUID(str(ssdgps_id))
        except ValueError:
            return None
        qs = scope_queryset(Ssdgps.objects.filter(is_deleted=False), request.user,
                            'affaire__propriete__projet__organization_id')
        return qs.select_related('affaire__propriete__projet').filter(pk=ssdgps_id).first()


class StatutView(_IaView):
    throttle_classes = []   # interrogé à l'ouverture des écrans : jamais facturé

    def get(self, request):
        actif = client.disponible()
        return Response({'disponible': actif, 'modele': client.modele() if actif else None})


class MappingColonnesView(_IaView):
    def post(self, request):
        from pieces.catalog import champs_with_meta, get_piece_def, import_visible_names

        type_piece = request.data.get('type_piece')
        colonnes = request.data.get('colonnes')
        if not type_piece or not isinstance(colonnes, list) or not colonnes:
            return self.erreur('type_piece et colonnes sont requis.')
        try:
            definition = get_piece_def(type_piece)
        except KeyError:
            return self.erreur('Type de pièce inconnu.')
        champs = champs_with_meta(type_piece)
        visibles = import_visible_names(type_piece,
                                        getattr(request.user, 'piece_fields_config', None) or {})
        if visibles is not None:
            champs = [c for c in champs if c['name'] in set(visibles)]
        lignes = request.data.get('lignes') or []
        deja = request.data.get('deja') or {}
        if not isinstance(lignes, list) or not isinstance(deja, dict):
            return self.erreur('lignes doit être une liste et deja un objet.')
        return self.executer(lambda: mapping.proposer(
            request.user, type_libelle=definition.get('nom') or type_piece, champs=champs,
            colonnes=colonnes, lignes=lignes, deja=deja))


class ObservationsView(_IaView):
    def post(self, request):
        ssdgps = self.dossier(request)
        if ssdgps is None:
            return self.erreur('SDGPS introuvable.', status.HTTP_404_NOT_FOUND)
        if ssdgps.est_verrouille():
            return self.erreur(
                f"Le dossier est {ssdgps.get_statut_display().lower()} : ses pièces ne sont "
                "plus modifiables.", status.HTTP_409_CONFLICT)
        return self.executer(lambda: redaction.observations(request.user, ssdgps))


class SyntheseView(_IaView):
    def post(self, request):
        ssdgps = self.dossier(request)
        if ssdgps is None:
            return self.erreur('SDGPS introuvable.', status.HTTP_404_NOT_FOUND)
        return self.executer(lambda: redaction.synthese(request.user, ssdgps))


class AssistantView(_IaView):
    def post(self, request):
        return self.executer(lambda: assistant.repondre(request.user,
                                                        request.data.get('messages')))
