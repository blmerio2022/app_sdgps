"""Seuils des normes qui pilotent la génération du réseau.

Chaque constante renvoie à un code de `docs/normes-reseau-triangulation-gps.md` : modifier
une valeur ici modifie l'algorithme ET les contrôles affichés. Les seuils exposés dans
l'écran (longueur maximale, nombre de suggestions) ne sont que des valeurs par défaut.
"""

ANGLE_MIN_CONFORME = 30.0     # N1
ANGLE_MAX_CONFORME = 120.0    # N1
ANGLE_MIN_TOLERE = 20.0       # N1b
ANGLE_MAX_TOLERE = 150.0      # N1b
ANGLE_IDEAL = 60.0            # N2
LIAISONS_MIN = 2              # N5 (bloquant)
LIAISONS_IDEAL = 3            # N5 (idéal)
LIGNES_PAR_BOUCLE_MAX = 6     # N6
LONGUEUR_MAX_KM_DEFAUT = 10.0  # N7 — statique rapide
LONGUEUR_MAX_KM_LIMITE = 50.0  # garde-fou de saisie
RATIO_STATIONS_VOISINES = 0.20  # N8
QUADRANTS_MIN = 3             # N9
ANCIENS_MIN = 3               # N10
ANCIENS_PAR_NOUVEAU = 3       # N10 (rattachement idéal)
LIGNES_PAR_POINT_SANS_PENALITE = 3.0  # coût d'observation

POINTS_MIN = 3
POINTS_MAX = 300
DISTANCE_DOUBLON_M = 0.01
SUGGESTIONS_MAX_DEFAUT = 5
SUGGESTIONS_MAX = 15

NORMES = [
    {'code': 'N1', 'titre': 'Angles des triangles entre 30° et 120°',
     'detail': "Un triangle aplati amplifie l'erreur angulaire en erreur de position.",
     'source': 'Triangulation classique (triangles bien conformés)'},
    {'code': 'N1b', 'titre': 'Aucun angle sous 20° ni au-dessus de 150°',
     'detail': 'Seuil de tolérance : au-delà, le triangle est défectueux.',
     'source': 'Triangulation classique — tolérance retenue par le module'},
    {'code': 'N2', 'titre': 'Triangles les plus équilatéraux possibles',
     'detail': 'Forme idéale 60°/60°/60° ; indicateur : écart moyen à 60°.',
     'source': 'Triangulation classique'},
    {'code': 'N4', 'titre': '100 % des lignes de base dans une boucle fermée',
     'detail': 'Les boucles permettent le contrôle des lignes de base.',
     'source': 'ANCFCC, Instruction sur le GPS (2007) ; Caltrans §6A'},
    {'code': 'N5', 'titre': 'Au moins 2 lignes de base par station (idéal : 3)',
     'detail': "Une station reliée par une seule ligne n'est pas contrôlée.",
     'source': 'Caltrans §6A.3 « Networks » ; FGCS'},
    {'code': 'N6', 'titre': 'Au plus 6 lignes de base par boucle',
     'detail': 'Respecté par construction (figures triangulaires).',
     'source': 'Caltrans, tableau 6A-1'},
    {'code': 'N7', 'titre': 'Lignes de base ≤ 10 km (statique rapide) ou ≤ 15 km (statique)',
     'detail': 'Longueur maximale paramétrable.',
     'source': 'ANCFCC, Instruction sur le GPS (2007)'},
    {'code': 'N8', 'titre': 'Règle des stations voisines (20 %)',
     'detail': 'Deux stations proches doivent être reliées directement.',
     'source': 'Caltrans §6A.3 (adjacent station rule)'},
    {'code': 'N9', 'titre': 'Points anciens autour de la zone (≥ 3 quadrants)',
     'detail': 'Les points nouveaux doivent être encadrés par les anciens.',
     'source': 'Caltrans, tableau 6A'},
    {'code': 'N10', 'titre': 'Au moins 3 points anciens ; nouveaux rattachés à ≥ 2 anciens',
     'detail': 'Deux points pour déterminer, un pour contrôler.',
     'source': 'Pratique du rattachement — choix du module'},
    {'code': 'N11', 'titre': 'Tout point de la zone à moins de 5 km de 3 points de densification',
     'detail': 'Lever des points de détail (stop and go / RTK) depuis les points anciens et nouveaux.',
     'source': 'Prescription du service du cadastre (utilisateur)'},
    {'code': 'N12', 'titre': 'Points anciens homogènes : écarts ΔD ≤ 15 cm entre eux',
     'detail': "Seuls les points homogènes du rapport de contrôle servent d'appui à la densification.",
     'source': 'Tolérance cadastrale en distance (Paramètres › Tolérances)'},
]
