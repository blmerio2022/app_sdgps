export const environment = {
  production: false,
  apiUrl: 'http://localhost:8085/api',
  // Sentry (observabilité) — vide = désactivé, aucun appel réseau.
  // Un DSN frontend est public par nature (il part dans le bundle). Il reste vide dans
  // le dépôt : renseignez-le au build de l'environnement concerné.
  sentryDsn: '',
};
