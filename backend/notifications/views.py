"""API des notifications : strictement PERSONNELLE (on ne voit que les siennes, admins compris)."""
from django.utils import timezone
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Notification, PreferenceNotification


def serialiser(n):
    return {
        'id': n.id, 'type': n.type, 'type_display': n.get_type_display(), 'titre': n.titre,
        'message': n.message, 'lien': n.lien, 'cible_type': n.cible_type, 'cible_id': n.cible_id,
        'acteur_nom': n.acteur_nom, 'lue': n.lue, 'lue_le': n.lue_le, 'created_at': n.created_at,
    }


class _Pagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100


class NotificationListView(APIView):
    """GET /api/v1/notifications/?non_lues=1&page=1 — ses notifications, les plus récentes d'abord."""

    def get(self, request):
        qs = Notification.objects.filter(destinataire=request.user)
        if request.query_params.get('non_lues') in ('1', 'true'):
            qs = qs.filter(lue=False)
        pagination = _Pagination()
        page = pagination.paginate_queryset(qs, request, view=self)
        reponse = pagination.get_paginated_response([serialiser(n) for n in page])
        reponse.data['non_lues'] = Notification.objects.filter(destinataire=request.user, lue=False).count()
        return reponse


class NotificationCompteView(APIView):
    """GET compte/ — nombre de non lues (sondé par la cloche)."""

    def get(self, request):
        return Response({'non_lues': Notification.objects.filter(destinataire=request.user, lue=False).count()})


class NotificationDetailView(APIView):
    def _objet(self, request, pk):
        return Notification.objects.filter(destinataire=request.user, pk=pk).first()

    def post(self, request, pk):
        """POST <id>/lue/ — marque lue (ou non lue avec {"lue": false})."""
        n = self._objet(request, pk)
        if n is None:
            return Response({'detail': 'Notification introuvable.'}, status=status.HTTP_404_NOT_FOUND)
        lue = request.data.get('lue', True) not in (False, 'false', 0, '0')
        n.lue, n.lue_le = lue, (timezone.now() if lue else None)
        n.save(update_fields=['lue', 'lue_le'])
        return Response(serialiser(n))

    def delete(self, request, pk):
        n = self._objet(request, pk)
        if n is None:
            return Response({'detail': 'Notification introuvable.'}, status=status.HTTP_404_NOT_FOUND)
        n.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class NotificationToutLuView(APIView):
    def post(self, request):
        n = Notification.objects.filter(destinataire=request.user, lue=False).update(
            lue=True, lue_le=timezone.now())
        return Response({'marquees': n})


class NotificationViderView(APIView):
    """POST vider/ — supprime ses notifications LUES."""

    def post(self, request):
        n, _ = Notification.objects.filter(destinataire=request.user, lue=True).delete()
        return Response({'supprimees': n})


class PreferenceView(APIView):
    """GET|PUT preferences/ — e-mails souhaités, globalement et par type."""

    def _etat(self, pref):
        return {
            'emails_actifs': pref.emails_actifs,
            'types': [{'type': t, 'libelle': lib, 'email': pref.email_pour(t) if pref.emails_actifs
                       else (pref.emails_par_type or {}).get(t, t in Notification.EMAIL_PAR_DEFAUT),
                       'defaut': t in Notification.EMAIL_PAR_DEFAUT}
                      for t, lib in Notification.TYPES],
        }

    def get(self, request):
        pref, _ = PreferenceNotification.objects.get_or_create(utilisateur=request.user)
        return Response(self._etat(pref))

    def put(self, request):
        pref, _ = PreferenceNotification.objects.get_or_create(utilisateur=request.user)
        if 'emails_actifs' in request.data:
            pref.emails_actifs = bool(request.data.get('emails_actifs'))
        types = request.data.get('types')
        if types is not None:
            if not isinstance(types, dict):
                return Response({'detail': '« types » doit être un objet {type: booléen}.'},
                                status=status.HTTP_400_BAD_REQUEST)
            connus = dict(Notification.TYPES)
            inconnus = [t for t in types if t not in connus]
            if inconnus:
                return Response({'detail': f"Type(s) inconnu(s) : {', '.join(inconnus)}."},
                                status=status.HTTP_400_BAD_REQUEST)
            ecarts = dict(pref.emails_par_type or {})
            for t, v in types.items():
                v = bool(v)
                if v == (t in Notification.EMAIL_PAR_DEFAUT):
                    ecarts.pop(t, None)   # seuls les écarts aux défauts sont gardés
                else:
                    ecarts[t] = v
            pref.emails_par_type = ecarts
        pref.save()
        return Response(self._etat(pref))
