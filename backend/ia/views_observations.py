"""
Gestion des observations des pièces — `/api/v1/ia/observations/…`.

L'observation d'une pièce (`Piece.commentaire`) alimente la colonne « Observations »
de la page de garde du SDGPS. Ces vues la gèrent sans jamais rien perdre :

- `POST observations/appliquer/`  — enregistre des observations (relues après la
  rédaction par l'IA, ou saisies) ; l'ancienne version est ARCHIVÉE ;
- `POST observations/supprimer/`  — efface l'observation de pièces choisies ou de TOUTES
  les pièces du dossier ; chaque texte effacé est archivé ;
- `GET  observations/historique/?ssdgps=&piece=` — versions archivées ;
- `POST observations/restaurer/`  — remet une version archivée (la version courante est
  archivée à son tour).

Mêmes garde-fous que l'API des pièces : portée RBAC du SDGPS, pièces du dossier
uniquement, dossier figé (soumis / validé / clos) refusé.
"""
import uuid

from django.db import transaction
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ObservationArchive
from .redaction import LONGUEUR_OBSERVATION


def _uuid(valeur):
    try:
        return str(uuid.UUID(str(valeur)))
    except ValueError:
        return None


class _Base(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def dossier(self, request, ssdgps_id):
        from projects.models import Ssdgps
        from projects.views import scope_queryset
        if not _uuid(ssdgps_id):
            return None
        qs = scope_queryset(Ssdgps.objects.filter(is_deleted=False), request.user,
                            'affaire__propriete__projet__organization_id')
        return qs.filter(pk=ssdgps_id).first()

    def refus(self, ssdgps):
        if ssdgps is None:
            return Response({'detail': 'SDGPS introuvable.'}, status=status.HTTP_404_NOT_FOUND)
        if ssdgps.est_verrouille():
            return Response({'detail': f"Le dossier est {ssdgps.get_statut_display().lower()} : "
                                       "ses observations ne sont plus modifiables."},
                            status=status.HTTP_409_CONFLICT)
        return None

    @staticmethod
    def pieces(ssdgps, ids=None):
        from pieces.models import Piece
        qs = Piece.objects.filter(ssdgps=ssdgps, is_deleted=False)
        if ids is not None:
            qs = qs.filter(pk__in=[i for i in (_uuid(x) for x in ids) if i])
        return qs

    @staticmethod
    def ecrire(piece, texte, utilisateur, motif):
        """Remplace l'observation d'une pièce en archivant l'ancienne (si elle diffère)."""
        ancien = (piece.commentaire or '').strip()
        if ancien and ancien != texte:
            ObservationArchive.objects.create(piece=piece, texte=ancien, motif=motif,
                                              created_by=utilisateur)
        if ancien != texte:
            piece.commentaire = texte
            piece.updated_by = utilisateur
            piece.save(update_fields=['commentaire', 'updated_by', 'updated_at'])
            return True
        return False


class AppliquerView(_Base):
    def post(self, request):
        ssdgps = self.dossier(request, request.data.get('ssdgps'))
        refus = self.refus(ssdgps)
        if refus:
            return refus
        entrees = request.data.get('observations')
        if not isinstance(entrees, list) or not entrees:
            return Response({'detail': 'Aucune observation à enregistrer.'},
                            status=status.HTTP_400_BAD_REQUEST)
        textes = {}
        for e in entrees:
            pid = _uuid((e or {}).get('piece'))
            if pid:
                textes[pid] = ' '.join(str(e.get('texte') or '').split())[:LONGUEUR_OBSERVATION]
        pieces = list(self.pieces(ssdgps, list(textes)))
        with transaction.atomic():
            modifiees = sum(self.ecrire(p, textes[str(p.pk)], request.user, 'remplacee')
                            for p in pieces)
        return Response({'modifiees': modifiees, 'ignorees': len(textes) - len(pieces)})


class SupprimerView(_Base):
    def post(self, request):
        ssdgps = self.dossier(request, request.data.get('ssdgps'))
        refus = self.refus(ssdgps)
        if refus:
            return refus
        if request.data.get('toutes'):
            pieces = self.pieces(ssdgps)
        else:
            ids = request.data.get('pieces')
            if not isinstance(ids, list) or not ids:
                return Response({'detail': 'Choisissez au moins une pièce, ou « toutes ».'},
                                status=status.HTTP_400_BAD_REQUEST)
            pieces = self.pieces(ssdgps, ids)
        with transaction.atomic():
            supprimees = sum(self.ecrire(p, '', request.user, 'supprimee')
                             for p in pieces.exclude(commentaire=''))
        return Response({'supprimees': supprimees})


class HistoriqueView(_Base):
    def get(self, request):
        from pieces.report import piece_designation
        ssdgps = self.dossier(request, request.query_params.get('ssdgps'))
        if ssdgps is None:
            return Response({'detail': 'SDGPS introuvable.'}, status=status.HTTP_404_NOT_FOUND)
        qs = ObservationArchive.objects.filter(piece__ssdgps=ssdgps).select_related('piece', 'created_by')
        piece = request.query_params.get('piece')
        if piece:
            qs = qs.filter(piece_id=_uuid(piece))
        return Response([{
            'id': a.id, 'piece': str(a.piece_id), 'designation': piece_designation(a.piece),
            'texte': a.texte, 'motif': a.motif, 'motif_display': a.get_motif_display(),
            'created_at': a.created_at,
            'created_by': (a.created_by.get_full_name() or a.created_by.email) if a.created_by else None,
        } for a in qs[:300]])


class RestaurerView(_Base):
    def post(self, request):
        archive = ObservationArchive.objects.select_related('piece__ssdgps').filter(
            pk=request.data.get('archive') if str(request.data.get('archive') or '').isdigit() else None
        ).first()
        if archive is None:
            return Response({'detail': 'Version introuvable.'}, status=status.HTTP_404_NOT_FOUND)
        ssdgps = self.dossier(request, archive.piece.ssdgps_id)
        refus = self.refus(ssdgps)
        if refus:
            # Une archive d'un dossier hors de vos droits : introuvable, pas « interdit ».
            return refus if ssdgps is not None else Response(
                {'detail': 'Version introuvable.'}, status=status.HTTP_404_NOT_FOUND)
        if archive.piece.is_deleted:
            return Response({'detail': 'La pièce a été supprimée.'}, status=status.HTTP_409_CONFLICT)
        with transaction.atomic():
            self.ecrire(archive.piece, archive.texte, request.user, 'restauree')
        return Response({'piece': str(archive.piece_id), 'texte': archive.texte})
