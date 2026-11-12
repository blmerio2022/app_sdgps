"""
Point d'entrée unique du journal d'audit (`accounts.models.AuditEvent`).

Pourquoi un helper plutôt que `AuditEvent.objects.create(...)` partout :

1. **Journaliser ne doit jamais casser l'action journalisée.** Si l'écriture du journal
   échoue (base indisponible, champ trop long…), on perd une trace — c'est regrettable,
   mais refuser la connexion ou la génération d'un rapport pour autant le serait
   davantage. Toute erreur est donc capturée et consignée dans les logs applicatifs.
2. **L'instantané de l'acteur** (email) et l'adresse IP sont extraits d'un seul endroit,
   de la même façon partout.
3. Les appelants restent lisibles : une ligne par événement.
"""
import logging

logger = logging.getLogger(__name__)


def adresse_ip_de(request):
    """IP de l'appelant, en tenant compte d'un éventuel proxy.

    `X-Forwarded-For` n'est digne de confiance que derrière un reverse proxy qui le
    réécrit (c'est le cas sur Railway). On prend la PREMIÈRE adresse de la liste, qui
    est celle du client d'origine.
    """
    if request is None:
        return None
    transmis = request.META.get('HTTP_X_FORWARDED_FOR')
    if transmis:
        return transmis.split(',')[0].strip() or None
    return request.META.get('REMOTE_ADDR') or None


def journaliser(action, *, request=None, acteur=None, acteur_email='',
                cible=None, cible_type='', cible_id='', cible_libelle='', **details):
    """Écrit un événement d'audit. Ne lève jamais.

    Args:
        action: une des constantes `AuditEvent.ACTION_*`.
        request: requête DRF/Django, pour l'IP et l'acteur par défaut.
        acteur: utilisateur auteur de l'action (défaut : `request.user` s'il est connecté).
        acteur_email: email à consigner quand il n'y a pas de compte (échec de connexion
            sur un email inconnu, par exemple).
        cible: objet visé — son type, son identifiant et son libellé en sont déduits.
        **details: contexte libre, sérialisable en JSON.

    Returns:
        L'`AuditEvent` créé, ou `None` si l'écriture a échoué.
    """
    from .models import AuditEvent

    try:
        if acteur is None and request is not None:
            candidat = getattr(request, 'user', None)
            if candidat is not None and getattr(candidat, 'is_authenticated', False):
                acteur = candidat

        if not acteur_email and acteur is not None:
            acteur_email = getattr(acteur, 'email', '') or ''

        if cible is not None:
            cible_type = cible_type or type(cible).__name__
            cible_id = cible_id or str(getattr(cible, 'pk', '') or '')
            cible_libelle = cible_libelle or str(cible)

        return AuditEvent.objects.create(
            action=action,
            acteur=acteur,
            acteur_email=acteur_email[:254],
            cible_type=cible_type[:64],
            cible_id=str(cible_id)[:64],
            cible_libelle=cible_libelle[:255],
            adresse_ip=adresse_ip_de(request),
            details=details or {},
        )
    except Exception:
        # Volontairement silencieux pour l'appelant : un journal d'audit en panne ne
        # doit pas empêcher l'application de fonctionner. La panne, elle, est tracée.
        logger.exception("Échec d'écriture du journal d'audit (action=%s)", action)
        return None
