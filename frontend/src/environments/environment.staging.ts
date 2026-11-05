// Harnais LOCAL « staging » : le SPA (ng serve :4206) appelle le backend staging (:8086).
// Distinct de environment.prod.ts ('/api', déploiement Railway même-origine).
export const environment = {
  production: false,
  apiUrl: 'http://localhost:8086/api'
};
