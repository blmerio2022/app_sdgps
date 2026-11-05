import { USER_MENU, ADMIN_MENU } from './menu.config';

/**
 * Épingle la cible du « Tableau de bord » par rôle :
 *  - Agent & Admin d'organisation → /dashboard
 *  - Super Admin & Admin Système  → /admin/dashboard
 */
describe('menu.config — Tableau de bord par rôle', () => {
  it('Agent d\'organisation (USER_MENU) → /dashboard', () => {
    const item = USER_MENU.find(i => i.id === 'dashboard');
    expect(item?.route).toBe('/dashboard');
  });

  it('Admin d\'organisation → /dashboard', () => {
    const item = ADMIN_MENU.find(i => i.route === '/dashboard' && i.roles?.includes('ROLE_ORGANISATION_ADMIN'));
    expect(item).withContext('entrée org-admin vers /dashboard attendue').toBeTruthy();
    expect(item?.title).toBe('Tableau de bord');
  });

  it('Super Admin & Admin Système → /admin/dashboard (jamais Admin d\'organisation)', () => {
    const item = ADMIN_MENU.find(i => i.route === '/admin/dashboard' && i.id === 'dashboard');
    expect(item?.roles).toEqual(['ROLE_SUPER_ADMIN', 'ROLE_ADMIN_SYSTEME']);
    expect(item?.roles).not.toContain('ROLE_ORGANISATION_ADMIN');
  });
});

describe('menu.config — entrées supprimées / restructurées', () => {
  const allIds = (items: any[]): string[] =>
    items.flatMap(i => [i.id, ...allIds(i.children || [])]);

  it('les entrées supprimées ne sont plus présentes (à tout niveau)', () => {
    const ids = allIds(ADMIN_MENU);
    for (const removed of ['invitations', 'logs-audit', 'supervision', 'health-check',
                           'stats-globales', 'maintenance', 'quotas', 'limites-projets',
                           'ajouter-organisation', 'liste-organisations']) {
      expect(ids).withContext(`"${removed}" doit être supprimé`).not.toContain(removed);
    }
  });

  it('« Organisations » est une entrée de PREMIER niveau (sans sous-menu)', () => {
    const item = ADMIN_MENU.find(i => i.id === 'organisations');
    expect(item?.title).toBe('Organisations');
    expect(item?.route).toBe('/admin/organisations/liste');
    expect(item?.children).toBeFalsy();
  });

  it('« Espace de stockage » est une entrée de PREMIER niveau', () => {
    const item = ADMIN_MENU.find(i => i.id === 'stockage');
    expect(item).withContext('stockage top-level attendu').toBeTruthy();
    expect(item?.route).toBe('/admin/quotas/stockage');
    expect(item?.children).toBeFalsy();
  });
});
