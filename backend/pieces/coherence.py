"""
Contrôle de cohérence d'un SDGPS AVANT la génération du rapport.

Le rapport se rend en silence : il prend les pièces valides telles qu'elles sont et
n'alerte sur rien. Une pièce restée en brouillon en est simplement absente, une
détermination manquante laisse un trou dans la numérotation, une session sans pièce
disparaît du document. Ces défauts ne se voient qu'à la relecture du PDF — après
plusieurs minutes de rendu, et parfois seulement au contrôle du dossier.

Ce module répond donc à une seule question, sans rien modifier : **qu'est-ce qui cloche
dans ce que je m'apprête à générer ?**

Deux niveaux de gravité, et rien de bloquant :
- `erreur` — incohérence interne du dossier (trou ou doublon dans la numérotation des
  déterminations, aucune pièce à inclure). Le rapport sortirait faux ou vide ;
- `avertissement` — ce que l'opérateur ne voulait probablement pas (pièce non validée
  donc exclue, pièce attendue absente, session sans pièce, pièce vide).

Le contrôle n'interdit JAMAIS la génération : un dossier incomplet se génère
légitimement en cours d'instruction. C'est l'opérateur qui décide, en connaissance de
cause — ce que ce module lui donne.
"""
from .catalog import PIECE_CATALOG, TOUTES
from .report import EXCLUDED_TYPES

ERREUR = 'erreur'
AVERTISSEMENT = 'avertissement'


def _anomalie(code, severite, message, **extra):
    return {'code': code, 'severite': severite, 'message': message, **extra}


def types_attendus(nature_ssdgps):
    """Types de pièces que le catalogue rattache à CETTE nature de SDGPS.

    `natures` du catalogue fait foi : c'est déjà lui qui pilote l'assistant d'ajout, donc
    ce que l'opérateur se voit proposer. Les types générés par le rapport lui-même
    (page de garde) en sont exclus — les réclamer n'aurait pas de sens.
    """
    attendus = []
    for code, definition in PIECE_CATALOG.items():
        if code in EXCLUDED_TYPES:
            continue
        natures = definition.get('natures')
        if natures == TOUTES or (natures and nature_ssdgps in natures):
            attendus.append(code)
    return attendus


def _libelle_session(session):
    return f"session n°{session.numero_session}" if session is not None else 'pièces communes'


def _est_vide(piece):
    """Une pièce valide sans aucune donnée ni image : une page blanche dans le rapport."""
    payload = piece.payload or {}
    if payload.get('rows'):
        return False
    # Les pièces à base d'images ne portent rien dans `payload` : leur contenu est la
    # galerie. On ne compte une pièce comme vide que si les deux sont vides.
    return not piece.images.exists()


def analyser_coherence(ssdgps, pieces, sessions_portee, pieces_hors_rapport=()):
    """Anomalies du SDGPS pour la portée demandée, de la plus grave à la moins grave.

    Args:
        ssdgps: le SDGPS contrôlé (sa `nature_ssdgps` fixe les pièces attendues) ;
        pieces: les pièces VALIDES retenues pour le rapport, dans l'ordre du rapport ;
        sessions_portee: les sessions couvertes (vide pour un rapport sans session) ;
        pieces_hors_rapport: les pièces non supprimées de la portée qui ne sont PAS
            valides — elles n'entreront pas dans le document, ce que l'opérateur doit
            savoir avant de lancer le rendu.

    Returns:
        `{'ok': bool, 'total': int, 'erreurs': int, 'avertissements': int,
          'anomalies': [...]}`. `ok` ne vaut `True` qu'en l'absence totale d'anomalie.
    """
    anomalies = []

    # --- (1) Aucune pièce : le rapport serait vide -----------------------------------
    if not pieces:
        anomalies.append(_anomalie(
            'aucune_piece', ERREUR,
            "Aucune pièce valide à inclure : le rapport serait vide."))

    # --- (2) Numérotation des déterminations (RDN) -----------------------------------
    # Une détermination manquante au milieu d'une série est une anomalie de DOSSIER, pas
    # de rapport : les déterminations successives se suivent par construction.
    par_session = {}
    for piece in pieces:
        if piece.type_piece == 'RDN' and piece.numero:
            par_session.setdefault(piece.session_id, []).append(piece)

    for session_id, rdns in par_session.items():
        session = next((s for s in sessions_portee if s.pk == session_id), None)
        numeros = sorted(p.numero for p in rdns)
        libelle = _libelle_session(session)

        # Pas de contrôle des doublons : la contrainte d'unicité
        # (ssdgps, type_piece, numero, session) les rend impossibles en base.
        attendus = set(range(1, max(numeros) + 1))
        manquants = sorted(attendus - set(numeros))
        if manquants:
            anomalies.append(_anomalie(
                'determination_manquante', ERREUR,
                f"Trou dans la numérotation des déterminations ({libelle}) : "
                f"n°{', n°'.join(str(n) for n in manquants)} "
                f"absente(s) alors que la n°{max(numeros)} existe.",
                type_piece='RDN', session_numero=getattr(session, 'numero_session', None)))

    # --- (3) Pièces non validées : exclues du rapport sans le dire -------------------
    for piece in pieces_hors_rapport:
        anomalies.append(_anomalie(
            'piece_non_validee', AVERTISSEMENT,
            f"« {piece.get_type_piece_display()} »"
            + (f" n°{piece.numero}" if piece.numero else '')
            + f" ({_libelle_session(piece.session)}) est en statut "
              f"« {piece.get_statut_display()} » : elle ne sera PAS dans le rapport.",
            type_piece=piece.type_piece, piece_id=str(piece.pk),
            session_numero=getattr(piece.session, 'numero_session', None)))

    # --- (4) Pièces attendues absentes ------------------------------------------------
    # Regroupées en UNE anomalie : un SDGPS en début d'instruction en compterait une
    # douzaine, et douze lignes identiques noieraient les anomalies qui comptent.
    presents = {p.type_piece for p in pieces} | {p.type_piece for p in pieces_hors_rapport}
    absents = [c for c in types_attendus(ssdgps.nature_ssdgps) if c not in presents]
    if absents:
        libelles = ', '.join(f"{PIECE_CATALOG[c]['nom']} ({c})" for c in absents)
        anomalies.append(_anomalie(
            'piece_attendue_absente', AVERTISSEMENT,
            f"{len(absents)} pièce(s) prévue(s) par la nature « {ssdgps.nature_ssdgps} » "
            f"sont absentes du SDGPS : {libelles}.",
            types_pieces=absents))

    # --- (5) Sessions sans aucune pièce ----------------------------------------------
    avec_piece = {p.session_id for p in pieces if p.session_id}
    for session in sessions_portee:
        if session.pk not in avec_piece:
            anomalies.append(_anomalie(
                'session_sans_piece', AVERTISSEMENT,
                f"La session n°{session.numero_session} n'a aucune pièce valide qui lui "
                f"soit propre : elle n'apparaîtra que par les pièces communes.",
                session_numero=session.numero_session))

    # --- (6) Pièces valides mais vides ------------------------------------------------
    for piece in pieces:
        if _est_vide(piece):
            anomalies.append(_anomalie(
                'piece_vide', AVERTISSEMENT,
                f"« {piece.get_type_piece_display()} »"
                + (f" n°{piece.numero}" if piece.numero else '')
                + f" ({_libelle_session(piece.session)}) est validée mais ne contient "
                  "ni donnée ni image : sa page sortirait vide.",
                type_piece=piece.type_piece, piece_id=str(piece.pk),
                session_numero=getattr(piece.session, 'numero_session', None)))

    erreurs = sum(1 for a in anomalies if a['severite'] == ERREUR)
    return {
        'ok': not anomalies,
        'total': len(anomalies),
        'erreurs': erreurs,
        'avertissements': len(anomalies) - erreurs,
        'anomalies': anomalies,
    }
