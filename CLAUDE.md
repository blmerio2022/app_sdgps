# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Présentation du projet

SDGPS (« Système de Génération de Documents ») est une plateforme multi-locataire de
gestion de documents et d'organisations. Elle comporte deux applications lancées
indépendamment :

- **backend/** — API REST Django 4.2 + Django REST Framework (authentification JWT via
  `djangorestframework-simplejwt`), base de données SQLite en développement.
- **frontend/** — SPA Angular 16 (basée sur les NgModule, pas les composants standalone),
  Angular Material + ngx-toastr + FontAwesome.

Le code est majoritairement en **français** (commentaires, docstrings, `verbose_name`,
textes d'interface). Respecter cette convention lors de l'ajout de code.

## Commandes

### Backend (à lancer depuis `backend/`)
- Serveur de dev : `python manage.py runserver` (port **8000** par défaut)
- Migrations : `python manage.py makemigrations` / `python manage.py migrate`
- Tests : `python manage.py test` — une seule app : `python manage.py test organizations`
- Shell Django : `python manage.py shell`
- Amorcer les données d'initialisation (seul jeu de données injecté, PARTOUT — dev inclus) :
  `python manage.py seed_initial_data`. Aucune donnée de démo/test n'est générée dans aucun
  environnement (les commandes `seed_test_users` / `generate_test_data` / `seed_demo_orgs` ont
  été **supprimées**).
- Réinitialiser la base à la demande (vide TOUT puis re-seed depuis les fichiers) :
  `python manage.py reset_db`. **Destructif, confirmation graduée** : `--yes` en dev/staging ;
  `--confirm-environment <nom exact>` en preprod/production (ex.
  `python manage.py reset_db --confirm-environment production`). Toujours sauvegarder la base
  avant en preprod/production.

### Frontend (à lancer depuis `frontend/`)
- Installer les dépendances : `npm install --legacy-peer-deps` (le flag est requis à cause
  de conflits de peer-dependencies)
- Serveur de dev : `npm start` (port **4200**) — voir « Pièges connus » ci-dessous
- Build : `npm run build` (configuration production par défaut)
- Tests unitaires (Karma/Jasmine) : `npm test` / `ng test`

### Installation / redémarrage en une commande (PowerShell Windows)
- Installation initiale (idempotente) : `.\backend\scripts\setup\run.ps1`
- Redémarrer les deux serveurs : `.\backend\scripts\setup\restart_servers.ps1`

### Toute modification du backend ⇒ REDÉMARRER LES DEUX SERVEURS (règle stricte)

**Dès qu'un fichier du backend est modifié** — code Python, gabarit, `settings.py`,
migration — **arrêter les DEUX serveurs puis les relancer**, afin que l'application
« live » serve bien le code courant.

Pourquoi ce n'est pas automatique : le serveur de dev est lancé avec **`--noreload`**
(indispensable pour qu'il tourne en tâche de fond sans se dédoubler). Il **ne recharge
donc jamais le code Python** modifié — vues, sérialiseurs, modèles, `settings.py` : il
continue de servir celui qu'il avait au démarrage, silencieusement. Un correctif backend
semble alors « sans effet » dans l'application, alors que le code sur disque est juste.

La règle couvre volontairement **tout** le backend, y compris les gabarits
(`pieces/templates/`) : en développement ceux-ci sont bien relus à chaque rendu
(`APP_DIRS` sans loader « cached » tant que `DEBUG=True`), mais distinguer au cas par cas
ce qui recharge de ce qui ne recharge pas est une source d'erreur — et la distinction
tombe dès que `DEBUG=False`. Redémarrer systématiquement coûte une minute et supprime
la question.

Le frontend, lui, se reconstruit tout seul (HMR) ; on le relance avec pour repartir d'un
état propre et cohérent.

Procédure :
1. arrêter le serveur Django **et** le serveur Angular ;
2. relancer le backend : `ENVIRONMENT=development python manage.py runserver 8085 --noreload`
   (depuis `backend/`) ;
3. relancer le frontend (`ng serve`, port 4205) ;
4. **vérifier** que les deux répondent avant d'annoncer que la correction est en ligne —
   un `curl` sur `/api/auth/login/` (405 ou 400 attendus, pas 000) et sur `http://localhost:4205/`.

Cette règle vaut aussi après un **changement de branche** ou un `git merge` qui touche
le backend : le serveur en cours tourne alors sur l'ancien code.

## Architecture

### RBAC / multi-locataire (modèle de domaine central)
Défini dans `backend/accounts/models.py` :
- **`Organization`** (clé primaire UUID) — un cabinet (`PRIVATE`) ou une entité publique
  (`PUBLIC`). La clé étrangère auto-référencée `parent` construit une hiérarchie
  (Direction > Division > Service). Suppression logique via `is_deleted`/`deleted_at` ;
  le flag `is_test_data` sépare les données générées.
- **`Membership`** — modèle de liaison entre `CustomUser` ↔ `Organization` avec un `role`
  (`ROLE_ORGANISATION_ADMIN` / `ROLE_ORGANISATION_AGENT`). Un utilisateur peut appartenir
  à plusieurs organisations (`unique_together = (user, organization)`).
- **`CustomUser`** (`AUTH_USER_MODEL`) — l'email est l'identifiant de connexion
  (`USERNAME_FIELD`, pas de username). Rôle global via `platform_role`
  (`ROLE_ADMIN_SYSTEME`) ; superuser = `ROLE_SUPER_ADMIN`. `get_primary_role()` encode la
  hiérarchie : **Super Admin > Admin Système > Admin Org > Agent Org**.
- **`PasswordResetToken`** — utilisé pour les flux de première connexion et de
  réinitialisation (email via SendGrid).

**Filtrage des données de test :** `Organization.objects` utilise `OrganizationManager`
(`accounts/managers.py`), qui exclut automatiquement les lignes `is_test_data=True` dans
les environnements « type production » (`settings.IS_PRODUCTION_LIKE`, soit `preprod` **et**
`production` — cf. `PRODUCTION_LIKE_ENVIRONMENTS`). Utiliser `Organization.all_objects` pour
contourner le filtrage.

**Changement de mot de passe forcé :** `accounts.middleware.ForcePasswordChangeMiddleware`
renvoie une 403 (`code: MUST_CHANGE_PASSWORD`) pour les appels API quand
`user.requires_password_change()`, n'autorisant que les endpoints
change-password/logout.

### Organisation des apps backend
- `accounts/` — authentification + gestion des utilisateurs. Attention à la séparation :
  les flux d'auth sont dans `views.py`/`urls.py`/`serializers.py` ; **le CRUD
  d'administration des utilisateurs est dans le trio parallèle `users_views.py` /
  `users_urls.py` / `users_serializers.py`**. Ne pas les confondre.
- `organizations/` — CRUD des organisations, membres, métadonnées, suppression en masse.
- `platform_admin/` — profil self-service du super-admin + mot de passe (pas de modèles,
  uniquement des vues).
- `reseaux/` — conception de réseaux de triangulation GPS (pas de modèles ; voir
  « Réseau de triangulation GPS » ci-dessous).
- Racines des URL (`backend/urls.py`) :
  - `/api/auth/` → accounts (login, forgot/verify/reset/change password, `me/`) — **pas de
    `register/`** : voir « Création de comptes » ci-dessous
  - `/api/v1/users/` → gestion des utilisateurs
  - `/api/v1/organizations/` → organisations
  - `/api/v1/platform-admin/` → profil super-admin
  - `/api/v1/reseau-gps/` → réseau de triangulation GPS (tous rôles)

**Contrôle d'accès :** le défaut DRF est **`IsAuthenticated`** — toute vue est fermée tant
qu'elle ne déclare pas le contraire. Les seules vues publiques sont les quatre flux
d'authentification (login, forgot/verify/reset password) et `TokenRefreshView` ; elles
posent `AllowAny` **explicitement**. `accounts/tests_default_permissions.py` parcourt
l'URLconf réelle et échoue sur toute autre vue publique : une nouvelle vue publique doit
donc être inscrite dans `VUES_PUBLIQUES_AUTORISEES` avec sa justification. L'application
des droits reste **par vue** : les vues admin filtrent au niveau du queryset et de l'objet
(`get_queryset` renvoie `none()` pour un non-admin ; `can_manage_user()` +
`check_object_permissions` dans `users_views.py`). Toujours vérifier la vue quand on
raisonne sur les droits.

**Force brute : limitation de débit + verrouillage (règle stricte).** Les endpoints
d'authentification sont les seuls joignables sans jeton ; ils sont protégés à deux
niveaux, car aucun ne suffit seul :
- `accounts/throttling.py` — débits DRF **par IP** (`*_ip`) *et* **par compte visé**
  (`*_email`, clé hachée) sur login / forgot-password / verify-code / reset-password. Les
  valeurs sont dans `settings.REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']` ;
- `accounts/lockout.py` — verrouillage **temporaire du compte** après
  `MAX_TENTATIVES` échecs, seul rempart contre une attaque lente que le débit ne voit pas
  passer. Une connexion réussie ou une réinitialisation efface les compteurs.

⚠️ Les deux s'appuient sur le **cache Django**. Avec plusieurs workers gunicorn, un cache
local par processus multiplie les limites par le nombre de workers et rend le verrou
contournable : **`REDIS_URL` est obligatoire en environnement serveur** (`CACHES` est
construit par `backend/observability.py::configuration_du_cache`, qui émet un
avertissement au démarrage si l'URL manque sur un serveur).

**Génération des rapports : TÂCHE DE FOND (Celery + Redis).** Le rendu d'un rapport dure
des dizaines de secondes à plusieurs minutes (une passe WeasyPrint par pièce). En
synchrone, il immobilisait un worker gunicorn sur trois, dépassait le `--timeout 300` du
serveur sur un gros SDGPS, et ne pouvait afficher qu'une barre **simulée** bloquée à 90 %.
- socle : `backend/celery.py` (+ `backend/__init__.py`), réglages `CELERY_*` dans
  `settings.py`. Le broker est le **même Redis que le cache** (`REDIS_URL`) ;
- ⚠️ **sans broker, Celery passe en mode « eager »** : la tâche s'exécute en ligne, dans
  la requête. Tout fonctionne donc en développement et en CI sans Redis ni worker — le
  suivi renvoyé est simplement déjà terminé. C'est ce qui rend les tests simples ;
- suivi : modèle `pieces.models.RapportGeneration` (statut, progression, étape, fichier).
  Le PDF produit est **stocké** et re-téléchargeable : fermer l'onglet ne fait plus perdre
  plusieurs minutes de rendu ;
- progression **réelle** : `render_report_pdf(..., on_progress=…)` appelle le rappel avant
  chaque pièce ; `report._avancer` garantit qu'une défaillance du suivi n'interrompt
  jamais le rendu ;
- API : `POST /api/v1/pieces/report-async/` (mêmes paramètres et mêmes contrôles que
  `report/` — c'est la même `_resoudre_portee_rapport`), puis
  `GET /api/v1/rapports/<id>/` (sondé toutes les 1,5 s) et
  `GET /api/v1/rapports/<id>/fichier/`. L'endpoint **synchrone reste exposé** ;
- le rapport est un artefact **dérivé** : il n'est PAS imputé au quota de l'organisation,
  mais purgé au-delà de `RAPPORT_RETENTION_JOURS` (`manage.py purger_rapports`) ;
- worker : profil `redis` de `docker-compose.yml` en local
  (`docker compose --env-file backend/.env.development --profile redis up -d`) ; sur
  Railway, un **second service** depuis la même image, commande
  `celery -A backend worker --loglevel=info --concurrency=2` ;
- ⚠️ **ne jamais nommer `format` un paramètre de requête DRF** : il est réservé à la
  négociation de contenu et provoque un 404 avant l'entrée dans la vue. Le flux PDF
  binaire s'obtient avec `?brut=1` (l'ancien `?format=raw`, documenté de longue date,
  n'a jamais pu fonctionner) ;
- tests : `backend/pieces/tests_rapport_async.py`.

**Rapport d'un SDGPS mono-session : AUCUNE mention de session (règle stricte).** Sa
session n°1 est structurelle (`autocreate_mono_session`) : ni en-tête, ni pied, ni page de
garde, ni nom de fichier ne la nomment, même si l'appelant la passe en portée ou si des
pièces anciennes y sont rattachées. Règle portée par `pieces/report.py` :
`est_mono_session` → `resolve_report_session` renvoie `None`, `report_filename` sans
suffixe, jamais de « synthèse ». Un multi-session à session unique, lui, la nomme.
Tests : `tests_report_session.MonoSessionSansSessionTests`.

**En-tête répété des pages de contenu : marge haute ADAPTATIVE.** L'encadré d'en-tête vit
dans la marge haute (`@page contenu` → `@top-center`, 43 mm par défaut) et ne repousse
jamais le contenu : plus haut que la marge (titre + mention de version du RDIA, organismes
longs…), il recouvrait le tableau. `render_report_pdf` mesure le bas de `.content-head`
dans la mise en page réelle (`required_content_margin_mm`) et, s'il manque de la place,
re-rend la pièce avec `content_margin_top` relevé (écart minimal `HEADER_GAP_MM`). Tests :
`tests_report_header_layout.MargeHauteAdaptativeTests`.

**Tolérances de l'opérateur : valeurs hors tolérance signalées dans le rapport.** Chaque
opérateur règle ses seuils dans *Paramètres › Tolérances* (`/parametres/tolerances`,
`CustomUser.tolerances_config`, API `GET/PUT /api/auth/me/tolerances/` + `reset/`). Seules
les valeurs qui diffèrent des défauts sont enregistrées. Règles (`pieces/tolerances.py`,
défauts dans `DEFAUTS`) :
- ROB (« Type » + « Durée ») et RTLB (« Méthode terrain » + « Durée ») : durée minimale
  par mode — statique ≥ 30 min ; stop and go ≥ 40 s (ROB) / > 40 s (RTLB : 40 s pile est
  hors tolérance). Mode reconnu par mots-clés (sans casse ni accents) — défauts `stati` /
  `stop`, `go`, `s&g`, `arret`, `marche` (« Arrêt et marche » = libellé Trimble français,
  majoritaire dans les données réelles) ; une ligne au mode inconnu n'est pas contrôlée ;
- RFB : Δ3D > « Tolérance » ou « Tolérable » = Non ;
- écarts des déterminations (version écarts des RDL/RDN/RDIA, RDI brut) et RC : |ΔD| > 15 cm.
`evaluer()` renvoie les colonnes fautives par ligne ; `_table_cells` marque les cellules
(`hors_tol`, encadré rouge) et toute la ligne (`row_hors_tol`) ; une légende `.tol-alerte`
précède le tableau. Le rapport applique les tolérances de **celui qui le demande** (vue
synchrone : `request.user` ; tâche de fond : `generation.created_by`). Ajouter une règle =
une entrée dans `DEFAUTS` + `LIBELLES`, sa validation dans `normaliser`, son cas dans
`evaluer`. Tests : `pieces/tests_tolerances.py`, `tolerances-settings.component.spec.ts`.

**Vues « à plat » entre niveaux.** Depuis un projet, une propriété, une affaire ou un SSDGPS
multi-session, le menu `<app-sous-niveaux-menu>` (icône *sitemap* dans les actions des
lignes ; bouton « À plat » dans l'en-tête de l'explorateur) ouvre la liste de TOUS les
éléments d'un niveau inférieur : routes `projets/:id/proprietes|affaires|ssdgps|sessions`,
portée en query params (`?propriete=` / `?affaire=` / `?ssdgps=`, la plus fine l'emporte).
`ProjectFlatListComponent` (propriétés, affaires, sessions) et la page SSDGPS existante
gardent l'outillage complet (colonnes + tri multi-niveaux sur les clés `flat_proprietes` /
`flat_affaires` / `flat_sessions`, déclarées dans `accounts/views.py`). Côté API :
`affaires/?projet=`, `sessions/?projet|propriete|affaire=` (sessions des seuls
multi-session — la session d'un mono-session est structurelle), niveaux intermédiaires en
corbeille exclus ; contexte parent (`propriete_*`, `ssdgps_numero`, `affaire_numero`…)
renvoyé par les sérialiseurs. Tests : `projects/tests_vues_a_plat.py`, specs
`sous-niveaux-menu`, `project-flat-list`.

**Aperçu de la page de garde (avant génération).** `GET /api/v1/pieces/report-cover/`
rend la **seule** page de garde en PDF, avec les mêmes paramètres, la même portée et les
mêmes contrôles que `report/` (c'est la même `_resoudre_portee_rapport`). Elle est la
table des matières officielle du rapport : une pièce oubliée, un intitulé fautif ou un
ordre inattendu s'y voient, et les découvrir après plusieurs minutes de rendu coûte une
génération complète pour rien.
- le rendu passe par `report.render_cover_pdf(...)` → `build_cover_context(...)` =
  `build_report_context(..., avec_contenu=False)` : le contenu des pièces
  (`_piece_content` — tableaux, images encodées, photos de points), qui fait l'essentiel
  du coût, n'est **pas** assemblé. D'où un endpoint **synchrone** ;
- la colonne « Page » y reste à « — » : le n° de page d'une pièce dépend de la pagination
  de tout le rapport (boucle de convergence de `render_report_pdf`). L'inventer serait
  trompeur ;
- transport identique à `report/` : JSON base64 par défaut, flux binaire sur `?brut=1` ;
  nom de fichier préfixé `APERCU_` ;
- **non journalisé** : l'aperçu n'expose que la liste de pièces déjà affichée à l'écran et
  ne produit aucun document exploitable hors de l'application. La **génération**, elle,
  reste journalisée (`ACTION_RAPPORT_GENERE`) ;
- front : bouton « Aperçu de la page de garde » dans la modale *Rapport PDF* (écran de
  configuration) → modale d'aperçu avec `<iframe>` sur un blob PDF ;
- tests : `backend/pieces/tests_rapport_apercu.py`, `pieces.service.spec.ts`,
  `piece-management-page.component.spec.ts`.

**Contrôle de cohérence avant génération.** `GET /api/v1/pieces/report-check/` (même
portée, mêmes droits, même `_resoudre_portee_rapport`, appelée avec
`exiger_pieces=False`) renvoie les anomalies du SDGPS sans rien modifier ni rendre :
`{ok, total, erreurs, avertissements, anomalies[]}`. Le rendu, lui, prend les pièces
valides telles qu'elles sont et n'alerte sur rien.
- logique : `backend/pieces/coherence.py::analyser_coherence(...)`. Deux gravités —
  `erreur` (incohérence de dossier : trou dans la numérotation des déterminations RDN,
  aucune pièce à inclure) et `avertissement` (pièce non validée donc exclue, pièces
  prévues par la nature absentes — **regroupées en une seule ligne**, session sans pièce
  propre, pièce validée mais vide) ;
- les pièces attendues viennent du champ `natures` du catalogue (`types_attendus`), qui
  pilote déjà l'assistant d'ajout — pas d'une nouvelle liste à maintenir ;
- **le contrôle ne bloque JAMAIS la génération** : un dossier en cours d'instruction est
  légitimement incomplet. L'endpoint de génération ne le consulte pas ;
- front : panneau repliable en tête de la modale *Rapport PDF*, relancé à l'ouverture et
  à chaque changement de portée (`setReportScope`, `onReportRangeChange`). Un contrôle
  en échec n'affiche rien plutôt que d'empêcher de générer ;
- tests : `backend/pieces/tests_rapport_coherence.py` (21 cas) + specs service/composant.

**Cycle de vie d'un SDGPS : en cours → soumis → validé → clos (règle stricte).** Un
SDGPS produit une pièce officielle d'un dossier foncier ; sans état, rien ne distinguait
un dossier en saisie d'un dossier contrôlé et arrêté, et ses pièces restaient modifiables
par quiconque sans trace du contrôle.
- toutes les règles sont dans `backend/projects/workflow.py` (`TRANSITIONS`,
  `appliquer_transition`, `est_encadrement`, `transitions_possibles`) ; champs portés par
  `Ssdgps` : `statut`, `statut_change_at/by`, `motif_statut`, `STATUTS_VERROUILLES`,
  `est_verrouille()` ;
- transitions : **soumettre** (tout utilisateur ayant accès ; exige que **toutes** les
  pièces vivantes soient validées), **valider** / **rejeter** / **clore** / **rouvrir**
  (réservées à l'**Admin Organisation de cette organisation** ou à l'administration de
  l'application — un rédacteur ne valide pas sa propre production). `rejeter` et
  `rouvrir` exigent un **motif** ;
- **API : `POST /api/v1/ssdgps/<id>/transition/`** — `{"action": "...", "motif": "..."}`.
  ⚠️ `statut` est **read-only** dans `SsdgpsSerializer` : jamais de `PATCH statut`, qui
  contournerait les règles. Le serializer expose `statut_display`, `verrouille` et
  `transitions` (transitions ouvertes à l'appelant — garde **cosmétique**) ;
- **VERROU** : dès `soumis`, plus aucune écriture sur les pièces du dossier. Posé dans
  `pieces/views.py` par `_check_modifiable()`, appelé depuis `_check_scope()` (chemins de
  création/import), `check_object_permissions()` (toute action détail en écriture) et les
  chemins qui ne passent pas par `get_object()` (`restore`, `permanent`). Les opérations
  **en masse** écartent les pièces verrouillées du lot et renvoient
  `verrouillees_count`. La **lecture** et la **génération du rapport** restent ouvertes ;
- journalisé : `AuditEvent.ACTION_SSDGPS_STATUT` (transition, statut avant/après, motif) ;
- front : badge de statut dans le titre de la page des pièces + boutons de décision +
  bandeaux (dossier figé / dossier rejeté avec son motif), modale de confirmation avec
  motif obligatoire ; colonne **Statut** (`statut_display`) dans la liste des SSDGPS
  (allowlists `TABLE_COLUMN_FIELDS['ssdgps']` et `SSDGPS_SORT_FIELDS`) ;
- tests : `backend/projects/tests_workflow_ssdgps.py` (34 cas) + specs
  `projects.service.spec.ts` / `piece-management-page.component.spec.ts`.

**Assistant de création SDGPS + modèles de pièces.** Un seul parcours, du projet au
rapport livrable, au lieu de traverser quatre listes (projet, propriété, affaire, SDGPS)
puis de deviner pièce par pièce ce que la nature du dossier exige.
- **Modèles** : `projects.models.ModeleSsdgps` (`nature_ssdgps`, `type_ssdgps`, `portee`
  `systeme`|`personnel`, `proprietaire`, `pieces` = liste JSON ordonnée
  `[{type_piece, numero, obligatoire}]`). Règles dans `backend/projects/modeles.py` :
  `pieces_par_defaut(nature)` (dérivé du champ `natures` du catalogue, RDN avec n°1, sans
  PGSDGPS), `normaliser_pieces` (type connu, applicable à la nature, pas de doublon, numéro
  ssi répétable), `assurer_modeles_systeme()` (4 modèles PDC/DDC/PLC/DLC — amorcés par la
  migration `projects/0009` **et** par `run_seed`, donc recréés après `reset_db` ; jamais
  réécrits s'ils existent), `plan_du_ssdgps` (liste de contrôle) ;
- **droits** : un modèle `systeme` ne se crée / modifie que par l'administration de
  l'application (`IsApplicationAdmin`) ; un modèle `personnel` n'est **visible** et
  modifiable que par son propriétaire. Suppression logique ;
- **API** : `/api/v1/modeles-ssdgps/` (CRUD, `?nature=`, `<id>/dupliquer/`,
  `depuis-ssdgps/`) ; `POST /api/v1/ssdgps/assistant/` crée projet → propriété → affaire →
  SDGPS en **une transaction** (chaque niveau `{"id"}` existant ou `{"nouveau": {...}}`,
  mêmes sérialiseurs et même portée RBAC que les vues CRUD ; erreurs rangées sous la clé du
  niveau fautif ; numéro du SDGPS attribué ; `nb_sessions` pour un multi-session) ;
  `GET ssdgps/<id>/plan/`, `POST ssdgps/<id>/appliquer-modele/`,
  `POST ssdgps/<id>/valider-pieces/` (validation groupée via le **même** `PieceSerializer` —
  règle des photos PPA/PPN comprise —, refusée sur un dossier figé) ;
- le SDGPS garde `modele` + `pieces_prevues` (**instantané** : modifier le modèle ne change
  pas les dossiers existants) ;
- **propriété réutilisée sans organismes** (données anciennes : 35 sur 38 en dev) :
  l'assistant la signale et fait compléter les deux organismes sur place
  (`{"id": …, "complement": {organisme_niveau1, organisme_niveau2}}`, validé par
  `ProprieteSerializer` partiel, enregistré dans la même transaction) ; sans eux, le
  serveur refuse (`propriete.organismes`) — ils figurent dans l'en-tête de chaque page ;
- **front** : route `projets/assistant` (`SdgpsAssistantComponent`, 6 étapes ; reprise par
  `?ssdgps=&projet=`, démarrage par `?modele=`), route `projets/modeles`
  (`ModeleSsdgpsListComponent`), éditeur en modale `ModeleSsdgpsEditorComponent`. L'import
  de chaque pièce réutilise `app-piece-add-wizard` avec `[presetTypeCode]` (étape « Type »
  sautée). Entrées : bouton « Assistant SDGPS » de la liste des projets, bouton
  « Assistant » de la page des pièces, raccourci du tableau de bord. Styles communs :
  `features/projects/_sdgps-kit.scss`. La barre Précédent/Suivant (`.as-foot`) vit **hors**
  de la zone défilante (`.as-scroll`) : elle reste ancrée en bas quelle que soit la hauteur
  de l'étape — ne pas la remettre en `position: sticky` dans le contenu ;
- tests : `backend/projects/tests_modeles_assistant.py` (48 cas) + specs
  `modeles-ssdgps.service`, `sdgps-assistant`, `modele-ssdgps-editor`,
  `modele-ssdgps-list`, `piece-add-wizard` (type imposé).

**Import de PDF d'images (RDC, pièces à images, photos PPA/PPN).** Un PDF déposé là où
l'on attend des images ouvre l'**éditeur de pages** `features/projects/pdf-page-editor/`
(`<app-pdf-page-editor>`) : suppression / restauration, réorganisation (flèches et
glisser-déposer), rotation, sélection multiple, aperçu, rognage des marges et — si
`[points]` est fourni (PPA/PPN) — affectation de chaque page à un point (une par une, par
lot, ou « dans l'ordre », n pages par point). Chaque page retenue est rendue en **JPEG**
(`canvasToJpeg`, sous `maxBytes`) et suit le circuit d'images habituel : **aucun
changement backend**, le PDF lui-même n'est jamais stocké.
- rendu : `core/services/pdf-render.service.ts` — **pdf.js** (`pdfjs-dist` 3.x, build
  `legacy`) chargé **à la demande** (import dynamique, bundle séparé) ; worker copié par
  `angular.json` vers `assets/pdfjs/pdf.worker.min.js`. Rendu en intention `print` : le
  mode `display` est cadencé par `requestAnimationFrame` et se fige dans un onglet en
  arrière-plan. ⚠️ Après modification de `angular.json`, **relancer `ng serve`** (sinon le
  worker répond 404 et le PDF est déclaré illisible) ;
- branché dans `piece-add-wizard` (file d'attente si plusieurs PDF, ≤ 2 Mo par page),
  `piece-image-gallery` et `piece-photo-points` (envoi groupé **par point** via
  `addImages(pieceId, files, pointRef)`) ;
- tests : `pdf-page-editor.component.spec.ts` (+ utilitaires), specs wizard / galerie /
  photos par point.

**Réseau de triangulation GPS (module indépendant, TOUS les rôles).** Conçoit la géométrie
d'un réseau GNSS avant le terrain, à partir d'une liste de points au format LPA. Les règles
viennent de `docs/normes-reseau-triangulation-gps.md` (codes **N1…N10** : angles 30°–120°,
triangles équilatéraux, 100 % des lignes en boucle, ≥ 2 liaisons par station, lignes ≤ 10/15 km
selon l'Instruction GPS ANCFCC 2007, règle des stations voisines, ≥ 3 quadrants, ≥ 3 anciens).
- backend : app **`reseaux/`**, **sans modèle ni migration** (rien n'est enregistré, tout est
  recalculé). `normes.py` (seuils — modifier ici modifie l'algorithme ET les contrôles),
  `geometrie.py` (Delaunay Bowyer-Watson en Python pur), `generation.py` (variantes
  `delaunay`, `delaunay_toleree`, `delaunay_stricte`, `quadrilateres`, + `rattachement` en
  réseau mixte ; contrôles par norme avec gravité bloquant/majeur/mineur ; `score` sur 100 ;
  `recommander` + `justifier` ; variante **parfaite** = raffinement glouton type Ruppert qui
  suggère des emplacements où rechercher des points anciens, avec rayon de recherche),
  `projection.py` (Lambert Maroc zones Nord/Sud/Sahara Nord/Sahara Sud, Clarke 1880 IGN +
  Helmert Merchich→WGS84 31/146/47, **vérifié contre PROJ**, sans dépendance) ;
- API (`IsAuthenticated`, tous rôles) : `GET /api/v1/reseau-gps/referentiel/`,
  `POST /api/v1/reseau-gps/generer/` (`points`, `type_reseau` `anciens`|`mixte`, `zone`,
  `longueur_max_km`, `nb_suggestions_max`), `GET sources-lpa/` et `sources-lpa/<ssdgps>/`
  (reprise de la LPA d'un SDGPS — **filtrée par `scope_queryset`**, zone proposée d'après la
  « Zone Projection » des PPA/PPN) ;
- front : module lazy `features/reseau-gps/` monté à `/reseau-gps` (opérateur) **et**
  `/admin/reseau-gps` (admins), entrée « Réseau GPS » des deux menus. Carte **Leaflet**
  (`reseau-carte`) ; fonds intégrés OSM / Esri imagerie & topo / OpenTopoMap / CARTO —
  **Google Satellite volontairement absent** (conditions des API Google Maps) ; fonds
  personnels XYZ/WMS enregistrés dans le **navigateur** (`localStorage`, `fonds-carte.ts`).
  Import CSV/Excel par `points-import.util.ts` (en-têtes LPA techniques ou libellés, colonne
  facultative `statut`). Les deux tableaux de la page (saisie des points, comparaison des
  variantes) ne sont **pas** des listes d'entités persistées : ils sont hors du périmètre des
  règles colonnes d'audit / configuration des colonnes / tri multi-niveaux ;
- tests : `backend/reseaux/tests.py` (projection vs PROJ, Delaunay, algorithme, API, RBAC) +
  specs `reseau-gps.service`, `points-import.util`, `fonds-carte`, `reseau-carte`,
  `reseau-gps-page`, `menu.config`.

**Journal d'audit (`accounts.models.AuditEvent`).** Les 7 colonnes d'audit disent qui a
touché une ligne **en dernier** ; elles ne disent pas ce qui a changé et ne gardent aucune
trace des actions qui ne modifient rien. Le journal, lui, enregistre QUI / QUOI / QUAND,
**consultations comprises** — exigence courante sur des données foncières.
- écrire un événement : **toujours** via `accounts/audit.py::journaliser(...)`, jamais
  `AuditEvent.objects.create()` en direct. Le helper fige l'email de l'acteur (la trace
  survit à la suppression du compte), déduit la cible, relève l'IP (proxy compris) et
  **ne lève jamais** : un journal en panne ne doit pas casser l'action journalisée ;
- **append-only** : `save()` refuse toute modification, `delete()` toute suppression. Un
  journal modifiable ne prouve rien ;
- actions couvertes : connexion (réussie / échouée / verrouillage), mot de passe
  (changement, réinitialisation), compte créé, **rôle modifié** (avant/après), membre
  rattaché à une organisation, **rapport généré**, suppression définitive. Ajouter une
  action = une constante `ACTION_*` + son libellé dans `AuditEvent.ACTIONS` ;
- lecture : `GET /api/v1/audit-events/` (+ `/actions/`), **réservé à l'administration de
  l'application** (`IsApplicationAdmin`), filtres `action` / `acteur` / `acteur_email` /
  `cible_id` / `depuis` / `jusqu_a`. Pas d'écran frontend à ce stade ;
- tests : `backend/accounts/tests_audit_journal.py`.

**Observabilité :** `backend/observability.py::configurer_sentry` (backend) et
`core/observability/sentry.ts` (frontend). **Inerte** tant que `SENTRY_DSN` /
`environment.sentryDsn` est vide — aucun appel réseau. `send_default_pii` reste à `False`
dans les deux : l'application manipule des données foncières nominatives, qui n'ont pas à
être recopiées chez un tiers.

**Création de comptes : AUCUNE inscription publique (règle stricte).** Il n'existe pas
d'endpoint d'inscription — `/api/auth/register/`, `RegisterView` et `RegisterSerializer`
ont été **supprimés** (ils créaient un compte *et* une organisation dont l'inscrit devenait
l'admin, sans aucune authentification). Un compte — **Admin Système, Admin Organisation ou
Agent Organisation** — ne peut être créé que par le **Super Admin** ou l'**Admin Système**
de l'application :
- unique point d'entrée : `POST /api/v1/users/` (`UserListView`), dont `get_permissions()`
  exige `IsApplicationAdmin` sur `POST` — la **lecture** reste ouverte à un Admin
  Organisation (filtrée par `get_queryset`) ;
- prédicat partagé : `accounts/permissions.py` → `is_application_admin(user)` /
  `IsApplicationAdmin` (Super Admin **ou** `platform_role == ROLE_ADMIN_SYSTEME` ; un Admin
  Organisation n'en relève **pas**). Réutiliser ce module pour toute nouvelle vue réservée
  à l'administration de l'application plutôt que de refaire le test à la main ;
- hiérarchie des rôles créables (`UserCreateSerializer.validate_role`, garde-fou en
  profondeur) : seul un Super Admin crée un **Admin Système** ; un Admin Système crée des
  Admins Organisation et des Agents, dans n'importe quelle organisation ;
- côté front : plus de route `/auth/register`, plus de composant d'inscription, plus de
  `AuthService.register()` ; le bouton « Ajouter » de la liste des utilisateurs est
  conditionné par `canCreateUser` (garde **cosmétique**) ;
- tests garde-fous : `backend/accounts/tests_account_creation.py` (24 cas),
  `auth-routing.module.spec.ts`, `user-list.component.spec.ts`.

### Structure du frontend (`frontend/src/app/`)
- `core/` — singletons transverses :
  - `auth/auth.service.ts` — login/reset (**pas d'inscription**), stocke le JWT dans `localStorage`
    (`authToken`), décode le JWT côté client pour extraire le rôle.
  - `interceptors/auth.interceptor.ts` — ajoute le token `Bearer` ; en cas de 401, purge le
    token et redirige vers `/auth/login`.
  - `guards/admin.guard.ts` — protège `/admin/**` ; autorise `ROLE_SUPER_ADMIN`,
    `ROLE_ADMIN_SYSTEME`, `ROLE_ORGANISATION_ADMIN` (rôle lu depuis le payload JWT). Ce
    guard est **cosmétique** : la vraie barrière de sécurité est côté backend.
  - `layout/` — `DashboardLayoutComponent` (coquille sidebar/topbar) qui englobe les routes
    de l'app.
  - `services/` — services organization/user/preferences/toast/password-validation.
- `features/` — modules de fonctionnalités chargés en lazy : `auth/`, `dashboard/`,
  `admin/users/`, `profile/`. Le routage est centralisé dans
  `core/.../app-routing.module.ts` ; de nombreuses routes admin utilisent encore un
  `PlaceholderComponent` en dur (modules en cours de construction).
- `shared/` — composants réutilisables (organization-form, toast, field-info).

Les modules sont importés en eager dans `app.module.ts` (`LayoutModule`, `AuthModule`,
`DashboardModule`, `UsersModule`) ; `auth` et `profile` sont aussi des routes lazy via
`loadChildren`.

## Pièges connus

État actuel du dépôt qui piège si on l'ignore (facts, pas des jugements) :

- **Ports incohérents.** Le front vise l'API sur le port **8085**
  (`frontend/src/environments/environment.ts`), mais les scripts PowerShell
  (`backend/scripts/setup/restart_servers.ps1`) lancent encore **8000** / **4200**. Le
  lancement de référence en développement reste **8085** (backend) et **4205** (front) —
  vérifier le port réel avant de brancher front↔back.
- **`package.json` → script `start`.** Il contient un `cd` vers un chemin absolu erroné
  (`...PythonProject...` au lieu de `perso`). `npm start` peut échouer ailleurs que sur la
  machine d'origine ; utiliser `ng serve` directement.
- **Deux endpoints change-password** (`accounts` et `platform_admin`) : vérifier lequel
  s'applique au type d'utilisateur visé.
- **Le JWT est un instantané de la connexion.** Il porte `user_id` (posé par simplejwt),
  `role`, `platform_role`, `is_superuser` et `org_id`. Ces valeurs ne suivent PAS un
  changement de rôle ou d'organisation : elles ne sont à jour qu'à la reconnexion. Le
  front peut s'en servir pour l'affichage, **jamais** comme contrôle d'accès — le backend
  relit toujours la base.

Entrées **corrigées** depuis (conservées pour mémoire, le piège n'existe plus) :
`auth.service.ts` importe bien `environment.apiUrl` ; le défaut DRF est passé à
`IsAuthenticated` ; `Pillow` figure dans `requirements.txt` ; le claim `org_id` est posé
à la connexion ; l'intercepteur implémente un vrai rafraîchissement de jeton sur 401.

## Politique de tests (OBLIGATOIRE)

**Toute nouvelle fonctionnalité ou correction de bug DOIT être accompagnée de tests**, dans
le même changement. C'est une exigence, pas une option — elle s'applique à tous les
assistants de codage IA comme aux contributeurs humains (cf. `AGENTS.md`).

- **Backend** (Django/DRF) : tests dans `app/tests.py` ou `app/tests_*.py`, exécutés par
  `python manage.py test`. Couvrir : la règle métier / le happy-path, les cas d'erreur et de
  validation, et le **scoping RBAC** (permissions par rôle) pour toute vue exposée.
- **Frontend** (Angular) : specs `*.spec.ts` à côté du code, exécutées par
  `npm run test:ci` (Karma/Jasmine, headless). Couvrir au minimum les **services** (avec
  `HttpClientTestingModule`), les **guards/interceptors**, et la logique non triviale des
  composants.
- **Definition of Done** : une fonctionnalité n'est « terminée » que si `python manage.py
  test` **et** `npm run test:ci` passent au vert, en local et en CI
  (`.github/workflows/ci.yml`).
- Écrire les tests au fil de l'eau (idéalement avant/pendant l'implémentation), pas « plus
  tard ». Un correctif de bug commence par un test qui reproduit le bug.
- Ne jamais désactiver, ignorer (`skip`/`xit`) ou supprimer un test pour faire passer la CI
  sans justification explicite dans le message de commit.

## Règles du dépôt (local et distant)

> Règles reprises du dépôt frère `ancfcc/datacap-web` (section « Règles du dépôt » de son
> `README.md`) et adaptées à ce projet. Elles sont mises à jour à chaque nouvelle règle adoptée.

### Dépôts

| Dépôt | Emplacement |
|---|---|
| Local | `D:\BOULMANE\PycharmProjects\perso\ancfcc\app-sdgps` |
| Distant (`origin`, privé) | https://github.com/blmerio2022/app_sdgps |

Identité Git configurée **pour ce dépôt uniquement** :
`blmerio2022 <120096166+blmerio2022@users.noreply.github.com>`.

### Branches

| Branche | Rôle |
|---|---|
| `main` | Production : code stable et livré. Aucun commit direct. |
| `develop` | Intégration (branche par défaut sur GitHub). Reçoit les `feature/vX.Y` via PR. |
| `feature/vX.Y` | Branche de travail de la version en cours (`feature/v1.0`, puis `feature/v1.1`, …). Une seule version active à la fois. |

Les branches historiques (`fix/*`, `release/*`, `chore/*`, `docs/*`, `feature/<sujet>`) restent
dans l'historique mais le **modèle à suivre désormais est `feature/vX.Y`**.

### Cycle de vie d'une version

1. Créer `feature/vX.Y` à partir de `develop` à jour et la pousser
   (`git push -u origin feature/vX.Y`).
2. Développer : **un commit par fonctionnalité ou tâche terminée**, poussé immédiatement vers
   `origin` (le dépôt distant est toujours synchronisé avec le local).
3. Quand toutes les tâches de la version sont terminées et testées (cf. « Politique de tests ») :
   ouvrir une **PR `feature/vX.Y` → `develop`**, puis la fusionner.
4. Créer `feature/vX.(Y+1)` depuis `develop` et continuer.
5. Quand `develop` atteint un jalon stable : PR `develop` → `main`
   (**uniquement sur demande explicite**).

### Pull Requests

- **Toute PR cible et est fusionnée dans `develop`, sauf indication contraire explicite.**
- Fusion par **commit de merge** (`gh pr merge <n> --merge`) pour conserver l'historique de la
  version — jamais de squash ni de rebase à la fusion.
- Après la fusion, `develop` est fusionnée dans la branche `feature/vX.Y` en cours pour rester à
  jour.
- La procédure détaillée (vérification de `mergeable`, attente de la CI) est la règle stricte
  « Fusion vers `develop` / `main` : JAMAIS sans PR » ci-dessous : elle s'applique intégralement.

#### Suivi des PR fusionnées

Tableau tenu à jour **à chaque fusion** (une ligne par PR, la plus récente en bas).
Les PR vers `main` sont les promotions de version ; toutes les autres ciblent `develop`.

| PR | Branche | Cible | Fusionnée le |
|---|---|---|---|
| [#1](https://github.com/blmerio2022/app_sdgps/pull/1) — analytique de stockage, RBAC suivi-créateur & stockage S3 | `feature/import-donnees-pieces` | `develop` | 2026-07-21 |
| [#2](https://github.com/blmerio2022/app_sdgps/pull/2) — suite de tests backend/frontend + pipeline CI/CD | `release/preparation-deploiement` | `develop` | 2026-07-21 |
| [#3](https://github.com/blmerio2022/app_sdgps/pull/3) — préparation déploiement : seed métier + prep Railway | `release/preparation-deploiement` | `develop` | 2026-07-23 |
| [#4](https://github.com/blmerio2022/app_sdgps/pull/4) — savepoint migration Postgres + vars/gunicorn/whitenoise | `release/preparation-deploiement` | `develop` | 2026-07-23 |
| [#5](https://github.com/blmerio2022/app_sdgps/pull/5) — synchro mots de passe + CI GHCR sur develop | `release/preparation-deploiement` | `develop` | 2026-07-23 |
| [#6](https://github.com/blmerio2022/app_sdgps/pull/6) — `fileReplacements` env.prod en build production | `release/preparation-deploiement` | `develop` | 2026-07-23 |
| [#7](https://github.com/blmerio2022/app_sdgps/pull/7) — supprime le super admin par défaut | `release/preparation-deploiement` | `develop` | 2026-07-23 |
| [#8](https://github.com/blmerio2022/app_sdgps/pull/8) — retire cadazilal + 2 admins système & 3 admins org | `release/preparation-deploiement` | `develop` | 2026-07-23 |
| [#9](https://github.com/blmerio2022/app_sdgps/pull/9) — corrige l'organisation des agents | `release/preparation-deploiement` | `develop` | 2026-07-23 |
| [#10](https://github.com/blmerio2022/app_sdgps/pull/10) — supprime le projet démo `DEMO-SEED-01` + cascade | `release/preparation-deploiement` | `develop` | 2026-07-23 |
| [#11](https://github.com/blmerio2022/app_sdgps/pull/11) — tests migration 0025 indépendants de l'environnement | `release/preparation-deploiement` | `develop` | 2026-07-23 |
| [#12](https://github.com/blmerio2022/app_sdgps/pull/12) — services du cadastre ANCFCC (organismes N2) | `release/preparation-deploiement` | `develop` | 2026-07-23 |
| [#13](https://github.com/blmerio2022/app_sdgps/pull/13) — ne conserver que les services du fichier ANCFCC | `release/preparation-deploiement` | `develop` | 2026-07-23 |
| [#14](https://github.com/blmerio2022/app_sdgps/pull/14) — socle des environnements progressifs | `release/preparation-deploiement` | `develop` | 2026-07-23 |
| [#15](https://github.com/blmerio2022/app_sdgps/pull/15) — aligne `main` sur `develop` (production sur `main`) | `develop` | `main` | 2026-07-23 |
| [#16](https://github.com/blmerio2022/app_sdgps/pull/16) — finalise la config des 4 environnements | `release/preparation-deploiement` | `develop` | 2026-07-23 |
| [#17](https://github.com/blmerio2022/app_sdgps/pull/17) — `sync-fork` pousse via le PAT | `release/preparation-deploiement` | `develop` | 2026-07-23 |
| [#18](https://github.com/blmerio2022/app_sdgps/pull/18) — `initial_data.json` source unique + `reset_db` | `release/preparation-deploiement` | `develop` | 2026-07-24 |
| [#19](https://github.com/blmerio2022/app_sdgps/pull/19) — déploiement tag-based (rc→preprod, release→production) | `chore/ci-tag-based-deploy` | `develop` | 2026-07-24 |
| [#20](https://github.com/blmerio2022/app_sdgps/pull/20) — colonnes d'audit unifiées, modale des colonnes, info-bulles | `fix/v1.0.1-corrections-ui` | `develop` | 2026-07-26 |
| [#21](https://github.com/blmerio2022/app_sdgps/pull/21) — filtre de colonne façon Excel | `fix/v1.0.1-corrections-ui` | `develop` | 2026-07-27 |
| [#22](https://github.com/blmerio2022/app_sdgps/pull/22) — corrections UI/UX des pages pièces + règles de dépôt | `fix/v1.0.1-corrections-ui` | `develop` | 2026-11-05 |
| [#23](https://github.com/blmerio2022/app_sdgps/pull/23) — promotion de `develop` vers `main` (v1.0.1) | `develop` | `main` | 2026-11-05 |

### Conventions de commit

- Format [Conventional Commits](https://www.conventionalcommits.org/) **en français** :
  `type(portée): description` — types : `feat`, `fix`, `perf`, `refactor`, `docs`, `test`,
  `chore`.
- Description à l'**impératif**, en minuscule, sans point final ; la portée est le domaine
  fonctionnel (`pieces`, `users`, `organisations`, `projets`, `ci`, `depot`…).
- Exemple : `feat(pieces): extraire les métadonnées EXIF des images jointes`.
- **Un commit par fonctionnalité ou tâche terminée**, poussé immédiatement.

### Secrets et fichiers locaux

- **Jamais de mot de passe ni de jeton dans le dépôt.** Les secrets vont dans
  `backend/.env.<environnement>` (non suivis) ; seuls les templates `*.example` sont versionnés.
- Non suivis (voir `.gitignore`) : `backend/.env.*`, `db.sqlite3`, `media/`, `logs/`, `*.log`,
  données de travail volumineuses (`*.gpkg`, `docs/exemples-ssdgps/`) et configurations d'éditeur
  locales (`*.code-workspace`).

### Tenue de la documentation

`CLAUDE.md` (et `AGENTS.md` quand il est concerné) est mis à jour **dans le même commit** que
toute nouvelle règle de dépôt, nouvelle fonctionnalité transverse ou nouvelle commande.

## Conventions & notes de workflow

- **Règles d'auto-commit** (`.opencode/instructions.md`) : ce dépôt est configuré pour un
  workflow OpenCode qui réinitialise l'espace de travail lors des changements de mode ; il
  impose de committer après chaque fonctionnalité/correction. Format des messages :
  `type(portée): description` — voir « Conventions de commit » ci-dessus, qui fait foi. Les
  commits `wip: auto-save` de l'historique proviennent de cet outillage et ne sont **plus** un
  format acceptable.

- **Fusion vers `develop` / `main` : JAMAIS sans PR (règle stricte).** Ne **jamais** fusionner une
  branche dans `develop` ou `main` en local (pas de `git merge` depuis ces branches, même quand un
  fast-forward est possible). Le passage par une **pull request** est obligatoire :
  1. pousser la branche de travail (`git push origin <branche>`) ;
  2. créer la PR : `gh pr create --base develop --head <branche>` (ou `--base main`) ;
  3. **vérifier l'absence de conflit** : `gh pr view <n> --json mergeable,mergeStateStatus` →
     exiger `mergeable: "MERGEABLE"`. Si `CONFLICTING`, résoudre **dans la branche de travail**
     (rebase/merge depuis la cible), pousser, puis re-vérifier — ne jamais forcer la fusion ;
  4. **attendre la CI** (`gh pr checks <n> --watch`) : `test-backend` **et** `test-frontend` doivent
     être au vert. `mergeStateStatus: UNSTABLE` = checks en cours ou en échec → ne pas fusionner ;
  5. fusionner seulement ensuite (`gh pr merge <n> --merge`), puis resynchroniser le local
     (`git fetch --prune` + `git merge --ff-only origin/develop` sur la branche cible) et **revenir
     sur la branche de travail**.
  Cette règle prime sur toute demande de « fusionner dans develop » : proposer/créer la PR plutôt
  que de fusionner directement en local.
- Le `.env` (backend) contient les clés SendGrid, les identifiants d'amorçage du super-admin
  et les flags `ENVIRONMENT` / `SHOW_TEST_DATA`. Il est gitignoré mais présent en local.
- Les composants Angular utilisent **SCSS** par défaut (schematics de `angular.json`).

- **Barres de défilement : style UNIQUE, défini une seule fois (règle stricte).** Tous les
  défilements de l'app — **verticaux comme horizontaux** — partagent le même style, déclaré
  **globalement** dans `frontend/src/styles.scss` (section « BARRES DE DÉFILEMENT »). La référence
  est le défilement de la modale d'organisation des colonnes.
  - **Ne JAMAIS redéfinir `::-webkit-scrollbar`, `scrollbar-width` ou `scrollbar-color` dans un
    composant.** La règle globale (`*::-webkit-scrollbar…`) s'applique automatiquement à tout
    conteneur défilant, existant ou futur : un nouveau composant n'a **rien** à styler.
  - Style de référence : rail **transparent**, pouce **fin et arrondi** en `--border-color`,
    détaché des bords (`border: 2px solid transparent` + `background-clip: padding-box`), accentué
    en `--accent-color` au survol ; `8px` en largeur (vertical) **et** en hauteur (horizontal) ;
    `scrollbar-width: thin` + `scrollbar-color` pour Firefox ; coin (`-corner`) transparent.
  - Côté composant, ne poser que ce qui relève de la **mise en page** : `overflow`, `max-height`,
    `min-height: 0` (indispensable dans un conteneur flex pour que l'enfant défile), et
    éventuellement une gouttière (`padding-right` + `margin-right` négatif) pour éviter que la
    barre ne décale le contenu.
  - Vérification : `grep -rn "webkit-scrollbar\|scrollbar-width\|scrollbar-color" frontend/src/app`
    ne doit **rien** renvoyer (toutes les définitions vivent dans `styles.scss`).
- Référence de design : `docs/ui-design-spec.md` ; notes de travail dans `docs/notes/`,
  plans dans `docs/plans/PLAN_DEV.md`.
- **Tri multi-niveaux (parité obligatoire entre toutes les pages).** La fonctionnalité de tri
  multi-niveaux des tableaux (bouton « Trier » + modale de configuration) doit avoir **le même
  design, le même style et les mêmes options partout dans l'app**. Options standard de la modale :
  niveaux ordonnables (placer en premier/monter/descendre/placer en dernier + retirer),
  **« Effacer le tri »** (vide tous les niveaux), **« Réinitialiser avec la configuration source »**
  (hérite du compte administrateur), ajout de niveau, enregistrement automatique. Le bouton
  « Trier » a un état par défaut (aucun tri) lisible et un état actif accentué (`.btn-sort-multi`).
  - **Composant partagé (à privilégier pour toute NOUVELLE liste).**
    `shared/components/multi-level-sort/` — composant présentationnel `<app-multi-level-sort>`
    (bouton + modale, design identique aux organisations) + helpers `multi-level-sort.util.ts`
    (`compareByLevels`, `sortLevelOf`, `sortDirOf`). Persistance générique par utilisateur via
    `core/services/table-sort-config.service.ts` (clé de tableau) → backend
    `CustomUser.table_sort_configs` + endpoints `me/table-sort-config/<key>/` (+ `/reset/`),
    allowlists dans `accounts/views.py::TABLE_SORT_FIELDS`. Le parent conserve `sortLevels`,
    branche `[levels]`/`(levelsChange)`/`(resetToSource)`, applique `compareByLevels` et affiche
    les marqueurs d'en-tête (`.sort-badge`). Intégré ainsi (clés `TABLE_SORT_FIELDS`) :
    **utilisateurs** (`users`), **projets** (`projects`), **explorateur de projet** — un tableau
    par niveau : `project_proprietes` / `project_affaires` / `project_ssdgps` / `project_sessions`
    (l'explorateur garde une config de tri **par niveau** dans `sortLevelsByLevel`), et **liste
    des pièces d'un rapport SSDGPS** (`pieces`). Quand le bouton et l'en-tête vivent dans des
    blocs `*ngIf` frères, ouvrir la modale via `@ViewChild(MultiLevelSortComponent)` + `openSort()`
    (une variable de template `#sorter` n'est pas visible d'une vue embarquée à l'autre).
    ⚠️ Le tri des **pièces** ci-dessus porte sur la **liste** des pièces d'un rapport ; il est
    distinct du tri des **données internes** d'une pièce (`piece_sort_config`, par type, via
    *Profil → Paramètres de tri des pièces*) — ne pas confondre.
  - **Toutes les listes utilisent désormais le composant partagé** (plus aucune copie inline du
    bouton/modale). Les 3 surfaces « historiques » — liste des organisations
    (`features/dashboard/organization-list`), listes des organismes niveau 1 & 2
    (`features/admin/organismes/organisme-list`), liste des SSDGPS
    (`features/projects/project-ssdgps-list`) — ont été **migrées** vers `<app-multi-level-sort>`
    tout en conservant leurs services/endpoints backend **dédiés** (`org-sort-config`,
    `organisme-sort-config`, `ssdgps-sort-config`) : seule l'UI est mutualisée. Le parent garde
    `sortLevels`, `sortLevelOf`/`sortDirOf`, `compareByLevels`, `onSortLevelsChange`, `onResetSort`,
    et ouvre la modale via `@ViewChild(MultiLevelSortComponent)` + `openSortConfig()`.

- **Colonnes d'audit OBLIGATOIRES (règle transverse, tout nouveau tableau).** Tout tableau de
  l'app doit exposer ces **7 colonnes**, avec ces **noms de champ** et ces **libellés exacts** —
  ils sont **unifiés dans toute l'application**, ne jamais en inventer de variante
  (« Date de création », « Dernière modification », « Email du créateur »… sont **proscrits**) :

  | Champ API | Libellé | Type |
  |---|---|---|
  | `created_by_email` | **Créé par** | text |
  | `created_at` | **Créé le** | date |
  | `updated_by_email` | **Modifié par** | text |
  | `updated_at` | **Modifié le** | date |
  | `is_deleted` | **Supprimé** | boolean |
  | `deleted_by_email` | **Supprimé par** | text |
  | `deleted_at` | **Supprimé le** | date |

  - **Source de vérité unique (front)** : `shared/components/column-config/audit-columns.ts`
    (`auditColumns()`, `withAuditColumns()`, `AUDIT_COLUMN_LABELS/DESCRIPTIONS/ORDER`,
    `isAuditColumn()`). Un nouveau tableau **concatène** simplement le catalogue partagé en fin de
    ses colonnes métier : `columns = [ ...colonnes métier..., ...auditColumns() ]`, et réutilise
    `AUDIT_COLUMN_ORDER/LABELS` pour ses `sortableFields` ainsi que `AUDIT_COLUMN_DESCRIPTIONS`
    pour son `getFieldDescription`. **Ne jamais réécrire ces libellés à la main.**
  - Masquées par défaut (`visible: false`) — activables via la modale « Colonnes ». Le rendu des
    cellules suit le patron générique (cf. `project-list`) : dates via `formatDate()`, `is_deleted`
    en badge Oui/Non, `*_by_email` avec repli `—`.
  - **Backend** : déclarer les 7 champs dans `TABLE_COLUMN_FIELDS[<clé>]` (`accounts/views.py`) et
    dans l'allowlist de tri du tableau, et les exposer dans le serializer.
  - **Auteurs : toujours `AuthorDisplayField`** (`accounts/fields.py`), branché sur la **clé
    étrangère** (`source='created_by'`, `'updated_by'`, `'modified_by'`, `'deleted_by'`) et non sur
    `…​.email`. Il rend le **nom complet** de l'utilisateur (repli sur l'email si le compte n'a ni
    prénom ni nom) et garantit que le champ vaut `null` au lieu d'être **omis** quand la FK est
    nulle — un `EmailField(source='x.email')` sans `allow_null=True` déclenche `SkipField` et la
    colonne disparaît alors du payload. ⚠️ Le **nom** des champs exposés reste `*_by_email` : il
    est figé dans les allowlists et dans les configurations de colonnes déjà enregistrées par les
    opérateurs ; seule la **valeur** est un nom complet.
  - **Capture des auteurs** : renseigner `created_by`/`updated_by` dans `perform_create` /
    `perform_update` et `deleted_by` (+ `deleted_at`) sur **tous** les chemins de suppression
    logique, y compris les suppressions **en masse**.
  - **Exceptions historiques** : l'organisation utilise le champ DB `modified_by` — l'API expose
    l'alias `updated_by_email` (nom unifié) **et** `modified_by_email` (compatibilité). Pour les
    utilisateurs, `date_joined` tient lieu de date de création et est aliasé en `created_at`.
  - Tests garde-fous : `backend/accounts/tests_audit_columns.py` (toutes les clés déclarent les 7
    colonnes + capture des auteurs) et `audit-columns.spec.ts` (libellés unifiés).

- **Configuration des colonnes (parité stricte avec le tri multi-niveaux).** Chaque tableau
  enregistre sa config de **colonnes** (affichées/masquées **+ ordre**) **par utilisateur**, héritée
  par défaut du **compte super admin (source)**, avec **auto-save** et bouton **« Réinitialiser avec
  la configuration source »**. Mécanisme miroir du tri :
  - **Composant partagé unique** `shared/components/column-config/` — `<app-column-config>` (bouton
    « Colonnes » + modale : cases visibilité, réordonnancement flèches **+ drag&drop**, filtre
    toutes/visibles, tout sélectionner/désélectionner/inverser, indicateur auto-save, reset-source,
    **pas de OK/Annuler**). Helpers `column-config.util.ts` (`applyColumnsConfig(catalog, stored)`,
    `toColumnPrefs`, interfaces `ManagedColumn`/`StoredColumnPref`). Déclaré dans `shared.module.ts`.
  - **Service générique** `core/services/table-columns-config.service.ts` (`get/save/resetToSource`,
    cache par clé) → backend `CustomUser.table_columns_configs` (dict `{clé: [{field,visible}]}`) +
    endpoints `me/table-columns-config/<key>/` (+ `/reset/`), allowlist `TABLE_COLUMN_FIELDS` dans
    `accounts/views.py` (catalogue COMPLET des colonnes, triables **et** non triables). Source =
    `superadmin_table_columns_config(key)` (`piece_defaults.py`). **Un seul champ générique** pour
    les 11 tableaux (pas de champ dédié, contrairement au tri).
  - **11 clés** : `organizations`, `organisme_niveau1`, `organisme_niveau2`, `users`, `projects`,
    `project_proprietes` / `project_affaires` / `project_ssdgps` / `project_sessions` (explorateur,
    config **par niveau** — clé = `sortKey` du niveau courant), `ssdgps` (liste SSDGPS), `pieces`.
  - **Intégration parent** : garde le catalogue `columns` (source de vérité), charge via
    `svc.get(key)` → `applyColumnsConfig`, branche `[columns]`/`(columnsChange)`/`(resetToSource)`,
    auto-save debouncé, ouvre la modale via `@ViewChild(ColumnConfigComponent)` +
    `openColumnConfig()` (bouton **et** menu contextuel `openColumnConfigFromContext`). La
    persistance `localStorage` des colonnes a été **retirée** (backend = source de vérité ; le
    `viewMode` reste en localStorage).
