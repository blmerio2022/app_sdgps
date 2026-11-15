"""
Accès au modèle d'IA (Claude, API Anthropic) — point de passage UNIQUE de l'application.

Toutes les fonctions d'IA (mapping des colonnes à l'import, rédaction des textes du
dossier, assistant conversationnel) appellent `appeler(...)`, jamais le SDK en direct.
Ce module garantit :

- **inertie par défaut** : rien ne part tant que `settings.IA_ACTIVE` n'est pas vrai ET
  qu'une clé n'est pas fournie (`disponible()`). Les dossiers fonciers sont nominatifs :
  activer l'IA est une décision de l'organisation, pas un réglage par défaut ;
- **traçabilité** : chaque appel est inscrit au journal d'audit (`ACTION_IA_APPEL` —
  fonction, modèle, jetons consommés), succès comme échec ;
- **messages exploitables** : les erreurs du fournisseur (clé refusée, débit, panne,
  refus de sécurité) deviennent une `IaErreur` au message en français ;
- **repli en cas de refus** : le paramètre serveur `fallbacks="default"` relance la
  requête sur un autre modèle si le premier décline (bêta
  `server-side-fallback-2026-07-01`) ;
- **passerelle** (`IA_BASE_URL`, ex. OmniRoute) : en mode compatible (`IA_COMPATIBLE`),
  seul le cœur standard de l'API Messages part — la sortie structurée devient une
  consigne de format dans le prompt système, et le JSON est extrait avec tolérance.

L'IA PROPOSE, l'opérateur DÉCIDE : aucune fonction n'écrit en base sur la seule foi
d'une réponse du modèle.
"""
from __future__ import annotations

import json
import logging

from django.conf import settings

logger = logging.getLogger(__name__)

BETA_REPLI = 'server-side-fallback-2026-07-01'


class IaIndisponible(Exception):
    """L'IA n'est pas activée sur cette instance."""

    message = ("L'intelligence artificielle n'est pas activée sur cette instance "
               "(IA_ACTIVE et ANTHROPIC_API_KEY).")


class IaErreur(Exception):
    """Échec d'un appel : le message est destiné à l'opérateur."""


def disponible() -> bool:
    return bool(getattr(settings, 'IA_ACTIVE', False) and getattr(settings, 'ANTHROPIC_API_KEY', ''))


def modele() -> str:
    return getattr(settings, 'IA_MODELE', '') or 'claude-opus-5-5'


def adresse() -> str:
    """Adresse de la passerelle, ou '' pour l'API Anthropic directe."""
    return (getattr(settings, 'IA_BASE_URL', '') or '').strip().rstrip('/')


def compatible() -> bool:
    return bool(getattr(settings, 'IA_COMPATIBLE', False))


_CLIENT = None


def _client():
    """Client du SDK, construit paresseusement (l'import ne coûte rien si l'IA est éteinte)."""
    global _CLIENT
    if _CLIENT is None:
        import anthropic
        _CLIENT = anthropic.Anthropic(
            api_key=settings.ANTHROPIC_API_KEY,
            base_url=adresse() or None,          # None : API Anthropic directe
            timeout=float(getattr(settings, 'IA_DELAI', 90)),
            max_retries=2,
        )
    return _CLIENT


def reinitialiser_client():
    """Oublie le client mis en cache (tests, changement de clé)."""
    global _CLIENT
    _CLIENT = None


def _journaliser(fonction, utilisateur, reponse=None, erreur=''):
    from accounts.audit import journaliser
    from accounts.models import AuditEvent

    usage = getattr(reponse, 'usage', None)
    journaliser(
        AuditEvent.ACTION_IA_APPEL, acteur=utilisateur,
        fonction=fonction, modele=getattr(reponse, 'model', None) or modele(),
        jetons_entree=getattr(usage, 'input_tokens', None),
        jetons_sortie=getattr(usage, 'output_tokens', None),
        erreur=erreur or None,
    )


def appeler(fonction: str, utilisateur, *, messages, system=None, tools=None,
            schema=None, effort='medium', max_tokens=8000):
    """Un appel au modèle. Renvoie la réponse du SDK (objet `BetaMessage`).

    Args:
        fonction: nom court de la fonction appelante (journal d'audit).
        utilisateur: compte à l'origine de l'appel (journal d'audit).
        schema: schéma JSON de sortie — la réponse est alors un texte JSON valide.
        effort: profondeur de réflexion (`low` pour une tâche simple et fréquente).

    Raises:
        IaIndisponible: IA non activée.
        IaErreur: tout échec, avec un message pour l'opérateur.
    """
    if not disponible():
        raise IaIndisponible(IaIndisponible.message)

    import anthropic

    params = {'model': modele(), 'max_tokens': max_tokens, 'messages': messages}
    if compatible():
        # Passerelle : cœur standard seulement. Le format attendu passe par le prompt.
        if schema is not None:
            system = ((system + '\n\n') if system else '') + consigne_json(schema)
    else:
        output_config = {'effort': effort}
        if schema is not None:
            output_config['format'] = {'type': 'json_schema', 'schema': schema}
        params.update(output_config=output_config, betas=[BETA_REPLI], fallbacks='default')
    if system:
        params['system'] = system
    if tools:
        params['tools'] = tools

    try:
        api = _client().messages if compatible() else _client().beta.messages
        reponse = api.create(**params)
    except anthropic.AuthenticationError:
        _journaliser(fonction, utilisateur, erreur='authentification')
        raise IaErreur("La clé d'accès au service d'IA est refusée : contactez l'administration.")
    except anthropic.RateLimitError:
        _journaliser(fonction, utilisateur, erreur='debit')
        raise IaErreur("Le service d'IA est momentanément saturé : réessayez dans une minute.")
    except anthropic.APIConnectionError:
        _journaliser(fonction, utilisateur, erreur='connexion')
        raise IaErreur("Le service d'IA est injoignable : vérifiez la connexion du serveur.")
    except anthropic.NotFoundError:
        _journaliser(fonction, utilisateur, erreur='modele')
        raise IaErreur(f"Le modèle « {modele()} » est inconnu du service d'IA : vérifiez "
                       "IA_MODELE (python manage.py ia_verifier liste les modèles).")
    except anthropic.APIStatusError as exc:
        _journaliser(fonction, utilisateur, erreur=f'http {exc.status_code}')
        logger.warning('Appel IA %s en échec : %s', fonction, exc)
        raise IaErreur(f"Le service d'IA a renvoyé une erreur ({exc.status_code}) : réessayez.")

    _journaliser(fonction, utilisateur, reponse)
    if reponse.stop_reason == 'refusal':
        raise IaErreur("Le service d'IA a décliné cette demande.")
    return reponse


def texte(reponse) -> str:
    """Texte de la réponse (blocs `text` concaténés)."""
    return ''.join(b.text for b in reponse.content if getattr(b, 'type', '') == 'text').strip()


def consigne_json(schema) -> str:
    """Consigne de format pour un modèle sans sortie structurée (mode passerelle)."""
    return ("FORMAT DE RÉPONSE OBLIGATOIRE : réponds UNIQUEMENT par un objet JSON valide, "
            "sans texte avant ni après, sans bloc de code, conforme à ce schéma JSON :\n"
            + json.dumps(schema, ensure_ascii=False))


def extraire_json(contenu: str):
    """Objet JSON d'un texte : brut, entouré d'un bloc ```json, ou précédé d'une phrase.
    Lève `ValueError` si aucun objet n'est lisible."""
    t = (contenu or '').strip()
    if t.startswith('```'):
        t = t.split('\n', 1)[1] if '\n' in t else ''
        t = t.rsplit('```', 1)[0]
    try:
        return json.loads(t)
    except ValueError:
        debut, fin = t.find('{'), t.rfind('}')
        if debut < 0 or fin <= debut:
            raise
        return json.loads(t[debut:fin + 1])


def json_de(reponse) -> dict:
    """Réponse JSON → dict. Lève `IaErreur` si le JSON est inexploitable (réponse
    tronquée par `max_tokens`, typiquement)."""
    if reponse.stop_reason == 'max_tokens':
        raise IaErreur("La réponse du service d'IA a été tronquée : réessayez.")
    try:
        donnees = extraire_json(texte(reponse))
    except ValueError:
        raise IaErreur("La réponse du service d'IA est illisible : réessayez.")
    if not isinstance(donnees, dict):
        raise IaErreur("La réponse du service d'IA est illisible : réessayez.")
    return donnees
