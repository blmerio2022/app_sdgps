// Harnais LOCAL « production » : le SPA (ng serve :4208) appelle le backend prod local (:8088).
// NB : NON utilisé par Railway. Le vrai build prod utilise environment.prod.ts ('/api',
// même-origine, SPA servi par Django). Ce fichier ne sert qu'au test local.
export const environment = {
  production: false,
  apiUrl: 'http://localhost:8088/api',
  // Sentry (observabilité) — vide = désactivé, aucun appel réseau.
  // Un DSN frontend est public par nature (il part dans le bundle). Il reste vide dans
  // le dépôt : renseignez-le au build de l'environnement concerné.
  sentryDsn: '',
};
