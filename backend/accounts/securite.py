"""
Sécurité des comptes : double authentification (TOTP), sessions révocables, alertes.

- **TOTP (RFC 6238)** en bibliothèque standard (hmac/sha1, pas de 30 s, 6 chiffres) :
  compatible avec toutes les applications d'authentification (Google Authenticator,
  Microsoft Authenticator, FreeOTP…). Fenêtre de ±1 pas ; un pas déjà accepté ne peut pas
  être rejoué. Codes de secours : 8, hachés, à usage unique.
- **Connexion en deux temps** : mot de passe correct + double authentification active →
  pas de jeton, mais un `jeton_mfa` signé (5 min) à présenter avec le code à
  `POST /api/auth/login/mfa/`.
- **Sessions** : chaque émission de jetons crée une `SessionConnexion` dont l'id voyage
  dans le claim `sid` ; la révoquer rend ses jetons inutilisables immédiatement.
- **Alertes** : un verrouillage de compte prévient l'utilisateur et l'administration.
"""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.utils import timezone

PAS = 30
CHIFFRES = 6
FENETRE = 1
NB_CODES_SECOURS = 8
DUREE_JETON_MFA = 300
SEL_JETON_MFA = 'accounts.mfa.login'
EMETTEUR = 'SDGPS'
CACHE_SESSION = 'session_revoquee:{}'


# ----------------------------------------------------------------------------- TOTP

def nouveau_secret():
    return base64.b32encode(secrets.token_bytes(20)).decode('ascii').rstrip('=')


def _cle(secret):
    remplissage = '=' * (-len(secret) % 8)
    return base64.b32decode(secret.upper() + remplissage)


def code_au_pas(secret, pas):
    mac = hmac.new(_cle(secret), struct.pack('>Q', pas), hashlib.sha1).digest()
    decalage = mac[-1] & 0x0F
    valeur = struct.unpack('>I', mac[decalage:decalage + 4])[0] & 0x7FFFFFFF
    return str(valeur % (10 ** CHIFFRES)).zfill(CHIFFRES)


def pas_courant(instant=None):
    return int((instant if instant is not None else time.time()) // PAS)


def verifier_totp(secret, code, dernier_pas=0, instant=None):
    """Renvoie le pas accepté, ou None. Refuse un pas ≤ `dernier_pas` (rejeu)."""
    code = ''.join(c for c in str(code or '') if c.isdigit())
    if len(code) != CHIFFRES or not secret:
        return None
    courant = pas_courant(instant)
    for pas in range(courant - FENETRE, courant + FENETRE + 1):
        if pas > dernier_pas and hmac.compare_digest(code_au_pas(secret, pas), code):
            return pas
    return None


def uri_otpauth(secret, email):
    libelle = quote(f'{EMETTEUR}:{email}')
    return (f'otpauth://totp/{libelle}?secret={secret}&issuer={quote(EMETTEUR)}'
            f'&algorithm=SHA1&digits={CHIFFRES}&period={PAS}')


def _hacher_code(code):
    return hashlib.sha256(f'{settings.SECRET_KEY}:{code}'.encode()).hexdigest()


def nouveaux_codes_secours():
    """(codes en clair à montrer UNE fois, empreintes à enregistrer)."""
    codes = [f'{secrets.randbelow(10**4):04d}-{secrets.randbelow(10**4):04d}' for _ in range(NB_CODES_SECOURS)]
    return codes, [_hacher_code(c) for c in codes]


def chiffrer(texte):
    from ia.secret import chiffrer as _chiffrer
    return _chiffrer(texte)


def dechiffrer(texte):
    from ia.secret import dechiffrer as _dechiffrer
    return _dechiffrer(texte)


def mfa_active(user):
    da = getattr(user, 'double_authentification', None) if user else None
    try:
        return bool(da and da.active)
    except Exception:  # noqa: BLE001
        return False


def verifier_code(user, code):
    """Code TOTP OU code de secours (consommé). Met à jour l'anti-rejeu. Vrai si accepté."""
    from .models import DoubleAuthentification
    da = DoubleAuthentification.objects.filter(utilisateur=user, active=True).first()
    if da is None:
        return False
    secret = dechiffrer(da.secret_chiffre) if da.secret_chiffre else ''
    pas = verifier_totp(secret, code, da.dernier_pas)
    if pas is not None:
        da.dernier_pas = pas
        da.save(update_fields=['dernier_pas', 'updated_at'])
        return True
    brut = str(code or '').strip()
    empreinte = _hacher_code(brut)
    if empreinte in (da.codes_secours or []):
        da.codes_secours = [c for c in da.codes_secours if c != empreinte]
        da.save(update_fields=['codes_secours', 'updated_at'])
        return True
    return False


# ----------------------------------------------------------------- connexion en 2 temps

def jeton_mfa(user):
    return signing.dumps({'u': user.pk}, salt=SEL_JETON_MFA)


def utilisateur_du_jeton_mfa(jeton):
    from django.contrib.auth import get_user_model
    try:
        data = signing.loads(jeton or '', salt=SEL_JETON_MFA, max_age=DUREE_JETON_MFA)
    except signing.BadSignature:
        return None
    return get_user_model().objects.filter(pk=data.get('u'), is_active=True).first()


# ------------------------------------------------------------------------ sessions

def _ip(request):
    if request is None:
        return None
    transfere = request.META.get('HTTP_X_FORWARDED_FOR', '')
    ip = transfere.split(',')[0].strip() if transfere else request.META.get('REMOTE_ADDR')
    return ip or None


def emettre_jetons(user, request=None, double_auth=False):
    """Crée la session puis le couple de jetons (claims de rôle + `sid`)."""
    from rest_framework_simplejwt.settings import api_settings
    from rest_framework_simplejwt.tokens import RefreshToken
    from .models import SessionConnexion

    session = SessionConnexion.objects.create(
        utilisateur=user, adresse_ip=_ip(request),
        agent=(request.META.get('HTTP_USER_AGENT', '') if request is not None else '')[:300],
        derniere_activite=timezone.now(), double_auth=double_auth,
        expire_le=timezone.now() + api_settings.REFRESH_TOKEN_LIFETIME,
    )
    refresh = RefreshToken.for_user(user)
    # ⚠️ Instantané de la connexion : le backend ne s'y fie JAMAIS (il relit la base).
    organisation = user.get_primary_organization()
    refresh['platform_role'] = user.platform_role or ''
    refresh['role'] = user.get_primary_role()
    refresh['is_superuser'] = user.is_superuser
    refresh['org_id'] = str(organisation.id) if organisation else ''
    refresh['sid'] = str(session.id)
    return refresh, session


def session_revoquee(sid):
    """Vrai si la session est révoquée ou inconnue (mis en cache 60 s)."""
    cle = CACHE_SESSION.format(sid)
    valeur = cache.get(cle)
    if valeur is None:
        from .models import SessionConnexion
        s = SessionConnexion.objects.filter(pk=sid).only('revoquee_le').first()
        valeur = 1 if (s is None or s.revoquee_le is not None) else 0
        cache.set(cle, valeur, 60)
    return bool(valeur)


def revoquer(sessions):
    """Révoque un queryset de sessions ; renvoie le nombre révoqué."""
    ids = list(sessions.filter(revoquee_le__isnull=True).values_list('id', flat=True))
    sessions.model.objects.filter(pk__in=ids).update(revoquee_le=timezone.now())
    for sid in ids:
        cache.set(CACHE_SESSION.format(sid), 1, 60)
    return len(ids)


def toucher_session(sid):
    """Dernière activité, au plus une écriture toutes les 5 minutes par session."""
    cle = f'session_touchee:{sid}'
    if cache.get(cle):
        return
    cache.set(cle, 1, 300)
    from .models import SessionConnexion
    SessionConnexion.objects.filter(pk=sid).update(derniere_activite=timezone.now())


# ------------------------------------------------------------------------- alertes

def alerter_verrouillage(user, request=None):
    """Compte verrouillé : prévenir l'utilisateur et l'administration (jamais bloquant)."""
    try:
        from django.contrib.auth import get_user_model
        from notifications.models import Notification
        from notifications.services import notifier
        from .audit import journaliser
        from .models import AuditEvent

        ip = _ip(request) or 'inconnue'
        journaliser(AuditEvent.ACTION_ALERTE_SECURITE, request=request, acteur=user,
                    acteur_email=user.email, motif='verrouillage après échecs répétés')
        notifier([user], Notification.TYPE_SECURITE, 'Votre compte a été verrouillé',
                 f"Plusieurs tentatives de connexion échouées (adresse {ip}). Si ce n'était pas "
                 "vous, changez votre mot de passe et activez la double authentification.",
                 lien='parametres/securite')
        User = get_user_model()
        admins = User.objects.filter(is_active=True).filter(
            models_q_admins()).exclude(pk=user.pk)
        notifier(admins, Notification.TYPE_SECURITE, f'Compte verrouillé : {user.email}',
                 f"Échecs de connexion répétés depuis l'adresse {ip}.", lien='journal-audit')
    except Exception:  # noqa: BLE001
        pass


def models_q_admins():
    from django.db.models import Q
    return Q(is_superuser=True) | Q(platform_role='ROLE_ADMIN_SYSTEME')
