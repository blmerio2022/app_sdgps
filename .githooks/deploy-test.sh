#!/bin/sh
# Déploie UN commit sur l'environnement de TEST Railway (projet sdgps-test, service app).
#
# Appelé en arrière-plan par les hooks post-commit / post-merge (cf. `_lancer-deploiement`),
# ou à la main :  sh .githooks/deploy-test.sh [<commit>]   (défaut : HEAD)
#
# Pourquoi un hook local et non la CI : Railway exige un compte VÉRIFIÉ pour créer le
# jeton de projet dont GitHub Actions aurait besoin. La CLI Railway du poste, elle, est
# déjà connectée : c'est elle qui déploie, sans aucun jeton à stocker.
#
# Garanties :
# - on déploie le COMMIT, jamais l'arbre de travail : un worktree git temporaire en est
#   extrait (modifications non commitées et node_modules locaux ne partent pas, et la
#   version calculée est exactement celle du commit, sans « +local ») ;
# - projet / environnement / service sont TOUJOURS passés explicitement : `railway up`
#   dans un dossier non lié créerait sinon un nouveau projet ;
# - des commits rapprochés : seul le plus récent est envoyé (fichier « dernier ») ;
# - le script s'achève en vérifiant que `/api/version/` annonce bien le commit.
set -u

PROJET="${SDGPS_TEST_PROJET:-d9f8bb0b-2da6-4536-9214-8fc67c7003fb}"
ENVIRONNEMENT="${SDGPS_TEST_ENVIRONNEMENT:-production}"
SERVICE="${SDGPS_TEST_SERVICE:-app}"
URL="${SDGPS_TEST_URL:-https://app-production-4e77e566.up.railway.app}"

racine="$(git rev-parse --show-toplevel)" || exit 1
cd "$racine" || exit 1
mkdir -p logs
sha="$(git rev-parse --verify "${1:-HEAD}^{commit}")" || { echo "Commit introuvable : ${1:-HEAD}"; exit 1; }
court="$(git rev-parse --short "$sha")"
dernier="logs/deploy-test.dernier"
echo "$sha" > "$dernier"

horodatage() { date '+%Y-%m-%d %H:%M:%S'; }
journal() { echo "[$(horodatage)] $*"; }
plus_recent_demande() { [ "$(cat "$dernier" 2>/dev/null)" != "$sha" ]; }

journal "Déploiement de $court ($(git log -1 --format=%s "$sha")) → $PROJET / $ENVIRONNEMENT / $SERVICE"

if ! command -v railway >/dev/null 2>&1; then
  journal "ÉCHEC : CLI Railway absente (npm install -g @railway/cli)."; exit 1
fi
if ! railway whoami >/dev/null 2>&1; then
  journal "ÉCHEC : CLI Railway non connectée — lancer « railway login »."; exit 1
fi

# Worktree temporaire du commit (partage l'historique et les tags : la version se calcule).
tmp="$(mktemp -d 2>/dev/null || echo "${TMPDIR:-/tmp}/sdgps-deploy-$$")"
arbre="$tmp/arbre"
nettoyer() { git worktree remove --force "$arbre" >/dev/null 2>&1; rm -rf "$tmp"; git worktree prune >/dev/null 2>&1; }
trap nettoyer EXIT INT TERM

# `core.autocrlf=false` : fichiers extraits OCTET POUR OCTET comme dans le dépôt. Avec la
# conversion Windows, les scripts shell partaient en CRLF et le conteneur Linux plantait
# au démarrage (« set: Illegal option - »).
if ! git -c core.autocrlf=false -c core.eol=lf worktree add --detach --quiet "$arbre" "$sha"; then
  journal "ÉCHEC : impossible d'extraire le commit $court."; exit 1
fi

# Premier interpréteur qui S'EXÉCUTE vraiment : sous Windows, « python3 » est souvent le
# raccourci du Microsoft Store, présent dans le PATH mais inopérant.
PY=""
for candidat in python python3 py; do
  if command -v "$candidat" >/dev/null 2>&1 && "$candidat" -c "import sys" >/dev/null 2>&1; then
    PY="$candidat"; break
  fi
done
[ -n "$PY" ] || { journal "ÉCHEC : aucun interpréteur Python utilisable."; exit 1; }
if ! (cd "$arbre" && "$PY" backend/backend/version.py --ecrire build-info/version.json); then
  journal "ÉCHEC : calcul de la version."; exit 1
fi
version="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$arbre/build-info/version.json")"
commit_attendu="$(sed -n 's/.*"commit": *"\([^"]*\)".*/\1/p' "$arbre/build-info/version.json")"

if plus_recent_demande; then
  journal "Abandon : un commit plus récent est en cours de déploiement."; exit 0
fi

journal "Envoi de $version vers Railway…"
# Envoi lancé DEPUIS le worktree : la CLI refuse un chemin hors du dossier courant
# (« prefix not found »). Le dossier n'est pas lié : projet / environnement / service
# explicites, sans quoi `railway up` proposerait de créer un projet.
if ! (cd "$arbre" && railway up --project "$PROJET" --environment "$ENVIRONNEMENT" \
       --service "$SERVICE" --detach); then
  journal "ÉCHEC : l'envoi vers Railway a été refusé."; exit 1
fi

# Railway construit l'image (quelques minutes) puis bascule le trafic : on attend que la
# version en ligne soit celle envoyée — ou qu'un commit plus récent prenne le relais.
journal "Construction en cours sur Railway — attente de la mise en ligne de $commit_attendu…"
i=0
while [ $i -lt 90 ]; do
  sleep 10
  i=$((i + 1))
  if plus_recent_demande; then
    journal "Un commit plus récent a pris le relais : fin du suivi de $court."; exit 0
  fi
  en_ligne="$(curl -fsS --max-time 10 "$URL/api/version/" 2>/dev/null \
              | sed -n 's/.*"commit": *"\([^"]*\)".*/\1/p')"
  if [ "$en_ligne" = "$commit_attendu" ]; then
    journal "✅ EN LIGNE : $version ($commit_attendu) — $URL"; exit 0
  fi
done
journal "⚠ Pas encore en ligne après 15 min (en ligne : « ${en_ligne:-?} »). Voir les journaux de build Railway."
exit 1
