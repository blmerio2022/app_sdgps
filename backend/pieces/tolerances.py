"""
Tolérances de l'opérateur sur les valeurs des pièces d'un rapport SDGPS.

Une valeur hors tolérance (observation trop courte, boucle non tolérable, écart trop
grand…) doit sauter aux yeux du lecteur du rapport. Chaque opérateur règle ses seuils
dans ses paramètres (`CustomUser.tolerances_config`) ; les seuils absents prennent les
valeurs par défaut ci-dessous. Le module ne fait qu'ÉVALUER : le rendu (style des
cellules, légende) est dans `report.py` et le gabarit.

Règles couvertes à ce stade (d'autres viendront : ajouter une entrée à `DEFAUTS`, sa
validation dans `normaliser`, et son évaluation dans `evaluer`) :

- `rob_duree`  — Rapport des observations brutes : durée d'observation minimale selon le
  mode (statique / stop and go), lu dans la colonne « Type » ;
- `rtlb_duree` — Rapport du traitement des lignes de base : durée d'un vecteur, selon la
  colonne « Méthode terrain » ;
- `rfb_fermeture` — Fermeture des boucles : Δ3D au-delà de la tolérance de la boucle, ou
  colonne « Tolérable » à « Non » ;
- `ecarts_determinations` — écarts des déterminations intermédiaires (RDL, RDN, RDIA,
  RDI) par rapport à la détermination définitive : ΔD maximal ;
- `rc_ecarts` — Rapport de contrôle : ΔD maximal.
"""
import copy
import re
import unicodedata

#: Valeurs par défaut. Une durée est « hors tolérance » si elle est INFÉRIEURE au minimum
#: (ou égale, quand `*_limite_acceptee` vaut False) ; un écart l'est s'il DÉPASSE le max.
DEFAUTS = {
    'rob_duree': {
        'actif': True,
        'statique_min_s': 30 * 60, 'statique_limite_acceptee': True,
        'stopgo_min_s': 40, 'stopgo_limite_acceptee': True,
    },
    'rtlb_duree': {
        'actif': True,
        'statique_min_s': 30 * 60, 'statique_limite_acceptee': True,
        # « ne doit pas être inférieure OU ÉGALE à 40 s » : 40 s pile est hors tolérance.
        'stopgo_min_s': 40, 'stopgo_limite_acceptee': False,
    },
    'rfb_fermeture': {'actif': True},
    'ecarts_determinations': {'actif': True, 'max_m': 0.15},
    'rc_ecarts': {'actif': True, 'max_m': 0.15},
    # Mots-clés reconnaissant le mode d'observation dans les colonnes « Type » / « Méthode
    # terrain » (comparaison sans casse ni accents, par inclusion).
    'modes': {
        'statique': ['stati'],
        # « Arrêt et marche » : libellé français des logiciels Trimble (constaté sur les
        # données réelles, où il est bien plus fréquent que « Stop and go »).
        'stopgo': ['stop', 'go', 's&g', 'arret', 'marche'],
    },
}

#: Libellés des règles (paramètres, légende du rapport).
LIBELLES = {
    'rob_duree': "Durée des observations (Rapport des observations brutes)",
    'rtlb_duree': "Durée des vecteurs (Rapport du traitement des lignes de base)",
    'rfb_fermeture': "Fermeture des boucles (Δ3D ≤ tolérance)",
    'ecarts_determinations': "Écarts des déterminations par rapport à la définitive (ΔD)",
    'rc_ecarts': "Écarts du rapport de contrôle (ΔD)",
}

DUREE_MAX_S = 7 * 24 * 3600
ECART_MAX_M = 100.0


class ToleranceInvalide(ValueError):
    pass


def effectives(config):
    """Configuration effective : valeurs par défaut complétées par celles de l'opérateur."""
    out = copy.deepcopy(DEFAUTS)
    for cle, valeur in (config or {}).items():
        if cle in out and isinstance(valeur, dict):
            out[cle].update({k: v for k, v in valeur.items() if k in out[cle]})
    return out


def _bool(v, champ):
    if isinstance(v, bool):
        return v
    raise ToleranceInvalide(f"« {champ} » doit valoir vrai ou faux.")


def _nombre(v, champ, mini, maxi):
    try:
        n = float(v)
    except (TypeError, ValueError):
        raise ToleranceInvalide(f"« {champ} » doit être un nombre.")
    if not mini <= n <= maxi:
        raise ToleranceInvalide(f"« {champ} » doit être compris entre {mini} et {maxi}.")
    return n


def normaliser(config):
    """Valide une configuration envoyée par le client ; renvoie la version propre (seules
    les clés connues sont gardées). Lève `ToleranceInvalide` avec un message lisible."""
    if not isinstance(config, dict):
        raise ToleranceInvalide("Configuration de tolérances invalide.")
    propre = {}
    for cle, valeur in config.items():
        if cle not in DEFAUTS:
            continue
        if not isinstance(valeur, dict):
            raise ToleranceInvalide(f"Règle « {cle} » invalide.")
        regle = {}
        if cle == 'modes':
            for mode in ('statique', 'stopgo'):
                if mode in valeur:
                    mots = valeur[mode]
                    if not isinstance(mots, list) or not all(isinstance(m, str) for m in mots):
                        raise ToleranceInvalide(f"Mots-clés du mode « {mode} » invalides.")
                    mots = [m.strip() for m in mots if m.strip()][:20]
                    if not mots:
                        raise ToleranceInvalide(f"Le mode « {mode} » doit avoir au moins un mot-clé.")
                    regle[mode] = mots
        else:
            for champ, v in valeur.items():
                if champ not in DEFAUTS[cle]:
                    continue
                nom = f"{cle}.{champ}"
                if champ == 'actif' or champ.endswith('_limite_acceptee'):
                    regle[champ] = _bool(v, nom)
                elif champ.endswith('_min_s'):
                    regle[champ] = int(round(_nombre(v, nom, 0, DUREE_MAX_S)))
                elif champ == 'max_m':
                    regle[champ] = _nombre(v, nom, 0, ECART_MAX_M)
        propre[cle] = regle
    return propre


# --- Lecture des valeurs ----------------------------------------------------------------

def _sans_accents(texte):
    texte = unicodedata.normalize('NFD', str(texte or ''))
    return ''.join(c for c in texte if unicodedata.category(c) != 'Mn').lower().strip()


_UNITES = {'h': 3600, 'hr': 3600, 'heure': 3600, 'heures': 3600,
           'm': 60, 'mn': 60, 'min': 60, 'mins': 60, 'minute': 60, 'minutes': 60,
           's': 1, 'sec': 1, 'secs': 1, 'seconde': 1, 'secondes': 1, '"': 1, "'": 60}


def duree_secondes(valeur):
    """Durée en secondes depuis les formats rencontrés dans les rapports GNSS :
    « 00:45:12 », « 45:12 », « 1h02m03s », « 45 min », « 40 s », « 40 » (secondes),
    « 00:00:40.0 ». Renvoie `None` si la valeur n'est pas une durée lisible."""
    if valeur is None:
        return None
    if isinstance(valeur, (int, float)):
        return float(valeur)
    texte = _sans_accents(valeur).replace(',', '.')
    if not texte or texte in ('--', '-', '?'):
        return None
    if ':' in texte:
        parties = texte.split(':')
        try:
            nombres = [float(p) for p in parties]
        except ValueError:
            return None
        if len(nombres) == 3:
            return nombres[0] * 3600 + nombres[1] * 60 + nombres[2]
        if len(nombres) == 2:
            return nombres[0] * 60 + nombres[1]
        return None
    morceaux = re.findall(r"(\d+(?:\.\d+)?)\s*([a-z\"']*)", texte)
    if not morceaux:
        return None
    total, unite_vue = 0.0, False
    for nombre, unite in morceaux:
        if unite and unite not in _UNITES:
            return None
        total += float(nombre) * _UNITES.get(unite, 1)
        unite_vue = unite_vue or bool(unite)
    if len(morceaux) > 1 and not unite_vue:
        return None
    return total


def nombre(valeur):
    """Nombre depuis le format des rapports (« 0.023 », « 353 108.16 », « -0,012 »)."""
    if valeur is None:
        return None
    if isinstance(valeur, (int, float)):
        return float(valeur)
    texte = str(valeur).replace(' ', '').replace(' ', '').replace(',', '.').strip()
    try:
        return float(texte)
    except ValueError:
        return None


def mode_observation(valeur, modes):
    """'statique', 'stopgo' ou None selon les mots-clés de l'opérateur."""
    texte = _sans_accents(valeur)
    if not texte:
        return None
    # Statique d'abord : « statique rapide » n'est pas du stop and go.
    for mode in ('statique', 'stopgo'):
        if any(_sans_accents(m) in texte for m in modes.get(mode) or []):
            return mode
    return None


def _fmt_duree(s):
    s = int(s)
    if s >= 3600 and s % 60 == 0:
        return f"{s // 3600} h {s % 3600 // 60:02d}" if s % 3600 else f"{s // 3600} h"
    if s >= 60 and s % 60 == 0:
        return f"{s // 60} min"
    return f"{s} s"


def _fmt_m(m):
    return f"{m * 100:g} cm" if m < 1 else f"{m:g} m"


# --- Évaluation -------------------------------------------------------------------------

#: Types de pièces dont la version ÉCARTS (ou la version brute pour RDI) porte des
#: écarts de détermination par rapport à la définitive.
TYPES_ECARTS_DETERMINATION = {'RDL', 'RDN', 'RDIA'}


def _duree(rows, regle, modes, col_mode, col_duree='duree'):
    flags, nb = [], 0
    for row in rows:
        mode = mode_observation(row.get(col_mode), modes)
        d = duree_secondes(row.get(col_duree))
        hors = False
        if mode and d is not None:
            mini = regle[f'{mode}_min_s']
            hors = d < mini or (d == mini and not regle[f'{mode}_limite_acceptee'])
        flags.append({col_duree} if hors else set())
        nb += hors
    return flags, nb


def _ecart(rows, max_m, colonne='delta_d_m'):
    flags, nb = [], 0
    for row in rows:
        v = nombre(row.get(colonne))
        hors = v is not None and abs(v) > max_m
        flags.append({colonne} if hors else set())
        nb += hors
    return flags, nb


def evaluer(type_piece, version, rows, config):
    """Marque les valeurs hors tolérance d'un tableau de pièce.

    Returns:
        `(flags, alerte)` : `flags[i]` est l'ensemble des colonnes hors tolérance de la
        ligne `i` (aligné sur `rows`), `alerte` une phrase pour la légende du tableau
        (`''` si rien n'est hors tolérance). `(None, '')` si aucune règle ne s'applique.
    """
    cfg = effectives(config)
    modes = cfg['modes']
    regle = None
    if type_piece == 'ROB' and version == 'brut':
        regle = cfg['rob_duree']
        if regle['actif']:
            flags, nb = _duree(rows, regle, modes, 'type')
            seuil = (f"statique ≥ {_fmt_duree(regle['statique_min_s'])}, "
                     f"stop and go {'≥' if regle['stopgo_limite_acceptee'] else '>'} "
                     f"{_fmt_duree(regle['stopgo_min_s'])}")
            return flags, (f"{nb} observation(s) de durée hors tolérance ({seuil})." if nb else '')
    elif type_piece == 'RTLB' and version == 'brut':
        regle = cfg['rtlb_duree']
        if regle['actif']:
            flags, nb = _duree(rows, regle, modes, 'methode_terrain')
            seuil = (f"statique {'≥' if regle['statique_limite_acceptee'] else '>'} "
                     f"{_fmt_duree(regle['statique_min_s'])}, stop and go "
                     f"{'≥' if regle['stopgo_limite_acceptee'] else '>'} "
                     f"{_fmt_duree(regle['stopgo_min_s'])}")
            return flags, (f"{nb} vecteur(s) de durée hors tolérance ({seuil})." if nb else '')
    elif type_piece == 'RFB' and version == 'brut':
        if cfg['rfb_fermeture']['actif']:
            flags, nb = [], 0
            for row in rows:
                d3, tol = nombre(row.get('delta_3d_m')), nombre(row.get('tolerance_m'))
                non = _sans_accents(row.get('tolerable')) in ('non', 'no', 'n', 'false', 'faux')
                hors = non or (d3 is not None and tol is not None and abs(d3) > tol)
                flags.append({'delta_3d_m', 'tolerable'} if hors else set())
                nb += hors
            return flags, (f"{nb} boucle(s) non tolérable(s) (Δ3D supérieur à la tolérance)."
                           if nb else '')
    elif ((type_piece in TYPES_ECARTS_DETERMINATION and version == 'ecarts')
          or (type_piece == 'RDI' and version == 'brut')):
        regle = cfg['ecarts_determinations']
        if regle['actif']:
            flags, nb = _ecart(rows, regle['max_m'])
            return flags, (f"{nb} écart(s) supérieur(s) à {_fmt_m(regle['max_m'])} par rapport à "
                           "la détermination définitive." if nb else '')
    elif type_piece == 'RC' and version == 'brut':
        regle = cfg['rc_ecarts']
        if regle['actif']:
            flags, nb = _ecart(rows, regle['max_m'])
            return flags, (f"{nb} écart(s) de contrôle supérieur(s) à {_fmt_m(regle['max_m'])}."
                           if nb else '')
    return None, ''
