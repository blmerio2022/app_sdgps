import { FormBuilder } from '@angular/forms';
import { of } from 'rxjs';
import { UserListComponent } from './user-list.component';

/**
 * Pagination de la liste des utilisateurs. Le constructeur utilise authService.getUserId()
 * et FormBuilder → on fournit un stub minimal + un vrai FormBuilder ; le reste est factice.
 */
describe('UserListComponent (pagination)', () => {
  let cmp: UserListComponent;

  beforeEach(() => {
    const authStub = { getUserId: () => null } as any;
    const sortStub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    const columnsStub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    cmp = new UserListComponent(
      {} as any, {} as any, {} as any, {} as any,
      authStub, {} as any, new FormBuilder(), {} as any, sortStub, columnsStub,
    );
  });

  it('totalPages (min 1)', () => {
    cmp.pageSize = 10;
    cmp.filteredUsers = new Array(23).fill({}) as any;
    expect(cmp.totalPages).toBe(3);
    cmp.filteredUsers = [];
    expect(cmp.totalPages).toBe(1);
  });

  it('pageNumbers = fenêtre autour de la page courante', () => {
    cmp.pageSize = 10;
    cmp.filteredUsers = new Array(100).fill({}) as any; // 10 pages
    cmp.currentPage = 6;
    expect(cmp.pageNumbers).toEqual([4, 5, 6, 7, 8]);
  });

  it('goToPage borne les valeurs', () => {
    cmp.pageSize = 10;
    cmp.filteredUsers = new Array(20).fill({}) as any; // 2 pages
    cmp.currentPage = 1;
    cmp.goToPage(99);
    expect(cmp.currentPage).toBe(1);
  });
});

describe('UserListComponent (onglets & suppression définitive)', () => {
  let cmp: UserListComponent;
  let userService: jasmine.SpyObj<any>;
  let toast: jasmine.SpyObj<any>;

  beforeEach(() => {
    userService = jasmine.createSpyObj('UserService', [
      'permanentDeleteUser', 'bulkPermanentDeleteUsers', 'getUsers',
    ]);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    const sortStub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    const columnsStub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    cmp = new UserListComponent(
      userService, {} as any, {} as any, toast,
      { getUserId: () => null } as any, {} as any, new FormBuilder(), {} as any, sortStub, columnsStub,
    );
    spyOn<any>(cmp, 'savePreferences');
    spyOn(cmp, 'loadUsers');
    cmp.users = [
      { id: '1', is_deleted: false, is_active: true },
      { id: '2', is_deleted: true },
      { id: '3', is_deleted: true },
    ] as any;
  });

  it('compteurs actifs / supprimés', () => {
    expect(cmp.nonDeletedCount).toBe(1);
    expect(cmp.deletedUsersCount).toBe(2);
  });

  it('setTab(true) filtre la corbeille', () => {
    cmp.setTab(true);
    expect(cmp.showDeleted).toBeTrue();
    expect(cmp.filteredUsers.every(u => (u as any).is_deleted)).toBeTrue();
  });

  it('setTab(false) filtre les non supprimés', () => {
    cmp.setTab(true);
    cmp.setTab(false);
    expect(cmp.showDeleted).toBeFalse();
    expect(cmp.filteredUsers.every(u => !(u as any).is_deleted)).toBeTrue();
  });

  it('openBulkPermanentDeleteModal refuse sans sélection', () => {
    cmp.selectedIds.clear();
    cmp.openBulkPermanentDeleteModal();
    expect(cmp.showPermanentDeleteModal).toBeFalse();
  });

  it('confirmPermanentDelete (unitaire) appelle le service', () => {
    userService.permanentDeleteUser.and.returnValue(of(null));
    cmp.openPermanentDeleteModal({ id: '2' } as any);
    cmp.confirmPermanentDelete();
    expect(userService.permanentDeleteUser).toHaveBeenCalledWith('2');
    expect(toast.success).toHaveBeenCalled();
  });

  it('confirmPermanentDelete (masse) appelle bulkPermanentDeleteUsers', () => {
    userService.bulkPermanentDeleteUsers.and.returnValue(of({ deleted_count: 2, errors: [] }));
    cmp.selectedIds.add('2');
    cmp.selectedIds.add('3');
    cmp.openBulkPermanentDeleteModal();
    cmp.confirmPermanentDelete();
    expect(userService.bulkPermanentDeleteUsers).toHaveBeenCalled();
  });
});

describe('UserListComponent (tri multi-niveaux)', () => {
  let cmp: UserListComponent;
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
    cmp = new UserListComponent(
      {} as any, {} as any, {} as any, toast,
      { getUserId: () => null } as any, {} as any, new FormBuilder(), {} as any, sortSvc, columnsStub,
    );
    spyOn<any>(cmp, 'savePreferences');
  });

  it('applyFiltersAndSort applique le tri multi-niveaux (prioritaire sur le mono-colonne)', () => {
    cmp.users = [
      { id: '1', first_name: 'Alpha', email: 'z@x.ma', is_deleted: false, is_active: true },
      { id: '2', first_name: 'Alpha', email: 'a@x.ma', is_deleted: false, is_active: true },
      { id: '3', first_name: 'Beta', email: 'm@x.ma', is_deleted: false, is_active: true },
    ] as any;
    cmp.sortColumn = 'date_joined';
    cmp.sortLevels = [{ field: 'first_name', dir: 'asc' }, { field: 'email', dir: 'asc' }];
    cmp.applyFiltersAndSort();
    expect(cmp.filteredUsers.map(u => u.id)).toEqual(['2', '1', '3']);
  });

  it('sortLevelOf / sortDirOf reflètent les niveaux', () => {
    cmp.sortLevels = [{ field: 'email', dir: 'desc' }];
    expect(cmp.sortLevelOf('email')).toBe(1);
    expect(cmp.sortDirOf('email')).toBe('desc');
    expect(cmp.sortLevelOf('role')).toBe(0);
  });

  it('onSortLevelsChange applique et programme l’enregistrement', () => {
    cmp.users = [];
    cmp.onSortLevelsChange([{ field: 'email', dir: 'asc' }]);
    expect(cmp.sortLevels).toEqual([{ field: 'email', dir: 'asc' }]);
  });

  it('onResetSort appelle le service pour la clé du tableau', () => {
    cmp.users = [];
    sortSvc.resetToSource.and.returnValue(of([{ field: 'role', dir: 'asc' }]));
    cmp.onResetSort();
    expect(sortSvc.resetToSource).toHaveBeenCalledWith('users');
    expect(cmp.sortLevels).toEqual([{ field: 'role', dir: 'asc' }]);
    expect(toast.success).toHaveBeenCalled();
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

describe('UserListComponent (config colonnes)', () => {
  let cmp: UserListComponent;
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
    cmp = new UserListComponent(
      {} as any, {} as any, {} as any, toast,
      { getUserId: () => null } as any, {} as any, new FormBuilder(), {} as any, sortStub, columnsSvc,
    );
  });

  it('onColumnsChange applique les colonnes et programme l’enregistrement (clé « users »)', (done) => {
    const cols = [{ field: 'email', label: 'Email', visible: false }] as any;
    cmp.onColumnsChange(cols);
    expect(cmp.columns).toBe(cols);
    setTimeout(() => {
      expect(columnsSvc.save).toHaveBeenCalledWith('users', [{ field: 'email', visible: false }]);
      done();
    }, 600);
  });

  it('onResetColumns appelle le service pour la clé « users » et réapplique', () => {
    columnsSvc.resetToSource.and.returnValue(of([{ field: 'role', visible: true }]));
    cmp.onResetColumns();
    expect(columnsSvc.resetToSource).toHaveBeenCalledWith('users');
    expect(cmp.columns[0].field).toBe('role');
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
