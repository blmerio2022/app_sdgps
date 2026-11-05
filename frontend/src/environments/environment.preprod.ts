// Harnais LOCAL « preprod » : le SPA (ng serve :4207) appelle le backend preprod (:8087).
// Distinct de environment.prod.ts ('/api', déploiement Railway même-origine).
export const environment = {
  production: false,
  apiUrl: 'http://localhost:8087/api'
};
