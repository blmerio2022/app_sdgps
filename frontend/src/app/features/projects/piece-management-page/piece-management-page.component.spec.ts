import { of, throwError, Subject } from 'rxjs';
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
      {} as any,  // DomSanitizer (aperçu de la page de garde)
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
      {} as any,  // DomSanitizer (aperçu de la page de garde)
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
      {} as any,  // DomSanitizer (aperçu de la page de garde)
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
      {} as any,  // DomSanitizer (aperçu de la page de garde)
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

/**
 * Message d'erreur de la génération du rapport PDF.
 *
 * Bug couvert : la génération échouait côté serveur (dépendance `reportlab` absente) et la
 * modale n'affichait qu'« Erreur lors de la génération du rapport. » — barre figée à 90 %,
 * aucune piste pour l'opérateur. Le `detail` du serveur doit toujours primer, et les échecs
 * sans `detail` (requête interrompue, délai dépassé) doivent être nommés explicitement.
 */
describe('PieceManagementPageComponent.reportErrorMessage', () => {
  const message = (err: any) => PieceManagementPageComponent.reportErrorMessage(err);

  it('préfère le detail renvoyé par le serveur', () => {
    const detail = 'La génération PDF est indisponible : reportlab manquant.';
    expect(message({ status: 501, error: { detail } })).toBe(detail);
  });

  it('nettoie les espaces autour du detail', () => {
    expect(message({ status: 500, error: { detail: '  Échec du rendu.  ' } }))
      .toBe('Échec du rendu.');
  });

  it('ignore un detail vide ou non textuel et retombe sur le code HTTP', () => {
    expect(message({ status: 500, error: { detail: '   ' } })).toContain('code 500');
    expect(message({ status: 500, error: { detail: { x: 1 } } })).toContain('code 500');
  });

  it('nomme l’interruption de connexion quand le statut est 0', () => {
    const texte = message({ status: 0, error: null });
    expect(texte).toContain('n’a pas répondu');
    expect(texte).toContain('plusieurs minutes');
  });

  it('nomme le dépassement de délai serveur sur 502/503/504', () => {
    for (const status of [502, 503, 504]) {
      const texte = message({ status, error: null });
      expect(texte).toContain(`erreur ${status}`);
      expect(texte).toContain('volumineux');
    }
  });

  it('nomme le défaut de droits sur 401/403', () => {
    expect(message({ status: 403, error: null })).toContain('droits');
    expect(message({ status: 401, error: null })).toContain('droits');
  });

  it('mentionne toujours le code HTTP à défaut de detail', () => {
    expect(message({ status: 418, error: null })).toBe(
      'Erreur lors de la génération du rapport (code 418).');
  });

  it('reste lisible sans statut ni detail', () => {
    expect(message(undefined)).toBe('Erreur lors de la génération du rapport.');
  });
});

/**
 * Rapport de SYNTHÈSE sur une plage de sessions.
 *
 * L'opérateur choisit une session de début et une session de fin ; le backend regroupe
 * alors les pièces par pièce puis par session, et n'inclut qu'une fois les pièces
 * communes. Côté composant, l'essentiel est : proposer la synthèse seulement quand elle
 * a du sens, pré-remplir la plage, et ne JAMAIS transmettre une session unique en même
 * temps qu'une plage (le backend refuse les deux ensemble).
 */
describe('PieceManagementPageComponent — rapport de synthèse', () => {
  let cmp: PieceManagementPageComponent;
  let piecesSvc: jasmine.SpyObj<{
    startReport: any; getReportJob: any; getReportFile: any; checkReportCoherence: any;
  }>;

  const sessions = [
    { id: 'sess-3', numero_session: 3 },
    { id: 'sess-1', numero_session: 1 },
    { id: 'sess-2', numero_session: 2 },
  ] as any[];

  beforeEach(() => {
    piecesSvc = jasmine.createSpyObj('PiecesService',
      ['startReport', 'getReportJob', 'getReportFile', 'checkReportCoherence']);
    piecesSvc.startReport.and.returnValue(of({ id: 'job-1', statut: 'termine', progression: 100 }));
    piecesSvc.getReportFile.and.returnValue(
      of({ data: '', content_type: 'application/pdf', filename: 'r.pdf' }));
    // Le contrôle de cohérence tourne à l'ouverture de la modale et à chaque
    // changement de portée.
    piecesSvc.checkReportCoherence.and.returnValue(
      of({ ok: true, total: 0, erreurs: 0, avertissements: 0, anomalies: [] }));
    const router = jasmine.createSpyObj('Router', ['navigate']);
    (router as any).url = '/projets/p1/pieces/s1';
    const stub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    // Ordre réel du constructeur : projects, pieces, toast, router, route, breadcrumb, …
    cmp = new PieceManagementPageComponent(
      {} as any, piecesSvc as any, {} as any, router as any, {} as any, {} as any, stub, stub,
      {} as any,  // DomSanitizer (aperçu de la page de garde)
    );
    cmp.ssdgps = { id: 's1', numero_ssdgps: 2, type_ssdgps: 'multi-session' } as any;
    cmp.sessions = sessions;
  });

  afterEach(() => localStorage.clear());

  it('ordonne les sessions proposées par numéro', () => {
    expect(cmp.reportSessions.map(s => s.numero_session)).toEqual([1, 2, 3]);
  });

  it('propose la synthèse en multi-session avec au moins deux sessions', () => {
    expect(cmp.canSynthesize).toBeTrue();
  });

  it('ne propose pas la synthèse en mono-session', () => {
    cmp.ssdgps = { ...cmp.ssdgps, type_ssdgps: 'mono-session' } as any;
    expect(cmp.canSynthesize).toBeFalse();
  });

  it('ne propose pas la synthèse avec une seule session', () => {
    cmp.sessions = [sessions[1]];
    expect(cmp.canSynthesize).toBeFalse();
  });

  it('pré-remplit la plage de la première à la dernière session', () => {
    cmp.openReportModal();
    expect(cmp.reportScope).toBe('courant');
    expect(cmp.reportSessionFrom).toBe('sess-1');
    expect(cmp.reportSessionTo).toBe('sess-3');
  });

  it('ne transmet aucune plage hors mode synthèse', () => {
    cmp.openReportModal();
    expect(cmp.reportRange).toBeNull();
  });

  it('transmet la plage et aucune session unique en mode synthèse', () => {
    cmp.openReportModal();
    cmp.reportScope = 'synthese';
    (cmp as any).currentSessionId = 'sess-2';
    cmp.generateReport();

    const [, session, , range] = piecesSvc.startReport.calls.mostRecent().args;
    expect(session).toBeNull();
    expect(range).toEqual({ from: 'sess-1', to: 'sess-3' });
  });

  it('transmet la session courante hors mode synthèse', () => {
    cmp.openReportModal();
    (cmp as any).currentSessionId = 'sess-2';
    cmp.generateReport();

    const [, session, , range] = piecesSvc.startReport.calls.mostRecent().args;
    expect(session).toBe('sess-2');
    expect(range).toBeNull();
  });

  it('bloque la génération tant que la plage est incomplète', () => {
    cmp.openReportModal();
    cmp.reportScope = 'synthese';
    cmp.reportSessionTo = null;
    expect(cmp.reportRange).toBeNull();
    expect(cmp.canGenerateReport).toBeFalse();
  });

  it('autorise toujours la génération hors mode synthèse', () => {
    cmp.openReportModal();
    cmp.reportSessionFrom = null;
    expect(cmp.canGenerateReport).toBeTrue();
  });

  it('accepte une plage dont les bornes sont inversées (le backend les remet d’aplomb)', () => {
    cmp.openReportModal();
    cmp.reportScope = 'synthese';
    cmp.reportSessionFrom = 'sess-3';
    cmp.reportSessionTo = 'sess-1';
    expect(cmp.reportRange).toEqual({ from: 'sess-3', to: 'sess-1' });
    expect(cmp.canGenerateReport).toBeTrue();
  });
});

describe('PieceManagementPageComponent (statut modifiable dans la liste)', () => {
  let cmp: PieceManagementPageComponent;
  let piecesSvc: { update: jasmine.Spy };
  let toast: { success: jasmine.Spy; error: jasmine.Spy };

  function piece(over: Partial<Piece> = {}): Piece {
    return {
      id: 'p1', type_piece: 'RDL', type_piece_display: 'Rattachement',
      ordre: 1, is_deleted: false, session: null, source_saisie: 'manuel',
      statut: 'brouillon', ...over,
    } as any;
  }

  beforeEach(() => {
    piecesSvc = jasmine.createSpyObj('PiecesService', ['update']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    const sortStub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    const columnsStub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    cmp = new PieceManagementPageComponent(
      {} as any, piecesSvc as any, toast as any, {} as any, {} as any, {} as any,
      sortStub, columnsStub,
      {} as any,  // DomSanitizer (aperçu de la page de garde)
    );
  });

  it('enregistre le nouveau statut sans ouvrir la pièce', () => {
    const p = piece();
    piecesSvc.update.and.returnValue(of({ ...p, statut: 'valide' }));
    cmp.changeStatut(p, 'valide');
    expect(piecesSvc.update).toHaveBeenCalledWith('p1', { statut: 'valide' } as any);
    expect(p.statut).toBe('valide');
    expect(toast.success).toHaveBeenCalled();
  });

  it('n’appelle pas le serveur si le statut ne change pas', () => {
    cmp.changeStatut(piece({ statut: 'valide' }), 'valide');
    expect(piecesSvc.update).not.toHaveBeenCalled();
  });

  it('ignore une valeur vide', () => {
    cmp.changeStatut(piece(), '');
    expect(piecesSvc.update).not.toHaveBeenCalled();
  });

  it('rétablit le statut précédent quand le serveur refuse', () => {
    const p = piece();
    piecesSvc.update.and.returnValue(
      throwError(() => ({ error: { statut: ['Validation impossible : 2 point(s) sans photo.'] } })));
    cmp.changeStatut(p, 'valide');
    expect(p.statut).toBe('brouillon');
    expect(toast.error).toHaveBeenCalledWith('Changement impossible',
      'Validation impossible : 2 point(s) sans photo.');
  });

  it('retombe sur le detail puis sur un message générique', () => {
    piecesSvc.update.and.returnValue(throwError(() => ({ error: { detail: 'Interdit' } })));
    cmp.changeStatut(piece(), 'valide');
    expect(toast.error).toHaveBeenCalledWith('Changement impossible', 'Interdit');

    piecesSvc.update.and.returnValue(throwError(() => ({})));
    cmp.changeStatut(piece(), 'rejete');
    expect(toast.error).toHaveBeenCalledWith('Changement impossible', 'Statut non modifié');
  });

  it('ne lance pas deux envois concurrents pour la même pièce', () => {
    const p = piece();
    piecesSvc.update.and.returnValue(new Subject<any>().asObservable());
    cmp.changeStatut(p, 'valide');
    cmp.changeStatut(p, 'rejete');
    expect(piecesSvc.update).toHaveBeenCalledTimes(1);
  });

  it('libère le verrou une fois la réponse reçue', () => {
    const p = piece();
    piecesSvc.update.and.returnValue(of({ ...p, statut: 'valide' }));
    cmp.changeStatut(p, 'valide');
    expect(cmp.statutSaving['p1']).toBeUndefined();
  });

  it('interdit le changement sur une pièce supprimée', () => {
    expect(cmp.canChangeStatut(piece({ is_deleted: true }))).toBeFalse();
    expect(cmp.canChangeStatut(piece())).toBeTrue();
  });
});

/**
 * Génération du rapport en TÂCHE DE FOND.
 *
 * Avant : une seule requête synchrone, et une barre SIMULÉE qui montait à 90 % puis
 * attendait — un rendu de plusieurs minutes finissait par dépasser le délai du serveur,
 * sans que l'opérateur sache où il en était. Désormais la demande rend la main tout de
 * suite et le composant sonde l'avancement réel jusqu'au terme.
 */
describe('PieceManagementPageComponent — rapport en tâche de fond', () => {
  let cmp: PieceManagementPageComponent;
  let piecesSvc: jasmine.SpyObj<{ startReport: any; getReportJob: any; getReportFile: any }>;

  function job(over: any = {}): any {
    return {
      id: 'job-1', statut: 'en_cours', progression: 10, etape: 'Rendu de la pièce 1/3',
      erreur: '', nom_fichier: '', ...over,
    };
  }

  beforeEach(() => {
    jasmine.clock().install();
    piecesSvc = jasmine.createSpyObj('PiecesService', ['startReport', 'getReportJob', 'getReportFile']);
    piecesSvc.getReportFile.and.returnValue(
      of({ data: '', content_type: 'application/pdf', filename: 'rapport.pdf' }));
    const router = jasmine.createSpyObj('Router', ['navigate']);
    (router as any).url = '/projets/p1/pieces/s1';
    const stub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    cmp = new PieceManagementPageComponent(
      {} as any, piecesSvc as any, {} as any, router as any, {} as any, {} as any, stub, stub,
      {} as any,  // DomSanitizer (aperçu de la page de garde)
    );
    cmp.ssdgps = { id: 's1', numero_ssdgps: 2, type_ssdgps: 'mono-session' } as any;
    cmp.sessions = [];
  });

  afterEach(() => {
    jasmine.clock().uninstall();
    localStorage.clear();
  });

  it('affiche la progression réelle renvoyée par le serveur', () => {
    piecesSvc.startReport.and.returnValue(of(job({ progression: 37, etape: 'Rendu de la pièce 4/10' })));
    piecesSvc.getReportJob.and.returnValue(of(job({ progression: 37 })));

    cmp.generateReport();

    expect(cmp.reportProgress).toBe(37);
    expect(cmp.reportStep).toBe('Rendu de la pièce 4/10');
    expect(cmp.reportGenerating).toBeTrue();
  });

  it('continue à sonder tant que la génération n’est pas terminée', () => {
    piecesSvc.startReport.and.returnValue(of(job({ progression: 10 })));
    piecesSvc.getReportJob.and.returnValue(of(job({ progression: 60 })));

    cmp.generateReport();
    jasmine.clock().tick(1600);

    expect(piecesSvc.getReportJob).toHaveBeenCalledWith('job-1');
    expect(cmp.reportProgress).toBe(60);
  });

  it('récupère le fichier et termine à 100 % quand la génération aboutit', () => {
    piecesSvc.startReport.and.returnValue(of(job({ statut: 'en_cours' })));
    piecesSvc.getReportJob.and.returnValue(
      of(job({ statut: 'termine', progression: 100, nom_fichier: 'rapport.pdf' })));

    cmp.generateReport();
    jasmine.clock().tick(1600);

    expect(piecesSvc.getReportFile).toHaveBeenCalledWith('job-1');
    expect(cmp.reportProgress).toBe(100);
    expect(cmp.reportGenerating).toBeFalse();
    expect(cmp.reportFilename).toBe('rapport.pdf');
  });

  it('ne sonde plus une fois la génération terminée', () => {
    piecesSvc.startReport.and.returnValue(of(job({ statut: 'termine', progression: 100 })));

    cmp.generateReport();
    jasmine.clock().tick(5000);

    expect(piecesSvc.getReportJob).not.toHaveBeenCalled();
  });

  it('affiche le message d’erreur du serveur quand la génération échoue', () => {
    piecesSvc.startReport.and.returnValue(
      of(job({ statut: 'echec', erreur: 'Image illisible dans la pièce 3.' })));

    cmp.generateReport();

    expect(cmp.reportError).toBe('Image illisible dans la pièce 3.');
    expect(cmp.reportGenerating).toBeFalse();
    expect(cmp.reportProgress).toBe(0);
  });

  it('reste explicite si l’échec ne porte aucun message', () => {
    piecesSvc.startReport.and.returnValue(of(job({ statut: 'echec', erreur: '' })));

    cmp.generateReport();

    expect(cmp.reportError).toContain('Erreur lors de la génération');
  });

  it('traite une erreur HTTP au lancement', () => {
    piecesSvc.startReport.and.returnValue(throwError(() => ({ status: 403 })));

    cmp.generateReport();

    expect(cmp.reportGenerating).toBeFalse();
    expect(cmp.reportError).toContain('droits');
  });

  it('traite une erreur HTTP pendant le sondage', () => {
    piecesSvc.startReport.and.returnValue(of(job()));
    piecesSvc.getReportJob.and.returnValue(throwError(() => ({ status: 0 })));

    cmp.generateReport();
    jasmine.clock().tick(1600);

    expect(cmp.reportGenerating).toBeFalse();
    expect(cmp.reportError).toContain('serveur');
  });

  it('arrête le sondage à la fermeture de la modale', () => {
    piecesSvc.startReport.and.returnValue(of(job()));
    piecesSvc.getReportJob.and.returnValue(of(job()));

    cmp.generateReport();
    cmp.reportGenerating = false;      // la modale ne se ferme pas pendant le rendu
    cmp.closeReportModal();
    piecesSvc.getReportJob.calls.reset();
    jasmine.clock().tick(5000);

    expect(piecesSvc.getReportJob).not.toHaveBeenCalled();
  });

  it('repart de zéro quand on revient à la configuration', () => {
    piecesSvc.startReport.and.returnValue(of(job({ statut: 'termine', progression: 100 })));
    cmp.generateReport();

    cmp.backToReportConfig();

    expect(cmp.reportProgress).toBe(0);
    expect(cmp.reportStep).toBe('');
    expect(cmp.reportJobId).toBeNull();
  });

  it('ignore un second clic pendant une génération en cours', () => {
    piecesSvc.startReport.and.returnValue(of(job()));
    piecesSvc.getReportJob.and.returnValue(of(job()));

    cmp.generateReport();
    cmp.generateReport();

    expect(piecesSvc.startReport).toHaveBeenCalledTimes(1);
  });
});

/**
 * Aperçu de la page de garde.
 *
 * La page de garde est la table des matières du rapport : ordre, numérotation,
 * désignations. Une pièce oubliée ou un intitulé fautif s'y voient — mais les découvrir
 * après plusieurs minutes de rendu coûte une génération complète pour rien. L'aperçu ne
 * rend que cette page, avec la portée et le mode déjà choisis dans la modale.
 */
describe('PieceManagementPageComponent — aperçu de la page de garde', () => {
  let cmp: PieceManagementPageComponent;
  let piecesSvc: jasmine.SpyObj<{ previewReportCover: any }>;

  const REPONSE = { data: '', content_type: 'application/pdf', filename: 'APERCU_x.pdf' };

  beforeEach(() => {
    piecesSvc = jasmine.createSpyObj('PiecesService', ['previewReportCover']);
    piecesSvc.previewReportCover.and.returnValue(of(REPONSE));
    const sanitizer = { bypassSecurityTrustResourceUrl: (u: string) => u } as any;
    const stub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    cmp = new PieceManagementPageComponent(
      {} as any, piecesSvc as any, {} as any, { navigate: () => {} } as any,
      {} as any, {} as any, stub, stub, sanitizer,
    );
    cmp.ssdgps = { id: 's1', numero_ssdgps: 2, type_ssdgps: 'multi-session' } as any;
    cmp.sessions = [
      { id: 'sess-1', numero_session: 1 } as any,
      { id: 'sess-2', numero_session: 2 } as any,
    ];
  });

  afterEach(() => localStorage.clear());

  it('ouvre la modale et expose une URL d’aperçu', () => {
    cmp.previewReportCover();

    expect(cmp.showCoverPreview).toBeTrue();
    expect(cmp.coverPreviewLoading).toBeFalse();
    expect(cmp.coverPreviewUrl).toBeTruthy();
    expect(cmp.coverPreviewError).toBe('');
  });

  it('transmet la session courante et le mode d’impression choisis', () => {
    cmp.currentSessionId = 'sess-1';
    cmp.reportDuplex = true;

    cmp.previewReportCover();

    const [ssdgps, session, duplex, range] = piecesSvc.previewReportCover.calls.mostRecent().args;
    expect(ssdgps).toBe('s1');
    expect(session).toBe('sess-1');
    expect(duplex).toBeTrue();
    expect(range).toBeNull();
  });

  it('transmet la plage en mode synthèse, sans session', () => {
    cmp.currentSessionId = 'sess-1';
    cmp.reportScope = 'synthese';
    cmp.reportSessionFrom = 'sess-1';
    cmp.reportSessionTo = 'sess-2';

    cmp.previewReportCover();

    const [, session, , range] = piecesSvc.previewReportCover.calls.mostRecent().args;
    expect(session).toBeNull();
    expect(range).toEqual({ from: 'sess-1', to: 'sess-2' });
  });

  it('ne demande rien tant que la plage de synthèse est incomplète', () => {
    cmp.reportScope = 'synthese';
    cmp.reportSessionFrom = 'sess-1';
    cmp.reportSessionTo = null;

    cmp.previewReportCover();

    expect(piecesSvc.previewReportCover).not.toHaveBeenCalled();
    expect(cmp.showCoverPreview).toBeFalse();
  });

  it('affiche le message du serveur en cas d’échec', () => {
    piecesSvc.previewReportCover.and.returnValue(
      throwError(() => ({ status: 501, error: { detail: 'WeasyPrint indisponible' } })));

    cmp.previewReportCover();

    expect(cmp.coverPreviewError).toBe('WeasyPrint indisponible');
    expect(cmp.coverPreviewUrl).toBeNull();
    expect(cmp.coverPreviewLoading).toBeFalse();
  });

  it('libère l’aperçu à la fermeture', () => {
    cmp.previewReportCover();

    cmp.closeCoverPreview();

    expect(cmp.showCoverPreview).toBeFalse();
    expect(cmp.coverPreviewUrl).toBeNull();
  });

  it('ferme aussi l’aperçu quand on ferme la modale du rapport', () => {
    cmp.previewReportCover();

    cmp.closeReportModal();

    expect(cmp.showCoverPreview).toBeFalse();
  });
});

/**
 * Contrôle de cohérence avant génération.
 *
 * La génération ne dit rien d'elle-même : une pièce restée en brouillon est absente du
 * rapport, un trou dans la numérotation des déterminations passe inaperçu. Le contrôle
 * tourne à l'ouverture de la modale et suit la portée choisie — un contrôle périmé
 * vaudrait moins que pas de contrôle du tout.
 */
describe('PieceManagementPageComponent — contrôle de cohérence', () => {
  let cmp: PieceManagementPageComponent;
  let piecesSvc: jasmine.SpyObj<{ checkReportCoherence: any }>;

  const SAIN = { ok: true, total: 0, erreurs: 0, avertissements: 0, anomalies: [] };
  const ANOMALIES = {
    ok: false, total: 2, erreurs: 1, avertissements: 1,
    anomalies: [
      { code: 'determination_manquante', severite: 'erreur', message: 'Trou n°2.' },
      { code: 'piece_non_validee', severite: 'avertissement', message: 'LPA en brouillon.' },
    ],
  };

  beforeEach(() => {
    piecesSvc = jasmine.createSpyObj('PiecesService', ['checkReportCoherence']);
    piecesSvc.checkReportCoherence.and.returnValue(of(SAIN));
    const stub = { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any;
    cmp = new PieceManagementPageComponent(
      {} as any, piecesSvc as any, {} as any, { navigate: () => {} } as any,
      {} as any, {} as any, stub, stub, {} as any,
    );
    cmp.ssdgps = { id: 's1', numero_ssdgps: 2, type_ssdgps: 'multi-session' } as any;
    cmp.sessions = [
      { id: 'sess-1', numero_session: 1 } as any,
      { id: 'sess-2', numero_session: 2 } as any,
    ];
  });

  afterEach(() => localStorage.clear());

  it('contrôle dès l’ouverture de la modale', () => {
    cmp.openReportModal();

    expect(piecesSvc.checkReportCoherence).toHaveBeenCalled();
    expect(cmp.coherence).toEqual(SAIN as any);
    expect(cmp.coherenceLoading).toBeFalse();
  });

  it('expose le détail des anomalies, replié par défaut', () => {
    piecesSvc.checkReportCoherence.and.returnValue(of(ANOMALIES));

    cmp.openReportModal();

    expect(cmp.coherence!.erreurs).toBe(1);
    expect(cmp.coherence!.avertissements).toBe(1);
    expect(cmp.coherenceOpen).toBeFalse();

    cmp.toggleCoherenceDetail();
    expect(cmp.coherenceOpen).toBeTrue();
  });

  it('recontrôle quand la portée change', () => {
    cmp.openReportModal();
    piecesSvc.checkReportCoherence.calls.reset();

    cmp.setReportScope('synthese');

    expect(piecesSvc.checkReportCoherence).toHaveBeenCalled();
    const [, session, range] = piecesSvc.checkReportCoherence.calls.mostRecent().args;
    expect(session).toBeNull();
    expect(range).toEqual({ from: 'sess-1', to: 'sess-2' });
  });

  it('recontrôle quand une borne de plage change', () => {
    cmp.openReportModal();
    cmp.setReportScope('synthese');
    piecesSvc.checkReportCoherence.calls.reset();

    cmp.reportSessionTo = 'sess-1';
    cmp.onReportRangeChange();

    const [, , range] = piecesSvc.checkReportCoherence.calls.mostRecent().args;
    expect(range).toEqual({ from: 'sess-1', to: 'sess-1' });
  });

  it('ne contrôle pas tant que la plage de synthèse est incomplète', () => {
    cmp.openReportModal();
    cmp.reportScope = 'synthese';
    cmp.reportSessionTo = null;
    piecesSvc.checkReportCoherence.calls.reset();

    cmp.runCoherenceCheck();

    expect(piecesSvc.checkReportCoherence).not.toHaveBeenCalled();
    expect(cmp.coherence).toBeNull();
  });

  it('n’affiche rien si le contrôle échoue : il ne doit pas empêcher de générer', () => {
    piecesSvc.checkReportCoherence.and.returnValue(throwError(() => ({ status: 500 })));

    cmp.openReportModal();

    expect(cmp.coherence).toBeNull();
    expect(cmp.coherenceLoading).toBeFalse();
  });

  it('transmet la session courante hors synthèse', () => {
    cmp.currentSessionId = 'sess-2';

    cmp.openReportModal();

    const [ssdgps, session, range] = piecesSvc.checkReportCoherence.calls.mostRecent().args;
    expect(ssdgps).toBe('s1');
    expect(session).toBe('sess-2');
    expect(range).toBeNull();
  });
});
