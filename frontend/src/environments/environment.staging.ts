// Harnais LOCAL « staging » : le SPA (ng serve :4206) appelle le backend staging (:8086).
// Distinct de environment.prod.ts ('/api', déploiement Railway même-origine).
export const environment = {
  production: false,
  apiUrl: 'http://localhost:8086/api',
  // Sentry (observabilité) — vide = désactivé, aucun appel réseau.
  // Un DSN frontend est public par nature (il part dans le bundle). Il reste vide dans
  // le dépôt : renseignez-le au build de l'environnement concerné.
  sentryDsn: '',
};
