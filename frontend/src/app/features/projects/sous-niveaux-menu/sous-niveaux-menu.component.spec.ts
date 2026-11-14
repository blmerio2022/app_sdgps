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

describe('SousNiveauxMenuComponent — panneau', () => {
  let cmp: SousNiveauxMenuComponent;
  const bouton = (rect: Partial<DOMRect>) => ({ nativeElement: { getBoundingClientRect: () => rect } } as any);

  beforeEach(() => {
    const router = jasmine.createSpyObj('Router', ['navigate']);
    router.url = '/projets';
    cmp = new SousNiveauxMenuComponent(router, { nativeElement: document.createElement('div') } as any);
    cmp.niveau = 'propriete';
    cmp.entite = { id: 'pr1', id_titre: 'T9002/C', nbr_total_affaires: 3 };
  });

  afterEach(() => cmp.ngOnDestroy());

  it('nom de l’élément d’origine et sous-titre contextualisé', () => {
    expect(cmp.nom).toBe('Propriété T9002/C');
    expect(cmp.complement).toBe('de cette propriété');
    expect(cmp.options.map(o => cmp.retrait(o))).toEqual([0, 1, 2]);
  });

  it('s’ouvre sous le bouton, aligné à droite et gardé dans la fenêtre', () => {
    cmp.trigger = bouton({ top: 100, bottom: 130, right: 200, left: 170 });
    cmp.toggle(new Event('click'));
    expect(cmp.open).toBeTrue();
    expect(cmp.vers).toBe('bas');
    expect(cmp.position.top).toBe(136);
    expect(cmp.position.left).toBe(8);            // 200 - 360 < 8 : ramené dans la fenêtre
  });

  it('s’ouvre vers le haut près du bas de la fenêtre', () => {
    const h = window.innerHeight;
    cmp.trigger = bouton({ top: h - 40, bottom: h - 10, right: 900, left: 870 });
    cmp.toggle(new Event('click'));
    expect(cmp.vers).toBe('haut');
    expect(cmp.position.bottom).toBe(46);
  });

  it('se ferme au défilement d’un conteneur, à Échap et au second clic', () => {
    cmp.trigger = bouton({ top: 100, bottom: 130, right: 600, left: 570 });
    cmp.toggle(new Event('click'));
    document.body.dispatchEvent(new Event('scroll'));
    expect(cmp.open).toBeFalse();
    cmp.toggle(new Event('click'));
    cmp.onEscape();
    expect(cmp.open).toBeFalse();
    cmp.toggle(new Event('click'));
    cmp.toggle(new Event('click'));
    expect(cmp.open).toBeFalse();
  });
});
