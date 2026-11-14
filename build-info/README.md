# build-info/

`version.json` est **généré** au moment du build (jamais versionné) :

    python backend/backend/version.py --ecrire build-info/version.json

- avant `railway up` (le serveur ne reçoit pas le dossier `.git`) ;
- dans la CI, avant la construction de l'image.

L'image Docker l'intègre côté backend (`/app/build-info/version.json`, lu par
`GET /api/version/`) et côté frontend (`build-version.ts`, version propre du bundle,
comparée à celle de l'API pour annoncer une nouvelle version).
