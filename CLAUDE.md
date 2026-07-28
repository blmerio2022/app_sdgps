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
- Racines des URL (`backend/urls.py`) :
  - `/api/auth/` → accounts (register, login, forgot/verify/reset/change password, `me/`)
  - `/api/v1/users/` → gestion des utilisateurs
  - `/api/v1/organizations/` → organisations
  - `/api/v1/platform-admin/` → profil super-admin

**Contrôle d'accès :** le défaut DRF est `AllowAny` (voir « Pièges connus »). L'application
des permissions se fait **par vue** : les vues admin filtrent au niveau du queryset et de
l'objet (`get_queryset` renvoie `none()` pour un non-admin ; `can_manage_user()` +
`check_object_permissions` dans `users_views.py`). Toujours vérifier la vue quand on
raisonne sur les droits.

### Structure du frontend (`frontend/src/app/`)
- `core/` — singletons transverses :
  - `auth/auth.service.ts` — login/register/reset, stocke le JWT dans `localStorage`
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
  (`frontend/src/environments/environment.ts`, et en dur dans `auth.service.ts`), mais le
  backend et les scripts tournent sur **8000**. Certains scripts servent le front sur
  **4205** au lieu de 4200. Vérifier le port réel avant de brancher front↔back.
- **URL d'API en dur.** `auth.service.ts` code `API_URL` en dur au lieu d'importer
  `environment.apiUrl`. Modifier `environment.ts` seul ne suffit pas.
- **`package.json` → script `start`.** Il contient un `cd` vers un chemin absolu erroné
  (`...PythonProject...` au lieu de `perso`). `npm start` peut échouer ailleurs que sur la
  machine d'origine ; utiliser `ng serve` directement.
- **JWT partiel.** Le token ne pose que `role`, `platform_role`, `is_superuser`
  (`accounts/views.py`). Il ne contient **pas** `org_id`/`user_id`, alors que le front les
  lit → `getOrganizationId()`/`getUserId()` renvoient toujours `null`.
- **Défaut DRF `AllowAny`.** `DEFAULT_PERMISSION_CLASSES = ['AllowAny']` : toute nouvelle
  vue est publique tant qu'elle ne pose pas explicitement `IsAuthenticated`.
- **Deux endpoints change-password** (`accounts` et `platform_admin`) : vérifier lequel
  s'applique au type d'utilisateur visé.
- **Pillow** est requis (`ImageField` sur les logos/photos) mais absent de
  `requirements.txt` (seulement installé dans le `Dockerfile`).

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

## Conventions & notes de workflow

- **Règles d'auto-commit** (`.opencode/instructions.md`) : ce dépôt est configuré pour un
  workflow OpenCode qui réinitialise l'espace de travail lors des changements de mode ; il
  impose de committer après chaque fonctionnalité/correction. Format des messages :
  `type(scope): description` (ex. `feat(users): add ROLE_SUPER_ADMIN filter`). Les commits
  `wip: auto-save` de l'historique proviennent de cet outillage.

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
