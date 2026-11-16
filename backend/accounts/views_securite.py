"""
API de sécurité des comptes — cf. `accounts/securite.py`.

- `POST /api/auth/login/mfa/` (PUBLIC, limité comme la connexion) : 2e étape de connexion ;
- `GET|POST /api/auth/me/mfa/…` : état, initier, activer, désactiver, codes de secours ;
- `GET /api/auth/me/sessions/`, `POST …/<id>/revoquer/`, `POST …/revoquer-autres/` ;
- administration de l'application : révoquer toutes les sessions d'un compte,
  réinitialiser sa double authentification (téléphone perdu).
"""
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from . import lockout
from .audit import journaliser
from .models import AuditEvent, DoubleAuthentification, SessionConnexion
from .permissions import IsApplicationAdmin
from .securite import (chiffrer, dechiffrer, emettre_jetons, nouveau_secret, nouveaux_codes_secours,
                       revoquer, uri_otpauth, utilisateur_du_jeton_mfa, verifier_code, verifier_totp,
                       alerter_verrouillage)
from .throttling import LoginIPThrottle

User = get_user_model()


def reponse_connexion(user, refresh):
    if hasattr(user, 'update_last_connection'):
        user.update_last_connection()
    return Response({
        'token': str(refresh.access_token), 'refresh_token': str(refresh),
        'user': {'id': user.id, 'email': user.email, 'first_name': user.first_name,
                 'last_name': user.last_name, 'nom_societe': getattr(user, 'nom_societe', '')},
    })


class LoginMfaView(APIView):
    """2e étape de la connexion : jeton signé de la 1re étape + code (ou code de secours)."""
    # Vue PUBLIQUE assumée : l'utilisateur n'a pas encore de jeton d'accès.
    permission_classes = [AllowAny]
    throttle_classes = [LoginIPThrottle]

    def post(self, request):
        user = utilisateur_du_jeton_mfa(request.data.get('jeton_mfa'))
        if user is None:
            return Response({'detail': 'Étape de connexion expirée : recommencez.', 'code': 'MFA_EXPIRED'},
                            status=status.HTTP_401_UNAUTHORIZED)
        if lockout.est_verrouille(user.email):
            return Response({'detail': 'Compte temporairement verrouillé.', 'code': 'ACCOUNT_LOCKED',
                             'retry_after': lockout.secondes_restantes(user.email)},
                            status=status.HTTP_403_FORBIDDEN)
        if not verifier_code(user, request.data.get('code')):
            verrouille, restantes = lockout.enregistrer_echec(user.email)
            journaliser(AuditEvent.ACTION_2FA_ECHEC, request=request, acteur=user,
                        tentatives_restantes=restantes)
            if verrouille:
                journaliser(AuditEvent.ACTION_COMPTE_VERROUILLE, request=request, acteur=user,
                            motif='codes de double authentification refusés')
                alerter_verrouillage(user, request)
                return Response({'detail': 'Compte temporairement verrouillé.', 'code': 'ACCOUNT_LOCKED',
                                 'retry_after': lockout.secondes_restantes(user.email)},
                                status=status.HTTP_403_FORBIDDEN)
            return Response({'detail': 'Code incorrect.', 'code': 'MFA_INVALID', 'remaining_attempts': restantes},
                            status=status.HTTP_401_UNAUTHORIZED)
        lockout.effacer_echecs(user.email)
        journaliser(AuditEvent.ACTION_CONNEXION, request=request, acteur=user, double_auth=True)
        refresh, _ = emettre_jetons(user, request, double_auth=True)
        return reponse_connexion(user, refresh)


def _etat_mfa(user):
    da = DoubleAuthentification.objects.filter(utilisateur=user).first()
    return {'active': bool(da and da.active), 'active_le': da.active_le if da else None,
            'codes_secours_restants': len(da.codes_secours or []) if da and da.active else 0}


class MfaEtatView(APIView):
    def get(self, request):
        return Response(_etat_mfa(request.user))


class MfaInitierView(APIView):
    """Nouveau secret (pas encore actif) : clé à saisir + lien otpauth://."""

    def post(self, request):
        da, _ = DoubleAuthentification.objects.get_or_create(utilisateur=request.user)
        if da.active:
            return Response({'detail': 'La double authentification est déjà active.'},
                            status=status.HTTP_409_CONFLICT)
        secret = nouveau_secret()
        da.secret_chiffre = chiffrer(secret)
        da.dernier_pas = 0
        da.save()
        groupes = ' '.join(secret[i:i + 4] for i in range(0, len(secret), 4))
        return Response({'secret': groupes, 'uri': uri_otpauth(secret, request.user.email)})


class MfaActiverView(APIView):
    """Confirme avec un premier code ; renvoie les codes de secours (montrés UNE fois)."""

    def post(self, request):
        da = DoubleAuthentification.objects.filter(utilisateur=request.user).first()
        if da is None or not da.secret_chiffre:
            return Response({'detail': "Commencez par générer une clé."}, status=status.HTTP_400_BAD_REQUEST)
        if da.active:
            return Response({'detail': 'La double authentification est déjà active.'},
                            status=status.HTTP_409_CONFLICT)
        pas = verifier_totp(dechiffrer(da.secret_chiffre), request.data.get('code'))
        if pas is None:
            return Response({'detail': "Code incorrect : vérifiez l'heure de votre téléphone et réessayez."},
                            status=status.HTTP_400_BAD_REQUEST)
        codes, empreintes = nouveaux_codes_secours()
        da.active, da.active_le, da.dernier_pas, da.codes_secours = True, timezone.now(), pas, empreintes
        da.save()
        journaliser(AuditEvent.ACTION_2FA_ACTIVEE, request=request, acteur=request.user)
        return Response({**_etat_mfa(request.user), 'codes_secours': codes})


class MfaDesactiverView(APIView):
    """Exige le mot de passe ET un code : une session volée ne suffit pas à la retirer."""

    def post(self, request):
        if not request.user.check_password(request.data.get('mot_de_passe') or ''):
            return Response({'detail': 'Mot de passe incorrect.'}, status=status.HTTP_400_BAD_REQUEST)
        if not verifier_code(request.user, request.data.get('code')):
            return Response({'detail': 'Code incorrect.'}, status=status.HTTP_400_BAD_REQUEST)
        DoubleAuthentification.objects.filter(utilisateur=request.user).update(
            active=False, secret_chiffre='', codes_secours=[], active_le=None)
        journaliser(AuditEvent.ACTION_2FA_DESACTIVEE, request=request, acteur=request.user)
        return Response(_etat_mfa(request.user))


class MfaCodesView(APIView):
    """Régénère les codes de secours (les anciens deviennent inutilisables)."""

    def post(self, request):
        da = DoubleAuthentification.objects.filter(utilisateur=request.user, active=True).first()
        if da is None:
            return Response({'detail': "La double authentification n'est pas active."},
                            status=status.HTTP_400_BAD_REQUEST)
        if not verifier_code(request.user, request.data.get('code')):
            return Response({'detail': 'Code incorrect.'}, status=status.HTTP_400_BAD_REQUEST)
        da.refresh_from_db()
        codes, empreintes = nouveaux_codes_secours()
        da.codes_secours = empreintes
        da.save(update_fields=['codes_secours', 'updated_at'])
        return Response({**_etat_mfa(request.user), 'codes_secours': codes})


# ------------------------------------------------------------------------ sessions

def _session_dict(s, courante=None):
    return {'id': str(s.id), 'adresse_ip': s.adresse_ip, 'agent': s.agent, 'created_at': s.created_at,
            'derniere_activite': s.derniere_activite, 'expire_le': s.expire_le,
            'double_auth': s.double_auth, 'courante': str(s.id) == str(courante or '')}


def _sid(request):
    jeton = getattr(request, 'auth', None)
    try:
        return jeton.get('sid') if jeton is not None else None
    except AttributeError:
        return None


class MesSessionsView(APIView):
    """Sessions actives (non révoquées, non expirées) de l'appelant."""

    def get(self, request):
        qs = SessionConnexion.objects.filter(utilisateur=request.user, revoquee_le__isnull=True,
                                             expire_le__gt=timezone.now())
        return Response([_session_dict(s, _sid(request)) for s in qs])


class RevoquerSessionView(APIView):
    def post(self, request, pk):
        qs = SessionConnexion.objects.filter(utilisateur=request.user, pk=pk)
        if not qs.exists():
            return Response({'detail': 'Session introuvable.'}, status=status.HTTP_404_NOT_FOUND)
        n = revoquer(qs)
        if n:
            journaliser(AuditEvent.ACTION_SESSION_REVOQUEE, request=request, acteur=request.user, session=str(pk))
        return Response({'revoquees': n})


class RevoquerAutresSessionsView(APIView):
    def post(self, request):
        qs = SessionConnexion.objects.filter(utilisateur=request.user)
        sid = _sid(request)
        if sid:
            qs = qs.exclude(pk=sid)
        n = revoquer(qs)
        if n:
            journaliser(AuditEvent.ACTION_SESSION_REVOQUEE, request=request, acteur=request.user,
                        toutes_sauf_courante=True, nombre=n)
        return Response({'revoquees': n})


class AdminSecuriteUtilisateurView(APIView):
    """
    Administration de l'application, pour un compte donné :
    GET  /api/v1/securite/utilisateurs/<id>/ — état de la 2FA et sessions actives ;
    POST …/revoquer-sessions/ — déconnecte le compte partout ;
    POST …/reinitialiser-mfa/ — retire la double authentification (téléphone perdu).
    """
    permission_classes = [IsApplicationAdmin]

    def _cible(self, pk):
        return User.objects.filter(pk=pk).first()

    def get(self, request, pk):
        cible = self._cible(pk)
        if cible is None:
            return Response({'detail': 'Utilisateur introuvable.'}, status=status.HTTP_404_NOT_FOUND)
        sessions = SessionConnexion.objects.filter(utilisateur=cible, revoquee_le__isnull=True,
                                                   expire_le__gt=timezone.now())
        return Response({'mfa': _etat_mfa(cible), 'sessions': [_session_dict(s) for s in sessions]})

    def post(self, request, pk, operation):
        cible = self._cible(pk)
        if cible is None:
            return Response({'detail': 'Utilisateur introuvable.'}, status=status.HTTP_404_NOT_FOUND)
        if cible.is_superuser and not request.user.is_superuser:
            return Response({'detail': "Seul un Super Admin agit sur la sécurité d'un Super Admin."},
                            status=status.HTTP_403_FORBIDDEN)
        if operation == 'revoquer-sessions':
            n = revoquer(SessionConnexion.objects.filter(utilisateur=cible))
            journaliser(AuditEvent.ACTION_SESSION_REVOQUEE, request=request, cible=cible,
                        cible_libelle=cible.email, par_administration=True, nombre=n)
            return Response({'revoquees': n})
        if operation == 'reinitialiser-mfa':
            DoubleAuthentification.objects.filter(utilisateur=cible).update(
                active=False, secret_chiffre='', codes_secours=[], active_le=None)
            journaliser(AuditEvent.ACTION_2FA_DESACTIVEE, request=request, cible=cible,
                        cible_libelle=cible.email, par_administration=True)
            return Response(_etat_mfa(cible))
        return Response({'detail': 'Opération inconnue.'}, status=status.HTTP_404_NOT_FOUND)
