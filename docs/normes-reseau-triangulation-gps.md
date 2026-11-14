# Normes de conception d'un réseau de triangulation GPS

Référentiel qui **pilote l'algorithme** du module « Réseau GPS »
(`backend/reseaux/normes.py`, `backend/reseaux/generation.py`). Chaque règle porte un code
(`N1`…`N12`) repris tel quel dans les contrôles de conformité renvoyés par l'API et affichés
à l'écran.

> **Statut des sources.** Le texte officiel marocain applicable est l'*Instruction sur le GPS*
> de l'ANCFCC (édition 2007). Seuls son objet, son plan et ses prescriptions de longueur de
> lignes de base / de boucles sont accessibles publiquement (extraits cités ci-dessous) : les
> seuils qu'elle ne donne pas publiquement sont repris des normes de référence (FGCS/Caltrans,
> pratique de la triangulation classique) et **signalés comme tels**. Tous les seuils sont des
> **paramètres** : si le texte complet de l'instruction ANCFCC impose une autre valeur, il
> suffit de modifier `normes.py` (ou les paramètres saisis dans l'écran).

## 1. Triangulation classique — forme des triangles

| Code | Règle | Valeur retenue | Source |
|---|---|---|---|
| **N1** | Tous les angles d'un triangle compris entre **30° et 120°** (triangle « bien conformé »). | conforme si 30° ≤ α ≤ 120° | Règle pratique de la triangulation : un triangle aplati (angle proche de 0° ou 180°) amplifie l'erreur d'angle en erreur de position — même phénomène que la dilution de précision GNSS ([Fizziq — Triangulation](https://www.fizziq.org/en/glossary/triangulation/)) ; « les triangles ayant un angle inférieur à 30° ou supérieur à 120° ne devraient pas être retenus » (cours *well-conditioned triangles*). |
| **N1b** | Seuil de **tolérance** : un angle sous **20°** (≈ 22 gon) ou au-dessus de **150°** rend le triangle *défectueux*. | défectueux si α < 20° ou α > 150° | La triangulation française proscrivait les angles « inférieurs à 30 grades soit environ 27 degrés » au 1er ordre ([La Martinique à la carte — la triangulation](http://cartes-martinique.pagesperso-orange.fr/Triangulation.htm)) ; 20° est la tolérance retenue pour un canevas de détail (**choix du module**, paramétrable). |
| **N2** | Triangles **les plus équilatéraux possibles** (forme idéale : 60°/60°/60° ; meilleur isocèle : angles à la base de 56°14'). | indicateur : écart moyen à 60° | Idem ; « travailler avec des triangles équilatéraux ou proches : on dit alors que les triangles sont bien conformés » (La Martinique à la carte). |
| **N3** | Côtés de longueurs comparables (« prendre une base d'une longueur comparable à la distance à mesurer »). | couvert par N1/N2 (un triangle à angles ∈ [30°,120°] a un rapport de côtés ≤ 2√3 ≈ 3,46) | Fizziq. |

La **triangulation de Delaunay** est, parmi toutes les triangulations d'un semis de points,
celle qui **maximise le plus petit angle** : c'est le point de départ naturel de N1/N2. Elle
peut cependant produire, sur le pourtour (enveloppe convexe), des triangles très aplatis :
ils sont « épluchés » par les variantes épurées.

## 2. Réseaux GPS / GNSS — géométrie du réseau

| Code | Règle | Valeur retenue | Source |
|---|---|---|---|
| **N4** | Les lignes de base forment des **polygones fermés (boucles)** pour le contrôle : **100 %** des lignes de base appartiennent à une boucle ; un réseau ne contient que des boucles fermées. | taux de lignes en boucle (aucun « pont ») | ANCFCC, *Instruction sur le GPS* (2007) : « il est recommandé que les lignes de base forment des polygones fermés (boucles) pour des besoins de contrôle » ([extrait](https://latopographie-generale.blogspot.com/2019/11/instruction-sur-le-gps-ancfcc.html)) ; Caltrans *GPS Survey Specifications* §6A, tableau 6A : « Minimum percentage of all baselines contained in a loop : 100 % » ([Caltrans ch. 6](https://dot.ca.gov/-/media/dot-media/programs/right-of-way/documents/ls-manual/06-surveys-a11y.pdf)). |
| **N5** | Chaque station est reliée par **au moins deux lignes de base indépendantes** ; éviter de rattacher une station par plusieurs lignes vers **une seule** autre station. Idéal : **3 liaisons ou plus**. | bloquant si degré < 2 ; indicateur « ≥ 3 liaisons » | Caltrans §6A.3 « Networks » : « Each station in a network shall be connected with at least two different independent baselines » ; guide GPS du Washington DNR (points reliés par deux lignes indépendantes ou plus). |
| **N6** | Une boucle compte **au plus 6 lignes de base** (ici, les figures élémentaires sont des triangles : 3 lignes). | respecté par construction | Caltrans, tableau 6A-1 : « maximum number of baselines per loop : 6 ». |
| **N7** | **Longueur des lignes de base** : statique ≤ **15 km** (récepteurs mono-fréquence) ; statique rapide < **10 km**. | `longueur_max_km` = 10 km par défaut (15 km sélectionnable) | ANCFCC, *Instruction sur le GPS* (2007) : « le mode statique pourra être utilisé pour les courtes et les longues lignes de base sans toutefois dépasser les 15 km avec des récepteurs mono-fréquence » ; « le mode statique rapide pour des lignes de base inférieures à 10 km ». |
| **N8** | **Règle des stations voisines** (*adjacent station rule*) : deux stations dont la distance directe est inférieure à **20 %** du plus court chemin qui les relie dans le réseau doivent être **reliées directement**. | nombre de violations (pénalisé) | Caltrans §6A.3 et tableau 6A : « Direct connection between survey stations which are closer than 20 percent of the distance between those stations traced along existing or new connections ». |
| **N9** | **Rattachement aux points anciens** : les points de contrôle de référence **entourent** la zone de travail — présents dans **au moins 3 quadrants** autour du centre du projet ; les points nouveaux sont à l'**intérieur** de l'enveloppe des points anciens. | réseau mixte : quadrants occupés par les anciens autour du barycentre des nouveaux ; nouveaux hors enveloppe | Caltrans, tableau 6A : « Location of reference network control (relative to center of project); minimum number of quadrants : 3 » ; RTK : « the project area shall be surrounded and enclosed with control stations ». |
| **N10** | **Nombre minimal de points anciens** : **3** (deux pour déterminer, un pour contrôler). Chaque point nouveau est rattaché à **au moins 2** points du réseau, idéalement à 3 points anciens. | bloquant si < 3 anciens ; indicateur rattachement | Pratique courante du rattachement planimétrique (**choix du module**, le texte ANCFCC public ne donne pas ce chiffre) ; cohérent avec N5 et N9. |
| **N11** | **Couverture du lever de détail** : tout point de la zone intérieure au réseau est à moins de **5 km** d'au moins **3 points de densification** (anciens homogènes ou nouveaux), depuis lesquels les points de détail sont levés (stop and go / RTK). | taux de couverture de la zone (paramétrable : rayon, nombre de points) | **Prescription de l'utilisateur (service du cadastre)**, transmise le 14/11/2026 ; non retrouvée dans les textes publics. |
| **N12** | **Homogénéité des points anciens** : seuls les points anciens dont les écarts du rapport de contrôle (ΔD entre coordonnées connues et calculées) restent **≤ 15 cm** entre eux servent d'appui à la densification. | tolérance paramétrable, 15 cm par défaut (Paramètres › Tolérances, `rc_ecarts`) | Tolérance cadastrale en distance indiquée par l'utilisateur ; déjà appliquée par l'application au rapport de contrôle (pièce RC). |

### Notions utilisées pour les indicateurs

- **Lignes de base indépendantes** : un réseau connexe de *N* stations en compte au minimum
  *N − 1* (un arbre, sans aucun contrôle) — NYSDOT *Primary Project Control* ch. 8,
  NGS Bluebook *Annex L* (« a session cannot have more than N − 1 independent vectors »).
- **Redondance** = nombre de **boucles indépendantes** = *E − (N − 1)* (E = nombre de lignes
  de base). Plus elle est élevée, mieux une faute est détectée et isolée lors de la
  compensation libre — mais chaque ligne supplémentaire est une observation de plus.
- **Coût d'observation** : nombre de lignes de base par point (*E / N*). Au-delà de 3, la
  redondance supplémentaire est pénalisée dans le score (elle coûte des sessions).

### Ce qui n'est **pas** dans le périmètre du module

Les prescriptions d'**observation** et de **traitement** (durées de session, fermetures de
boucles en ppm, répétitions de lignes de base, précision finale) relèvent des pièces ROB,
RTLB, RFB… et des *Tolérances* déjà gérées par l'application. Le module conçoit la
**géométrie** du réseau avant le terrain.

## 3. Traduction dans l'algorithme

1. **Variantes calculées** (toutes sur les mêmes points) :
   - `delaunay` — triangulation de Delaunay intégrale (maximise l'angle minimal) ;
   - `delaunay_toleree` — Delaunay dont on épluche, depuis le pourtour, les triangles
     défectueux (N1b) ou dont un côté dépasse la longueur maximale (N7), sans jamais isoler
     un point (N5) ;
   - `delaunay_stricte` — même épluchage avec les seuils de conformité stricts (N1 : 30°/120°) ;
   - `quadrilateres` — Delaunay renforcée par les **deux diagonales** des quadrilatères
     convexes (« chaîne de quadrilatères » de la triangulation classique) : redondance
     maximale, coût élevé ;
   - réseau mixte seulement : `rattachement` — canevas des anciens + chaque point nouveau
     relié à ses 3 points anciens les plus proches (N10) et à son voisin nouveau le plus
     proche.
2. **Contrôles de conformité** par variante (code de norme, gravité *bloquant / majeur /
   mineur*, message). Une variante avec un contrôle **bloquant** en échec (réseau non
   connexe, point à moins de 2 liaisons, aucun triangle, moins de 3 anciens) n'est **pas
   recommandable**.
3. **Score sur 100** (documenté dans `generation.py::score`) :
   `30·C + 20·E + 15·A + 15·B + 10·L + 10·R − P`, avec C = part des triangles conformes (N1),
   E = 1 − écart moyen à 60°/30° (N2), A = angle minimal/30° plafonné à 1 (N1), B = part des
   lignes en boucle (N4), L = part des lignes ≤ longueur max (N7), R = part des points à
   ≥ 3 liaisons (N5), P = pénalités (coût au-delà de 3 lignes/point, violations N8, défauts
   N9 en mixte).
4. **Recommandation** : la variante admissible au meilleur score ; à égalité, celle qui a le
   moins de lignes de base. La justification compare les indicateurs avec les autres
   variantes.
5. **Variante parfaite** : raffinement glouton de type Ruppert — on évalue des emplacements
   candidats (centre du cercle circonscrit d'un triangle mal conformé, sommet du triangle
   équilatéral bâti vers l'extérieur sur un côté du pourtour, milieu d'une ligne trop
   longue) et l'on retient, à chaque tour, celui qui améliore le plus le score, jusqu'à ce
   que tous les triangles soient conformes ou que le nombre maximal de suggestions soit
   atteint. Chaque emplacement est accompagné d'un **rayon de recherche** (où chercher un
   point ancien existant) et de sa justification.
6. **Points à écarter** (`optimisation.py`) : un point ancien est proposé à l'écart quand il
   fait double emploi avec un voisin plus proche que le seuil de proximité (15 % de la
   longueur médiane des lignes, 50 m au moins), ou quand son retrait fait gagner au moins
   1 point de score (triangles mieux conformés, N1/N2). Jamais en dessous de 3 anciens
   (N10) ; c'est l'opérateur qui décide.

## 3 bis. Workflow de densification

L'écran suit l'ordre du travail du service du cadastre :

1. **Points anciens** — rassembler les points anciens disponibles dans la zone (import de la
   LPA : fichier ou pièce d'un SDGPS) ; l'opérateur peut écarter un point (avec motif).
2. **Réseau de contrôle de stabilité** — variantes, recommandation, points anciens à
   **rechercher** (variante parfaite) et à **écarter** (§ 3, point 6), jusqu'au score le plus
   proche de 100.
3. **Contrôle des écarts** (`ecarts.py`) — import du rapport de contrôle (pièce RC du SDGPS
   PDC ou fichier). Pour une détermination tenue fixe sur F, l'écart ΔD d'un point de
   contrôle P mesure la cohérence de F et P : la paire est **compatible** si ΔD ≤ tolérance
   (N12 ; quand les deux sens existent, le pire est retenu). Les **points homogènes** sont la
   plus grande clique de points deux à deux compatibles (Bron–Kerbosch ; à taille égale, la
   plus faible somme d'écarts). L'opérateur ajuste la sélection à la main.
4. **Densification** (`densification.py`) — zone = enveloppe convexe des anciens homogènes,
   échantillonnée sur une grille. Ajout glouton du candidat (grille, centres des triangles
   mal conformés, zones non couvertes, pré-filtrés sur le gain de couverture) qui maximise
   le score de densification augmenté d'un crédit de couverture progressif ; puis
   déplacements locaux des points proposés. Nombre de points paramétrable (0 = automatique :
   jusqu'à couverture complète, tant que le score progresse). Les points placés par
   l'opérateur sont conservés ; il peut en ajouter (saisie ou clic sur la carte), en
   supprimer et **recalculer le score**.
   **Score de densification** = 0,8 × score du réseau (§ 3, point 3) + 20 × taux de
   couverture N11 : un réseau parfait qui laisse des zones sans appui n'atteint pas 100.

## 4. Projection — Lambert Maroc → WGS84

Ellipsoïde **Clarke 1880 (IGN)** (a = 6 378 249,2 m ; 1/f = 293,466 021 293 6), datum
**Merchich**, projection conique conforme de Lambert à un parallèle ; passage au WGS84 par
translation géocentrique **(+31 m, +146 m, +47 m)** (EPSG « Merchich to WGS 84 (1) »).
Paramètres vérifiés contre PROJ (EPSG:26191/26192/26194/26195) :

| Zone | EPSG | φ0 | λ0 | k0 | X0 | Y0 |
|---|---|---|---|---|---|---|
| Nord Maroc (zone I) | 26191 | 33,3° | −5,4° | 0,999625769 | 500 000 | 300 000 |
| Sud Maroc (zone II) | 26192 | 29,7° | −5,4° | 0,999615596 | 500 000 | 300 000 |
| Sahara Nord (zone III) | 26194 | 26,1° | −5,4° | 0,999616304 | 1 200 000 | 400 000 |
| Sahara Sud (zone IV) | 26195 | 22,5° | −5,4° | 0,999616437 | 1 500 000 | 400 000 |

La zone n'est pas déductible des seules coordonnées : l'utilisateur la choisit (le module la
propose quand la pièce PPA/PPN du SDGPS renseigne « Zone Projection »).

## Sources

- ANCFCC — *Instruction sur le GPS*, édition 2007 (objet, plan, modes et longueurs de lignes
  de base, boucles) : <https://latopographie-generale.blogspot.com/2019/11/instruction-sur-le-gps-ancfcc.html>
- ANCFCC — *Notes et instructions relatives aux travaux cadastraux* (« Livre bleu », 2017) :
  <https://kitigt.onigtevents.ma/assets/files/3-DOC-TECHNIQUE/ancfcc/2017-livrebleu.pdf>
- Caltrans — *Global Positioning System (GPS) Survey Specifications*, chapitre 6 (boucles,
  réseaux, redondance, règle des stations voisines, quadrants) :
  <https://dot.ca.gov/-/media/dot-media/programs/right-of-way/documents/ls-manual/06-surveys-a11y.pdf>
- FGCC — *Geometric Geodetic Accuracy Standards and Specifications for Using GPS Relative
  Positioning Techniques* (1988/1989) ; NGS Bluebook *Annex L* :
  <https://geodesy.noaa.gov/FGCS/BlueBook/pdf/Annex_L.20011221.pdf>
- NYSDOT — *Primary Project Control*, chapitre 8 (lignes de base indépendantes = N − 1) :
  <https://www.dot.ny.gov/divisions/engineering/design/design-services/land-survey/repository/Chapter%208%20Primary%20Project%20Control.pdf>
- Washington DNR — *GPS guidebook* : <https://dnr.wa.gov/sites/default/files/2025-03/eng_plso_gps_guidebook.pdf>
- Triangulation classique : <https://www.fizziq.org/en/glossary/triangulation/>,
  <http://cartes-martinique.pagesperso-orange.fr/Triangulation.htm>,
  <https://www.infotopocad.com/2018/11/triangulation-reseaux-geodesiques.html>
- EPSG / PROJ — systèmes Merchich / Nord Maroc, Sud Maroc, Sahara Nord, Sahara Sud.
