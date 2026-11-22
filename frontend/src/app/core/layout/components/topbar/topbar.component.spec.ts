import { of } from 'rxjs';
import { DELAI_FERMETURE_FICHE, DELAI_OUVERTURE_FICHE, TopBarComponent } from './topbar.component';

describe('TopBarComponent (logique)', () => {
  let cmp: TopBarComponent;
  let router: any;
  const layoutService = {
    userProfile$: of(null),
    theme$: of('dark'),
    sidebarState$: of({ isCollapsed: true, isVisible: true }),
    toggleTheme: jasmine.createSpy('toggleTheme'),
    toggleSidebarVisibility: jasmine.createSpy('toggleSidebarVisibility'),
    logout: jasmine.createSpy('logout'),
  };
  const breadcrumbService = { trail$: of(null) };

  beforeEach(() => {
    router = { url: '/home', events: of(), navigate: jasmine.createSpy('navigate') };
    cmp = new TopBarComponent(layoutService as any, breadcrumbService as any, router);
  });

  afterEach(() => localStorage.clear());

  describe('menu utilisateur', () => {
    it('toggleUserMenu / closeUserMenu', () => {
      cmp.toggleUserMenu();
      expect(cmp.showUserMenu).toBeTrue();
      cmp.closeUserMenu();
      expect(cmp.showUserMenu).toBeFalse();
    });
  });

  describe('getUserInitials / roleLabel / roleIcon', () => {
    it('initiales ou U par défaut', () => {
      expect(cmp.getUserInitials(null)).toBe('U');
      expect(cmp.getUserInitials({ first_name: 'ali', last_name: 'ben' } as any)).toBe('AB');
    });
    it('roleLabel / roleIcon mappent avec repli', () => {
      expect(cmp.roleLabel('ROLE_SUPER_ADMIN')).toBe('Super administrateur');
      expect(cmp.roleLabel(null)).toBe('Utilisateur');
      expect(cmp.roleIcon('ROLE_ORGANISATION_AGENT')).toBe('fa-user-gear');
      expect(cmp.roleIcon(undefined)).toBe('fa-user');
    });
  });

  describe('buildUrlFallback (privé)', () => {
    const build = () => (cmp as any).buildUrlFallback();
    it('démarre par Accueil et ignore dashboard/home', () => {
      router.url = '/home';
      const items = build();
      expect(items[0].label).toBe('Accueil');
      expect(items.length).toBe(1);
    });
    it('mappe les segments connus et marque le dernier actif', () => {
      router.url = '/admin/utilisateurs';
      const items = build();
      expect(items.map((i: any) => i.label)).toEqual(['Accueil', 'Administration', 'Utilisateurs']);
      expect(items[items.length - 1].isActive).toBeTrue();
    });
    it('ignore les segments UUID', () => {
      router.url = '/projets/123e4567-e89b-12d3-a456-426614174000';
      const items = build();
      expect(items.map((i: any) => i.label)).toEqual(['Accueil', 'Projets']);
    });
    it('prettifie un segment inconnu', () => {
      router.url = '/mon-segment-inconnu';
      const items = build();
      expect(items[1].label).toBe('Mon segment inconnu');
    });
  });

  describe('renderBreadcrumb (privé)', () => {
    it('le fil métier prime sur le repli URL', () => {
      (cmp as any).domainTrail = [{ label: 'Projet' }, { label: 'SSDGPS' }];
      (cmp as any).renderBreadcrumb();
      expect(cmp.breadcrumbs.map(b => b.label)).toEqual(['Projet', 'SSDGPS']);
    });
    it('masque le crumb Accueil de tête quand la hiérarchie est plus profonde', () => {
      (cmp as any).domainTrail = [
        { label: 'Accueil', icon: 'fa-house' },
        { label: 'Projets' },
      ];
      (cmp as any).renderBreadcrumb();
      expect(cmp.breadcrumbs.map(b => b.label)).toEqual(['Projets']);
    });
    it('conserve Accueil seul (page d’accueil)', () => {
      (cmp as any).domainTrail = [{ label: 'Accueil', icon: 'fa-house' }];
      (cmp as any).renderBreadcrumb();
      expect(cmp.breadcrumbs.map(b => b.label)).toEqual(['Accueil']);
    });
  });

  describe('goToProfile (routage selon rôle)', () => {
    function jwt(payload: object): string { return `x.${btoa(JSON.stringify(payload))}.y`; }

    it('route un admin vers /admin/profile', (done) => {
      localStorage.setItem('authToken', jwt({ role: 'ROLE_ORGANISATION_ADMIN' }));
      cmp.goToProfile();
      setTimeout(() => {
        expect(router.navigate).toHaveBeenCalledWith(['/admin/profile']);
        done();
      }, 150);
    });
    it('route un agent vers /profile', (done) => {
      localStorage.setItem('authToken', jwt({ role: 'ROLE_ORGANISATION_AGENT' }));
      cmp.goToProfile();
      setTimeout(() => {
        expect(router.navigate).toHaveBeenCalledWith(['/profile']);
        done();
      }, 150);
    });
  });

  it('toggleTheme / toggleSidebarVisibility délèguent au LayoutService', () => {
    cmp.toggleTheme();
    cmp.toggleSidebarVisibility();
    expect(layoutService.toggleTheme).toHaveBeenCalled();
    expect(layoutService.toggleSidebarVisibility).toHaveBeenCalled();
  });

  describe('fiche au survol du fil d\'Ariane', () => {
    const crumb = { label: 'SSDGPS 1', fiche: { type: 'ssdgps' as const, id: 's1' } };
    const autre = { label: 'SD 1', fiche: { type: 'affaire' as const, id: 'a1' } };
    const evt = () => ({ currentTarget: { getBoundingClientRect: () => ({ left: 40, bottom: 52, width: 90 }) } } as any);

    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    it('s\'ouvre après un court délai, sous le crumb', () => {
      cmp.survolCrumb(crumb, evt());
      expect(cmp.ficheCible).toBeNull();
      jasmine.clock().tick(DELAI_OUVERTURE_FICHE);
      expect(cmp.ficheCible).toEqual({ type: 'ssdgps', id: 's1', rect: { left: 40, bottom: 52, width: 90 } });
    });

    it('un simple passage de la souris n\'ouvre rien', () => {
      cmp.survolCrumb(crumb, evt());
      cmp.quitterCrumb();
      jasmine.clock().tick(DELAI_OUVERTURE_FICHE + DELAI_FERMETURE_FICHE);
      expect(cmp.ficheCible).toBeNull();
    });

    it('reste ouverte quand la souris passe sur la fiche, se ferme en la quittant', () => {
      cmp.survolCrumb(crumb, evt());
      jasmine.clock().tick(DELAI_OUVERTURE_FICHE);
      cmp.quitterCrumb();
      cmp.survolFiche(true);
      jasmine.clock().tick(DELAI_FERMETURE_FICHE * 2);
      expect(cmp.ficheCible).not.toBeNull();
      cmp.survolFiche(false);
      jasmine.clock().tick(DELAI_FERMETURE_FICHE);
      expect(cmp.ficheCible).toBeNull();
    });

    it('passe d\'un crumb à l\'autre sans délai ; un crumb sans fiche la ferme ; Échap aussi', () => {
      cmp.survolCrumb(crumb, evt());
      jasmine.clock().tick(DELAI_OUVERTURE_FICHE);
      cmp.survolCrumb(autre, evt());
      expect(cmp.ficheCible?.id).toBe('a1');
      cmp.survolCrumb({ label: 'Pièces' }, evt());
      expect(cmp.ficheCible).toBeNull();
      cmp.survolCrumb(crumb, evt());
      jasmine.clock().tick(DELAI_OUVERTURE_FICHE);
      cmp.fermerFiche();
      expect(cmp.ficheCible).toBeNull();
    });

    it('un nouveau fil (navigation) ferme la fiche', () => {
      cmp.survolCrumb(crumb, evt());
      jasmine.clock().tick(DELAI_OUVERTURE_FICHE);
      (cmp as any).domainTrail = [{ label: 'Projets' }];
      (cmp as any).renderBreadcrumb();
      expect(cmp.ficheCible).toBeNull();
    });
  });
});
