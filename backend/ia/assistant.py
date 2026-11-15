"""
N°5 — Assistant conversationnel de l'application.

L'opérateur pose ses questions en langage courant (« Quels dossiers attendent ma
validation ? », « Où en est le SDGPS 4 de la Ferme Zaytoun ? », « Comment apposer mon
cachet ? »). L'assistant interroge l'application au moyen d'OUTILS et répond.

Sécurité — trois principes :
1. **lecture seule** : aucun outil ne modifie quoi que ce soit ;
2. **droits de l'utilisateur** : chaque outil passe par `scope_queryset`, comme les vues
   de l'API — l'assistant ne voit que ce que l'utilisateur voit déjà à l'écran ;
3. **l'utilisateur agit lui-même** : pour ouvrir un dossier ou lancer un rapport,
   l'assistant PROPOSE une action (`proposer_action`), rendue en bouton ; c'est le clic
   de l'utilisateur qui l'exécute, par les écrans habituels.

L'historique de conversation est tenu par le navigateur (texte seul) ; le serveur ne
conserve rien. Chaque tour peut enchaîner plusieurs appels d'outils (`MAX_TOURS`).
"""
from __future__ import annotations

import json

from django.db.models import Count, Q

from .client import IaErreur, appeler, texte

MAX_TOURS = 6
MAX_MESSAGES = 30
MAX_CARACTERES = 4000
LIMITE_LISTE = 25

GUIDE = """\
Tu es l'assistant de SDGPS, l'application de production des dossiers GPS fonciers
(sous-sous-dossiers GPS, « SDGPS ») de l'ANCFCC. Tu aides des géomètres-topographes.

Organisation des données : Projet > Propriété (propriété-dite, réquisition, titre) >
Affaire > SDGPS (nature PDC/DDC/PLC/DLC, mono- ou multi-session) > Pièces (LPA, ROB,
RFB, RDN, RDIA, RC, photos PPA/PPN…). Cycle de vie d'un SDGPS : en cours → soumis à
validation → validé → clos (un dossier soumis est figé ; seul l'Admin Organisation valide).

Écrans utiles :
- Projets › Assistant SDGPS : créer un dossier complet pas à pas (projet → pièces).
- Page des pièces d'un SDGPS : import des pièces (CSV/Excel, avec proposition de
  correspondance des colonnes par l'IA), validation, « Rédiger les observations » (IA),
  bouton « Rapport PDF » (contrôle de cohérence, aperçu de la page de garde,
  recto-verso, cachet et signature apposés sur les pages).
- Paramètres : tri et champs des pièces, tolérances (valeurs signalées dans le
  rapport), cachets et signatures.
- Réseau GPS : conception d'un réseau de triangulation (normes N1 à N12).

Règles :
- Réponds en français, brièvement, sans Markdown lourd (listes courtes acceptées).
- Pour toute donnée (dossiers, pièces, statuts), utilise les outils : n'invente jamais.
  Si un outil ne renvoie rien, dis-le simplement.
- Tu ne modifies rien. Quand l'utilisateur veut ouvrir un dossier, générer un rapport,
  créer un dossier ou gérer ses cachets, appelle `proposer_action` : un bouton lui sera
  présenté, c'est lui qui clique.
- Hors du périmètre de l'application, réponds poliment que tu ne peux pas aider.
"""

ACTIONS = {
    'ouvrir_dossier': 'Ouvrir le dossier',
    'generer_rapport': 'Générer le rapport PDF',
    'creer_dossier': "Ouvrir l'assistant de création",
    'gerer_cachets': 'Gérer mes cachets',
    'ouvrir_reseau_gps': 'Ouvrir le module Réseau GPS',
    'regler_tolerances': 'Régler mes tolérances',
}
ACTIONS_SUR_DOSSIER = {'ouvrir_dossier', 'generer_rapport'}


def _outil(nom, description, proprietes, requis=()):
    return {'name': nom, 'description': description,
            'input_schema': {'type': 'object', 'properties': proprietes,
                             'required': list(requis), 'additionalProperties': False}}


def outils():
    from projects.models import Ssdgps
    statuts = [c for c, _ in Ssdgps.Statut.choices]
    return [
        _outil('chercher_dossiers',
               "Liste les SDGPS visibles par l'utilisateur, du plus récent au plus ancien. "
               "Filtre facultatif par texte (propriété, titre, réquisition, code ou nom de "
               "projet, n° de SDGPS) et par statut.",
               {'texte': {'type': 'string', 'description': 'Texte recherché.'},
                'statut': {'type': 'string', 'enum': statuts},
                'limite': {'type': 'integer', 'minimum': 1, 'maximum': LIMITE_LISTE}}),
        _outil('detail_dossier',
               "Détail d'un SDGPS : propriété, sessions, pièces (type, statut), transitions "
               "de statut ouvertes à l'utilisateur.",
               {'ssdgps_id': {'type': 'string'}}, ['ssdgps_id']),
        _outil('controle_coherence',
               "Contrôle de cohérence d'un SDGPS (pièces manquantes ou non validées, trous "
               "de numérotation…), comme avant la génération du rapport.",
               {'ssdgps_id': {'type': 'string'}}, ['ssdgps_id']),
        _outil('tableau_de_bord',
               "Comptes des SDGPS de l'utilisateur par statut, et dossiers soumis qui "
               "attendent une validation.", {}),
        _outil('proposer_action',
               "Propose à l'utilisateur un bouton d'action (il clique lui-même). "
               "`ssdgps_id` est requis pour ouvrir_dossier et generer_rapport.",
               {'action': {'type': 'string', 'enum': list(ACTIONS)},
                'ssdgps_id': {'type': 'string'},
                'libelle': {'type': 'string', 'description': 'Libellé court du bouton.'}},
               ['action']),
    ]


# ------------------------------------------------------------------------- données

def _dossiers(utilisateur):
    from projects.models import Ssdgps
    from projects.views import scope_queryset
    qs = Ssdgps.objects.filter(is_deleted=False).select_related(
        'affaire__propriete__projet')
    return scope_queryset(qs, utilisateur, 'affaire__propriete__projet__organization_id')


def _dossier(utilisateur, ssdgps_id):
    import uuid
    try:
        uuid.UUID(str(ssdgps_id))
    except ValueError:
        return None
    return _dossiers(utilisateur).filter(pk=ssdgps_id).first()


def _resume(s):
    propriete = s.affaire.propriete
    return {
        'id': str(s.pk), 'sdgps': f"SDGPS n°{s.numero_ssdgps}", 'nature': s.nature_ssdgps,
        'type': s.type_ssdgps, 'statut': s.get_statut_display(),
        'propriete': propriete.nom_propriete, 'titre': propriete.id_titre or None,
        'projet': propriete.projet.nom_projet, 'code_projet': propriete.projet.code_projet,
    }


def chercher_dossiers(utilisateur, texte_recherche=None, statut=None, limite=10):
    qs = _dossiers(utilisateur)
    if statut:
        qs = qs.filter(statut=statut)
    if texte_recherche:
        t = str(texte_recherche).strip()
        filtre = (Q(affaire__propriete__nom_propriete__icontains=t)
                  | Q(affaire__propriete__id_titre__icontains=t)
                  | Q(affaire__propriete__id_requisition__icontains=t)
                  | Q(affaire__propriete__projet__nom_projet__icontains=t)
                  | Q(affaire__propriete__projet__code_projet__icontains=t))
        chiffres = ''.join(c for c in t if c.isdigit())
        if chiffres and len(chiffres) <= 6:
            filtre |= Q(numero_ssdgps=int(chiffres))
        qs = qs.filter(filtre)
    limite = max(1, min(int(limite or 10), LIMITE_LISTE))
    qs = qs.annotate(
        nb_pieces=Count('pieces', filter=Q(pieces__is_deleted=False), distinct=True),
        nb_validees=Count('pieces', filter=Q(pieces__is_deleted=False,
                                             pieces__statut='valide'), distinct=True),
    ).order_by('-updated_at')
    total = qs.count()
    return {'total': total, 'dossiers': [
        {**_resume(s), 'pieces': s.nb_pieces, 'pieces_validees': s.nb_validees}
        for s in qs[:limite]]}


def detail_dossier(utilisateur, ssdgps_id):
    from projects.workflow import transitions_possibles
    from pieces.report import piece_designation
    from projects.models import Session

    s = _dossier(utilisateur, ssdgps_id)
    if s is None:
        return {'erreur': 'Dossier introuvable ou hors de vos droits.'}
    pieces = s.pieces.filter(is_deleted=False).select_related('session').order_by(
        'ordre', 'type_piece', 'numero')
    projet = s.affaire.propriete.projet
    return {
        **_resume(s),
        'motif_statut': s.motif_statut or None,
        'sessions': [{'numero': x.numero_session,
                      'date': x.date_session.strftime('%d/%m/%Y') if x.date_session else None}
                     for x in Session.objects.filter(ssdgps=s, is_deleted=False)
                     .order_by('numero_session')],
        'pieces': [{'designation': piece_designation(p), 'type': p.type_piece,
                    'statut': p.get_statut_display(),
                    'session': p.session.numero_session if p.session_id else None}
                   for p in pieces],
        'transitions_possibles': transitions_possibles(s, utilisateur, projet.organization_id),
    }


def controle_coherence(utilisateur, ssdgps_id):
    from .redaction import faits_coherence, pieces_du_dossier
    s = _dossier(utilisateur, ssdgps_id)
    if s is None:
        return {'erreur': 'Dossier introuvable ou hors de vos droits.'}
    return faits_coherence(s, pieces_du_dossier(s))


def tableau_de_bord(utilisateur):
    from projects.workflow import est_encadrement
    qs = _dossiers(utilisateur)
    par_statut = {}
    for s in qs.values('statut').annotate(n=Count('id')):
        par_statut[s['statut']] = s['n']
    a_valider = [_resume(s) for s in qs.filter(statut='soumis').order_by('-statut_change_at')[:10]
                 if est_encadrement(utilisateur, s.affaire.propriete.projet.organization_id)]
    return {'par_statut': par_statut, 'a_valider_par_vous': a_valider}


def route_action(utilisateur, action, ssdgps_id=None):
    """Chemin (relatif, sans préfixe /admin) ouvert par une action — ou None si
    l'action est invalide ou vise un dossier hors des droits de l'utilisateur."""
    if action not in ACTIONS:
        return None
    if action in ACTIONS_SUR_DOSSIER:
        s = _dossier(utilisateur, ssdgps_id)
        if s is None:
            return None
        base = f"projets/{s.affaire.propriete.projet_id}/pieces/{s.pk}"
        return base + ('?rapport=1' if action == 'generer_rapport' else '')
    return {
        'creer_dossier': 'projets/assistant',
        'gerer_cachets': 'parametres/cachets-signatures',
        'ouvrir_reseau_gps': 'reseau-gps',
        'regler_tolerances': 'parametres/tolerances',
    }[action]


def executer_outil(utilisateur, nom, entree, actions):
    """Exécute un outil ; renvoie le contenu texte (JSON) de son résultat."""
    entree = entree or {}
    try:
        if nom == 'chercher_dossiers':
            r = chercher_dossiers(utilisateur, entree.get('texte'), entree.get('statut'),
                                  entree.get('limite') or 10)
        elif nom == 'detail_dossier':
            r = detail_dossier(utilisateur, entree.get('ssdgps_id'))
        elif nom == 'controle_coherence':
            r = controle_coherence(utilisateur, entree.get('ssdgps_id'))
        elif nom == 'tableau_de_bord':
            r = tableau_de_bord(utilisateur)
        elif nom == 'proposer_action':
            action = entree.get('action')
            route = route_action(utilisateur, action, entree.get('ssdgps_id'))
            if route is None:
                r = {'erreur': 'Action impossible : dossier introuvable ou action inconnue.'}
            else:
                libelle = str(entree.get('libelle') or ACTIONS[action])[:60]
                if all(a['route'] != route for a in actions):
                    actions.append({'action': action, 'libelle': libelle, 'route': route})
                r = {'ok': True, 'message': "Le bouton est présenté à l'utilisateur."}
        else:
            r = {'erreur': f'Outil inconnu : {nom}'}
    except Exception as exc:  # noqa: BLE001 - un outil en panne ne doit pas casser la réponse
        r = {'erreur': f"L'outil a échoué ({type(exc).__name__})."}
    return json.dumps(r, ensure_ascii=False, default=str)


# ------------------------------------------------------------------------- dialogue

def valider_historique(messages):
    """Historique reçu du navigateur → messages API (texte seul, rôles alternés,
    commençant et finissant par l'utilisateur). Lève `ValueError` sinon."""
    if not isinstance(messages, list) or not messages:
        raise ValueError('La conversation est vide.')
    propres = []
    for m in messages[-MAX_MESSAGES:]:
        if not isinstance(m, dict) or m.get('role') not in ('user', 'assistant'):
            raise ValueError('Message de conversation invalide.')
        contenu = str(m.get('content') or '').strip()
        if not contenu:
            continue
        if len(contenu) > MAX_CARACTERES:
            raise ValueError(f'Message trop long ({MAX_CARACTERES} caractères au maximum).')
        if propres and propres[-1]['role'] == m['role']:
            propres[-1]['content'] += '\n\n' + contenu
        else:
            propres.append({'role': m['role'], 'content': contenu})
    while propres and propres[0]['role'] != 'user':
        propres.pop(0)
    if not propres or propres[-1]['role'] != 'user':
        raise ValueError("La conversation doit se terminer par un message de l'utilisateur.")
    return propres


def repondre(utilisateur, historique):
    """Un tour de conversation. Renvoie `{reponse, actions, outils}`."""
    messages = valider_historique(historique)
    prenom = (getattr(utilisateur, 'first_name', '') or '').strip()
    system = GUIDE + (f"\nL'utilisateur s'appelle {prenom}." if prenom else '')
    definitions = outils()
    actions, utilises = [], []

    for _ in range(MAX_TOURS):
        reponse = appeler('assistant', utilisateur, system=system, tools=definitions,
                          messages=messages, effort='medium', max_tokens=8000)
        if reponse.stop_reason == 'pause_turn':
            messages.append({'role': 'assistant', 'content': reponse.content})
            continue
        appels = [b for b in reponse.content if getattr(b, 'type', '') == 'tool_use']
        if reponse.stop_reason != 'tool_use' or not appels:
            return {'reponse': texte(reponse) or "Je n'ai pas de réponse à proposer.",
                    'actions': actions, 'outils': utilises}
        messages.append({'role': 'assistant', 'content': reponse.content})
        resultats = []
        for appel in appels:
            utilises.append(appel.name)
            resultats.append({'type': 'tool_result', 'tool_use_id': appel.id,
                              'content': executer_outil(utilisateur, appel.name,
                                                        appel.input, actions)})
        messages.append({'role': 'user', 'content': resultats})

    raise IaErreur("L'assistant n'a pas abouti dans le temps imparti : reformulez la question.")
