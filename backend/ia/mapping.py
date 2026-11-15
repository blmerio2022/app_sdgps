"""
N°4 — Correspondance des colonnes à l'import, proposée par l'IA.

L'import d'une pièce associe chaque champ du catalogue à une colonne du fichier. La
correspondance automatique existante (libellés normalisés, inclusion) échoue dès que le
fichier vient d'un autre logiciel ou d'une autre langue (« Ant. Height », « Hauteur
d'antenne (m) », « HI »…). L'IA lit les en-têtes ET quelques lignes d'exemple, et
propose les associations manquantes, chacune avec un niveau de confiance et sa raison.

Garde-fous :
- l'IA ne fait que COMPLÉTER : les champs déjà associés (par l'opérateur ou la
  correspondance automatique) sont fixes, leurs colonnes réservées ;
- la réponse est contrainte par un schéma (champs et colonnes en énumération) puis
  re-validée ici : pas de champ inventé, pas de colonne inventée, une colonne au plus
  par champ ;
- seuls les en-têtes et 5 lignes tronquées sont envoyés — rien n'est enregistré.
"""
from __future__ import annotations

from .client import appeler, json_de

MAX_COLONNES = 120
MAX_LIGNES = 5
MAX_CELLULE = 60
CONFIANCES = ('haute', 'moyenne', 'faible')
_RANG = {c: i for i, c in enumerate(CONFIANCES)}

SYSTEM = (
    "Tu aides un opérateur géomètre-topographe à importer un tableau (CSV ou Excel) dans "
    "une application de dossiers GPS fonciers marocains (ANCFCC). Ton rôle : associer les "
    "champs attendus par l'application aux colonnes du fichier.\n"
    "Règles :\n"
    "- Appuie-toi sur les en-têtes ET sur les valeurs d'exemple (unités, formats de "
    "date/heure, coordonnées Lambert en mètres, durées hh:mm:ss, noms de points…).\n"
    "- Une colonne ne sert qu'à un seul champ. Les colonnes déjà associées sont "
    "indisponibles.\n"
    "- N'associe que si c'est défendable : sinon, colonne vide. Mieux vaut un champ "
    "laissé à l'opérateur qu'une mauvaise association.\n"
    "- « haute » = en-tête et valeurs concordent sans ambiguïté ; « moyenne » = probable ; "
    "« faible » = plausible mais à vérifier.\n"
    "- La raison tient en une phrase courte, en français."
)


def _tronquer(v) -> str:
    s = '' if v is None else str(v)
    return s if len(s) <= MAX_CELLULE else s[:MAX_CELLULE - 1] + '…'


def proposer(utilisateur, *, type_libelle, champs, colonnes, lignes, deja=None):
    """Propose les associations manquantes.

    Args:
        champs: champs cibles du catalogue (dicts `name`, `label`, `type`,
            `description` éventuelle) — déjà filtrés sur la vue d'import de l'opérateur.
        colonnes: en-têtes du fichier.
        lignes: lignes d'exemple (listes alignées sur `colonnes`).
        deja: associations déjà faites `{champ: colonne}` — conservées telles quelles.

    Returns:
        `{"propositions": [{champ, colonne, confiance, raison}], "modele": ...}` —
        uniquement des associations nouvelles et valides.
    """
    deja = {k: v for k, v in (deja or {}).items() if v}
    colonnes = [str(c) for c in colonnes][:MAX_COLONNES]
    noms_champs = {c['name'] for c in champs}
    libres_champs = [c for c in champs if c['name'] not in deja]
    prises = set(deja.values())
    libres_colonnes = [c for c in colonnes if c not in prises]
    if not libres_champs or not libres_colonnes:
        return {'propositions': []}

    exemple = [[_tronquer(v) for v in (ligne or [])[:len(colonnes)]]
               for ligne in (lignes or [])[:MAX_LIGNES]]
    description = '\n'.join(
        f"- {c['name']} : « {c.get('label') or c['name']} » ({c.get('type') or 'texte'})"
        + (f" — {c['description']}" if c.get('description') else '')
        for c in libres_champs
    )
    contenu = (
        f"Pièce : {type_libelle}\n\n"
        f"Champs à associer :\n{description}\n\n"
        f"Colonnes du fichier (toutes, dans l'ordre) : {colonnes}\n"
        f"Colonnes encore disponibles : {libres_colonnes}\n"
        f"Associations déjà faites (fixes) : {deja or 'aucune'}\n\n"
        f"Lignes d'exemple (alignées sur les colonnes) :\n"
        + '\n'.join(str(l) for l in exemple)
    )

    schema = {
        'type': 'object',
        'properties': {
            'correspondances': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'properties': {
                        'champ': {'type': 'string', 'enum': [c['name'] for c in libres_champs]},
                        'colonne': {'type': 'string', 'enum': [''] + libres_colonnes},
                        'confiance': {'type': 'string', 'enum': list(CONFIANCES)},
                        'raison': {'type': 'string'},
                    },
                    'required': ['champ', 'colonne', 'confiance', 'raison'],
                    'additionalProperties': False,
                },
            },
        },
        'required': ['correspondances'],
        'additionalProperties': False,
    }
    reponse = appeler('mapping_colonnes', utilisateur, system=SYSTEM,
                      messages=[{'role': 'user', 'content': contenu}],
                      schema=schema, effort='low', max_tokens=6000)
    brut = json_de(reponse).get('correspondances') or []
    return {'propositions': filtrer(brut, noms_champs, deja, libres_colonnes),
            'modele': getattr(reponse, 'model', None)}


def filtrer(brut, noms_champs, deja, libres_colonnes):
    """Re-valide la réponse : champ connu et libre, colonne disponible, une colonne par
    champ et un champ par colonne (la plus sûre l'emporte)."""
    libres = set(libres_colonnes)
    candidats = []
    for p in brut:
        champ, colonne = p.get('champ'), p.get('colonne')
        confiance = p.get('confiance') if p.get('confiance') in CONFIANCES else 'faible'
        if champ in noms_champs and champ not in deja and colonne in libres:
            candidats.append({'champ': champ, 'colonne': colonne, 'confiance': confiance,
                              'raison': str(p.get('raison') or '')[:240]})
    candidats.sort(key=lambda p: _RANG[p['confiance']])
    retenus, champs_vus, colonnes_vues = [], set(), set()
    for p in candidats:
        if p['champ'] in champs_vus or p['colonne'] in colonnes_vues:
            continue
        champs_vus.add(p['champ'])
        colonnes_vues.add(p['colonne'])
        retenus.append(p)
    return retenus
