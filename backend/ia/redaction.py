"""
N°6 — Rédaction des textes du dossier, proposée par l'IA.

Deux textes, toujours à RELIRE avant usage — l'IA ne fait que proposer un brouillon :

1. **Observations des pièces** : la colonne « Observations » de la page de garde du
   SDGPS (`Piece.commentaire`) est, la plupart du temps, laissée en pointillés faute de
   temps. L'IA rédige pour chaque pièce une observation courte et factuelle (nombre de
   lignes, session, valeurs hors tolérance…). Une seule requête pour tout le dossier.
2. **Note de synthèse du dossier** : quelques paragraphes qui résument l'état du SDGPS
   (pièces, contrôle de cohérence, tolérances) — pour accompagner une soumission à
   validation ou répondre à un contrôleur.

Les faits sont CALCULÉS ici, par l'application (comptages, contrôle de cohérence,
tolérances de l'opérateur) : le modèle met en forme, il n'invente pas les chiffres, et
la consigne lui interdit d'affirmer ce qui ne figure pas dans les faits fournis.
Seules des données techniques partent : pas de nom de propriétaire ni de requérant.
"""
from __future__ import annotations

from .client import appeler, json_de, texte

#: Longueur maximale d'une observation : la colonne de la page de garde est étroite.
LONGUEUR_OBSERVATION = 160
LIGNES_EXEMPLE = 3

STYLE = (
    "Tu rédiges pour un dossier GPS foncier officiel marocain (ANCFCC), en français "
    "administratif sobre. Règles absolues : n'affirme RIEN qui ne figure pas dans les "
    "faits fournis ; pas de chiffre inventé ; pas de formule creuse ni d'emphase ; pas "
    "de mise en forme Markdown."
)


# ------------------------------------------------------------------------- faits

def _cellule(v):
    s = '' if v is None else str(v)
    return s if len(s) <= 40 else s[:39] + '…'


def faits_piece(piece, tolerances_config=None) -> dict:
    """Faits d'une pièce, calculés par l'application (aucune donnée nominative)."""
    from pieces.catalog import get_piece_def
    from pieces.report import piece_designation
    from pieces.tolerances import evaluer

    definition = get_piece_def(piece.type_piece)
    rows = (piece.payload or {}).get('rows') or []
    faits = {
        'id': str(piece.pk),
        'type': piece.type_piece,
        'designation': piece_designation(piece),
        'nature': definition.get('nom'),
        'statut': piece.get_statut_display(),
        'nb_lignes': len(rows),
        'session': (piece.session.numero_session if piece.session_id else None),
        'observation_actuelle': (piece.commentaire or '').strip() or None,
    }
    if piece.session_id and piece.session.date_session:
        faits['date_session'] = piece.session.date_session.strftime('%d/%m/%Y')
    nb_images = piece.images.count()
    if nb_images:
        faits['nb_images'] = nb_images
    if rows:
        _, alerte = evaluer(piece.type_piece, 'brut', rows, tolerances_config)
        if alerte:
            faits['hors_tolerance'] = alerte
        cles = list(rows[0].keys())[:8]
        faits['colonnes'] = cles
        faits['exemple'] = [{k: _cellule(r.get(k)) for k in cles} for r in rows[:LIGNES_EXEMPLE]]
    return faits


def pieces_du_dossier(ssdgps):
    from pieces.models import Piece
    from pieces.report import EXCLUDED_TYPES

    return list(Piece.objects.filter(ssdgps=ssdgps, is_deleted=False)
                .exclude(type_piece__in=EXCLUDED_TYPES)
                .select_related('session').order_by('ordre', 'type_piece', 'numero'))


def faits_coherence(ssdgps, pieces) -> dict:
    """Contrôle de cohérence du dossier entier — même logique que `report-check/`."""
    from pieces.coherence import analyser_coherence
    from pieces.models import Piece
    from projects.models import Session

    valides = [p for p in pieces if p.statut == Piece.Statut.VALIDE]
    hors = [p for p in pieces if p.statut != Piece.Statut.VALIDE]
    sessions = list(Session.objects.filter(ssdgps=ssdgps, is_deleted=False)
                    .order_by('numero_session'))
    resultat = analyser_coherence(ssdgps, valides, sessions, hors)
    return {
        'erreurs': resultat.get('erreurs', 0),
        'avertissements': resultat.get('avertissements', 0),
        'anomalies': [a.get('message') for a in resultat.get('anomalies', [])][:20],
    }


def faits_dossier(ssdgps) -> dict:
    return {
        'sdgps': f"SDGPS n°{ssdgps.numero_ssdgps}",
        'nature': ssdgps.nature_ssdgps,
        'type': ssdgps.type_ssdgps,
        'statut': ssdgps.get_statut_display(),
    }


# ------------------------------------------------------------------------- rédaction

def observations(utilisateur, ssdgps, pieces=None):
    """Brouillon d'observation pour chaque pièce du dossier (une requête).

    Returns: `{"propositions": [{piece, designation, observation}], "modele": …}`."""
    pieces = pieces if pieces is not None else pieces_du_dossier(ssdgps)
    if not pieces:
        return {'propositions': []}
    config = getattr(utilisateur, 'tolerances_config', None)
    faits = [faits_piece(p, config) for p in pieces]
    ids = [f['id'] for f in faits]
    contenu = (
        f"Dossier : {faits_dossier(ssdgps)}\n\n"
        f"Pièces (faits calculés par l'application) :\n"
        + '\n'.join(str(f) for f in faits)
        + "\n\nRédige, pour CHAQUE pièce, l'observation qui figurera dans la colonne "
          f"« Observations » de la page de garde : {LONGUEUR_OBSERVATION} caractères au "
          "maximum, une phrase nominale ou deux, factuelle (contenu, session, anomalie "
          "éventuelle comme une valeur hors tolérance). Pas de redite de la désignation. "
          "Si une pièce n'appelle aucune remarque, une observation brève et neutre suffit."
    )
    schema = {
        'type': 'object',
        'properties': {
            'observations': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'properties': {
                        'piece': {'type': 'string', 'enum': ids},
                        'observation': {'type': 'string'},
                    },
                    'required': ['piece', 'observation'],
                    'additionalProperties': False,
                },
            },
        },
        'required': ['observations'],
        'additionalProperties': False,
    }
    reponse = appeler('redaction_observations', utilisateur, system=STYLE,
                      messages=[{'role': 'user', 'content': contenu}],
                      schema=schema, effort='medium', max_tokens=12000)
    par_id = {}
    for o in json_de(reponse).get('observations') or []:
        texte_obs = ' '.join(str(o.get('observation') or '').split())
        if o.get('piece') in ids and texte_obs and o['piece'] not in par_id:
            par_id[o['piece']] = texte_obs[:LONGUEUR_OBSERVATION]
    return {
        'propositions': [
            {'piece': f['id'], 'designation': f['designation'],
             'observation_actuelle': f['observation_actuelle'] or '',
             'observation': par_id[f['id']]}
            for f in faits if f['id'] in par_id
        ],
        'modele': getattr(reponse, 'model', None),
    }


def synthese(utilisateur, ssdgps):
    """Brouillon de note de synthèse du dossier (texte brut, quelques paragraphes)."""
    pieces = pieces_du_dossier(ssdgps)
    config = getattr(utilisateur, 'tolerances_config', None)
    contenu = (
        f"Dossier : {faits_dossier(ssdgps)}\n\n"
        f"Pièces : {[faits_piece(p, config) for p in pieces] or 'aucune'}\n\n"
        f"Contrôle de cohérence : {faits_coherence(ssdgps, pieces)}\n\n"
        "Rédige une note de synthèse de ce dossier, 3 à 5 paragraphes courts : composition "
        "et état d'avancement (pièces validées / en cours), contrôles (cohérence, "
        "tolérances), puis ce qu'il reste à faire avant soumission ou validation. Commence "
        "directement par le contenu, sans titre ni formule d'appel."
    )
    reponse = appeler('redaction_synthese', utilisateur, system=STYLE,
                      messages=[{'role': 'user', 'content': contenu}],
                      effort='medium', max_tokens=8000)
    return {'texte': texte(reponse), 'modele': getattr(reponse, 'model', None)}
