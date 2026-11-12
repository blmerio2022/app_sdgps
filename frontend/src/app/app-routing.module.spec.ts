/**
 * Routage racine : garde-fou sur les routes dont dépend TOUTE l'application connectée.
 *
 * Régression vécue : un nettoyage des routes « en cours de développement » a emporté, au
 * passage, le groupe OPÉRATEUR (`path: ''`) et les deux tableaux de bord. Résultat —
 * après connexion, `getPostLoginRoute()` menait à `/dashboard`, que plus aucune route ne
 * couvrait : `NG04002 Cannot match any routes`, écran vide, sans message. Aucun test ne
 * l'a vu : supprimer une route ne casse aucun test de composant.
 *
 * Ces assertions portent donc sur la STRUCTURE du routage, pas sur un composant.
 */
import { Route, Routes } from '@angular/router';

import { routes } from './app-routing.module';

/** Route de premier niveau à ce chemin (`''` = groupe opérateur, servi à la racine). */
function groupe(path: string, avecEnfants = true): Route {
  const trouvee = routes.find(r => r.path === path && (!avecEnfants || !!r.children));
  expect(trouvee)
    .withContext(`route de premier niveau « ${path} »${avecEnfants ? ' avec enfants' : ''}`)
    .toBeDefined();
  return trouvee as Route;
}

function chemins(children: Routes | undefined): string[] {
  return (children || []).map(c => c.path || '');
}

describe('Routage racine', () => {
  it('redirige la racine vers la connexion', () => {
    const racine = routes.find(r => r.path === '' && !r.children);

    expect(racine?.redirectTo).toBe('/auth/login');
    expect(racine?.pathMatch).toBe('full');
  });

  it('expose le groupe opérateur à la racine', () => {
    // Sans lui, un utilisateur connecté n'atteint plus rien.
    expect(chemins(groupe('').children).length).toBeGreaterThan(0);
  });

  it('couvre /dashboard, destination post-connexion de l’opérateur', () => {
    expect(chemins(groupe('').children)).toContain('dashboard');
  });

  it('couvre /admin/dashboard, destination du Super Admin et de l’Admin Système', () => {
    expect(chemins(groupe('admin').children)).toContain('dashboard');
  });

  it('fait retomber toute URL inconnue sur un tableau de bord', () => {
    for (const path of ['', 'admin']) {
      const fourreTout = (groupe(path).children || []).find(c => c.path === '**');
      expect(fourreTout?.redirectTo)
        .withContext(`catch-all du groupe « ${path || 'opérateur'} »`)
        .toBe('dashboard');
    }
  });

  it('place le catch-all en DERNIER, sans quoi il masquerait les routes suivantes', () => {
    for (const path of ['', 'admin']) {
      const enfants = chemins(groupe(path).children);
      expect(enfants.indexOf('**'))
        .withContext(`position du catch-all du groupe « ${path || 'opérateur'} »`)
        .toBe(enfants.length - 1);
    }
  });

  it('déclare le groupe admin AVANT le groupe opérateur', () => {
    // Un groupe à path vide placé avant masquerait /admin/**.
    const iAdmin = routes.findIndex(r => r.path === 'admin');
    const iOperateur = routes.findIndex(r => r.path === '' && !!r.children);

    expect(iAdmin).toBeLessThan(iOperateur);
  });

  it('sert les features opérateur à la racine', () => {
    const enfants = chemins(groupe('').children);

    for (const feature of ['projets', 'profile', 'parametres']) {
      expect(enfants).withContext(`feature opérateur « ${feature} »`).toContain(feature);
    }
  });

  it('sert les écrans d’administration qui ont un composant', () => {
    const enfants = chemins(groupe('admin').children);

    for (const ecran of ['organisations/liste', 'organismes/niveau1', 'organismes/niveau2',
                         'utilisateurs', 'utilisateurs/liste', 'utilisateurs/roles',
                         'utilisateurs/:id', 'roles-permissions', 'quotas/stockage',
                         'quotas/limites', 'parametres/descriptions-champs']) {
      expect(enfants).withContext(`écran admin « ${ecran} »`).toContain(ecran);
    }
  });

  it('garde la route exacte des descriptions de champs AVANT le module parametres', () => {
    const enfants = chemins(groupe('admin').children);

    expect(enfants.indexOf('parametres/descriptions-champs'))
      .toBeLessThan(enfants.indexOf('parametres'));
  });

  it('n’expose aucune page « en cours de développement »', () => {
    // Une entrée de menu qui mène à une page vide est pire qu'une entrée absente.
    const tous = routes.flatMap(r => [r, ...(r.children || [])]);
    const placeholders = tous.filter(
      r => (r.component as any)?.name?.includes('Placeholder'));

    expect(placeholders).toEqual([]);
  });

  it('laisse l’authentification accessible hors du layout connecté', () => {
    const auth = routes.find(r => r.path === 'auth');

    expect(auth?.loadChildren).toBeDefined();
    expect(auth?.component).toBeUndefined();
  });
});
