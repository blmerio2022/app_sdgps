import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { LayoutService } from './layout.service';
import { MenuItem, SidebarState, ThemeMode, UserProfile } from '../interfaces/menu.interface';
import { USER_MENU } from '../config/menu.config';

describe('LayoutService', () => {
  let router: jasmine.SpyObj<Router>;

  const makeService = (): LayoutService => {
    router = jasmine.createSpyObj('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));
    TestBed.configureTestingModule({
      providers: [LayoutService, { provide: Router, useValue: router }],
    });
    return TestBed.inject(LayoutService);
  };

  afterEach(() => {
    localStorage.clear();
    document.body.removeAttribute('data-theme');
  });

  it('charge le thème sombre par défaut quand localStorage est vide', () => {
    localStorage.clear();
    const service = makeService();
    expect(service.getCurrentTheme()).toBe('dark');
    expect(document.body.getAttribute('data-theme')).toBeNull();
  });

  it('charge le thème sauvegardé depuis localStorage', () => {
    localStorage.setItem('app-theme', 'light');
    const service = makeService();
    expect(service.getCurrentTheme()).toBe('light');
    expect(document.body.getAttribute('data-theme')).toBe('light');
  });

  it('toggleTheme() bascule et persiste le thème', () => {
    localStorage.setItem('app-theme', 'light');
    const service = makeService();

    let emitted: ThemeMode | undefined;
    service.theme$.subscribe(t => (emitted = t));

    service.toggleTheme();
    expect(service.getCurrentTheme()).toBe('dark');
    expect(emitted).toBe('dark');
    expect(localStorage.getItem('app-theme')).toBe('dark');
    expect(document.body.getAttribute('data-theme')).toBeNull();

    service.toggleTheme();
    expect(service.getCurrentTheme()).toBe('light');
    expect(document.body.getAttribute('data-theme')).toBe('light');
  });

  it('démarre avec une sidebar réduite et visible', () => {
    const service = makeService();
    const state = service.getSidebarState();
    expect(state).toEqual({ isCollapsed: true, isVisible: true } as SidebarState);
  });

  it('toggleSidebarCollapse() inverse l’état collapsed', () => {
    const service = makeService();
    service.toggleSidebarCollapse();
    expect(service.getSidebarState().isCollapsed).toBeFalse();
    service.toggleSidebarCollapse();
    expect(service.getSidebarState().isCollapsed).toBeTrue();
  });

  it('collapseSidebar() réduit uniquement si déployée', () => {
    const service = makeService();
    service.toggleSidebarCollapse(); // → déployée
    service.collapseSidebar();
    expect(service.getSidebarState().isCollapsed).toBeTrue();
    // Idempotent quand déjà réduite
    service.collapseSidebar();
    expect(service.getSidebarState().isCollapsed).toBeTrue();
  });

  it('toggleSidebarVisibility() inverse la visibilité', () => {
    const service = makeService();
    service.toggleSidebarVisibility();
    expect(service.getSidebarState().isVisible).toBeFalse();
  });

  it('setMenuByRole() applique le menu opérateur pour un agent', () => {
    const service = makeService();
    let menu: MenuItem[] | undefined;
    service.menuItems$.subscribe(m => (menu = m));

    service.setMenuByRole('ROLE_ORGANISATION_AGENT');
    expect(menu).toEqual(USER_MENU);
  });

  it('setMenuByRole() filtre le menu admin selon le rôle', () => {
    const service = makeService();
    let menu: MenuItem[] = [];
    service.menuItems$.subscribe(m => (menu = m));

    // Un Admin d'organisation ne voit pas les entrées réservées Super/Système.
    service.setMenuByRole('ROLE_ORGANISATION_ADMIN');
    const ids = menu.map(m => m.id);
    // L'Admin d'organisation a son propre tableau de bord opérateur (id `dashboard-org`,
    // route /dashboard) ; l'entrée `dashboard` (/admin/dashboard) est réservée Super/Système.
    expect(ids).toContain('dashboard-org');
    expect(ids).not.toContain('dashboard');
    expect(ids).toContain('projets');
    expect(ids).not.toContain('organisations'); // roles: SUPER_OR_SYSTEME
    expect(ids).not.toContain('logs-audit');
  });

  it('setUserProfile() publie le profil, charge le menu et réduit la sidebar', () => {
    const service = makeService();
    service.toggleSidebarCollapse(); // déployée avant

    let profile: UserProfile | null | undefined;
    service.userProfile$.subscribe(p => (profile = p));

    const user: UserProfile = {
      id: 1,
      email: 'agent@example.com',
      first_name: 'A',
      last_name: 'B',
      role: 'ROLE_ORGANISATION_AGENT',
    };
    service.setUserProfile(user);

    expect(profile).toEqual(user);
    expect(service.getSidebarState().isCollapsed).toBeTrue();
  });

  it('logout() purge les tokens, réinitialise l’état et redirige', () => {
    localStorage.setItem('authToken', 'a');
    localStorage.setItem('access_token', 'b');
    localStorage.setItem('refresh_token', 'c');
    const service = makeService();

    let profile: UserProfile | null | undefined;
    let menu: MenuItem[] | undefined;
    service.userProfile$.subscribe(p => (profile = p));
    service.menuItems$.subscribe(m => (menu = m));

    service.logout();

    expect(localStorage.getItem('authToken')).toBeNull();
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(profile).toBeNull();
    expect(menu).toEqual([]);
    expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
  });
});
