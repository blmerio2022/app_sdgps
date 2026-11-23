"""
Registre statique des types de pièces (Phase 6.5).

Source : docs/notes/RAPPORTS.xlsm, feuille "Liste-Noms" (19 entrées ; les
« Rapport de la détermination N°1/2/3 » sont factorisées ici en un seul type
répétable RDN, doté d'un champ `numero` variable — cf. PLAN_DEV.md §7.2/§7.2.1).

Ce module N'EST PAS piloté par la base : c'est un dict Python figé, jamais une table.

Le champ `niveau` de chaque entrée est un niveau PAR DÉFAUT (utilisé pour
pré-sélectionner l'assistant d'ajout) — l'utilisateur peut librement choisir, pour
n'importe quel type, un niveau SSDGPS (commun à toutes les sessions) ou Session
(spécifique, potentiellement différent d'une session à l'autre) à la création ou
à la modification d'une pièce. `validators.validate_piece_coherence` ne contraint
donc plus le niveau réel d'une pièce par rapport à ce champ.
"""

TOUTES = 'toutes'


def _champ(entries):
    return [{'name': n, 'label': l, 'type': t} for n, l, t in entries]


# --- Champs OBLIGATOIRES (verrouillés) par type -------------------------------
# La vue « Import des données » (piece_fields_config['<TYPE>']['import']) permet à
# l'opérateur d'activer/désactiver et réordonner les champs bruts utilisés à la saisie.
# Certains champs sont toutefois indispensables aux calculs (écarts, RC, assemblage RDIA) :
# ils sont TOUJOURS conservés et ne peuvent être désactivés (verrou côté UI + validation
# backend). Type absent = aucun champ verrouillé.
_REQUIRED_FIELDS = {
    'LPA':  {'nom_point', 'x_m', 'y_m'},
    'PPA':  {'nom_point'},
    'PPN':  {'nom_point'},
    'RDL':  {'nom_point', 'x_m', 'y_m', 'sigma_x_m', 'sigma_y_m'},
    'RDN':  {'nom_point', 'x_m', 'y_m', 'sigma_x_m', 'sigma_y_m'},
    'RDD':  {'nom_point', 'x_m', 'y_m', 'sigma_x_m', 'sigma_y_m'},
    'RDIA': {'nom_point', 'x_m', 'y_m', 'sigma_x_m', 'sigma_y_m'},
}


def required_field_names(type_piece: str) -> set:
    """Ensemble des noms de champs bruts OBLIGATOIRES (verrouillés) d'un type.

    Source de vérité = base (PieceFieldMeta.required), éditable par l'App Admin. Repli sur
    les valeurs statiques `_REQUIRED_FIELDS` uniquement si la table n'est pas disponible
    (avant migration / tests sans base). Une fois la donnée seedée, la base fait foi (l'admin
    peut donc retirer un champ de la liste, y compris jusqu'à aucun)."""
    try:
        from .models import PieceFieldMeta
        return set(PieceFieldMeta.objects.filter(type_piece=type_piece, required=True)
                   .values_list('field_name', flat=True))
    except Exception:
        return set(_REQUIRED_FIELDS.get(type_piece, set()))


# --- Schémas de colonnes, issus tels quels du classeur -------------------------

_LPA_CHAMPS = [
    ('id', 'ID', 'text'), ('nom_point', 'Nom Point', 'text'),
    ('x_m', 'X(m)', 'number'), ('y_m', 'Y(m)', 'number'),
    ('reference', 'Référence', 'text'),
    ('nature_materialisation', 'Nature Matérialisation', 'text'),
    ('nature_signalisation', 'Nature Signalisation', 'text'),
]

_PPX_CHAMPS = [  # PPA / PPN
    ('id', 'ID', 'text'), ('nom_point', 'Nom Point', 'text'),
    ('x_m', 'X(m)', 'number'), ('y_m', 'Y(m)', 'number'),
    ('date_visite', 'Date Visite', 'date'),
    ('systeme_projection', 'Système Projection', 'text'),
    ('zone_projection', 'Zone Projection', 'text'),
    ('fichier_image', 'Fichier Image', 'text'),
]

_ROB_CHAMPS = [
    ('id', 'ID', 'text'), ('point', 'Point', 'text'),
    ('heure_debut', 'Heure Début', 'text'), ('heure_fin', 'Heure Fin', 'text'),
    ('duree', 'Durée', 'text'), ('type', 'Type', 'text'), ('fichier', 'Fichier', 'text'),
    ('epoques', 'Epoques', 'number'), ('cadence', 'Cadence', 'text'),
    ('haut_ant_m', 'Haut. Ant. (m)', 'number'), ('antenne', 'Antenne', 'text'),
    ('fabricant_antenne', 'Fabricant antenne', 'text'),
    ('ref_antenne', 'Réf. antenne', 'text'),
]

_RTLB_CHAMPS = [
    ('id', 'ID', 'text'), ('id_vec', 'ID Vec.', 'text'), ('de', 'De', 'text'), ('vers', 'Vers', 'text'),
    ('solution', 'Solution', 'text'), ('heure_debut', 'Heure Début', 'text'), ('heure_fin', 'Heure Fin', 'text'),
    ('duree', 'Durée', 'text'), ('methode_terrain', 'Méthode Terrain', 'text'),
    ('longueur_m', 'Longueur (m)', 'number'), ('rms_m', 'RMS (m)', 'number'),
    ('prec_horiz_m', 'Prec. Horiz. (m)', 'number'), ('prec_vert_m', 'Prec. Vert. (m)', 'number'),
    ('satellites', 'Satellites', 'number'), ('nb_epoques', 'Nb Epoques', 'number'),
    ('delta_x_m', 'Δ X (m)', 'number'), ('delta_y_m', 'Δ Y (m)', 'number'), ('delta_z_m', 'Δ Z (m)', 'number'),
]

_RFB_CHAMPS = [
    ('id', 'ID', 'text'), ('id_boucle', 'ID Boucle', 'text'), ('nom_boucle', 'Nom Boucle', 'text'),
    ('longueur_3d_m', 'Longueur 3D(m)', 'number'), ('delta_x_m', 'ΔX(m)', 'number'),
    ('delta_y_m', 'ΔY(m)', 'number'), ('delta_z_m', 'ΔZ(m)', 'number'), ('delta_h_m', 'ΔH(m)', 'number'),
    ('delta_v_m', 'ΔV(m)', 'number'), ('ppm', 'ppm', 'number'), ('delta_3d_m', 'Δ3D(m)', 'number'),
    ('tolerance_m', 'Tolérance(m)', 'number'), ('tolerable', 'Tolérable', 'text'),
]

_RDX_CHAMPS = [  # RDL / RDN / RDD — schéma identique
    ('id', 'ID', 'text'), ('nom_point', 'Nom Point', 'text'),
    ('x_m', 'X(m)', 'number'), ('sigma_x_m', 'σx(m)', 'number'),
    ('y_m', 'Y(m)', 'number'), ('sigma_y_m', 'σy(m)', 'number'),
]

_RDI_CHAMPS = [
    ('id', 'ID', 'text'), ('nom_point_fixe', 'Nom Point Fixe', 'text'),
    ('nom_point_calcule', 'Nom Point Calculé', 'text'),
    ('x_m_fixe', 'X(m) [Fixe]', 'number'), ('y_m_fixe', 'Y(m) [Fixe]', 'number'),
    ('x_m_calcule', 'X(m) [Calculé]', 'number'), ('y_m_calcule', 'Y(m) [Calculé]', 'number'),
    ('delta_x_m', 'ΔX(m)', 'number'), ('delta_y_m', 'ΔY(m)', 'number'), ('delta_d_m', 'ΔD(m)', 'number'),
]

# Deuxième version « écarts » des pièces RDL / RDN : pour chaque point, écart entre les
# coordonnées définitives (RDD, supposées vraies = « Fixe ») et les coordonnées calculées
# de la pièce (« Calculé »). Colonnes texte (les coordonnées gardent leur format source).
# Stocké dans payload['rows_ecarts'] ; cf. pieces/rc.py:compute_ecarts_vs_definitive.
_ECARTS_CHAMPS = [
    ('id', 'ID', 'text'),
    ('nom_point_fixe', 'Nom(s) Point(s) Fixe(s)', 'text'),
    ('nom_point_calcule', 'Nom Point Calculé', 'text'),
    ('x_m_fixe', 'X Fixe (m)', 'text'), ('y_m_fixe', 'Y Fixe (m)', 'text'),
    ('x_m_calcule', 'X Calculé (m)', 'text'), ('y_m_calcule', 'Y Calculé (m)', 'text'),
    ('delta_x_m', 'ΔX(m)', 'text'), ('delta_y_m', 'ΔY(m)', 'text'), ('delta_d_m', 'ΔD(m)', 'text'),
]

# RDIA (Rapport des déterminations intermédiaires ASSEMBLÉ) : regroupe la RDL + les RDNₖ
# d'un même SSDGPS/session en une seule pièce. Colonne « Détermination » (Libre / N°1 / N°2…)
# juste après « ID ». Deux versions : brute assemblée et écarts assemblés (vs RDD), par bloc.
_RDIA_BRUT_CHAMPS = [
    ('id', 'ID', 'text'),
    ('determination', 'Détermination', 'text'),
    ('nom_point', 'Nom Point', 'text'),
    ('x_m', 'X(m)', 'text'), ('sigma_x_m', 'σx(m)', 'text'),
    ('y_m', 'Y(m)', 'text'), ('sigma_y_m', 'σy(m)', 'text'),
]
_RDIA_ECARTS_CHAMPS = [
    ('id', 'ID', 'text'),
    ('determination', 'Détermination', 'text'),
    ('nom_point_fixe', 'Nom(s) Point(s) Fixe(s)', 'text'),
    ('nom_point_calcule', 'Nom Point Calculé', 'text'),
    ('x_m_fixe', 'X Fixe (m)', 'text'), ('y_m_fixe', 'Y Fixe (m)', 'text'),
    ('x_m_calcule', 'X Calculé (m)', 'text'), ('y_m_calcule', 'Y Calculé (m)', 'text'),
    ('delta_x_m', 'ΔX(m)', 'text'), ('delta_y_m', 'ΔY(m)', 'text'), ('delta_d_m', 'ΔD(m)', 'text'),
]

# Aucun schéma tabulaire trouvé dans le classeur pour FTR → formulaire manuel minimaliste,
# à confirmer avec le métier avant que le générateur de rapport (Phase 6) ne consomme son payload.
_FTR_CHAMPS = [
    ('recepteur', 'Récepteur (modèle)', 'text'), ('numero_serie', 'Numéro de série', 'text'),
    ('antenne', 'Antenne', 'text'), ('observations', 'Observations', 'textarea'),
]

# RC (Rapport de contrôle) : tableau CALCULÉ automatiquement (cf. pieces/rc.py) en croisant
# la « Liste des points anciens » (coordonnées fixes) et les « Rapports de la détermination
# N°k » (coordonnées calculées). Colonnes de type texte : les coordonnées conservent le
# format source (« 353 108.16 ») et les écarts valent « -- » pour le point fixe de la
# détermination courante.
_RC_CHAMPS = [
    ('id', 'ID', 'text'),
    ('nom_point_fixe', 'Nom Point Fixe', 'text'),
    ('nom_point_calcule', 'Nom Point Calculé', 'text'),
    ('x_m_fixe', 'X(m) Fixe', 'text'), ('y_m_fixe', 'Y(m) Fixe', 'text'),
    ('x_m_calcule', 'X(m) Calculé', 'text'), ('y_m_calcule', 'Y(m) Calculé', 'text'),
    ('delta_x_m', 'ΔX(m)', 'text'), ('delta_y_m', 'ΔY(m)', 'text'), ('delta_d_m', 'ΔD(m)', 'text'),
]


PIECE_CATALOG = {
    'PGSDGPS': {'nom': 'Page de Garde SDGPS', 'niveau': 'ssdgps', 'source': 'ui',
                'natures': TOUTES, 'champs': [], 'repeatable': False},
    'RDC':     {'nom': 'Rapport de Consultation', 'niveau': 'ssdgps', 'source': 'image',
                'natures': TOUTES, 'champs': [], 'repeatable': False},
    'LPA':     {'nom': 'Liste des Points Anciens', 'niveau': 'ssdgps', 'source': 'csv_manuel',
                'natures': ['PDC/GPS', 'PLC/GPS', 'DDC/GPS', 'DLC/GPS'], 'champs': _champ(_LPA_CHAMPS),
                'repeatable': False},
    'CCSPA':   {'nom': 'Canevas de Contrôle de Stabilité des Points Anciens', 'niveau': 'ssdgps',
                'source': 'image', 'natures': ['PDC/GPS', 'PLC/GPS'], 'champs': [], 'repeatable': False},
    'CDC':     {'nom': 'Canevas de Densification Cadastrale', 'niveau': 'ssdgps', 'source': 'image',
                'natures': ['DDC/GPS'], 'champs': [], 'repeatable': False},
    'CLC':     {'nom': 'Canevas de Levé Cadastral', 'niveau': 'ssdgps', 'source': 'image',
                'natures': ['PLC/GPS', 'DLC/GPS'], 'champs': [], 'repeatable': False},
    'PPA':     {'nom': 'Photos des points anciens', 'niveau': 'ssdgps', 'source': 'image_csv_manuel',
                'natures': ['PDC/GPS', 'PLC/GPS', 'DLC/GPS'], 'champs': _champ(_PPX_CHAMPS), 'repeatable': False},
    'PPN':     {'nom': 'Photos des points nouveaux', 'niveau': 'ssdgps', 'source': 'image_csv_manuel',
                'natures': ['PDC/GPS', 'PLC/GPS', 'DDC/GPS', 'DLC/GPS'], 'champs': _champ(_PPX_CHAMPS), 'repeatable': False},
    'FTR':     {'nom': 'Fiche Technique des Récepteurs', 'niveau': 'ssdgps', 'source': 'csv_manuel',
                'natures': TOUTES, 'champs': _champ(_FTR_CHAMPS), 'repeatable': False},
    'ROB':     {'nom': 'Rapport des Observations Brutes', 'niveau': 'session', 'source': 'csv_manuel',
                'natures': TOUTES, 'champs': _champ(_ROB_CHAMPS), 'repeatable': False},
    'RTLB':    {'nom': 'Rapport du traitement des lignes de base', 'niveau': 'session',
                'source': 'csv_manuel', 'natures': TOUTES, 'champs': _champ(_RTLB_CHAMPS), 'repeatable': False},
    'RFB':     {'nom': 'Rapport des fermetures des Boucles', 'niveau': 'session', 'source': 'csv_manuel',
                'natures': TOUTES, 'champs': _champ(_RFB_CHAMPS), 'repeatable': False,
                'html_import': True},
    'RDL':     {'nom': 'Rapport de la détermination libre', 'niveau': 'session', 'source': 'csv_manuel',
                'natures': TOUTES, 'champs': _champ(_RDX_CHAMPS), 'repeatable': False,
                'html_import': True, 'ecarts': True, 'ecarts_champs': _champ(_ECARTS_CHAMPS)},
    'RDN':     {'nom': 'Rapport de la détermination N°k', 'niveau': 'session', 'source': 'csv_manuel',
                'natures': ['PDC/GPS', 'DDC/GPS', 'PLC/GPS', 'DLC/GPS'], 'champs': _champ(_RDX_CHAMPS),
                'repeatable': True, 'html_import': True, 'ecarts': True,
                'ecarts_champs': _champ(_ECARTS_CHAMPS)},
    'RDIA':    {'nom': 'Rapport des déterminations intermédiaires', 'niveau': 'session',
                'source': 'csv_manuel', 'natures': ['PDC/GPS', 'DDC/GPS', 'PLC/GPS', 'DLC/GPS'],
                'champs': _champ(_RDIA_BRUT_CHAMPS), 'repeatable': False,
                'assemble': True, 'ecarts': True, 'ecarts_champs': _champ(_RDIA_ECARTS_CHAMPS)},
    # HISTORIQUE (première version du catalogue, réservée au DLC) : remplacé par RDN / RDIA,
    # désormais communs aux quatre natures. Plus proposé à la création (aucune nature) ; le type
    # reste connu pour afficher et rendre les pièces déjà enregistrées.
    'RDI':     {'nom': 'Rapport des déterminations Intermédiaires', 'niveau': 'session',
                'source': 'csv_manuel', 'natures': [], 'champs': _champ(_RDI_CHAMPS),
                'repeatable': False},
    'RDD':     {'nom': 'Rapport de la détermination définitive', 'niveau': 'session',
                'source': 'csv_manuel', 'natures': ['PDC/GPS', 'PLC/GPS', 'DDC/GPS', 'DLC/GPS'], 'champs': _champ(_RDX_CHAMPS),
                'repeatable': False, 'html_import': True},
    'RC':      {'nom': 'Rapport de contrôle', 'niveau': 'ssdgps', 'source': 'calcul',
                'natures': TOUTES, 'champs': _champ(_RC_CHAMPS), 'repeatable': False,
                'computed': True},
}

PIECE_CHOICES = [(code, d['nom']) for code, d in PIECE_CATALOG.items()]


def get_piece_def(type_piece: str) -> dict:
    d = PIECE_CATALOG.get(type_piece)
    if d is None:
        raise KeyError(f"Type de pièce inconnu : {type_piece}")
    return d


def natures_applicable(type_piece: str, nature_ssdgps: str) -> bool:
    d = get_piece_def(type_piece)
    return d['natures'] == TOUTES or nature_ssdgps in d['natures']


def catalog_orientation(type_piece: str, nature_ssdgps: str = ''):
    """Orientation « métier » d'un type de pièce, définie par la clé optionnelle
    `orientation` du catalogue (cf. ORIENTATION_CATALOG). Option 1 de la fonctionnalité
    d'orientation : n'est consultée par le générateur QUE si le flag
    `report.USE_CATALOG_ORIENTATION` est activé. Renvoie 'portrait'/'paysage' ou None.

    La valeur peut être une chaîne (orientation fixe) ou un dict indexé par nature du
    SSDGPS (`{'PDC/GPS': 'portrait', 'DLC/GPS': 'paysage', '*': 'paysage'}`), la clé
    '*' servant de défaut."""
    o = ORIENTATION_CATALOG.get(type_piece)
    if isinstance(o, dict):
        return o.get(nature_ssdgps) or o.get('*')
    return o


# --- Option 1 (arrière-plan) : orientations « métier » par type de pièce -------
# Table SÉPARÉE du registre principal, pré-remplie mais INERTE par défaut (le
# générateur ne la lit que si report.USE_CATALOG_ORIENTATION est True). Sert de
# repli configurable si le calcul automatique par largeur (Option 2) ne convient pas.
# Valeur = 'portrait' | 'paysage' | { <nature>: <orientation>, '*': <défaut> }.
ORIENTATION_CATALOG = {
    'RTLB': 'paysage',   # 18 colonnes
    'RFB':  'paysage',   # 13 colonnes
    'ROB':  'paysage',   # 12 colonnes
    'RDI':  'paysage',   # 10 colonnes
    'RC':   'paysage',   # 10 colonnes
    'RDIA': 'paysage',   # version « écarts » assemblée large
    # Exemple de variation par nature du SSDGPS (laissé en modèle, à ajuster au besoin) :
    # 'RDN': {'DLC/GPS': 'paysage', '*': 'portrait'},
}


def _field_meta_map() -> dict:
    """`{ (type_piece, field_name): {'description', 'tooltip'} }` depuis la base
    (PieceFieldMeta). Import local : `catalog` est importé par `models`, on évite la
    dépendance circulaire à l'import du module. Silencieux si la table n'existe pas encore
    (avant migration) — les descriptions valent alors ''."""
    try:
        from .models import PieceFieldMeta
        return {
            (m.type_piece, m.field_name): {
                'description': m.description or '', 'tooltip': m.tooltip or '',
                'required': bool(m.required),
            }
            for m in PieceFieldMeta.objects.all()
        }
    except Exception:
        return {}


def _champs_with_meta(code: str, champs: list, meta: dict) -> list:
    """Copie des champs enrichie des clés `description` / `tooltip` (métadonnées communes,
    éditées par l'App Admin) ; valeurs vides si aucune description n'est enregistrée.
    Préserve la clé `custom` si présente (champ ajouté par l'admin). Ajoute `required`
    (champ verrouillé, non désactivable dans la vue « Import des données ») lu depuis la base
    (PieceFieldMeta.required, éditable par l'App Admin)."""
    out = []
    for c in champs:
        m = meta.get((code, c['name']), {})
        out.append({**c, 'description': m.get('description', ''), 'tooltip': m.get('tooltip', ''),
                    'custom': bool(c.get('custom')), 'required': bool(m.get('required'))})
    return out


def import_visible_names(type_piece: str, fields_config: dict):
    """Noms des champs bruts VISIBLES à l'import pour un opérateur (vue `import` de sa
    `piece_fields_config`). `None` = tous les champs (défaut, aucune config). Sinon la liste
    ORDONNÉE configurée, complétée défensivement des champs `required` manquants (jamais
    désactivables). Sert de FILTRE-MAÎTRE : les vues `app`/`pdf` s'appliquent ensuite à ce
    sous-ensemble (un champ non importé ne peut être ni affiché ni imprimé)."""
    imp = ((fields_config or {}).get(type_piece) or {}).get('import') or {}
    names = imp.get('brut')
    if names is None:
        return None
    seen = set(names)
    out = list(names)
    # Sécurité : réinjecte tout champ requis absent (dans l'ordre catalogue), en tête.
    req = required_field_names(type_piece)
    if req:
        missing = [c['name'] for c in effective_champs(type_piece)
                   if c['name'] in req and c['name'] not in seen]
        out = missing + out
    return out


def import_effective_champs(type_piece: str, fields_config: dict) -> list:
    """Champs bruts EFFECTIFS après application du filtre-maître « Import des données » de
    l'opérateur : champs effectifs (statiques + perso) filtrés/réordonnés par `import`.
    `fields_config` vide / vue absente ⇒ tous les champs (ordre catalogue)."""
    champs = effective_champs(type_piece)
    names = import_visible_names(type_piece, fields_config)
    if names is None:
        return champs
    by_name = {c['name']: c for c in champs}
    return [by_name[n] for n in names if n in by_name]


def _custom_fields_map() -> dict:
    """`{ type_piece: [ {'name','label','type','custom': True}, … ] }` : champs SUPPLÉMENTAIRES
    ajoutés par l'App Admin (PieceCustomField), ordonnés. Silencieux avant migration."""
    out = {}
    try:
        from .models import PieceCustomField
        for f in PieceCustomField.objects.all():
            out.setdefault(f.type_piece, []).append(
                {'name': f.name, 'label': f.label, 'type': f.field_type, 'custom': True})
    except Exception:
        pass
    return out


def effective_champs(type_piece: str, custom_map: dict = None) -> list:
    """Champs EFFECTIFS de la version brute d'un type = champs statiques du catalogue
    (`champs`) + champs personnalisés de l'App Admin (PieceCustomField), ces derniers
    ajoutés après. Source de vérité des colonnes réelles d'un type (import, affichage,
    rapport PDF, configuration des champs). `custom_map` peut être fourni pour éviter des
    requêtes répétées."""
    d = get_piece_def(type_piece)
    if custom_map is None:
        custom_map = _custom_fields_map()
    return list(d.get('champs') or []) + list(custom_map.get(type_piece, []))


def valid_field_names(type_piece: str, version: str = 'brut') -> set:
    """Ensemble des noms de champs valides d'un type pour une version : champs EFFECTIFS
    (statiques + perso) pour 'brut' ; champs d'écarts (statiques) pour 'ecarts'."""
    if version == 'ecarts':
        return {c['name'] for c in (get_piece_def(type_piece).get('ecarts_champs') or [])}
    return {c['name'] for c in effective_champs(type_piece)}


def champs_with_meta(type_piece: str, version: str = 'brut') -> list:
    """Champs d'un type enrichis des descriptions/infobulles (PieceFieldMeta). Pour 'brut',
    renvoie les champs EFFECTIFS (statiques + personnalisés) ; pour 'ecarts', les champs
    d'écarts statiques. Utilisé pour l'aperçu d'import (aide à la correspondance)."""
    if version == 'ecarts':
        champs = get_piece_def(type_piece).get('ecarts_champs') or []
    else:
        champs = effective_champs(type_piece)
    return _champs_with_meta(type_piece, champs, _field_meta_map())


def serialize_catalog() -> list:
    """Représentation JSON du registre, consommée par GET /api/v1/pieces/catalog/.

    Les champs (`champs` et `ecarts_champs`) sont enrichis des métadonnées descriptives
    (`description` / `tooltip`) stockées en base (PieceFieldMeta), afin d'aider à la
    correspondance des colonnes lors de l'import et sur la page « Champs par défaut »."""
    meta = _field_meta_map()
    custom_map = _custom_fields_map()
    return [
        {'code': code, 'nom': d['nom'], 'niveau': d['niveau'], 'source': d['source'],
         'natures': d['natures'],
         'champs': _champs_with_meta(code, effective_champs(code, custom_map), meta),
         'repeatable': d['repeatable'],
         'html_import': d.get('html_import', False), 'computed': d.get('computed', False),
         'ecarts': d.get('ecarts', False),
         'ecarts_champs': _champs_with_meta(code, d.get('ecarts_champs', []), meta),
         'assemble': d.get('assemble', False)}
        for code, d in PIECE_CATALOG.items()
    ]
