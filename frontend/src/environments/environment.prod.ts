export const environment = {
  production: true,
  // Même origine : le SPA est servi par Django (WhiteNoise). Chemin relatif → l'API est
  // appelée sur le domaine qui sert l'app, sans CORS ni URL en dur.
  apiUrl: '/api',
  // Sentry (observabilité) — vide = désactivé, aucun appel réseau.
  // Un DSN frontend est public par nature (il part dans le bundle). Il reste vide dans
  // le dépôt : renseignez-le au build de l'environnement concerné.
  sentryDsn: '',
};
