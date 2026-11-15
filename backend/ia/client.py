"""
Accès au modèle d'IA — point de passage UNIQUE de l'application.

Toutes les fonctions d'IA (mapping des colonnes à l'import, rédaction des textes du
dossier, assistant conversationnel) appellent `appeler(...)`, jamais un SDK en direct.
Ce module garantit :

- **inertie par défaut** : rien ne part tant que `settings.IA_ACTIVE` n'est pas vrai ET
  qu'une clé n'est pas fournie (`disponible()`). Les dossiers fonciers sont nominatifs :
  activer l'IA est une décision de l'organisation, pas un réglage par défaut ;
- **plusieurs fournisseurs** (`IA_FOURNISSEUR`, cf. `fournisseurs.py`) : Anthropic et
  les passerelles qui parlent son API Messages (OmniRoute) par le SDK officiel ; Google
  Gemini, OpenRouter, Groq, Mistral… par le protocole « Chat Completions » compatible
  OpenAI (`openai_compat.py`). Les réponses ont toujours la même forme : les fonctions
  appelantes ignorent quel fournisseur a répondu ;
- **modèles de secours** (`IA_MODELES_SECOURS`) : sur un quota épuisé, un modèle
  inconnu ou une panne du fournisseur, le modèle suivant est essayé — précieux avec
  les offres gratuites, aux limites de débit serrées ;
- **traçabilité** : chaque appel est inscrit au journal d'audit (`ACTION_IA_APPEL` —
  fonction, modèle, jetons consommés), succès comme échec ;
- **messages exploitables** : les erreurs du fournisseur (clé refusée, débit, panne,
  refus de sécurité) deviennent une `IaErreur` au message en français ;
- **API Anthropic directe** : repli serveur en cas de refus (`fallbacks="default"`,
  bêta `server-side-fallback-2026-07-01`), effort et sortie structurée ;
- **mode compatible** (passerelle, protocole OpenAI) : seul le cœur standard part — la
  sortie structurée devient une consigne de format dans le prompt système, et le JSON
  est extrait avec tolérance.

L'IA PROPOSE, l'opérateur DÉCIDE : aucune fonction n'écrit en base sur la seule foi
d'une réponse du modèle.
"""
from __future__ import annotations

import json
import logging

from django.conf import settings

from . import fournisseurs, openai_compat

logger = logging.getLogger(__name__)

BETA_REPLI = 'server-side-fallback-2026-07-01'
MODELE_PAR_DEFAUT = 'claude-opus-5-5'


class IaIndisponible(Exception):
    """L'IA n'est pas activée sur cette instance."""

    message = ("L'intelligence artificielle n'est pas activée sur cette instance "
               "(IA_ACTIVE et la clé du fournisseur, IA_CLE).")


class IaErreur(Exception):
    """Échec d'un appel : le message est destiné à l'opérateur."""


# ------------------------------------------------------------------ configuration

def _reglage(nom, defaut=''):
    valeur = getattr(settings, nom, defaut)
    return valeur.strip() if isinstance(valeur, str) else valeur


def fournisseur():
    """Fournisseur choisi (`IA_FOURNISSEUR`), ou None : API Anthropic / adresse libre."""
    return fournisseurs.fournisseur(_reglage('IA_FOURNISSEUR'))


def protocole() -> str:
    f = fournisseur()
    return (_reglage('IA_PROTOCOLE') or (f.protocole if f else 'anthropic')).lower()


def adresse() -> str:
    """Adresse du service (passerelle ou fournisseur), ou '' pour l'API Anthropic directe."""
    f = fournisseur()
    return (_reglage('IA_BASE_URL') or (f.base_url if f else '')).rstrip('/')


def modele() -> str:
    f = fournisseur()
    return _reglage('IA_MODELE') or (f.modele if f else '') or MODELE_PAR_DEFAUT


def cle() -> str:
    """Clé du fournisseur : `IA_CLE`, ou `ANTHROPIC_API_KEY` (compatibilité)."""
    return _reglage('IA_CLE') or _reglage('ANTHROPIC_API_KEY')


def modeles_essai() -> list:
    """Le modèle principal, puis les modèles de secours, sans doublon."""
    brut = _reglage('IA_MODELES_SECOURS') or []
    secours = [m.strip() for m in (brut.split(',') if isinstance(brut, str) else brut)]
    ordre = [modele()] + [m for m in secours if m]
    return list(dict.fromkeys(ordre))


def compatible() -> bool:
    """Cœur standard seulement (ni bêta, ni output_config) : protocole OpenAI, passerelle,
    ou tout fournisseur autre qu'Anthropic."""
    if protocole() == 'openai':
        return True
    f = fournisseur()
    return bool(_reglage('IA_COMPATIBLE', False) or (f is not None and f.cle != 'anthropic'))


def disponible() -> bool:
    return bool(_reglage('IA_ACTIVE', False) and cle())


_CLIENT = None


def _client():
    """Client du SDK Anthropic, construit paresseusement (l'import ne coûte rien si l'IA
    est éteinte ou si le fournisseur parle le protocole OpenAI)."""
    global _CLIENT
    if _CLIENT is None:
        import anthropic
        _CLIENT = anthropic.Anthropic(
            api_key=cle(),
            base_url=adresse() or None,          # None : API Anthropic directe
            timeout=float(_reglage('IA_DELAI', 90) or 90),
            max_retries=2,
        )
    return _CLIENT


def reinitialiser_client():
    """Oublie le client mis en cache (tests, changement de clé)."""
    global _CLIENT
    _CLIENT = None


def _journaliser(fonction, utilisateur, reponse=None, erreur='', modele_essaye=None):
    from accounts.audit import journaliser
    from accounts.models import AuditEvent

    usage = getattr(reponse, 'usage', None)
    journaliser(
        AuditEvent.ACTION_IA_APPEL, acteur=utilisateur,
        fonction=fonction, modele=getattr(reponse, 'model', None) or modele_essaye or modele(),
        fournisseur=(fournisseur().cle if fournisseur() else None),
        jetons_entree=getattr(usage, 'input_tokens', None),
        jetons_sortie=getattr(usage, 'output_tokens', None),
        erreur=erreur or None,
    )


# ------------------------------------------------------------------ appel

class _Echec(Exception):
    """Échec d'une tentative : `reessayable` = un autre modèle peut réussir."""

    def __init__(self, code, message, reessayable):
        super().__init__(message)
        self.code, self.message, self.reessayable = code, message, reessayable


def _echec_http(statut, nom_modele, detail=''):
    if statut in (401, 403):
        return _Echec('authentification',
                      "La clé d'accès au service d'IA est refusée : contactez l'administration.",
                      False)
    if statut == 429:
        return _Echec('debit', "Le service d'IA est momentanément saturé (quota ou débit) : "
                               "réessayez dans une minute.", True)
    if statut == 404:
        return _Echec('modele', f"Le modèle « {nom_modele} » est inconnu du service d'IA : "
                                "vérifiez IA_MODELE (python manage.py ia_verifier liste les "
                                "modèles).", True)
    message = f"Le service d'IA a renvoyé une erreur ({statut}) : réessayez."
    if detail:
        logger.warning('IA, modèle %s : HTTP %s — %s', nom_modele, statut, detail)
    # 400 : souvent une capacité absente de CE modèle (outils…) — un autre peut réussir.
    return _Echec(f'http {statut}', message, statut >= 500 or statut == 400)


def _tentative_anthropic(nom_modele, *, messages, system, tools, schema, effort, max_tokens):
    import anthropic

    params = {'model': nom_modele, 'max_tokens': max_tokens, 'messages': messages}
    if compatible():
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
        return api.create(**params)
    except anthropic.APIConnectionError:
        raise _Echec('connexion', "Le service d'IA est injoignable : vérifiez la connexion "
                                  "du serveur.", False)
    except anthropic.APIStatusError as exc:
        raise _echec_http(exc.status_code, nom_modele, str(exc))


def _tentative_openai(nom_modele, *, messages, system, tools, schema, effort, max_tokens):
    if schema is not None:
        system = ((system + '\n\n') if system else '') + consigne_json(schema)
    try:
        return openai_compat.creer(adresse(), cle(), modele=nom_modele, messages=messages,
                                   system=system, tools=tools, max_tokens=max_tokens,
                                   delai=float(_reglage('IA_DELAI', 90) or 90))
    except openai_compat.ErreurConnexion:
        raise _Echec('connexion', "Le service d'IA est injoignable : vérifiez la connexion "
                                  "du serveur.", False)
    except openai_compat.ErreurHttp as exc:
        raise _echec_http(exc.statut, nom_modele, exc.message)


def appeler(fonction: str, utilisateur, *, messages, system=None, tools=None,
            schema=None, effort='medium', max_tokens=8000):
    """Un appel au modèle. Renvoie une réponse au format de l'API Messages d'Anthropic
    (`content` à blocs `text` / `tool_use`, `stop_reason`, `model`, `usage`).

    Le modèle principal est essayé d'abord, puis chaque modèle de secours tant que
    l'échec peut venir du modèle lui-même (quota, modèle inconnu, panne, refus).

    Args:
        fonction: nom court de la fonction appelante (journal d'audit).
        utilisateur: compte à l'origine de l'appel (journal d'audit).
        schema: schéma JSON de sortie — la réponse est alors un texte JSON valide.
        effort: profondeur de réflexion (API Anthropic directe uniquement).

    Raises:
        IaIndisponible: IA non activée.
        IaErreur: tout échec, avec un message pour l'opérateur.
    """
    if not disponible():
        raise IaIndisponible(IaIndisponible.message)

    tentative = _tentative_openai if protocole() == 'openai' else _tentative_anthropic
    essais = modeles_essai()
    for rang, nom_modele in enumerate(essais):
        dernier = rang == len(essais) - 1
        try:
            reponse = tentative(nom_modele, messages=messages, system=system, tools=tools,
                                schema=schema, effort=effort, max_tokens=max_tokens)
        except _Echec as echec:
            _journaliser(fonction, utilisateur, erreur=echec.code, modele_essaye=nom_modele)
            if echec.reessayable and not dernier:
                continue
            raise IaErreur(echec.message)
        _journaliser(fonction, utilisateur, reponse, modele_essaye=nom_modele)
        if reponse.stop_reason == 'refusal':
            if not dernier:
                continue
            raise IaErreur("Le service d'IA a décliné cette demande.")
        return reponse
    raise IaErreur("Aucun modèle n'a pu répondre.")   # garde-fou : liste vide impossible


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
