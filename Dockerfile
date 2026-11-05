# Image de PRODUCTION à service unique (déploiement Railway) :
# le SPA Angular est buildé puis servi par Django (WhiteNoise), sur la même origine que l'API.
# Contexte de build = racine du dépôt (monorepo backend/ + frontend/).

# ---------- Stage 1 : build du frontend Angular ----------
FROM node:18-slim AS frontend
WORKDIR /fe
# Cache des dépendances : on copie d'abord les manifestes.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY frontend/ ./
# Build de production → /fe/dist/frontend (cf. angular.json outputPath).
RUN npx ng build --configuration production

# ---------- Stage 2 : backend Django + service ----------
FROM python:3.11-slim AS backend
WORKDIR /app

# Bibliothèques natives requises par WeasyPrint (rendu HTML→PDF des rapports SSDGPS) :
# Pango/Cairo/HarfBuzz pour le texte, GDK-Pixbuf pour les images, libffi.
# Polices : URW Bookman (fonts-urw-base35) — équivalent libre, métriquement compatible
# de « Bookman Old Style » utilisée par le modèle de rapport métier.
RUN apt-get update && apt-get install --no-install-recommends -y \
        libpango-1.0-0 libpangocairo-1.0-0 libpangoft2-1.0-0 \
        libcairo2 libgdk-pixbuf-2.0-0 libffi8 libharfbuzz0b \
        shared-mime-info fonts-urw-base35 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# Build Angular embarqué : WhiteNoise le sert à la racine (WHITENOISE_ROOT = frontend_dist).
COPY --from=frontend /fe/dist/frontend/ /app/frontend_dist/

# Statiques Django/DRF (admin) collectés + post-traités (manifest WhiteNoise). Ne touche pas la
# base de données ; ENVIRONMENT non défini au build → aucun accès réseau requis.
RUN python manage.py collectstatic --noinput

RUN chmod +x /app/docker-entrypoint.sh

# L'entrypoint attend la base, applique les migrations (+ auto-seed) puis lance la CMD.
ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
# gunicorn en forme SHELL pour que ${PORT} (injecté par Railway) soit interprété au runtime.
# --timeout 300 : la génération du rapport PDF d'un SSDGPS est synchrone et longue
# (WeasyPrint rend un document par pièce). Mesure de référence : ~120 s pour 21 pièces /
# 7,6 Mo. Avec l'ancien timeout de 120 s, gunicorn tuait le worker en pleine génération →
# 502 côté client et barre de progression bloquée. Ne pas redescendre sous 300 s sans
# rendre la génération asynchrone.
CMD gunicorn backend.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 3 --timeout 300
