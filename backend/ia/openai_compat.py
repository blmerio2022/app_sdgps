"""
Protocole « Chat Completions » compatible OpenAI — Google Gemini, OpenRouter, Groq,
Mistral, Cerebras… et toute passerelle qui l'expose.

Le reste de l'application parle le format de l'API Messages d'Anthropic (messages à
blocs `text` / `tool_use` / `tool_result`, outils à `input_schema`). Ce module
traduit dans les deux sens, si bien que le mapping des colonnes, la rédaction et
l'assistant fonctionnent sans changement, quel que soit le fournisseur :

- requête : `system` → message `system` ; `tool_use` → `tool_calls` ; `tool_result`
  → messages `tool` ; outils → `{"type": "function", "function": {...}}` ;
- réponse : contenu → bloc `text` (raisonnement `<think>…</think>` retiré),
  `tool_calls` → blocs `tool_use`, `finish_reason` → `stop_reason`.

HTTP par la bibliothèque standard : aucune dépendance de plus pour l'image.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from types import SimpleNamespace

_ARRETS = {'stop': 'end_turn', 'tool_calls': 'tool_use', 'function_call': 'tool_use',
           'length': 'max_tokens', 'content_filter': 'refusal'}
_PENSEE = re.compile(r'<think>.*?</think>', re.S | re.I)


class ErreurHttp(Exception):
    def __init__(self, statut, message=''):
        super().__init__(message or f'HTTP {statut}')
        self.statut = statut
        self.message = message


class ErreurConnexion(Exception):
    pass


# ------------------------------------------------------------------ traduction aller

def _attr(bloc, nom, defaut=None):
    return bloc.get(nom, defaut) if isinstance(bloc, dict) else getattr(bloc, nom, defaut)


def _texte_de(contenu):
    if isinstance(contenu, str):
        return contenu
    if isinstance(contenu, list):
        return '\n'.join(str(_attr(b, 'text', '')) for b in contenu
                         if _attr(b, 'type') == 'text')
    return str(contenu or '')


def traduire_messages(system, messages):
    """Messages au format Anthropic → messages Chat Completions."""
    sortie = [{'role': 'system', 'content': system}] if system else []
    for m in messages:
        role, contenu = m['role'], m['content']
        if isinstance(contenu, str):
            sortie.append({'role': role, 'content': contenu})
            continue
        if role == 'assistant':
            textes, appels = [], []
            for b in contenu:
                t = _attr(b, 'type')
                if t == 'text' and _attr(b, 'text'):
                    textes.append(_attr(b, 'text'))
                elif t == 'tool_use':
                    appels.append({'id': _attr(b, 'id'), 'type': 'function', 'function': {
                        'name': _attr(b, 'name'),
                        'arguments': json.dumps(_attr(b, 'input') or {}, ensure_ascii=False)}})
            message = {'role': 'assistant', 'content': '\n'.join(textes) or None}
            if appels:
                message['tool_calls'] = appels
            sortie.append(message)
        else:
            textes = []
            for b in contenu:
                if _attr(b, 'type') == 'tool_result':
                    sortie.append({'role': 'tool', 'tool_call_id': _attr(b, 'tool_use_id'),
                                   'content': _texte_de(_attr(b, 'content', ''))})
                elif _attr(b, 'type') == 'text':
                    textes.append(_attr(b, 'text', ''))
            if textes:
                sortie.append({'role': 'user', 'content': '\n'.join(textes)})
    return sortie


def traduire_outils(outils):
    return [{'type': 'function', 'function': {
        'name': o['name'], 'description': o.get('description', ''),
        'parameters': o.get('input_schema') or {'type': 'object', 'properties': {}}}}
        for o in outils or []]


# ------------------------------------------------------------------ traduction retour

def traduire_reponse(donnees):
    """Réponse Chat Completions → objet au format d'une réponse de l'API Messages."""
    choix = (donnees.get('choices') or [{}])[0]
    message = choix.get('message') or {}
    contenu = message.get('content')
    if isinstance(contenu, list):            # certains fournisseurs renvoient des parties
        contenu = ''.join(p.get('text', '') for p in contenu if isinstance(p, dict))
    texte = _PENSEE.sub('', contenu or '').strip()
    blocs = [SimpleNamespace(type='text', text=texte)] if texte else []
    for i, appel in enumerate(message.get('tool_calls') or []):
        fonction = appel.get('function') or {}
        try:
            entree = json.loads(fonction.get('arguments') or '{}')
        except ValueError:
            entree = {}
        blocs.append(SimpleNamespace(type='tool_use', id=appel.get('id') or f'appel_{i}',
                                     name=fonction.get('name'), input=entree))
    arret = _ARRETS.get(choix.get('finish_reason'), 'end_turn')
    if arret == 'end_turn' and any(b.type == 'tool_use' for b in blocs):
        arret = 'tool_use'                   # fournisseurs qui répondent « stop » malgré tout
    usage = donnees.get('usage') or {}
    return SimpleNamespace(
        content=blocs, stop_reason=arret, model=donnees.get('model'),
        usage=SimpleNamespace(input_tokens=usage.get('prompt_tokens'),
                              output_tokens=usage.get('completion_tokens')))


# ------------------------------------------------------------------ HTTP

def _requete(methode, url, cle, corps=None, delai=90):
    entetes = {'Authorization': f'Bearer {cle}', 'Content-Type': 'application/json',
               'Accept': 'application/json', 'User-Agent': 'SDGPS/1.0'}
    donnees = json.dumps(corps).encode('utf-8') if corps is not None else None
    req = urllib.request.Request(url, data=donnees, headers=entetes, method=methode)
    try:
        with urllib.request.urlopen(req, timeout=delai) as rep:
            return json.loads(rep.read().decode('utf-8') or '{}')
    except urllib.error.HTTPError as exc:
        detail = ''
        try:
            erreur = json.loads(exc.read().decode('utf-8') or '{}').get('error')
            detail = erreur.get('message', '') if isinstance(erreur, dict) else str(erreur or '')
        except Exception:  # noqa: BLE001 - corps d'erreur illisible : le code suffit
            pass
        raise ErreurHttp(exc.code, detail[:300])
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ErreurConnexion(str(exc))


def creer(base_url, cle, *, modele, messages, system=None, tools=None, max_tokens=8000,
          delai=90):
    corps = {'model': modele, 'max_tokens': max_tokens,
             'messages': traduire_messages(system, messages)}
    if tools:
        corps['tools'] = traduire_outils(tools)
    return traduire_reponse(_requete('POST', f'{base_url.rstrip("/")}/chat/completions',
                                     cle, corps, delai))


def lister_modeles(base_url, cle, delai=30):
    donnees = _requete('GET', f'{base_url.rstrip("/")}/models', cle, None, delai)
    return [m.get('id') for m in donnees.get('data') or [] if isinstance(m, dict) and m.get('id')]
