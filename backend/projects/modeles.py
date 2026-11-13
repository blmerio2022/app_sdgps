"""
Modèles (gabarits) de SDGPS et plan de pièces d'un dossier.

Un modèle dit **quelles pièces** un SDGPS d'une nature donnée doit contenir, dans quel
ordre. Il alimente l'assistant de création : au lieu de deviner, pièce après pièce, ce
que la nature du dossier exige, l'opérateur choisit un modèle et l'application lui
présente la liste de contrôle à remplir.

Toutes les règles vivent ici :
- `pieces_par_defaut(nature)` — les pièces que le catalogue rattache à une nature ;
- `normaliser_pieces(pieces, nature)` — validation d'une liste de pièces de modèle ;
- `assurer_modeles_systeme()` — amorçage idempotent des 4 modèles de l'application ;
- `plan_du_ssdgps(ssdgps)` — état de la liste de contrôle d'un dossier (pièce importée ?
  validée ?), base de l'assistant et de son indicateur « prêt pour génération ».
"""
from django.core.exceptions import ValidationError

from pieces.catalog import PIECE_CATALOG, TOUTES

#: Types qu'un modèle ne peut pas réclamer : générés par le rapport lui-même.
TYPES_GENERES = frozenset(code for code, d in PIECE_CATALOG.items() if d['source'] == 'ui')

#: Les 4 modèles amorcés par l'application (code_systeme → nature, nom, description).
MODELES_SYSTEME = {
    'PDC': ('PDC/GPS', "Projet de densification cadastrale (PDC)",
            "Toutes les pièces requises pour un projet de densification cadastrale par GPS."),
    'DDC': ('DDC/GPS', "Dossier de densification cadastrale (DDC)",
            "Toutes les pièces requises pour un dossier de densification cadastrale par GPS."),
    'PLC': ('PLC/GPS', "Projet de levé cadastral (PLC)",
            "Toutes les pièces requises pour un projet de levé cadastral par GPS."),
    'DLC': ('DLC/GPS', "Dossier de levé cadastral (DLC)",
            "Toutes les pièces requises pour un dossier de levé cadastral par GPS."),
}


def _applicable(code, nature):
    natures = PIECE_CATALOG[code]['natures']
    return natures == TOUTES or nature in natures


def pieces_par_defaut(nature):
    """Pièces que le catalogue rattache à `nature`, dans l'ordre du catalogue (qui est
    l'ordre du rapport). Un type répétable (RDN) y figure une fois, avec le n°1."""
    out = []
    for code, d in PIECE_CATALOG.items():
        if code in TYPES_GENERES or not _applicable(code, nature):
            continue
        out.append({
            'type_piece': code,
            'numero': 1 if d.get('repeatable') else None,
            'obligatoire': True,
        })
    return out


def normaliser_pieces(pieces, nature):
    """Valide et normalise la liste de pièces d'un modèle.

    Lève `ValidationError` (message lisible) si un type est inconnu, généré par le
    rapport, non applicable à la nature, en double, ou si le numéro manque / est en trop.
    """
    if not isinstance(pieces, list) or not pieces:
        raise ValidationError("Un modèle doit contenir au moins une pièce.")
    vues, propres = set(), []
    for i, brut in enumerate(pieces, start=1):
        if not isinstance(brut, dict):
            raise ValidationError(f"Pièce n°{i} : format invalide.")
        code = brut.get('type_piece')
        if code not in PIECE_CATALOG:
            raise ValidationError(f"Pièce n°{i} : type de pièce inconnu « {code} ».")
        if code in TYPES_GENERES:
            raise ValidationError(
                f"« {PIECE_CATALOG[code]['nom']} » est générée par le rapport : "
                "elle ne peut pas figurer dans un modèle.")
        if not _applicable(code, nature):
            raise ValidationError(
                f"« {PIECE_CATALOG[code]['nom']} » ({code}) ne s'applique pas à la "
                f"nature {nature}.")
        repetable = PIECE_CATALOG[code].get('repeatable', False)
        numero = brut.get('numero')
        if repetable:
            try:
                numero = int(numero)
            except (TypeError, ValueError):
                raise ValidationError(
                    f"« {PIECE_CATALOG[code]['nom']} » est répétable : précisez son numéro.")
            if numero < 1:
                raise ValidationError(f"Pièce {code} : le numéro doit être positif.")
        else:
            numero = None
        cle = (code, numero)
        if cle in vues:
            raise ValidationError(
                f"La pièce {code}{f' n°{numero}' if numero else ''} figure deux fois.")
        vues.add(cle)
        propres.append({
            'type_piece': code, 'numero': numero,
            'obligatoire': bool(brut.get('obligatoire', True)),
        })
    return propres


def assurer_modeles_systeme(Modele=None):
    """Crée les modèles de l'application manquants (idempotent).

    Un modèle système déjà présent n'est JAMAIS réécrit : l'administration a pu l'adapter.
    `Modele` permet l'appel depuis une migration (modèle historique). Renvoie le nombre de
    modèles créés.
    """
    if Modele is None:
        from .models import ModeleSsdgps as Modele
    crees = 0
    for code, (nature, nom, description) in MODELES_SYSTEME.items():
        if Modele.objects.filter(portee='systeme', code_systeme=code).exists():
            continue
        Modele.objects.create(
            code_systeme=code, portee='systeme', nom=nom, description=description,
            nature_ssdgps=nature, type_ssdgps='mono-session',
            pieces=pieces_par_defaut(nature),
        )
        crees += 1
    return crees


def libelle_piece(code, numero=None):
    nom = PIECE_CATALOG.get(code, {}).get('nom', code)
    if numero and PIECE_CATALOG.get(code, {}).get('repeatable'):
        nom = nom.replace('N°k', f'N°{numero}')
    return nom


def plan_du_ssdgps(ssdgps):
    """État de la liste de contrôle d'un dossier.

    Chaque pièce prévue est rapprochée des pièces vivantes du dossier (même type, même
    numéro pour un type répétable). Une pièce prévue est :
    - `a_importer` : aucune pièce correspondante ;
    - `brouillon` / `rejete` : importée mais pas encore validée ;
    - `valide` : importée et validée (toutes les occurrences, pour un multi-session).

    `pret` vaut vrai quand toutes les pièces OBLIGATOIRES sont validées et qu'aucune pièce
    du dossier n'est en attente de validation : le rapport peut alors être généré complet.
    """
    pieces = list(ssdgps.pieces.filter(is_deleted=False)
                  .select_related('session').order_by('ordre'))
    prevues = ssdgps.pieces_prevues or []
    items, couvertes = [], set()
    for prevue in prevues:
        code, numero = prevue.get('type_piece'), prevue.get('numero')
        correspondantes = [
            p for p in pieces
            if p.type_piece == code and (numero is None or p.numero == numero)
        ]
        couvertes.update(p.pk for p in correspondantes)
        if not correspondantes:
            etat = 'a_importer'
        elif all(p.statut == 'valide' for p in correspondantes):
            etat = 'valide'
        elif any(p.statut == 'rejete' for p in correspondantes):
            etat = 'rejete'
        else:
            etat = 'brouillon'
        items.append({
            'type_piece': code, 'numero': numero,
            'nom': libelle_piece(code, numero),
            'obligatoire': bool(prevue.get('obligatoire', True)),
            'source': PIECE_CATALOG.get(code, {}).get('source', ''),
            'etat': etat,
            'pieces': [{'id': str(p.pk), 'statut': p.statut,
                        'session_numero': getattr(p.session, 'numero_session', None)}
                       for p in correspondantes],
        })
    hors_modele = [p for p in pieces if p.pk not in couvertes]
    obligatoires = [i for i in items if i['obligatoire']]
    non_validees = [p for p in pieces if p.statut != 'valide']
    return {
        'ssdgps': str(ssdgps.pk),
        'modele': str(ssdgps.modele_id) if ssdgps.modele_id else None,
        'modele_nom': ssdgps.modele.nom if ssdgps.modele_id else '',
        'items': items,
        'hors_modele': [{'id': str(p.pk), 'type_piece': p.type_piece, 'numero': p.numero,
                         'nom': libelle_piece(p.type_piece, p.numero), 'statut': p.statut}
                        for p in hors_modele],
        'total': len(items),
        'importees': sum(1 for i in items if i['etat'] != 'a_importer'),
        'validees': sum(1 for i in items if i['etat'] == 'valide'),
        'a_valider': len(non_validees),
        'pret': bool(pieces) and all(i['etat'] == 'valide' for i in obligatoires)
                and not non_validees,
    }
