import { FormBuilder } from '@angular/forms';
import { of } from 'rxjs';
import { ProjectListComponent } from './project-list.component';

/**
 * Helpers purs de la liste des projets (getters, pagination). Instanciation directe : seul
 * `FormBuilder` est réel (utilisé dans le constructeur pour bâtir le formulaire) ; les autres
 * dépendances ne sont sollicitées qu'en ngOnInit, non appelé ici.
 */
describe('ProjectListComponent (getters & pagination)', () => {
  let cmp: ProjectListComponent;

  beforeEach(() => {
    const sortStub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    const columnsStub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    cmp = new ProjectListComponent(
      {} as any, {} as any, {} as any, {} as any,
      new FormBuilder(), {} as any, {} as any, {} as any, sortStub, columnsStub,
    );
  });

  it('projets suit l’onglet actif/supprimés + compteurs', () => {
    cmp.activeProjets = [{ id: 'a' }, { id: 'b' }] as any;
    cmp.deletedProjets = [{ id: 'c' }] as any;
    expect(cmp.activeCount).toBe(2);
    expect(cmp.deletedCount).toBe(1);

    cmp.showDeleted = false;
    expect(cmp.projets.length).toBe(2);
    cmp.showDeleted = true;
    expect(cmp.projets.length).toBe(1);
  });

  it('isAdmin vrai sans organisation courante', () => {
    cmp.currentOrgId = null;
    expect(cmp.isAdmin).toBeTrue();
    cmp.currentOrgId = 'org-1';
    expect(cmp.isAdmin).toBeFalse();
  });

  it('totalPages calcule le nombre de pages (min 1)', () => {
    cmp.pageSize = 10;
    cmp.filteredProjets = new Array(25).fill({}) as any;
    expect(cmp.totalPages).toBe(3);
    cmp.filteredProjets = [];
    expect(cmp.totalPages).toBe(1);
  });

  it('pageNumbers fournit une fenêtre autour de la page courante', () => {
    cmp.pageSize = 10;
    cmp.filteredProjets = new Array(100).fill({}) as any; // 10 pages
    cmp.currentPage = 5;
    expect(cmp.pageNumbers).toEqual([3, 4, 5, 6, 7]);
  });

  it('goToPage ignore les valeurs hors bornes', () => {
    cmp.pageSize = 10;
    cmp.filteredProjets = new Array(20).fill({}) as any; // 2 pages
    cmp.currentPage = 1;
    cmp.goToPage(99);
    expect(cmp.currentPage).toBe(1);
    cmp.goToPage(0);
    expect(cmp.currentPage).toBe(1);
  });
});

describe('ProjectListComponent (suppression définitive)', () => {
  let cmp: ProjectListComponent;
  let service: jasmine.SpyObj<any>;
  let toast: jasmine.SpyObj<any>;

  beforeEach(() => {
    service = jasmine.createSpyObj('ProjectsService', ['permanentDeleteProjet', 'bulkPermanentDeleteProjets']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'warning']);
    const sortStub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    const columnsStub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    cmp = new ProjectListComponent(
      service, {} as any, {} as any, toast, new FormBuilder(), {} as any, {} as any, {} as any, sortStub, columnsStub,
    );
    spyOn(cmp, 'load');
  });

  it('openBulkPermanentDeleteModal refuse sans sélection', () => {
    cmp.selectedIds.clear();
    cmp.openBulkPermanentDeleteModal();
    expect(cmp.showPermanentDeleteModal).toBeFalse();
  });

  it('confirmPermanentDelete (unitaire) appelle le service', () => {
    service.permanentDeleteProjet.and.returnValue(of(null));
    cmp.openPermanentDeleteModal({ id: '2', nom_projet: 'X' } as any);
    cmp.confirmPermanentDelete();
    expect(service.permanentDeleteProjet).toHaveBeenCalledWith('2');
    expect(toast.success).toHaveBeenCalled();
  });

  it('confirmPermanentDelete (masse) : aucune suppression → toast error', () => {
    service.bulkPermanentDeleteProjets.and.returnValue(of({ deleted_count: 0, errors: [{ id: 'a' }] }));
    cmp.selectedIds.add('a');
    cmp.openBulkPermanentDeleteModal();
    cmp.confirmPermanentDelete();
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('ProjectListComponent (tri multi-niveaux)', () => {
  let cmp: ProjectListComponent;
  let toast: any;
  let sortSvc: any;

  beforeEach(() => {
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    sortSvc = {
      get: jasmine.createSpy('get').and.returnValue(of([])),
      save: jasmine.createSpy('save').and.returnValue(of([])),
      resetToSource: jasmine.createSpy('resetToSource').and.returnValue(of([])),
    };
    const columnsStub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    cmp = new ProjectListComponent(
      {} as any, {} as any, {} as any, toast, new FormBuilder(), {} as any, {} as any, {} as any, sortSvc, columnsStub,
    );
    spyOn<any>(cmp, 'savePreferences');
  });

  it('applyFiltersAndSort applique le tri multi-niveaux (prioritaire sur le mono-colonne)', () => {
    cmp.activeProjets = [
      { id: '1', nom_projet: 'Alpha', code_projet: 'Z', is_deleted: false },
      { id: '2', nom_projet: 'Alpha', code_projet: 'A', is_deleted: false },
      { id: '3', nom_projet: 'Beta', code_projet: 'M', is_deleted: false },
    ] as any;
    cmp.showDeleted = false;
    (cmp as any).manualOrder = null;
    cmp.sortLevels = [{ field: 'nom_projet', dir: 'asc' }, { field: 'code_projet', dir: 'asc' }];
    cmp.applyFiltersAndSort();
    expect(cmp.filteredProjets.map(p => p.id)).toEqual(['2', '1', '3']);
  });

  it('sortLevelOf / sortDirOf reflètent les niveaux', () => {
    cmp.sortLevels = [{ field: 'code_projet', dir: 'desc' }];
    expect(cmp.sortLevelOf('code_projet')).toBe(1);
    expect(cmp.sortDirOf('code_projet')).toBe('desc');
    expect(cmp.sortLevelOf('statut')).toBe(0);
  });

  it('onResetSort appelle le service pour la clé « projects »', () => {
    cmp.activeProjets = [];
    sortSvc.resetToSource.and.returnValue(of([{ field: 'nom_projet', dir: 'asc' }]));
    cmp.onResetSort();
    expect(sortSvc.resetToSource).toHaveBeenCalledWith('projects');
    expect(cmp.sortLevels).toEqual([{ field: 'nom_projet', dir: 'asc' }]);
  });

  it('openSortFromContext ferme le menu contextuel et ouvre la modale de tri', () => {
    const open = jasmine.createSpy('open');
    (cmp as any).sortCmp = { open };
    cmp.showColumnContextMenu = true;
    cmp.openSortFromContext();
    expect(cmp.showColumnContextMenu).toBeFalse();
    expect(open).toHaveBeenCalled();
  });
});

describe('ProjectListComponent (config colonnes)', () => {
  let cmp: ProjectListComponent;
  let toast: any;
  let columnsSvc: any;

  beforeEach(() => {
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    columnsSvc = {
      get: jasmine.createSpy('get').and.returnValue(of([])),
      save: jasmine.createSpy('save').and.returnValue(of([])),
      resetToSource: jasmine.createSpy('resetToSource').and.returnValue(of([])),
    };
    const sortStub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    cmp = new ProjectListComponent(
      {} as any, {} as any, {} as any, toast, new FormBuilder(), {} as any, {} as any, {} as any, sortStub, columnsSvc,
    );
  });

  it('onColumnsChange applique les colonnes et programme l’enregistrement (clé « projects »)', (done) => {
    const cols = [{ field: 'nom_projet', label: 'Nom', visible: false }] as any;
    cmp.onColumnsChange(cols);
    expect(cmp.columns).toBe(cols);
    setTimeout(() => {
      expect(columnsSvc.save).toHaveBeenCalledWith('projects', [{ field: 'nom_projet', visible: false }]);
      done();
    }, 600);
  });

  it('onResetColumns appelle le service pour la clé « projects » et réapplique', () => {
    columnsSvc.resetToSource.and.returnValue(of([{ field: 'statut', visible: true }]));
    cmp.onResetColumns();
    expect(columnsSvc.resetToSource).toHaveBeenCalledWith('projects');
    expect(cmp.columns[0].field).toBe('statut');
    expect(toast.success).toHaveBeenCalled();
  });

  it('openColumnConfigFromContext ferme le menu contextuel et ouvre la modale de colonnes', () => {
    const open = jasmine.createSpy('open');
    (cmp as any).columnCfg = { open };
    cmp.showColumnContextMenu = true;
    cmp.openColumnConfigFromContext();
    expect(cmp.showColumnContextMenu).toBeFalse();
    expect(open).toHaveBeenCalled();
  });
});
