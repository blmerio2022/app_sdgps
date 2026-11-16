"""
API des sauvegardes — cf. `platform_admin/sauvegardes.py`.

- lister / créer / télécharger : administration de l'application (`IsApplicationAdmin`) ;
- supprimer / restaurer : **Super Admin** seulement (opérations irréversibles) ; la
  restauration exige le nom EXACT de l'environnement.
Toutes les opérations sont journalisées (une sauvegarde contient des données nominatives
et les empreintes des mots de passe).
"""
from datetime import timedelta

from django.conf import settings
from django.http import FileResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.audit import journaliser
from accounts.models import AuditEvent
from accounts.permissions import IsApplicationAdmin

from . import sauvegardes


def _refuser_si_pas_super_admin(request):
    if not request.user.is_superuser:
        return Response({'detail': 'Réservé au Super Admin.'}, status=status.HTTP_403_FORBIDDEN)
    return None


class SauvegardesView(APIView):
    permission_classes = [IsApplicationAdmin]

    def get(self, request):
        liste = sauvegardes.lister()
        derniere = next((s for s in liste if not s['securite']), None)
        seuil = getattr(settings, 'SAUVEGARDE_ALERTE_HEURES', 36)
        en_retard = (derniere is None or derniere['date'] is None
                     or timezone.now() - derniere['date'] > timedelta(hours=seuil))
        return Response({
            'sauvegardes': liste, 'derniere': derniere, 'en_retard': en_retard,
            'alerte_heures': seuil, 'retention': getattr(settings, 'SAUVEGARDE_RETENTION', 14),
            'environnement': getattr(settings, 'ENVIRONMENT', 'development'),
            'super_admin': request.user.is_superuser,
        })

    def post(self, request):
        res = sauvegardes.creer(avec_medias=bool(request.data.get('avec_medias')))
        journaliser(AuditEvent.ACTION_SAUVEGARDE, request=request, fichier=res['nom'],
                    objets=res['objets'], medias=res['medias'])
        return Response(res, status=status.HTTP_201_CREATED)


class SauvegardeDetailView(APIView):
    permission_classes = [IsApplicationAdmin]

    def get(self, request, nom):
        """Téléchargement de l'archive."""
        try:
            fichier = sauvegardes.ouvrir(nom)
        except sauvegardes.SauvegardeErreur as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_404_NOT_FOUND)
        journaliser(AuditEvent.ACTION_SAUVEGARDE_TELECHARGEE, request=request, fichier=nom)
        reponse = FileResponse(fichier, as_attachment=True, filename=nom, content_type='application/zip')
        reponse['Access-Control-Expose-Headers'] = 'Content-Disposition'
        return reponse

    def delete(self, request, nom):
        refus = _refuser_si_pas_super_admin(request)
        if refus:
            return refus
        try:
            sauvegardes.supprimer(nom)
        except sauvegardes.SauvegardeErreur as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SauvegardeRestaurerView(APIView):
    permission_classes = [IsApplicationAdmin]

    def post(self, request, nom):
        refus = _refuser_si_pas_super_admin(request)
        if refus:
            return refus
        email = request.user.email
        try:
            res = sauvegardes.restaurer(nom, request.data.get('confirmation') or '')
        except sauvegardes.SauvegardeErreur as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        # L'acteur peut ne plus exister dans la base restaurée : on ne consigne que son email
        # (pas de clé étrangère vers un compte peut-être disparu).
        journaliser(AuditEvent.ACTION_SAUVEGARDE_RESTAUREE, acteur_email=email,
                    fichier=res['restauree'], sauvegarde_securite=res['sauvegarde_securite'])
        return Response(res)
