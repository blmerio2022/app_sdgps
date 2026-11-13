import { of } from 'rxjs';
import { ModeleSsdgpsListComponent } from './modele-ssdgps-list.component';

describe('ModeleSsdgpsListComponent (logique)', () => {
  let cmp: ModeleSsdgpsListComponent;
  let service: jasmine.SpyObj<any>;
  let router: jasmine.SpyObj<any>;

  const MODELES: any[] = [
    { id: 's1', nom: 'PDC', nature_ssdgps: 'PDC/GPS', portee: 'systeme', modifiable: false },
    { id: 's2', nom: 'DLC', nature_ssdgps: 'DLC/GPS', portee: 'systeme', modifiable: false },
    { id: 'p1', nom: 'Mon PDC urbain', description: 'zone dense', nature_ssdgps: 'PDC/GPS', portee: 'personnel', modifiable: true },
  ];

  beforeEach(() => {
    service = jasmine.createSpyObj('ModelesSsdgpsService', ['list', 'duplicate', 'delete']);
    service.list.and.returnValue(of(MODELES));
    router = jasmine.createSpyObj('Router', ['navigate']);
    router.url = '/projets/modeles';
    const auth = jasmine.createSpyObj('AuthService', ['isPlatformAdmin']);
    cmp = new ModeleSsdgpsListComponent(service, {} as any, jasmine.createSpyObj('Toast', ['success', 'error']),
      router, {} as any, jasmine.createSpyObj('Breadcrumb', ['set', 'clear']), auth);
    cmp.load();
  });

  it('filtre par nature, portée et recherche', () => {
    expect(cmp.filtered.length).toBe(3);
    cmp.natureFilter = 'PDC/GPS';
    expect(cmp.filtered.map(m => m.id)).toEqual(['s1', 'p1']);
    cmp.porteeFilter = 'personnel';
    expect(cmp.filtered.map(m => m.id)).toEqual(['p1']);
    cmp.natureFilter = ''; cmp.porteeFilter = ''; cmp.search = 'dense';
    expect(cmp.filtered.map(m => m.id)).toEqual(['p1']);
  });

  it('compteurs par nature et modèles personnels', () => {
    expect(cmp.countFor('PDC/GPS')).toBe(2);
    expect(cmp.personnelsCount).toBe(1);
  });

  it('dupliquer ouvre l’éditeur sur la copie', () => {
    service.duplicate.and.returnValue(of({ id: 'c1', nom: 'Copie' }));
    cmp.duplicate(MODELES[0]);
    expect(cmp.editorOpen).toBeTrue();
    expect(cmp.editorModele?.id).toBe('c1');
  });

  it('un modèle non modifiable ne se supprime pas', () => {
    cmp.remove(MODELES[0]);
    expect(service.delete).not.toHaveBeenCalled();
  });

  it('« Utiliser » ouvre l’assistant avec le modèle', () => {
    cmp.use(MODELES[2]);
    expect(router.navigate).toHaveBeenCalledWith(['../assistant'], jasmine.objectContaining({ queryParams: { modele: 'p1' } }));
  });

  it('toggle déplie / replie la liste des pièces', () => {
    cmp.toggle(MODELES[0]);
    expect(cmp.expanded.has('s1')).toBeTrue();
    cmp.toggle(MODELES[0]);
    expect(cmp.expanded.has('s1')).toBeFalse();
  });
});
