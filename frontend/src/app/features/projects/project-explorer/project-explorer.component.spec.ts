import { FormBuilder } from '@angular/forms';
import { of } from 'rxjs';
import { ProjectExplorerComponent } from './project-explorer.component';

describe('ProjectExplorerComponent (logique)', () => {
  let cmp: ProjectExplorerComponent;

  beforeEach(() => {
    const sortStub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    const columnsStub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    cmp = new ProjectExplorerComponent(
      {} as any, {} as any, {} as any, {} as any, {} as any, new FormBuilder(), {} as any, sortStub, columnsStub,
    );
  });

  afterEach(() => localStorage.clear());

  describe('libellés & icônes de niveau', () => {
    it('levelTitle / childLabel / levelIcon', () => {
      cmp.level = 'ssdgps';
      expect(cmp.levelTitle).toBe('SSDGPS');
      expect(cmp.childLabel()).toBe('SSDGPS');
      expect(cmp.levelIcon('session')).toBe('fa-clock');
    });
    it('isLeaf uniquement au niveau session', () => {
      cmp.level = 'session';
      expect(cmp.isLeaf()).toBeTrue();
      cmp.level = 'propriete';
      expect(cmp.isLeaf()).toBeFalse();
    });
  });

  describe('itemLabel', () => {
    it('propriété : nom + identifiant (titre prioritaire)', () => {
      expect(cmp.itemLabel({ nom_propriete: 'Villa', id_titre: 'TF-1', id_requisition: 'R-9' }, 'propriete'))
        .toBe('Villa (TF-1)');
      expect(cmp.itemLabel({ nom_propriete: 'Villa', id_requisition: 'R-9' }, 'propriete'))
        .toBe('Villa (R-9)');
    });
    it('affaire / ssdgps / session', () => {
      expect(cmp.itemLabel({ numero_sd_affaire: 3, nature_affaire: 'IF' }, 'affaire')).toBe('SD 3 — IF');
      expect(cmp.itemLabel({ numero_ssdgps: 2, nature_ssdgps: 'rattachement' }, 'ssdgps'))
        .toBe('SSDGPS 2 (rattachement)');
      expect(cmp.itemLabel({ numero_session: 4 }, 'session')).toBe('Session 4');
    });
  });

  describe('proprieteBreadcrumbLabel', () => {
    it('identifiant seul (titre, sinon réquisition, sinon nom)', () => {
      expect(cmp.proprieteBreadcrumbLabel({ id_titre: 'TF-1' })).toBe('TF-1');
      expect(cmp.proprieteBreadcrumbLabel({ id_requisition: 'R-9' })).toBe('R-9');
      expect(cmp.proprieteBreadcrumbLabel({ nom_propriete: 'Villa' })).toBe('Villa');
      expect(cmp.proprieteBreadcrumbLabel({})).toBe('');
    });
  });

  describe('proprieteIdentifier (colonne « ID propriété »)', () => {
    it('utilise `id_propriete` du backend en priorité', () => {
      expect(cmp.proprieteIdentifier({ id_propriete: 'TF-7', id_requisition: 'R-9' })).toBe('TF-7');
    });
    it('repli : titre foncier, sinon réquisition, sinon vide', () => {
      expect(cmp.proprieteIdentifier({ id_titre: 'TF-1', id_requisition: 'R-9' })).toBe('TF-1');
      expect(cmp.proprieteIdentifier({ id_requisition: 'R-9' })).toBe('R-9');
      expect(cmp.proprieteIdentifier({ nom_propriete: 'Villa' })).toBe('');
      expect(cmp.proprieteIdentifier(null)).toBe('');
    });
    it('getCellValue rend l’identifiant, avec « — » si aucun', () => {
      expect(cmp.getCellValue({ id_titre: 'TF-1' }, 'id_propriete')).toBe('TF-1');
      expect(cmp.getCellValue({}, 'id_propriete')).toBe('—');
    });
  });

  describe('colonnes de comptage', () => {
    it('isCountField reconnaît les colonnes `nbr_total_*`', () => {
      expect(cmp.isCountField('nbr_total_pieces')).toBeTrue();
      expect(cmp.isCountField('nom_propriete')).toBeFalse();
    });
    it('getCellValue renvoie 0 (et non « — ») pour un compteur absent', () => {
      expect(cmp.getCellValue({ nbr_total_pieces: 4 }, 'nbr_total_pieces')).toBe('4');
      expect(cmp.getCellValue({}, 'nbr_total_pieces')).toBe('0');
    });
  });

  describe('formatDate & getCellValue', () => {
    it('formatDate', () => {
      expect(cmp.formatDate(null)).toBe('—');
      expect(cmp.formatDate('2026-07-21T10:00:00Z')).toContain('2026');
    });
    it('getCellValue formate les champs spéciaux', () => {
      expect(cmp.getCellValue({ is_deleted: true }, 'is_deleted')).toBe('Oui');
      expect(cmp.getCellValue({ created_at: '2026-01-01T00:00:00Z' }, 'created_at')).toContain('2026');
      expect(cmp.getCellValue({ numero_ssdgps: 7 }, 'numero_ssdgps')).toBe('7');
      expect(cmp.getCellValue({}, 'numero_ssdgps')).toBe('—');
    });
    it('getTypeLabel / getFieldDescription', () => {
      expect(cmp.getTypeLabel('number')).toBe('NOMBRE');
      expect(cmp.getFieldDescription('numero_ssdgps')).toContain('SSDGPS');
      expect(cmp.getFieldDescription('inconnu')).toBe('');
    });
  });

  describe('filteredItems (recherche, filtre, tri)', () => {
    beforeEach(() => {
      cmp.level = 'session';
      cmp.activeItems = [
        { id: 'a', numero_session: 2 },
        { id: 'b', numero_session: 1 },
        { id: 'c', numero_session: 3 },
      ];
      cmp.sortColumn = 'numero_session';
    });
    it('trie selon la colonne', () => {
      cmp.sortDirection = 'asc';
      expect(cmp.filteredItems.map(i => i.id)).toEqual(['b', 'a', 'c']);
      cmp.sortDirection = 'desc';
      expect(cmp.filteredItems.map(i => i.id)).toEqual(['c', 'a', 'b']);
    });
    it('recherche sur le libellé', () => {
      cmp.searchText = 'session 3';
      expect(cmp.filteredItems.map(i => i.id)).toEqual(['c']);
    });
    it('filtre par champ', () => {
      cmp.activeFieldFilter = 'numero_session';
      cmp.fieldFilterValue = '1';
      expect(cmp.filteredItems.map(i => i.id)).toEqual(['b']);
    });
  });

  describe('pagination', () => {
    beforeEach(() => {
      cmp.level = 'session';
      cmp.activeItems = new Array(23).fill(null).map((_, i) => ({ id: String(i), numero_session: i }));
      cmp.pageSize = 10;
    });
    it('totalPages / paginatedItems', () => {
      expect(cmp.totalPages).toBe(3);
      cmp.currentPage = 2;
      expect(cmp.paginatedItems.length).toBe(10);
    });
    it('nextPage / prevPage bornent', () => {
      cmp.currentPage = 3;
      cmp.nextPage();
      expect(cmp.currentPage).toBe(3);
      cmp.currentPage = 1;
      cmp.prevPage();
      expect(cmp.currentPage).toBe(1);
    });
    it('setPageSize revient page 1', () => {
      cmp.currentPage = 2;
      cmp.setPageSize(5);
      expect(cmp.currentPage).toBe(1);
    });
  });

  describe('sélection', () => {
    beforeEach(() => {
      cmp.level = 'session';
      cmp.activeItems = [{ id: 'a' }, { id: 'b' }];
    });
    it('toggleSelect / isSelected / selectedCount', () => {
      cmp.toggleSelect({ id: 'a' }, new Event('c'));
      expect(cmp.isSelected({ id: 'a' })).toBeTrue();
      expect(cmp.selectedCount).toBe(1);
    });
    it('selectAll / isAllSelected / deselectAll', () => {
      cmp.selectAll();
      expect(cmp.isAllSelected).toBeTrue();
      cmp.deselectAll();
      expect(cmp.selectedCount).toBe(0);
    });
    it('invertSelection', () => {
      cmp.selectedIds.add('a');
      cmp.invertSelection();
      expect(Array.from(cmp.selectedIds)).toEqual(['b']);
    });
  });

  describe('tri & vue', () => {
    it('sortBy bascule la direction', () => {
      cmp.sortColumn = 'x'; cmp.sortDirection = 'asc';
      cmp.sortBy('x');
      expect(cmp.sortDirection).toBe('desc');
      cmp.sortBy('y');
      expect(cmp.sortColumn).toBe('y');
      expect(cmp.sortDirection).toBe('asc');
    });
    it('getSortIcon', () => {
      cmp.sortColumn = 'x'; cmp.sortDirection = 'asc';
      expect(cmp.getSortIcon('x')).toBe('fas fa-sort-up');
      expect(cmp.getSortIcon('z')).toBe('fas fa-sort');
    });
    it('toggleViewMode persiste', () => {
      cmp.toggleViewMode('table');
      expect(cmp.viewMode).toBe('table');
      expect(localStorage.getItem('sdgps_explorer_view_mode')).toBe('table');
    });
    it('setTab bascule la corbeille et réinitialise', () => {
      cmp.searchText = 'x';
      cmp.setTab(true);
      expect(cmp.showDeleted).toBeTrue();
      expect(cmp.searchText).toBe('');
    });
  });

  describe('colonnes', () => {
    beforeEach(() => {
      cmp.columns = [
        { field: 'a', label: 'A', visible: true },
        { field: 'b', label: 'B', visible: false },
      ];
    });
    it('getVisibleColumns ne renvoie que les colonnes visibles', () => {
      expect(cmp.getVisibleColumns().length).toBe(1);
      expect(cmp.getVisibleColumns()[0].field).toBe('a');
    });
    // L'édition (visibilité/ordre/filtre) est dans <app-column-config> (testé séparément) ;
    // branchements du parent couverts dans « config colonnes par niveau ».
  });
});

describe('ProjectExplorerComponent (suppression définitive par niveau)', () => {
  let cmp: ProjectExplorerComponent;
  let service: jasmine.SpyObj<any>;
  let toast: jasmine.SpyObj<any>;

  beforeEach(() => {
    service = jasmine.createSpyObj('ProjectsService', [
      'permanentDeleteSsdgps', 'bulkPermanentDeleteSsdgps',
    ]);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'warning']);
    const sortStub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    const columnsStub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    cmp = new ProjectExplorerComponent(
      service, {} as any, {} as any, {} as any, toast, new FormBuilder(), {} as any, sortStub, columnsStub,
    );
    spyOn(cmp, 'loadLevel');
    cmp.level = 'ssdgps';
  });

  it('confirmPermanentDelete (unitaire) dispatche vers le service du niveau courant', () => {
    service.permanentDeleteSsdgps.and.returnValue(of(null));
    cmp.openPermanentDeleteModal({ id: '9' } as any);
    cmp.confirmPermanentDelete();
    expect(service.permanentDeleteSsdgps).toHaveBeenCalledWith('9');
    expect(toast.success).toHaveBeenCalled();
  });

  it('confirmPermanentDelete (masse) : partiel → toast warning', () => {
    service.bulkPermanentDeleteSsdgps.and.returnValue(of({ deleted_count: 1, errors: [{ id: 'b' }] }));
    cmp.selectedIds.add('a');
    cmp.selectedIds.add('b');
    cmp.openBulkPermanentDeleteModal();
    cmp.confirmPermanentDelete();
    expect(service.bulkPermanentDeleteSsdgps).toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalled();
  });
});

describe('ProjectExplorerComponent (tri multi-niveaux par niveau)', () => {
  let cmp: ProjectExplorerComponent;
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
    cmp = new ProjectExplorerComponent(
      {} as any, {} as any, {} as any, {} as any, toast, new FormBuilder(), {} as any, sortSvc, columnsStub,
    );
  });
  afterEach(() => localStorage.clear());

  it('sortKey / sortableFields dépendent du niveau courant', () => {
    cmp.level = 'propriete';
    expect(cmp.sortKey).toBe('project_proprietes');
    expect(cmp.sortableFields.some(f => f.field === 'nom_propriete')).toBeTrue();
    cmp.level = 'ssdgps';
    expect(cmp.sortKey).toBe('project_ssdgps');
    expect(cmp.sortableFields.some(f => f.field === 'numero_ssdgps')).toBeTrue();
  });

  it('« ID propriété » et « Pièces » font partie des colonnes triables du niveau', () => {
    cmp.level = 'propriete';
    expect(cmp.sortableFields.some(f => f.field === 'id_propriete')).toBeTrue();
    expect(cmp.sortableFields.some(f => f.field === 'nbr_total_pieces')).toBeTrue();
    cmp.level = 'affaire';
    expect(cmp.sortableFields.some(f => f.field === 'nbr_total_pieces')).toBeTrue();
  });

  it('filteredItems applique le tri multi-niveaux du niveau courant', () => {
    cmp.level = 'propriete';
    cmp.activeItems = [
      { id: '1', nom_propriete: 'Alpha', id_titre: 'Z' },
      { id: '2', nom_propriete: 'Alpha', id_titre: 'A' },
      { id: '3', nom_propriete: 'Beta', id_titre: 'M' },
    ] as any;
    (cmp as any).manualOrder = null;
    cmp.sortLevelsByLevel.propriete = [{ field: 'nom_propriete', dir: 'asc' }, { field: 'id_titre', dir: 'asc' }];
    expect(cmp.filteredItems.map(i => i.id)).toEqual(['2', '1', '3']);
  });

  it('onSortLevelsChange met à jour le niveau courant uniquement', () => {
    cmp.level = 'affaire';
    cmp.onSortLevelsChange([{ field: 'numero_sd_affaire', dir: 'desc' }]);
    expect(cmp.sortLevelsByLevel.affaire).toEqual([{ field: 'numero_sd_affaire', dir: 'desc' }]);
    expect(cmp.sortLevelsByLevel.propriete).toEqual([]);
  });

  it('onResetSort appelle le service avec la clé du niveau courant', () => {
    cmp.level = 'ssdgps';
    sortSvc.resetToSource.and.returnValue(of([{ field: 'numero_ssdgps', dir: 'asc' }]));
    cmp.onResetSort();
    expect(sortSvc.resetToSource).toHaveBeenCalledWith('project_ssdgps');
    expect(cmp.sortLevelsByLevel.ssdgps).toEqual([{ field: 'numero_ssdgps', dir: 'asc' }]);
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

describe('ProjectExplorerComponent (config colonnes par niveau)', () => {
  let cmp: ProjectExplorerComponent;
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
    cmp = new ProjectExplorerComponent(
      {} as any, {} as any, {} as any, {} as any, toast, new FormBuilder(), {} as any, sortStub, columnsSvc,
    );
  });
  afterEach(() => localStorage.clear());

  it('onColumnsChange enregistre sous la clé du niveau courant', (done) => {
    cmp.level = 'ssdgps'; // sortKey = project_ssdgps
    const cols = [{ field: 'numero_ssdgps', label: 'Numéro', visible: false }] as any;
    cmp.onColumnsChange(cols);
    expect(cmp.columns).toBe(cols);
    setTimeout(() => {
      expect(columnsSvc.save).toHaveBeenCalledWith('project_ssdgps', [{ field: 'numero_ssdgps', visible: false }]);
      done();
    }, 600);
  });

  it('onResetColumns appelle le service avec la clé du niveau courant', () => {
    cmp.level = 'affaire'; // sortKey = project_affaires
    cmp.columns = [{ field: 'numero_sd_affaire', label: 'N° SD', visible: true } as any];
    columnsSvc.resetToSource.and.returnValue(of([{ field: 'numero_sd_affaire', visible: false }]));
    cmp.onResetColumns();
    expect(columnsSvc.resetToSource).toHaveBeenCalledWith('project_affaires');
    expect(cmp.columns[0].visible).toBeFalse();
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

/**
 * Format des dates de l'explorateur : `date_bornage` (affaires) et `date_session` (sessions)
 * s'affichent SANS heure ; les colonnes d'audit gardent `jj/mm/aaaa hh:mm:ss`.
 */
describe('ProjectExplorerComponent (format des dates)', () => {
  let cmp: any;
  const d = new Date(2026, 6, 21, 14, 5, 9);

  beforeEach(() => {
    cmp = new (ProjectExplorerComponent as any)(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
  });

  it('date_bornage et date_session : jj/mm/aaaa sans heure', () => {
    expect(cmp.getCellValue({ date_bornage: d }, 'date_bornage')).toBe('21/07/2026');
    expect(cmp.getCellValue({ date_session: d }, 'date_session')).toBe('21/07/2026');
  });

  it('les colonnes d’audit conservent l’heure avec les secondes', () => {
    expect(cmp.getCellValue({ created_at: d }, 'created_at')).toBe('21/07/2026 14:05:09');
    expect(cmp.getCellValue({ updated_at: d }, 'updated_at')).toBe('21/07/2026 14:05:09');
    expect(cmp.getCellValue({ deleted_at: d }, 'deleted_at')).toBe('21/07/2026 14:05:09');
  });

  it('formatDate sans champ garde le format complet (repli)', () => {
    expect(cmp.formatDate(d)).toBe('21/07/2026 14:05:09');
    expect(cmp.formatDate(d, 'date_bornage')).toBe('21/07/2026');
  });
});
