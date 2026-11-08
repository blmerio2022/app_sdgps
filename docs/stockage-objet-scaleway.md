# Stockage objet S3-compatible — mise en place sur STAGING (Scaleway)

Procédure de bascule des fichiers uploadés (pièces, images, aperçus, avatars, logos) du
disque local vers un **stockage objet S3-compatible**, à commencer par l'environnement
de staging.

## Pourquoi Scaleway

Le choix est contraint par la nature des données : titres fonciers, réquisitions et
photos de bornes pour l'ANCFCC.

| Critère | Scaleway (Paris) | AWS S3 / R2 / B2 / Wasabi | OVHcloud |
|---|---|---|---|
| Juridiction | France (UE) | **États-Unis → CLOUD Act** | France (UE) |
| API S3 | oui | oui | oui |
| Réplication | multi-AZ | oui | oui |
| Egress | 75 Go/mois offerts | payant (AWS ~0,09 $/Go) | faible |
| Coût ~100 Go | ~1,50 €/mois | 0,60 à 2,30 $/mois | ~1 €/mois |

À cette échelle l'écart de prix entre fournisseurs est de l'ordre de **2 € par mois** :
le critère décisif n'est pas le tarif mais la juridiction. OVHcloud est un second choix
équivalent. Les fournisseurs américains sont écartés malgré leurs tarifs parfois
meilleurs.

**Ce choix n'est pas un engagement.** L'application passe par `django-storages` : migrer
plus tard vers un MinIO auto-hébergé dans le datacenter de l'ANCFCC ne demande aucun
développement — trois variables d'environnement et la commande de copie ci-dessous.

## Comment la bascule fonctionne dans le code

`backend/backend/settings.py` choisit le backend de stockage sur un seul critère :

```
AWS_STORAGE_BUCKET_NAME vide      → FileSystemStorage (disque / volume persistant)
AWS_STORAGE_BUCKET_NAME renseigné → storages.backends.s3.S3Storage
```

Réglages posés automatiquement dès que le bucket est renseigné :

- `AWS_DEFAULT_ACL = None` et `AWS_QUERYSTRING_AUTH = True` → les objets restent
  **privés**, servis par des URL **signées et expirantes** (`AWS_QUERYSTRING_EXPIRE`,
  1 h par défaut). Une pièce cadastrale n'est jamais lisible par simple lien.
- `AWS_S3_FILE_OVERWRITE = False` → deux fichiers homonymes coexistent au lieu que le
  second écrase le premier.
- `AWS_S3_SIGNATURE_VERSION = 's3v4'` → signature exigée par Scaleway.

Le préfixe `AWS_` est celui de `django-storages` ; il n'implique pas Amazon. C'est
`AWS_S3_ENDPOINT_URL` qui désigne le fournisseur réel.

Ce chemin est **vérifié en CI** par `backend/analytics/tests_object_storage.py`, qui
démarre un vrai serveur HTTP S3 local (moto) et éprouve l'endpoint non-AWS, l'aller-retour
des fichiers, la signature des URL et le non-écrasement — sans compte payant.

## Étape 1 — Créer le bucket et les clés (à faire par le propriétaire du compte)

Ces actions demandent un compte Scaleway et un moyen de paiement : elles ne peuvent pas
être automatisées depuis ce dépôt.

1. Créer un compte sur <https://console.scaleway.com> et y ajouter un moyen de paiement.
2. **Object Storage → Créer un bucket** :
   - nom : `sdgps-staging` (un bucket **par environnement** — jamais partagé entre
     staging et production, sinon un test écrase une donnée réelle) ;
   - région : **Paris (`fr-par`)** ;
   - visibilité : **privé**.
3. **IAM → Clés d'API → Générer une clé** :
   - créer une application dédiée (p. ex. `sdgps-staging`) plutôt que d'utiliser la clé
     du compte ;
   - droits limités à Object Storage sur ce seul bucket ;
   - noter l'`access key` et la `secret key` — **la secret key n'est affichée qu'une fois**.

## Étape 2 — Déclarer les variables dans Railway (staging)

Le staging Railway **ne lit aucun fichier `.env`** : il faut saisir les variables dans
le service. Railway → projet → environnement **staging** → service applicatif →
*Variables* :

| Variable | Valeur |
|---|---|
| `AWS_STORAGE_BUCKET_NAME` | `sdgps-staging` |
| `AWS_ACCESS_KEY_ID` | l'access key de l'étape 1 |
| `AWS_SECRET_ACCESS_KEY` | la secret key de l'étape 1 |
| `AWS_S3_REGION_NAME` | `fr-par` |
| `AWS_S3_ENDPOINT_URL` | `https://s3.fr-par.scw.cloud` |
| `AWS_QUERYSTRING_EXPIRE` | `3600` |

Puis redéployer le service. Au démarrage, tout nouvel upload part vers le bucket.

> Les secrets vont **uniquement** dans Railway, jamais dans le dépôt. Le modèle
> versionné `backend/.env.staging.example` ne contient que des valeurs vides.

## Étape 3 — Copier les fichiers existants

La commande est **idempotente** et ne supprime jamais les fichiers locaux : un objet
déjà présent dans le bucket est ignoré, et `media/` reste intact jusqu'à nettoyage
manuel. La bascule est donc réversible.

```bash
python manage.py migrate_media_to_storage --dry-run
```

```bash
python manage.py migrate_media_to_storage
```

Elle renseigne au passage `Piece.taille_octets` pour les pièces anciennes — ce qui
alimente le tableau de bord de stockage et les **quotas par organisation**.

## Étape 4 — Vérifier

1. Téléverser une image de pièce depuis l'application, puis vérifier qu'elle apparaît
   dans le bucket (console Scaleway).
2. Ouvrir la galerie : l'URL servie doit contenir `X-Amz-Signature` et `X-Amz-Expires`.
3. Coller cette URL après expiration (ou en retirer la signature) : l'accès doit être
   **refusé**. C'est le test qui prouve que les objets ne sont pas publics.
4. `/admin/quotas/stockage` : la volumétrie doit rester cohérente avant/après bascule.
5. Générer un rapport PDF : il est produit à la volée et **n'est pas stocké** — son
   fonctionnement ne dépend pas du backend de stockage.

## Étape 5 — Nettoyer le volume local

Une fois le bucket validé sur plusieurs jours, et **après sauvegarde** :

- retirer le volume persistant monté sur `/app/media` du service Railway staging ;
- vider `media/` sur le banc d'essai local.

Ne pas le faire avant d'avoir confirmé que les anciens fichiers sont bien servis depuis
le bucket.

## Production : ce qui change

Même procédure, avec un bucket **distinct** (`sdgps-production`) et des clés d'API
**distinctes**. À faire seulement après validation complète du staging, et en
sauvegardant la base et les médias au préalable.

## Banc d'essai local sans compte payant

Pour éprouver la bascule sur son poste, MinIO suffit (S3-compatible, gratuit) :

```bash
docker run -p 9000:9000 -p 9001:9001 -e MINIO_ROOT_USER=minio -e MINIO_ROOT_PASSWORD=minio123 minio/minio server /data --console-address ":9001"
```

Puis dans `backend/.env.development` : `AWS_STORAGE_BUCKET_NAME=sdgps-dev`,
`AWS_ACCESS_KEY_ID=minio`, `AWS_SECRET_ACCESS_KEY=minio123`,
`AWS_S3_ENDPOINT_URL=http://localhost:9000`, `AWS_S3_REGION_NAME=us-east-1`.
Créer le bucket depuis la console MinIO (<http://localhost:9001>) avant le premier envoi.
