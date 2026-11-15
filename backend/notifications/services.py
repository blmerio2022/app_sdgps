"""
Point de passage UNIQUE pour créer des notifications (et les e-mails qui les doublent).

`notifier(...)` ne lève JAMAIS : une notification en panne (base, SendGrid…) ne doit pas
faire échouer la transition de dossier ou le rapport qui la déclenche.
"""
import html
import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction

from .models import Notification, PreferenceNotification

logger = logging.getLogger(__name__)


def _nom(user):
    if user is None:
        return ''
    nom = f"{getattr(user, 'first_name', '') or ''} {getattr(user, 'last_name', '') or ''}".strip()
    return nom or getattr(user, 'email', '') or ''


def email_souhaite(user, type_):
    pref = PreferenceNotification.objects.filter(utilisateur=user).first()
    if pref is None:
        return type_ in Notification.EMAIL_PAR_DEFAUT
    return pref.email_pour(type_)


def _url_absolue(lien, user):
    base = (getattr(settings, 'FRONTEND_URL', '') or '').rstrip('/')
    if not base or not lien:
        return ''
    from accounts.permissions import is_application_admin
    admin = is_application_admin(user) or user.memberships.filter(
        role='ROLE_ORGANISATION_ADMIN', is_active=True).exists()
    return f"{base}/{'admin/' if admin else ''}{lien.lstrip('/')}"


def _envoyer_email(notification):
    try:
        from accounts.email_service import EmailService

        user = notification.destinataire
        url = _url_absolue(notification.lien, user)
        corps = (f"<p>Bonjour {html.escape(_nom(user))},</p>"
                 f"<p><strong>{html.escape(notification.titre)}</strong></p>"
                 + (f"<p>{html.escape(notification.message)}</p>" if notification.message else '')
                 + (f'<p><a href="{html.escape(url)}">Ouvrir dans SDGPS</a></p>' if url else '')
                 + "<p style='color:#888;font-size:12px'>Vous pouvez choisir les e-mails reçus dans "
                   "Paramètres › Notifications.</p>")
        texte = '\n\n'.join(x for x in [notification.titre, notification.message, url] if x)
        if EmailService().send_email(user.email, f"SDGPS — {notification.titre}", corps, texte):
            Notification.objects.filter(pk=notification.pk).update(email_envoye=True)
    except Exception:  # noqa: BLE001 — jamais bloquant
        logger.exception("Envoi de l'e-mail de notification impossible")


def notifier(destinataires, type_, titre, message='', lien='', cible=None, acteur=None):
    """Crée une notification par destinataire (sans doublon, jamais pour l'acteur lui-même).

    Retourne la liste des notifications créées ([] en cas d'erreur).
    """
    try:
        vus, creees = set(), []
        acteur_id = getattr(acteur, 'pk', None)
        for user in destinataires:
            if user is None or not getattr(user, 'is_active', False):
                continue
            if user.pk in vus or user.pk == acteur_id:
                continue
            vus.add(user.pk)
            n = Notification.objects.create(
                destinataire=user, type=type_, titre=titre[:200], message=message or '',
                lien=lien or '', acteur_nom=_nom(acteur)[:200],
                cible_type=(cible._meta.model_name if cible is not None else ''),
                cible_id=(str(cible.pk) if cible is not None else ''),
            )
            creees.append(n)
            if email_souhaite(user, type_):
                transaction.on_commit(lambda n=n: _envoyer_email(n))
        return creees
    except Exception:  # noqa: BLE001
        logger.exception('Création de notification impossible')
        return []


# --------------------------------------------------------------------------- dossiers

def lien_ssdgps(ssdgps):
    projet_id = ssdgps.affaire.propriete.projet_id
    return f"projets/{projet_id}/pieces/{ssdgps.pk}"


def encadrement_de(organization_id):
    """Admins de l'organisation ; à défaut, l'administration de l'application.

    Un dossier soumis dans une organisation sans Admin Organisation ne doit pas tomber
    dans le vide : l'Admin Système peut aussi le valider.
    """
    User = get_user_model()
    admins = list(User.objects.filter(
        is_active=True, memberships__organization_id=organization_id,
        memberships__role='ROLE_ORGANISATION_ADMIN', memberships__is_active=True,
    ).distinct())
    if admins:
        return admins
    return list(User.objects.filter(is_active=True, platform_role='ROLE_ADMIN_SYSTEME'))


_TRANSITION_TYPE = {
    'soumettre': Notification.TYPE_DOSSIER_SOUMIS,
    'valider': Notification.TYPE_DOSSIER_VALIDE,
    'rejeter': Notification.TYPE_DOSSIER_REJETE,
    'clore': Notification.TYPE_DOSSIER_CLOS,
    'rouvrir': Notification.TYPE_DOSSIER_ROUVERT,
}
_TRANSITION_TITRE = {
    'soumettre': '{dossier} soumis à validation',
    'valider': '{dossier} validé',
    'rejeter': '{dossier} rejeté',
    'clore': '{dossier} clos',
    'rouvrir': '{dossier} rouvert',
}


def libelle_dossier(ssdgps):
    affaire = ssdgps.affaire
    propriete = affaire.propriete
    return (f"SDGPS n°{ssdgps.numero_ssdgps} ({ssdgps.nature_ssdgps}) — "
            f"{propriete.nom_propriete}, SD {affaire.numero_sd_affaire}")


def notifier_transition(ssdgps, nom, acteur, organization_id, motif='', soumis_par=None):
    """Prévenir qui doit agir (soumission) ou qui a produit le dossier (décision)."""
    type_ = _TRANSITION_TYPE.get(nom)
    if type_ is None:
        return []
    dossier = libelle_dossier(ssdgps)
    titre = _TRANSITION_TITRE[nom].format(dossier=f"SDGPS n°{ssdgps.numero_ssdgps}")
    if nom == 'soumettre':
        destinataires = encadrement_de(organization_id)
        message = f"{dossier} attend votre décision (soumis par {_nom(acteur) or 'un opérateur'})."
    else:
        destinataires = [ssdgps.created_by, soumis_par]
        message = dossier + (f". Motif : {motif.strip()}" if motif and motif.strip() else '.')
    return notifier(destinataires, type_, titre, message, lien=lien_ssdgps(ssdgps),
                    cible=ssdgps, acteur=acteur)


def notifier_rapport(generation, reussi, erreur=''):
    ssdgps = generation.ssdgps
    if reussi:
        type_, titre = Notification.TYPE_RAPPORT_PRET, f"Rapport prêt — SDGPS n°{ssdgps.numero_ssdgps}"
        message = f"{generation.nom_fichier} est prêt à être téléchargé."
    else:
        type_, titre = Notification.TYPE_RAPPORT_ECHEC, f"Échec du rapport — SDGPS n°{ssdgps.numero_ssdgps}"
        message = erreur or 'La génération du rapport a échoué.'
    return notifier([generation.created_by], type_, titre, message,
                    lien=lien_ssdgps(ssdgps), cible=ssdgps)
