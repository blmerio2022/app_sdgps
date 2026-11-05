"""Configuration de tri par défaut des tableaux de pièces.

SOURCE de vérité : la configuration de tri du compte SUPER ADMIN (page
« /admin/profile/parametres/tri-pieces »). Elle sert :
- de valeur par défaut du champ CustomUser.piece_sort_config (tout compte nouvellement créé
  hérite, à sa création, de la configuration courante du super admin) ;
- de graine pour les comptes existants SANS configuration (commande de management
  `seed_piece_sort_config`).

`DEFAULT_PIECE_SORT_CONFIG` est un REPLI figé (dernière valeur connue, initialement copiée
depuis « agent1@sdgps.ma »), utilisé uniquement quand aucun super admin n'existe encore ou
que sa configuration est vide (ex. tout premier `createsuperuser`). Ce nom reste importé par
la migration accounts.0022 : ne pas le renommer.

Forme : { '<TYPE_PIECE>': [ {'field': .., 'dir': 'asc'|'desc'}, .. ]
          | {'brut': [..], 'ecarts': [..]} }  (cf. CustomUser.piece_sort_config).
"""
import copy

from django.db import transaction

DEFAULT_PIECE_SORT_CONFIG = {
    "LPA": [
        {
            "field": "nom_point",
            "dir": "asc"
        },
        {
            "field": "reference",
            "dir": "asc"
        },
        {
            "field": "nature_materialisation",
            "dir": "asc"
        },
        {
            "field": "nature_signalisation",
            "dir": "asc"
        }
    ],
    "PPA": [
        {
            "field": "nom_point",
            "dir": "asc"
        },
        {
            "field": "date_visite",
            "dir": "asc"
        },
        {
            "field": "zone_projection",
            "dir": "asc"
        },
        {
            "field": "systeme_projection",
            "dir": "asc"
        }
    ],
    "PPN": [
        {
            "field": "nom_point",
            "dir": "asc"
        },
        {
            "field": "date_visite",
            "dir": "asc"
        },
        {
            "field": "zone_projection",
            "dir": "asc"
        },
        {
            "field": "systeme_projection",
            "dir": "asc"
        }
    ],
    "ROB": [
        {
            "field": "point",
            "dir": "asc"
        },
        {
            "field": "heure_debut",
            "dir": "asc"
        },
        {
            "field": "duree",
            "dir": "asc"
        },
        {
            "field": "type",
            "dir": "asc"
        }
    ],
    "RTLB": [
        {
            "field": "id_vec",
            "dir": "asc"
        },
        {
            "field": "duree",
            "dir": "desc"
        },
        {
            "field": "longueur_m",
            "dir": "desc"
        },
        {
            "field": "heure_debut",
            "dir": "asc"
        }
    ],
    "RFB": [
        {
            "field": "delta_3d_m",
            "dir": "desc"
        },
        {
            "field": "longueur_3d_m",
            "dir": "asc"
        },
        {
            "field": "tolerance_m",
            "dir": "asc"
        }
    ],
    "RDL": {
        "brut": [
            {
                "field": "nom_point",
                "dir": "asc"
            }
        ],
        "ecarts": [
            {
                "field": "nom_point_calcule",
                "dir": "asc"
            },
            {
                "field": "delta_d_m",
                "dir": "desc"
            }
        ]
    },
    "RDN": {
        "brut": [
            {
                "field": "nom_point",
                "dir": "asc"
            }
        ],
        "ecarts": [
            {
                "field": "nom_point_fixe",
                "dir": "asc"
            },
            {
                "field": "nom_point_calcule",
                "dir": "asc"
            },
            {
                "field": "delta_d_m",
                "dir": "desc"
            }
        ]
    },
    "RDIA": {
        "brut": [
            {
                "field": "determination",
                "dir": "asc"
            },
            {
                "field": "nom_point",
                "dir": "asc"
            }
        ],
        "ecarts": [
            {
                "field": "determination",
                "dir": "asc"
            },
            {
                "field": "nom_point_fixe",
                "dir": "asc"
            },
            {
                "field": "nom_point_calcule",
                "dir": "asc"
            },
            {
                "field": "delta_d_m",
                "dir": "desc"
            }
        ]
    },
    "RDI": [
        {
            "field": "nom_point_fixe",
            "dir": "asc"
        },
        {
            "field": "nom_point_calcule",
            "dir": "asc"
        },
        {
            "field": "delta_d_m",
            "dir": "desc"
        }
    ],
    "RDD": [
        {
            "field": "nom_point",
            "dir": "asc"
        }
    ],
    "RC": [
        {
            "field": "nom_point_fixe",
            "dir": "asc"
        },
        {
            "field": "nom_point_calcule",
            "dir": "asc"
        },
        {
            "field": "delta_d_m",
            "dir": "desc"
        }
    ]
}


def superadmin_piece_sort_config():
    """Configuration de tri du compte super admin de référence, ou `None` si indisponible
    (aucun super admin, ou configuration vide). Choix déterministe : le super admin le plus
    ancien (par date d'inscription puis email). Défensif : `None` si la requête échoue (schéma
    en cours de migration)."""
    from django.contrib.auth import get_user_model
    try:
        # Savepoint : si la requête échoue (colonne pas encore créée pendant une migration),
        # PostgreSQL laisse la transaction dans un état « aborted ». Le `atomic()` restaure au
        # savepoint pour ne pas casser la transaction de migration englobante (cf. RDL Postgres).
        with transaction.atomic():
            User = get_user_model()
            admin = (User.objects.filter(is_superuser=True)
                     .order_by('date_joined', 'email').first())
            cfg = getattr(admin, 'piece_sort_config', None) if admin else None
        return cfg or None
    except Exception:
        return None


def default_piece_sort_config():
    """Valeur par défaut du champ `piece_sort_config` (copie profonde : jamais l'objet partagé).

    Source = configuration courante du super admin ; à défaut (pas encore de super admin, ou
    configuration vide), repli sur `DEFAULT_PIECE_SORT_CONFIG`. Invoquée à la création d'un
    compte (create_user / inscription / admin / seeds) quand le champ n'est pas fourni."""
    cfg = superadmin_piece_sort_config()
    return copy.deepcopy(cfg if cfg else DEFAULT_PIECE_SORT_CONFIG)


def superadmin_piece_fields_config():
    """Configuration des CHAMPS (colonnes) du compte super admin de référence, ou `None` si
    indisponible (aucun super admin, ou configuration vide). Choix déterministe : le super
    admin le plus ancien (par date d'inscription puis email). Calqué sur
    `superadmin_piece_sort_config`."""
    from django.contrib.auth import get_user_model
    try:
        # Savepoint : cf. superadmin_piece_sort_config (résilience migration PostgreSQL).
        with transaction.atomic():
            User = get_user_model()
            admin = (User.objects.filter(is_superuser=True)
                     .order_by('date_joined', 'email').first())
            cfg = getattr(admin, 'piece_fields_config', None) if admin else None
        return cfg or None
    except Exception:
        return None


def default_piece_fields_config():
    """Valeur par défaut du champ `piece_fields_config` (copie profonde : jamais l'objet partagé).

    Source = configuration de colonnes courante du super admin ; à défaut (pas encore de super
    admin, ou configuration vide), repli sur `{}` (config vide = toutes les colonnes, ordre du
    catalogue). Invoquée à la création d'un compte quand le champ n'est pas fourni."""
    cfg = superadmin_piece_fields_config()
    return copy.deepcopy(cfg) if cfg else {}


# ---------------------------------------------------------------------------
# Tri multi-niveaux de la LISTE DES SSDGPS (tableau à plat d'un projet).
# Forme : liste ordonnée de niveaux `[{'field': <nom_colonne>, 'dir': 'asc'|'desc'}, ..]`.
# Même logique de source (super admin) que les configs de pièces ci-dessus.
# ---------------------------------------------------------------------------
DEFAULT_SSDGPS_SORT_CONFIG = [{'field': 'numero_ssdgps', 'dir': 'asc'}]


def superadmin_ssdgps_sort_config():
    """Config de tri multi-niveaux de la liste des SSDGPS du super admin de référence, ou
    `None` si indisponible (aucun super admin, ou config vide). Super admin le plus ancien.

    Défensif : renvoie `None` si la requête échoue — notamment pendant la migration qui CRÉE
    la colonne (la valeur par défaut est alors évaluée avant que la colonne existe). Le
    savepoint `atomic()` est INDISPENSABLE sur PostgreSQL : sans lui, le SELECT sur la colonne
    absente met la transaction de migration en état « aborted » et l'`ADD COLUMN` échoue ensuite
    en `InFailedSqlTransaction`."""
    from django.contrib.auth import get_user_model
    try:
        with transaction.atomic():
            User = get_user_model()
            admin = (User.objects.filter(is_superuser=True)
                     .order_by('date_joined', 'email').first())
            cfg = getattr(admin, 'ssdgps_sort_config', None) if admin else None
        return cfg or None
    except Exception:
        return None


def default_ssdgps_sort_config():
    """Valeur par défaut du champ `ssdgps_sort_config` (copie profonde). Source = config du super
    admin ; à défaut, repli sur `DEFAULT_SSDGPS_SORT_CONFIG` (tri par numéro croissant)."""
    cfg = superadmin_ssdgps_sort_config()
    return copy.deepcopy(cfg if cfg else DEFAULT_SSDGPS_SORT_CONFIG)


# --- Tri MULTI-NIVEAUX de la liste des ORGANISATIONS (miroir du tri SSDGPS) --------------
DEFAULT_ORG_SORT_CONFIG = [{'field': 'name', 'dir': 'asc'}]


def superadmin_org_sort_config():
    """Config de tri multi-niveaux de la liste des ORGANISATIONS du super admin de référence,
    ou `None` si indisponible (aucun super admin, ou config vide). Super admin le plus ancien.

    Même logique défensive que `superadmin_ssdgps_sort_config` : le savepoint `atomic()` est
    INDISPENSABLE (la valeur par défaut est évaluée pendant la migration qui CRÉE la colonne)."""
    from django.contrib.auth import get_user_model
    try:
        with transaction.atomic():
            User = get_user_model()
            admin = (User.objects.filter(is_superuser=True)
                     .order_by('date_joined', 'email').first())
            cfg = getattr(admin, 'org_sort_config', None) if admin else None
        return cfg or None
    except Exception:
        return None


def default_org_sort_config():
    """Valeur par défaut du champ `org_sort_config` (copie profonde). Source = config du super
    admin ; à défaut, repli sur `DEFAULT_ORG_SORT_CONFIG` (tri par nom croissant)."""
    cfg = superadmin_org_sort_config()
    return copy.deepcopy(cfg if cfg else DEFAULT_ORG_SORT_CONFIG)


# --- Tri MULTI-NIVEAUX des listes d'ORGANISMES (niveau 1 et niveau 2, miroir des organisations) --
DEFAULT_ORGANISME_N1_SORT_CONFIG = [{'field': 'nom', 'dir': 'asc'}]
DEFAULT_ORGANISME_N2_SORT_CONFIG = [{'field': 'nom', 'dir': 'asc'}]


def _superadmin_organisme_sort_config(attr):
    """Config de tri multi-niveaux d'une liste d'organismes du super admin de référence (le plus
    ancien), ou `None` si indisponible. `attr` = nom du champ (`organisme_niveau1_sort_config` /
    `organisme_niveau2_sort_config`).

    Même logique défensive que `superadmin_org_sort_config` : le savepoint `atomic()` est
    INDISPENSABLE (la valeur par défaut est évaluée pendant la migration qui CRÉE la colonne)."""
    from django.contrib.auth import get_user_model
    try:
        with transaction.atomic():
            User = get_user_model()
            admin = (User.objects.filter(is_superuser=True)
                     .order_by('date_joined', 'email').first())
            cfg = getattr(admin, attr, None) if admin else None
        return cfg or None
    except Exception:
        return None


def superadmin_organisme_niveau1_sort_config():
    """Config de tri des organismes de PREMIER niveau du super admin source (ou `None`)."""
    return _superadmin_organisme_sort_config('organisme_niveau1_sort_config')


def superadmin_organisme_niveau2_sort_config():
    """Config de tri des organismes de DEUXIÈME niveau du super admin source (ou `None`)."""
    return _superadmin_organisme_sort_config('organisme_niveau2_sort_config')


def default_organisme_niveau1_sort_config():
    """Valeur par défaut du champ `organisme_niveau1_sort_config` (copie profonde). Source = config
    du super admin ; à défaut, repli sur `DEFAULT_ORGANISME_N1_SORT_CONFIG` (tri par nom croissant)."""
    cfg = superadmin_organisme_niveau1_sort_config()
    return copy.deepcopy(cfg if cfg else DEFAULT_ORGANISME_N1_SORT_CONFIG)


def default_organisme_niveau2_sort_config():
    """Valeur par défaut du champ `organisme_niveau2_sort_config` (copie profonde). Source = config
    du super admin ; à défaut, repli sur `DEFAULT_ORGANISME_N2_SORT_CONFIG` (tri par nom croissant)."""
    cfg = superadmin_organisme_niveau2_sort_config()
    return copy.deepcopy(cfg if cfg else DEFAULT_ORGANISME_N2_SORT_CONFIG)


# --- Tri MULTI-NIVEAUX GÉNÉRIQUE par tableau (utilisateurs, projets, explorateur, ...) ----------
# Stocké dans le dictionnaire `CustomUser.table_sort_configs` (clé = identifiant du tableau).
# La source d'héritage/réinitialisation reste le compte super admin, comme les configs dédiées.
def superadmin_table_sort_config(key):
    """Config de tri multi-niveaux du tableau `key` du super admin de référence (le plus ancien),
    ou `None` si indisponible (aucun super admin, dictionnaire absent, ou entrée vide).

    Même logique défensive/`atomic()` que `superadmin_org_sort_config` (la colonne peut être créée
    par une migration au moment où le défaut est évalué)."""
    from django.contrib.auth import get_user_model
    try:
        with transaction.atomic():
            User = get_user_model()
            admin = (User.objects.filter(is_superuser=True)
                     .order_by('date_joined', 'email').first())
            configs = getattr(admin, 'table_sort_configs', None) if admin else None
            cfg = (configs or {}).get(key) if isinstance(configs, dict) else None
        return cfg or None
    except Exception:
        return None


# --- Configuration des COLONNES GÉNÉRIQUE par tableau (visibilité + ordre) ----------------------
# Stockée dans `CustomUser.table_columns_configs` (clé = identifiant du tableau). La source
# d'héritage/réinitialisation reste le compte super admin, comme le tri générique ci-dessus.
def superadmin_table_columns_config(key):
    """Config de colonnes (visibilité + ordre) du tableau `key` du super admin de référence (le
    plus ancien), ou `None` si indisponible (aucun super admin, dictionnaire absent, ou entrée vide).

    Même logique défensive/`atomic()` que `superadmin_table_sort_config`."""
    from django.contrib.auth import get_user_model
    try:
        with transaction.atomic():
            User = get_user_model()
            admin = (User.objects.filter(is_superuser=True)
                     .order_by('date_joined', 'email').first())
            configs = getattr(admin, 'table_columns_configs', None) if admin else None
            cfg = (configs or {}).get(key) if isinstance(configs, dict) else None
        return cfg or None
    except Exception:
        return None
