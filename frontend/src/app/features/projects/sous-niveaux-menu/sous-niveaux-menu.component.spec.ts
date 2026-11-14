import { SousNiveauxMenuComponent } from './sous-niveaux-menu.component';
import { porteeDe, projetsBase, sousNiveauxDe } from './sous-niveaux.util';

describe('sous-niveaux.util', () => {
  it('liste les niveaux strictement inférieurs', () => {
    expect(sousNiveauxDe('projet').map(o => o.niveau)).toEqual(['propriete', 'affaire', 'ssdgps', 'session']);
    expect(sousNiveauxDe('propriete').map(o => o.niveau)).toEqual(['affaire', 'ssdgps', 'session']);
    expect(sousNiveauxDe('affaire').map(o => o.niveau)).toEqual(['ssdgps', 'session']);
    expect(sousNiveauxDe('ssdgps', { type_ssdgps: 'multi-session' }).map(o => o.niveau)).toEqual(['session']);
    expect(sousNiveauxDe('session')).toEqual([]);
  });

  it('un SSDGPS mono-session n’a pas de sous-niveau (session structurelle)', () => {
    expect(sousNiveauxDe('ssdgps', { type_ssdgps: 'mono-session' })).toEqual([]);
  });

  it('portée transmise en paramètres', () => {
    expect(porteeDe('projet', { id: 'p' })).toEqual({});
    expect(porteeDe('propriete', { id: 'pr' })).toEqual({ propriete: 'pr' });
    expect(porteeDe('affaire', { id: 'a', propriete: 'pr' })).toEqual({ affaire: 'a', propriete: 'pr' });
    expect(porteeDe('ssdgps', { id: 's', affaire: 'a', propriete: 'pr' })).toEqual({ ssdgps: 's', affaire: 'a', propriete: 'pr' });
  });

  it('projetsBase fonctionne sous /projets et /admin/projets', () => {
    expect(projetsBase('/projets/x/affaires?propriete=1')).toEqual(['/', 'projets']);
    expect(projetsBase('/admin/projets/x')).toEqual(['/', 'admin', 'projets']);
  });
});

describe('SousNiveauxMenuComponent', () => {
  let cmp: SousNiveauxMenuComponent;
  let router: jasmine.SpyObj<any>;

  beforeEach(() => {
    router = jasmine.createSpyObj('Router', ['navigate']);
    router.url = '/admin/projets';
    cmp = new SousNiveauxMenuComponent(router, { nativeElement: document.createElement('div') } as any);
  });

  it('depuis un projet : effectifs lus sur l’entité, navigation vers la vue à plat', () => {
    cmp.niveau = 'projet';
    cmp.entite = { id: 'p1', nbr_total_affaires: 7 };
    const affaires = cmp.options.find(o => o.niveau === 'affaire')!;
    expect(cmp.count(affaires)).toBe(7);
    expect(cmp.count(cmp.options[0])).toBeNull();          // compteur absent
    cmp.open = true;
    cmp.go(affaires);
    expect(cmp.open).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/', 'admin', 'projets', 'p1', 'affaires'], { queryParams: {} });
  });

  it('depuis une propriété : portée et projet racine', () => {
    cmp.niveau = 'propriete';
    cmp.entite = { id: 'pr1' };
    cmp.projetId = 'p1';
    cmp.go(cmp.options.find(o => o.niveau === 'session')!);
    expect(router.navigate).toHaveBeenCalledWith(['/', 'admin', 'projets', 'p1', 'sessions'], { queryParams: { propriete: 'pr1' } });
  });

  it('sans projet connu, ne navigue pas', () => {
    cmp.niveau = 'affaire';
    cmp.entite = { id: 'a1' };
    cmp.go(cmp.options[0]);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('se ferme sur un clic à l’extérieur', () => {
    cmp.open = true;
    cmp.onDocumentClick({ target: document.body } as any);
    expect(cmp.open).toBeFalse();
  });
});
