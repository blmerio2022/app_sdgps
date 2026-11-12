# Déploiement Railway depuis les images GHCR (« build once, promote »)

Ce document décrit comment Railway **consomme** les images Docker construites par la CI (GHCR),
sans jamais reconstruire l'image lui-même, et comment la même image est **promue** de STAGING vers
PREPROD puis PRODUCTION.

Voir aussi : [environnements-progressifs.md](environnements-progressifs.md) (stratégie des 4
environnements), [.github/workflows/ci-cd.yml](../.github/workflows/ci-cd.yml) (build/promotion/redeploy)
et [.github/workflows/sync-fork.yml](../.github/workflows/sync-fork.yml) (miroir upstream → fork).

## Topologie des dépôts

```
 blmerio2022/app_sdgps  ──(push main/develop/release/*)──▶  sync-fork.yml (PAT)
   (UPSTREAM : dev)                                              │  miroir --force
                                                                 ▼
                                          onedevasus/app_sdgps  ──▶  CI ci-cd.yml
                                            (FORK : CI + images)      tests → build → promote
                                                                       │  push GHCR (privé)
                                                                       ▼
                                            ghcr.io/onedevasus/app_sdgps:{staging,preprod,production}
                                                                       │  redeploy (railway CLI)
                                                                       ▼
                                            Railway (compte onedevasus) : 3 environnements
```

- Le **développement** se fait dans l'upstream `blmerio2022/app_sdgps`.
- À chaque push sur `main`/`develop`/`release/*`, `sync-fork.yml` **recopie la branche** dans le
  fork `onedevasus/app_sdgps` (push `--force` avec un **PAT**, ce qui déclenche la CI du fork).
- La CI (`ci-cd.yml`) **ne construit/promeut/redéploie que dans le fork** (jobs gatés par
  `github.repository != 'blmerio2022/app_sdgps'`). Les images vivent donc sous
  `ghcr.io/onedevasus/app_sdgps`, dans le **même compte** que Railway (permissions simples).
- Railway (compte onedevasus) tire l'image GHCR **privée** via des identifiants de registre.

## Principe : un seul build, promotion par re-tag

```
sync develop   → BUILD UNIQUE (image racine) → GHCR :sha-<court> + :staging → redeploy STAGING
sync release/* → re-tag digest :staging  → :preprod            (aucun rebuild) → redeploy PREPROD
sync main      → re-tag digest :preprod  → :production + :latest (aucun rebuild) → redeploy PROD
```

- L'image (SPA Angular buildé **puis** servi par Django/WhiteNoise, service unique) est celle du
  [Dockerfile racine](../Dockerfile).
- Le re-tag utilise `docker buildx imagetools create` : copie du **manifeste côté registre**, aucun
  pull ni rebuild → l'octet-pour-octet est préservé de staging à production.
- Chaque étage promeut le digest de l'étage précédent : impossible d'atteindre la prod sans être
  passé par staging puis preprod.

## Image GHCR

`ghcr.io/onedevasus/app_sdgps` (namespace du fork où tourne la CI). Tags produits :

| Tag             | Signification                                   | Écrit par (branche)     |
|-----------------|-------------------------------------------------|-------------------------|
| `sha-<court>`   | Build immuable et traçable                       | `develop` (build)       |
| `staging`       | Tag mouvant suivi par l'env STAGING              | `develop` (build)       |
| `preprod`       | Tag mouvant suivi par l'env PREPROD              | `release/*` (promotion) |
| `production`    | Tag mouvant suivi par l'env PRODUCTION           | `main` (promotion)      |
| `latest`        | Alias de `production` (utilisé par docker-compose local) | `main` (promotion) |

## Secrets & variables GitHub Actions

### Dans l'UPSTREAM `blmerio2022/app_sdgps` (pour le miroir)
- **Secret** `FORK_SYNC_TOKEN` — PAT du compte **onedevasus** (propriétaire du fork) avec les
  scopes `repo` **et** `workflow` (le miroir pousse aussi les fichiers `.github/workflows/`).
- **Variable** `FORK_REPOSITORY` — slug exact du fork, ex. `onedevasus/app_sdgps`.

### Dans le FORK `onedevasus/app_sdgps` (pour build/promotion/redeploy)
- **Secrets** `RAILWAY_TOKEN_STAGING`, `RAILWAY_TOKEN_PREPROD`, `RAILWAY_TOKEN_PRODUCTION` —
  tokens de projet Railway scopés à chaque environnement.
- **Variable** `RAILWAY_SERVICE` — nom du service applicatif Railway à redéployer.
- `GITHUB_TOKEN` (fourni) suffit pour pousser/re-taguer dans `ghcr.io/onedevasus/...`.
- **Activer GitHub Actions** dans le fork (désactivées par défaut sur un fork).

> Le redéploiement est déclenché par la CLI Railway : `railway redeploy --service <RAILWAY_SERVICE>
> --yes`, authentifiée par `RAILWAY_TOKEN` (token scopé à un environnement → pas de flag
> `--environment`). Le service suivant un **tag mouvant**, `redeploy` re-tire le nouveau digest.

## Configuration Railway (une fois par environnement)

Pour chaque environnement Railway — `staging`, `preprod`, `production` :

1. **Service applicatif → Source = Docker image** : `ghcr.io/onedevasus/app_sdgps:<env>`
   (`:staging`, `:preprod` ou `:production`). **Ne pas** connecter le dépôt GitHub comme source,
   sinon Railway rebuilderait l'image.
   - Package **privé** → renseigner des **identifiants de registre** dans Railway :
     username = `onedevasus`, password = PAT `read:packages` du compte onedevasus.
2. **Service PostgreSQL dédié** ; variable d'app `DATABASE_URL=${{Postgres.DATABASE_URL}}`.
3. **Variables de service** (équivalent de `backend/.env.<env>.example`, posées comme variables
   Railway — jamais dans un `.env` versionné) :
   - `ENVIRONMENT=<env>` (staging / preprod / production)
   - `SECRET_KEY`, `DEBUG=false`
   - `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS` (sous-domaine Railway de l'env)
   - SendGrid (`SENDGRID_API_KEY`, `FROM_EMAIL`, `FROM_NAME`)
   - Comptes seedés (`SUPER_ADMIN_*`, `APP_ADMIN*`, `ORGADMIN_PASSWORD`, `SEED_*`)
4. **Volume persistant** monté sur `/app/media` (uploads sinon perdus à chaque redéploiement).
   Alternative durable : stockage S3-compatible (voir [deploiement-stockage.md](deploiement-stockage.md)).
5. **Token de projet Railway scopé à l'environnement** → secret GitHub du fork (voir ci-dessus).
6. **Service Redis** (plugin Railway) ; variable d'app `REDIS_URL=${{Redis.REDIS_URL}}`.
   Il sert à DEUX choses, toutes deux nécessaires en production :
   - le **cache partagé** entre les workers gunicorn — sans lui, la limitation de débit et
     le verrouillage de compte sont comptés worker par worker, donc multipliés par 3 ;
   - le **broker Celery** de la génération des rapports.
7. **Service worker Celery** : *même image GHCR* que le service applicatif, mêmes variables
   (dont `REDIS_URL` et `DATABASE_URL`), mais **commande de démarrage** remplacée par :

   ```
   celery -A backend worker --loglevel=info --concurrency=2
   ```

   Pas de port exposé, pas de volume `/app/media` nécessaire si le stockage est S3 ; avec un
   volume local, il doit être **partagé avec le service web**, sinon le PDF produit par le
   worker serait introuvable au téléchargement.

> Sans Redis ni worker, l'application **reste fonctionnelle** : Celery bascule en mode
> « eager » et les rapports sont rendus dans la requête web, comme avant — avec les limites
> que cela implique (worker web immobilisé, délai de 300 s, progression non suivie).

> `ENVIRONMENT` pilote tout côté Django (moteur BDD, masquage des données de démo, protections
> production) — cf. [backend/backend/settings.py](../backend/backend/settings.py). Migrations et seed
> sont rejoués automatiquement au démarrage du conteneur
> ([backend/docker-entrypoint.sh](../backend/docker-entrypoint.sh)).

## ⚠️ Sécurité — secrets à révoquer

Les tokens GitHub (blmerio2022 + onedevasus) et Railway sont **en clair** dans
[docs/notes/Notes.md](notes/Notes.md), fichier versionné. Ils sont donc exposés (d'autant plus via le
fork). **Les révoquer/régénérer** puis les retirer du fichier et de l'historique git avant de créer
les secrets ci-dessus.

## Vérification bout en bout

1. **PR** vers `develop`/`main` (upstream) : `test-backend` + `test-frontend` tournent ; **aucun**
   miroir/build/promotion (le miroir se déclenche sur *push* de branche, pas sur PR).
2. **Merge sur `develop` (upstream)** : `sync-fork.yml` recopie `develop` dans le fork → la CI du
   fork construit et pousse `:sha-<court>` **et** `:staging` sur le **même digest** ; Railway STAGING
   redéploie (logs : image tirée, `migrate` + seed OK, app UP).
3. **Merge sur `release/*`** : miroir → fork ; **aucun** build ; `:preprod` == digest de `:staging` ;
   PREPROD redéploie.
4. **Merge sur `main`** : miroir → fork ; `:production` == `:latest` == digest de `:preprod` ;
   PRODUCTION redéploie. Comparer les digests aux 3 étages — **identiques**.
5. **Local prod-like** (optionnel) : `docker login ghcr.io` puis
   `docker compose pull backend && docker compose up -d` tire `:latest` (= production), app sur `:8085`.

Comparer deux tags par digest :

```bash
docker buildx imagetools inspect ghcr.io/onedevasus/app_sdgps:staging
docker buildx imagetools inspect ghcr.io/onedevasus/app_sdgps:production
```
