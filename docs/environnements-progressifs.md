# Stratégie des environnements progressifs

Le code remonte progressivement à travers **4 environnements**, chacun avec **sa propre base de
données** (on ne mélange jamais les données) :

```
Code  →  DEV         →  STAGING      →  PREPROD       →  PRODUCTION
        (moi)          (équipe)         (client)         (tout le monde)
```

| Environnement | `ENVIRONMENT` | Public        | Base de données        | Données démo/test |
|---------------|---------------|---------------|------------------------|-------------------|
| Développement | `development` | Moi           | **SQLite** locale      | visibles          |
| Staging       | `staging`     | Équipe        | **PostgreSQL** dédiée  | visibles          |
| Préprod       | `preprod`     | Client        | **PostgreSQL** dédiée  | **masquées**      |
| Production    | `production`  | Tout le monde | **PostgreSQL** dédiée  | **masquées**      |

## Sélection de l'environnement

La variable **`ENVIRONMENT`** (posée par l'OS / Docker / Railway, jamais dans un `.env`) pilote
tout (`backend/settings.py`) :

- charge `backend/.env.<ENVIRONMENT>` s'il existe (sinon repli sur les variables d'env du service) ;
- choisit le **moteur BDD** : PostgreSQL pour `staging`/`preprod`/`production`, SQLite pour `development`
  (`settings.SERVER_ENVIRONMENTS`) ;
- active les protections « type production » pour `preprod`/`production`
  (`settings.PRODUCTION_LIKE_ENVIRONMENTS` → `IS_PRODUCTION_LIKE`) :
  - les organisations `is_test_data=True` sont **masquées** (`OrganizationManager`).

> **Aucune donnée de démo/test n'est générée, dans aucun environnement.** Les commandes
> `seed_demo_orgs`, `generate_test_data` et `seed_test_users` ont été **supprimées** : tous les
> environnements (dev/staging/preprod/production) n'utilisent que les données d'initialisation
> (`initial_data.json`).

Chaque environnement a un fichier `.env.<env>` (non versionné, ex. `.env.development`,
`.env.production`). Aucun modèle `.example` n'est versionné : localement on renseigne
directement `.env.<env>` ; sur les serveurs (**staging**, **preprod**, **production**), la
config est posée en variables de service (Railway). Les clés attendues sont lues par
`settings.py` (`config(...)`) et par `docker-compose.yml`.

## Bases de données séparées

Chaque environnement pointe vers **une base distincte** via `DATABASE_URL` (ou `POSTGRES_*`). Sur
Railway, chaque environnement possède son propre service PostgreSQL — aucune connexion n'est
partagée entre dev/staging/preprod/production.

## Données d'initialisation (identiques dans les 4 — première étape)

Le seed (`accounts.seeding.run_seed`, rejoué à chaque `migrate` via le signal `post_migrate`)
lit **les mêmes fichiers embarqués** quel que soit l'environnement :

- `accounts/seed_data/initial_data.json` — utilisateurs de référence, organisations, organismes ;
- `accounts/seed_data/business_data.json` — données métier (projets → pièces) + médias.

Donc, **dans un premier temps, les 4 environnements sont initialisés avec les mêmes données**.
Différenciation possible plus tard via la variable `SEED_DATA_FILE` (fichier monté par
environnement) sans changer le code.

## Flux de promotion (branches → environnements) — « build once, promote »

Câblé dans le CI/CD ([.github/workflows/ci-cd.yml](../.github/workflows/ci-cd.yml)) :

```
feature/* ──PR──▶ develop ──▶ [BUILD UNIQUE] ──▶ STAGING      (déploiement auto sur merge)
                    │
                    └──PR──▶ release/* ──▶ [re-tag, PAS de build] ──▶ PREPROD   (validation client)
                                 │
                                 └──PR──▶ main ──▶ [re-tag, PAS de build] ──▶ PRODUCTION  (live)
```

- **L'image n'est construite qu'UNE fois**, au merge sur `develop` (image racine Angular +
  Django). Elle est poussée dans GHCR avec un tag immuable `:sha-<court>` et le tag mouvant
  `:staging`.
- Les promotions **ne reconstruisent jamais** l'image : elles **re-taguent le même digest**
  (`:staging`→`:preprod`, puis `:preprod`→`:production`+`:latest`) via
  `docker buildx imagetools create` (copie de manifeste côté registre). L'image livrée en
  production est donc **exactement** celle validée en staging puis préprod.
- On ne déploie jamais directement en production : un changement doit avoir traversé
  STAGING puis PREPROD (garanti structurellement, chaque étage promeut le digest de l'étage
  précédent).

## Mise en place Railway (résumé)

Railway **consomme** l'image GHCR (il ne la construit **pas** lui-même). La CI tourne dans le fork
`onedevasus/app_sdgps` (synchronisé depuis l'upstream `blmerio2022/app_sdgps`) et publie l'image
sous `ghcr.io/onedevasus/app_sdgps`. Un **projet** Railway (compte onedevasus) avec ses
environnements : `staging`, `preprod`, `production` (`development` local). Pour chaque environnement
serveur :

1. un service **PostgreSQL** dédié (`DATABASE_URL=${{Postgres.DATABASE_URL}}`) ;
2. le service applicatif avec **Source = image Docker** `ghcr.io/onedevasus/app_sdgps:<env>` (tag
   mouvant), `ENVIRONMENT=<env>`, un **volume** `/app/media`, et les secrets (`SECRET_KEY`,
   SendGrid, comptes seedés). Package privé → identifiants de registre GHCR dans Railway ;
3. le redéploiement est **déclenché par la CI** (token de projet Railway scopé à l'environnement).

Procédure détaillée pas-à-pas : voir [deploiement-railway-ghcr.md](deploiement-railway-ghcr.md).
