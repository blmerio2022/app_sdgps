#!/bin/sh
# Point d'entrée du conteneur backend SDGPS.
# `set -e` : tout échec (base indisponible, migration KO, amorçage KO) stoppe le conteneur
# avec un code non nul → aucune application servie sans ses données essentielles.
set -e

echo "⏳ Attente de la base de données…"
python manage.py wait_for_db --timeout 60

echo "📦 Application des migrations + amorçage des données d'initialisation…"
# `migrate` déclenche l'auto-seed (signal post_migrate → run_seed). Si le seed échoue,
# migrate renvoie un code non nul et `set -e` interrompt le démarrage.
python manage.py migrate --noinput

# Séquences d'identifiants recalées sur les tables (idempotent) : une séquence en retard
# faisait échouer les insertions (« duplicate key … _pkey »), p. ex. les photos importées.
python manage.py reinitialiser_sequences

echo "🚀 Démarrage du serveur…"
exec "$@"
