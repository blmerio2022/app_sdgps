import { of } from 'rxjs';
import { SidebarComponent } from './sidebar.component';

describe('SidebarComponent', () => {
  let cmp: SidebarComponent;
  const layoutService = {
    menuItems$: of([]),
    sidebarState$: of({ isCollapsed: true, isVisible: true }),
    collapseSidebar: jasmine.createSpy('collapseSidebar'),
  };
  const router = { navigate: jasmine.createSpy('navigate') };

  beforeEach(() => {
    layoutService.collapseSidebar.calls.reset();
    router.navigate.calls.reset();
    cmp = new SidebarComponent(layoutService as any, router as any);
  });

  it('toggleSubmenu ouvre puis referme', () => {
    cmp.toggleSubmenu('projets');
    expect(cmp.isExpanded('projets')).toBeTrue();
    cmp.toggleSubmenu('projets');
    expect(cmp.isExpanded('projets')).toBeFalse();
  });

  it('accordéon : ouvrir un sous-menu referme les autres', () => {
    cmp.toggleSubmenu('a');
    expect(cmp.isExpanded('a')).toBeTrue();
    cmp.toggleSubmenu('b');
    expect(cmp.isExpanded('b')).toBeTrue();
    expect(cmp.isExpanded('a')).toBeFalse(); // 'a' s'est replié automatiquement
  });

  it('onNavigate réduit la sidebar', () => {
    cmp.onNavigate();
    expect(layoutService.collapseSidebar).toHaveBeenCalled();
  });

  it('openSubmenu déplie ET navigue vers la première sous-entrée', () => {
    const item = {
      id: 'projets',
      children: [{ id: 'a', route: '/projets/a' }, { id: 'b', route: '/projets/b' }],
    } as any;
    cmp.openSubmenu(item);
    expect(cmp.isExpanded('projets')).toBeTrue();
    expect(router.navigate).toHaveBeenCalledOnceWith(['/projets/a']);
  });

  it('openSubmenu ne navigue pas lorsqu\'il REFERME le sous-menu', () => {
    const item = { id: 'projets', children: [{ id: 'a', route: '/projets/a' }] } as any;
    cmp.openSubmenu(item);            // ouvre + navigue
    router.navigate.calls.reset();
    cmp.openSubmenu(item);            // referme
    expect(cmp.isExpanded('projets')).toBeFalse();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
