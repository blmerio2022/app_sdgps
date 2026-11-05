import { of } from 'rxjs';
import { PieceManagementPageComponent } from './piece-management-page.component';
import { Piece } from '../../../core/models/piece.model';

describe('PieceManagementPageComponent (logique)', () => {
  let cmp: PieceManagementPageComponent;
  let router: jasmine.SpyObj<{ navigate: any }>;

  function piece(over: Partial<Piece> = {}): Piece {
    return {
      id: 'x', type_piece: 'RDL', type_piece_display: 'Rattachement',
      ordre: 1, is_deleted: false, session: null, source_saisie: 'manuel',
      statut: 'brouillon', ...over,
    } as any;
  }

  beforeEach(() => {
    router = jasmine.createSpyObj('Router', ['navigate']);
    (router as any).url = '/projets/p1/pieces/s1';
    const sortStub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    const columnsStub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    cmp = new PieceManagementPageComponent(
      {} as any, {} as any, {} as any, router as any, {} as any, {} as any, sortStub, columnsStub,
    );
    (cmp as any).projectId = 'p1';
    cmp.ssdgps = { id: 's1', numero_ssdgps: 3, type_ssdgps: 'mono-session' } as any;
  });

  afterEach(() => localStorage.clear());

  describe('portée par session', () => {
    it('items ignore la session en mono-session', () => {
      cmp.activePieces = [piece({ id: 'a', session: null }), piece({ id: 'b', session: 'sess1' })];
      cmp.currentSessionId = null;
      expect(cmp.items.length).toBe(2);
      expect(cmp.activeCount).toBe(2);
    });
    it('items filtre par session courante + communes', () => {
      cmp.activePieces = [
        piece({ id: 'a', session: null }),
        piece({ id: 'b', session: 'sess1' }),
        piece({ id: 'c', session: 'sess2' }),
      ];
      cmp.currentSessionId = 'sess1';
      expect(cmp.items.map(p => p.id)).toEqual(['a', 'b']);
    });
    it('deletedCount suit la corbeille', () => {
      cmp.deletedPieces = [piece({ id: 'd' })];
      expect(cmp.deletedCount).toBe(1);
    });
  });

  describe('libellés', () => {
    it('portee_label vide en mono-session', () => {
      expect(cmp.portee_label(piece())).toBe('');
    });
    it('portee_label distingue session / commune en multi', () => {
      cmp.ssdgps = { ...cmp.ssdgps, type_ssdgps: 'multi-session' } as any;
      expect(cmp.portee_label(piece({ session: 'sess1', session_numero: 2 } as any))).toContain('Session');
      expect(cmp.portee_label(piece({ session: null }))).toContain('SSDGPS');
    });
    it('sourceLabel / statutLabel / statutBadgeClass', () => {
      expect(cmp.sourceLabel('manuel')).toBe('Saisie manuelle');
      expect(cmp.sourceLabel('inconnu')).toBe('inconnu');
      expect(cmp.statutLabel('valide')).toBe('Validée');
      expect(cmp.statutBadgeClass('valide')).toBe('badge-success');
      expect(cmp.statutBadgeClass('x')).toBe('badge-secondary');
    });
    it('formatDate', () => {
      expect(cmp.formatDate(null)).toBe('—');
      expect(cmp.formatDate('2026-07-21T10:00:00Z')).toContain('2026');
    });
  });

  describe('filtrage, tri, pagination', () => {
    beforeEach(() => {
      cmp.activePieces = [
        piece({ id: 'a', type_piece_display: 'Alpha', ordre: 2 }),
        piece({ id: 'b', type_piece_display: 'Beta', ordre: 1 }),
        piece({ id: 'c', type_piece_display: 'Gamma', ordre: 3 }),
      ];
    });
    it('filteredItems trie par ordre', () => {
      cmp.sortColumn = 'ordre'; cmp.sortDirection = 'asc';
      expect(cmp.filteredItems.map(p => p.id)).toEqual(['b', 'a', 'c']);
    });
    it('filteredItems recherche sur le libellé', () => {
      cmp.searchText = 'beta';
      expect(cmp.filteredItems.map(p => p.id)).toEqual(['b']);
    });
    it('sortBy bascule la direction', () => {
      cmp.sortBy('ordre');
      expect(cmp.sortDirection).toBe('desc');
      expect(cmp.getSortIcon('ordre')).toBe('fas fa-sort-down');
    });
    it('pagination', () => {
      cmp.pageSize = 2;
      expect(cmp.totalPages).toBe(2);
      cmp.nextPage();
      expect(cmp.currentPage).toBe(2);
      cmp.setPageSize(10);
      expect(cmp.currentPage).toBe(1);
    });
    it('pinSelectionToTop épingle la sélection', () => {
      cmp.selectedIds.add('c');
      cmp.pinSelectionToTop();
      expect(cmp.filteredItems[0].id).toBe('c');
    });
  });

  describe('getCellValue', () => {
    it('formate les champs spéciaux', () => {
      const p = piece({ is_deleted: true, source_saisie: 'import', statut: 'valide' });
      expect(cmp.getCellValue(p, 'is_deleted')).toBe('Oui');
      expect(cmp.getCellValue(p, 'source_saisie')).toBe('Import CSV/Excel');
      expect(cmp.getCellValue(p, 'statut')).toBe('Validée');
    });
  });

  describe('sélection', () => {
    beforeEach(() => {
      cmp.activePieces = [piece({ id: 'a' }), piece({ id: 'b' })];
      cmp.viewMode = 'cards';
    });
    it('toggleSelect / isSelected / selectedCount', () => {
      cmp.toggleSelect(piece({ id: 'a' }), new Event('c'));
      expect(cmp.isSelected(piece({ id: 'a' }))).toBeTrue();
      expect(cmp.selectedCount).toBe(1);
    });
    it('toggleSelectAll / isAllSelected', () => {
      cmp.toggleSelectAll();
      expect(cmp.isAllSelected).toBeTrue();
      cmp.toggleSelectAll();
      expect(cmp.selectedCount).toBe(0);
    });
    it('invertSelection', () => {
      cmp.selectedIds.add('a');
      cmp.invertSelection();
      expect(Array.from(cmp.selectedIds)).toEqual(['b']);
    });
  });

  describe('reorderModeActive', () => {
    it('actif seulement en conditions neutres', () => {
      cmp.sortColumn = 'ordre'; cmp.sortDirection = 'asc';
      cmp.displayMode = 'all'; cmp.showDeleted = false;
      expect(cmp.reorderModeActive).toBeTrue();
      cmp.searchText = 'x';
      expect(cmp.reorderModeActive).toBeFalse();
    });
    it('enableReorderMode réinitialise les filtres', () => {
      cmp.searchText = 'x'; cmp.displayMode = 'selected';
      cmp.enableReorderMode();
      expect(cmp.reorderModeActive).toBeTrue();
    });
  });

  describe('colonnes', () => {
    it('getVisibleColumns masque « Portée » en mono-session', () => {
      expect(cmp.getVisibleColumns().some(c => c.field === 'portee_label')).toBeFalse();
      cmp.ssdgps = { ...cmp.ssdgps, type_ssdgps: 'multi-session' } as any;
      expect(cmp.getVisibleColumns().some(c => c.field === 'portee_label')).toBeTrue();
    });
    it('getTypeLabel', () => {
      expect(cmp.getTypeLabel('date')).toBe('DATE');
    });
    // L'édition des colonnes (visibilité/ordre/filtre) est désormais dans <app-column-config>
    // (testé séparément) ; branchements du parent couverts dans le describe « config colonnes ».
  });

  describe('vue & onglets', () => {
    it('toggleViewMode persiste dans localStorage', () => {
      cmp.toggleViewMode('cards');
      expect(cmp.viewMode).toBe('cards');
      expect(localStorage.getItem('sdgps_pieces_view_mode')).toBe('cards');
    });
    it('setTab bascule la corbeille et réinitialise', () => {
      cmp.searchText = 'x';
      cmp.setTab(true);
      expect(cmp.showDeleted).toBeTrue();
      expect(cmp.searchText).toBe('');
    });
    it('currentSession résout la session courante', () => {
      cmp.sessions = [{ id: 'sess1', numero_session: 2 } as any];
      cmp.currentSessionId = 'sess1';
      expect(cmp.currentSession?.numero_session).toBe(2);
    });
  });

  describe('navigation', () => {
    it('goToAddPage / goToViewPage / goToEditPage', () => {
      cmp.goToAddPage();
      expect(router.navigate).toHaveBeenCalledWith(
        ['/projets', 'p1', 'pieces', 's1', 'ajouter'], jasmine.any(Object),
      );
      cmp.goToViewPage(piece({ id: 'pi1' }));
      expect(router.navigate).toHaveBeenCalledWith(
        ['/projets', 'p1', 'pieces', 's1', 'piece', 'pi1'], jasmine.any(Object),
      );
      cmp.goToEditPage(piece({ id: 'pi1' }));
      expect(router.navigate).toHaveBeenCalledWith(
        ['/projets', 'p1', 'pieces', 's1', 'piece', 'pi1', 'modifier'], jasmine.any(Object),
      );
    });
  });

  describe('buildFullOrder (privé)', () => {
    it('remplace uniquement les ids visibles réordonnés', () => {
      cmp.activePieces = [
        piece({ id: 'a', ordre: 0 }),
        piece({ id: 'b', ordre: 1 }),
        piece({ id: 'c', ordre: 2 }),
      ];
      // On réordonne le sous-ensemble visible [c, a] (b hors scope garde sa place)
      const full = (cmp as any).buildFullOrder([piece({ id: 'c' }), piece({ id: 'a' })]);
      expect(full).toEqual(['c', 'b', 'a']);
    });
  });

  describe('csvEscape (privé)', () => {
    it('échappe les caractères spéciaux', () => {
      const esc = (v: any) => (cmp as any).csvEscape(v);
      expect(esc('simple')).toBe('simple');
      expect(esc('a;b')).toBe('"a;b"');
      expect(esc('a"b')).toBe('"a""b"');
      expect(esc(null)).toBe('');
    });
  });
});

describe('PieceManagementPageComponent (suppression définitive)', () => {
  let cmp: PieceManagementPageComponent;
  let piecesService: jasmine.SpyObj<any>;
  let toast: jasmine.SpyObj<any>;

  beforeEach(() => {
    piecesService = jasmine.createSpyObj('PiecesService', ['permanentDelete', 'bulkPermanentDelete']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    const sortStub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    const columnsStub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    cmp = new PieceManagementPageComponent(
      {} as any, piecesService, toast, { navigate: () => {} } as any, {} as any, {} as any, sortStub, columnsStub,
    );
    spyOn(cmp, 'loadPieces');
  });

  it('confirmPermanentDelete (unitaire) appelle le service', () => {
    piecesService.permanentDelete.and.returnValue(of(null));
    cmp.openPermanentDeleteModal({ id: '2', type_piece_display: 'X' } as any);
    cmp.confirmPermanentDelete();
    expect(piecesService.permanentDelete).toHaveBeenCalledWith('2');
    expect(toast.success).toHaveBeenCalled();
  });

  it('confirmPermanentDelete (masse) appelle bulkPermanentDelete', () => {
    piecesService.bulkPermanentDelete.and.returnValue(of({ deleted_count: 2, errors: [] }));
    cmp.selectedIds.add('a');
    cmp.selectedIds.add('b');
    cmp.openBulkPermanentDeleteModal();
    cmp.confirmPermanentDelete();
    expect(piecesService.bulkPermanentDelete).toHaveBeenCalled();
  });
});

describe('PieceManagementPageComponent (tri multi-niveaux de la liste)', () => {
  let cmp: PieceManagementPageComponent;
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
    cmp = new PieceManagementPageComponent(
      {} as any, {} as any, toast, { navigate: () => {} } as any, {} as any, {} as any, sortSvc, columnsStub,
    );
  });
  afterEach(() => localStorage.clear());

  it('filteredItems applique le tri multi-niveaux (prioritaire sur le mono-colonne)', () => {
    cmp.activePieces = [
      { id: '1', type_piece_display: 'Alpha', statut: 'z', ordre: 1 },
      { id: '2', type_piece_display: 'Alpha', statut: 'a', ordre: 2 },
      { id: '3', type_piece_display: 'Beta', statut: 'm', ordre: 3 },
    ] as any;
    cmp.sortColumn = 'ordre';
    cmp.sortLevels = [{ field: 'type_piece_display', dir: 'asc' }, { field: 'statut', dir: 'asc' }];
    expect(cmp.filteredItems.map(p => p.id)).toEqual(['2', '1', '3']);
  });

  it('sortLevelOf / sortDirOf reflètent les niveaux', () => {
    cmp.sortLevels = [{ field: 'statut', dir: 'desc' }];
    expect(cmp.sortLevelOf('statut')).toBe(1);
    expect(cmp.sortDirOf('statut')).toBe('desc');
    expect(cmp.sortLevelOf('ordre')).toBe(0);
  });

  it('onResetSort appelle le service pour la clé « pieces »', () => {
    sortSvc.resetToSource.and.returnValue(of([{ field: 'ordre', dir: 'asc' }]));
    cmp.onResetSort();
    expect(sortSvc.resetToSource).toHaveBeenCalledWith('pieces');
    expect(cmp.sortLevels).toEqual([{ field: 'ordre', dir: 'asc' }]);
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

describe('PieceManagementPageComponent (config colonnes)', () => {
  let cmp: PieceManagementPageComponent;
  let toast: any;
  let columnsSvc: any;

  beforeEach(() => {
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    columnsSvc = {
      get: jasmine.createSpy('get').and.returnValue(of([])),
      save: jasmine.createSpy('save').and.returnValue(of([])),
      resetToSource: jasmine.createSpy('resetToSource').and.returnValue(of([])),
    };
    cmp = new PieceManagementPageComponent(
      {} as any, {} as any, toast, { navigate: () => {} } as any, {} as any, {} as any,
      { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any, columnsSvc,
    );
  });
  afterEach(() => localStorage.clear());

  it('onColumnsChange applique les colonnes et programme l’enregistrement (clé « pieces »)', (done) => {
    const cols = [{ field: 'type_piece_display', label: 'Type', visible: false }] as any;
    cmp.onColumnsChange(cols);
    expect(cmp.columns).toBe(cols);
    setTimeout(() => {
      expect(columnsSvc.save).toHaveBeenCalledWith('pieces', [{ field: 'type_piece_display', visible: false }]);
      done();
    }, 600);
  });

  it('onResetColumns appelle le service pour la clé « pieces »', () => {
    columnsSvc.resetToSource.and.returnValue(of([{ field: 'ordre', visible: true }]));
    cmp.onResetColumns();
    expect(columnsSvc.resetToSource).toHaveBeenCalledWith('pieces');
    expect(cmp.columns[0].field).toBe('ordre');
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
