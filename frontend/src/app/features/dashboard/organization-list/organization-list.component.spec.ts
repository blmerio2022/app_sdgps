import { of, throwError } from 'rxjs';
import { OrganizationListComponent } from './organization-list.component';
import { toColumnPrefs } from '../../../shared/components/column-config/column-config.util';

/**
 * Helpers purs de la liste des organisations (filtres, tri, sélection, pagination, badges).
 * Instanciation directe : les dépendances ne sont sollicitées qu'en ngOnInit / appels API.
 */
describe('OrganizationListComponent (logique)', () => {
  let cmp: OrganizationListComponent;

  const orgs = [
    { id: '1', code: 'ORG-A', name: 'Alpha', type: 'PUBLIC', email: 'a@x.ma', member_count: 3, is_active: true },
    { id: '2', code: 'ORG-B', name: 'Beta', type: 'PRIVATE', email: 'b@x.ma', member_count: 1, is_active: false },
    { id: '3', code: 'ORG-C', name: 'Gamma', type: 'PUBLIC', email: 'c@x.ma', member_count: 7, is_active: true },
  ] as any[];

  beforeEach(() => {
    cmp = new OrganizationListComponent(
      {} as any, {} as any, {} as any,
      { markForCheck: () => {} } as any,
      {} as any, {} as any,
      { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any,
      { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any,
    );
    cmp.organizations = [...orgs];
    cmp.filteredOrganizations = [...orgs];
  });

  describe('recherche & tri', () => {
    it('filtre par requête (nom/code/email)', () => {
      cmp.searchQuery = 'beta';
      (cmp as any).applyFiltersAndSort();
      expect(cmp.filteredOrganizations.map(o => o.id)).toEqual(['2']);
    });
    it('trie par colonne et bascule la direction', () => {
      cmp.sort('member_count');
      expect(cmp.filteredOrganizations.map(o => o.member_count)).toEqual([1, 3, 7]);
      cmp.sort('member_count'); // re-clic → desc
      expect(cmp.filteredOrganizations.map(o => o.member_count)).toEqual([7, 3, 1]);
    });
    it('getSortIcon reflète l’état', () => {
      expect(cmp.getSortIcon('name')).toBe('fas fa-sort');
      cmp.sort('name');
      expect(cmp.getSortIcon('name')).toBe('fas fa-sort-up');
    });
  });

  describe('tri multi-niveaux', () => {
    // La modale (ajout/retrait/déplacement/effacement des niveaux) est désormais dans le composant
    // partagé <app-multi-level-sort> (testé séparément). Ici : application du tri + branchements.
    it('compareByLevels : niveau 1 puis départage par niveau 2', () => {
      // is_active desc → true (Alpha 3, Gamma 7) avant false (Beta 1) ; départage member_count desc.
      cmp.sortLevels = [{ field: 'is_active', dir: 'desc' }, { field: 'member_count', dir: 'desc' }];
      (cmp as any).applyFiltersAndSort();
      expect(cmp.filteredOrganizations.map(o => o.id)).toEqual(['3', '1', '2']);
    });
    it('le tri multi-niveaux prime sur le tri mono-colonne', () => {
      cmp.sortColumn = 'name'; cmp.sortDirection = 'asc';
      cmp.sortLevels = [{ field: 'member_count', dir: 'asc' }];
      (cmp as any).applyFiltersAndSort();
      expect(cmp.filteredOrganizations.map(o => o.member_count)).toEqual([1, 3, 7]);
    });
    it('sortLevelOf / sortDirOf', () => {
      cmp.sortLevels = [{ field: 'name', dir: 'asc' }, { field: 'code', dir: 'desc' }];
      expect(cmp.sortLevelOf('name')).toBe(1);
      expect(cmp.sortLevelOf('code')).toBe(2);
      expect(cmp.sortLevelOf('email')).toBe(0);
      expect(cmp.sortDirOf('code')).toBe('desc');
    });
    it('onSortLevelsChange applique les niveaux reçus de la modale partagée', () => {
      cmp.sortLevels = [];
      cmp.onSortLevelsChange([{ field: 'member_count', dir: 'asc' }]);
      expect(cmp.sortLevels).toEqual([{ field: 'member_count', dir: 'asc' }]);
      expect(cmp.filteredOrganizations.map(o => o.member_count)).toEqual([1, 3, 7]);
    });
  });

  describe('sélection', () => {
    it('toggleSelection ajoute puis retire', () => {
      cmp.toggleSelection('1');
      expect(cmp.selectedOrganizations.has('1')).toBeTrue();
      cmp.toggleSelection('1');
      expect(cmp.selectedOrganizations.has('1')).toBeFalse();
    });
    it('selectAll / isAllSelected / deselectAll', () => {
      cmp.selectAll();
      expect(cmp.isAllSelected()).toBeTrue();
      cmp.deselectAll();
      expect(cmp.selectedOrganizations.size).toBe(0);
    });
    it('invertSelection inverse la sélection', () => {
      cmp.selectedOrganizations.add('1');
      cmp.invertSelection();
      expect(Array.from(cmp.selectedOrganizations).sort()).toEqual(['2', '3']);
    });
    it('toggleSelectAll bascule tout', () => {
      cmp.toggleSelectAll();
      expect(cmp.isAllSelected()).toBeTrue();
      cmp.toggleSelectAll();
      expect(cmp.selectedOrganizations.size).toBe(0);
    });
  });

  // La gestion des colonnes (visibilité/ordre/filtre) est désormais dans le composant partagé
  // <app-column-config> (testé séparément). Les branchements du parent (onColumnsChange /
  // onResetColumns / openColumnConfigFromContext) sont couverts dans le describe « config colonnes ».

  describe('pagination', () => {
    beforeEach(() => {
      cmp.filteredOrganizations = new Array(23).fill(null).map((_, i) => ({ id: String(i) })) as any;
      cmp.pageSize = 5;
    });
    it('totalPages arrondit vers le haut', () => {
      expect(cmp.totalPages).toBe(5);
    });
    it('paginatedOrganizations découpe la page courante', () => {
      cmp.currentPage = 2;
      expect(cmp.paginatedOrganizations.length).toBe(5);
      expect(cmp.paginatedOrganizations[0].id).toBe('5');
    });
    it('nextPage / prevPage bornent', () => {
      cmp.currentPage = 5;
      cmp.nextPage();
      expect(cmp.currentPage).toBe(5);
      cmp.currentPage = 1;
      cmp.prevPage();
      expect(cmp.currentPage).toBe(1);
    });
    it('setPageSize revient page 1', () => {
      cmp.currentPage = 3;
      cmp.setPageSize(10);
      expect(cmp.pageSize).toBe(10);
      expect(cmp.currentPage).toBe(1);
    });
    it('getPageNumbers limite la fenêtre à 5', () => {
      cmp.currentPage = 3;
      expect(cmp.getPageNumbers().length).toBeLessThanOrEqual(5);
    });
  });

  describe('badges & formatage', () => {
    it('getStatusText / getStatusBadgeClass', () => {
      expect(cmp.getStatusText(true)).toBe('Active');
      expect(cmp.getStatusBadgeClass(false)).toContain('danger');
    });
    it('getTypeBadgeClass', () => {
      expect(cmp.getTypeBadgeClass('PRIVATE')).toContain('primary');
      expect(cmp.getTypeBadgeClass('PUBLIC')).toContain('info');
    });
    it('formatTypeDisplay mappe public/privé', () => {
      expect(cmp.formatTypeDisplay('PUBLIC', 'x')).toBe('Administration');
      expect(cmp.formatTypeDisplay('PRIVATE', 'x')).toBe('Entreprise');
      expect(cmp.formatTypeDisplay('AUTRE', 'Libellé')).toBe('Libellé');
    });
    it('formatDate renvoie un tiret si vide', () => {
      expect(cmp.formatDate('')).toBe('-');
      expect(cmp.formatDate('2026-07-21T10:00:00Z')).toContain('2026');
    });
    it('getTypeLabel mappe les types de colonne', () => {
      expect(cmp.getTypeLabel('number')).toBe('Nombre');
      expect(cmp.getTypeLabel(undefined)).toBe('Texte');
    });
  });

  describe('canCreateOrganization (rôle JWT)', () => {
    afterEach(() => localStorage.clear());
    function jwt(payload: object): string { return `x.${btoa(JSON.stringify(payload))}.y`; }

    it('vrai pour un Admin Système', () => {
      localStorage.setItem('authToken', jwt({ platform_role: 'ROLE_ADMIN_SYSTEME' }));
      expect(cmp.canCreateOrganization).toBeTrue();
    });
    it('faux pour un agent', () => {
      localStorage.setItem('authToken', jwt({ role: 'ROLE_ORGANISATION_AGENT' }));
      expect(cmp.canCreateOrganization).toBeFalse();
    });
    it('faux sans token (repli agent)', () => {
      localStorage.clear();
      expect(cmp.canCreateOrganization).toBeFalse();
    });
  });

  describe('onglets Actifs / Corbeille & suppression définitive', () => {
    let orgService: jasmine.SpyObj<any>;
    let toast: jasmine.SpyObj<any>;

    beforeEach(() => {
      orgService = jasmine.createSpyObj('OrganizationService', [
        'getOrganizations', 'restoreOrganization', 'bulkRestoreOrganizations',
        'permanentDeleteOrganization', 'bulkPermanentDeleteOrganizations',
      ]);
      toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'warning']);
      cmp = new OrganizationListComponent(
        orgService, {} as any, {} as any, { markForCheck: () => {} } as any, {} as any, toast,
        { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any,
        { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any,
      );
      cmp.activeOrganizations = [{ id: '1', name: 'Active' }] as any;
      cmp.deletedOrganizations = [{ id: '2', name: 'Deleted' }] as any;
      cmp.organizations = cmp.activeOrganizations;
    });

    it('compteurs actifs/supprimés', () => {
      expect(cmp.activeCount).toBe(1);
      expect(cmp.deletedCount).toBe(1);
    });

    it('setTab bascule vers la corbeille', () => {
      cmp.setTab(true);
      expect(cmp.showDeleted).toBeTrue();
      expect(cmp.organizations).toBe(cmp.deletedOrganizations);
    });

    it('openBulkRestore refuse sans sélection', () => {
      cmp.selectedOrganizations.clear();
      cmp.openBulkRestore();
      expect(cmp.showRestoreModal).toBeFalse();
    });

    it('confirmRestore (unitaire) appelle le service', () => {
      orgService.restoreOrganization.and.returnValue(of({}));
      orgService.getOrganizations.and.returnValue(of([]));
      cmp.openRestore({ id: '2', name: 'X' } as any);
      cmp.confirmRestore();
      expect(orgService.restoreOrganization).toHaveBeenCalledWith('2');
    });

    it('confirmPermanentDelete (masse) appelle bulkPermanentDelete', () => {
      orgService.bulkPermanentDeleteOrganizations.and.returnValue(of({ deleted_count: 2, errors: [] }));
      orgService.getOrganizations.and.returnValue(of([]));
      cmp.selectedOrganizations.add('a');
      cmp.selectedOrganizations.add('b');
      cmp.openBulkPermanentDelete();
      cmp.confirmPermanentDelete();
      expect(orgService.bulkPermanentDeleteOrganizations).toHaveBeenCalled();
    });

    it('openPermanentDelete arme la cible unitaire', () => {
      cmp.openPermanentDelete({ id: '2', name: 'X' } as any);
      expect(cmp.showPermanentDeleteModal).toBeTrue();
      expect(cmp.isBulkPermanent).toBeFalse();
    });

    it('confirmPermanentDelete (unitaire) affiche le message backend en cas de blocage', () => {
      orgService.permanentDeleteOrganization.and.returnValue(
        throwError(() => ({ error: { detail: '2 projet(s) rattaché(s).' } }))
      );
      cmp.openPermanentDelete({ id: '2', name: 'X' } as any);
      cmp.confirmPermanentDelete();
      expect(toast.error).toHaveBeenCalledWith('Suppression impossible', '2 projet(s) rattaché(s).');
    });

    it('confirmPermanentDelete (masse) : aucune suppression → toast error', () => {
      orgService.bulkPermanentDeleteOrganizations.and.returnValue(
        of({ deleted_count: 0, errors: [{ id: 'a', detail: 'projets' }] })
      );
      orgService.getOrganizations.and.returnValue(of([]));
      cmp.selectedOrganizations.add('a');
      cmp.openBulkPermanentDelete();
      cmp.confirmPermanentDelete();
      expect(toast.error).toHaveBeenCalled();
    });

    it('confirmPermanentDelete (masse) : partiel → toast warning', () => {
      orgService.bulkPermanentDeleteOrganizations.and.returnValue(
        of({ deleted_count: 1, errors: [{ id: 'b', detail: 'projets' }] })
      );
      orgService.getOrganizations.and.returnValue(of([]));
      cmp.selectedOrganizations.add('a');
      cmp.selectedOrganizations.add('b');
      cmp.openBulkPermanentDelete();
      cmp.confirmPermanentDelete();
      expect(toast.warning).toHaveBeenCalled();
    });
  });
});

describe('OrganizationListComponent (config colonnes)', () => {
  let cmp: OrganizationListComponent;
  let toast: any;
  let columnsSvc: any;

  beforeEach(() => {
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    columnsSvc = {
      get: jasmine.createSpy('get').and.returnValue(of([])),
      save: jasmine.createSpy('save').and.returnValue(of([])),
      resetToSource: jasmine.createSpy('resetToSource').and.returnValue(of([])),
    };
    cmp = new OrganizationListComponent(
      {} as any, {} as any, {} as any, { markForCheck: () => {} } as any, {} as any, toast,
      { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any,
      columnsSvc,
    );
    cmp.columns = [
      { field: 'code', label: 'Code', visible: true } as any,
      { field: 'name', label: 'Nom', visible: true } as any,
    ];
  });

  it('onColumnsChange applique les colonnes et programme l’enregistrement (clé « organizations »)', (done) => {
    const cols = [{ field: 'name', label: 'Nom', visible: false }] as any;
    cmp.onColumnsChange(cols);
    expect(cmp.columns).toBe(cols);
    setTimeout(() => {
      expect(columnsSvc.save).toHaveBeenCalledWith('organizations', [{ field: 'name', visible: false }]);
      done();
    }, 600);
  });

  it('onResetColumns appelle le service pour la clé « organizations » et réapplique', () => {
    columnsSvc.resetToSource.and.returnValue(of([{ field: 'name', visible: true }, { field: 'code', visible: false }]));
    cmp.onResetColumns();
    expect(columnsSvc.resetToSource).toHaveBeenCalledWith('organizations');
    expect(cmp.columns.map(c => c.field)).toEqual(['name', 'code']);
    expect(toast.success).toHaveBeenCalled();
  });

  it('openColumnConfigFromContext ferme les menus et ouvre la modale de colonnes', () => {
    const open = jasmine.createSpy('open');
    (cmp as any).columnCfg = { open };
    cmp.showColumnContextMenu = true;
    cmp.openColumnConfigFromContext();
    expect(cmp.showColumnContextMenu).toBeFalse();
    expect(open).toHaveBeenCalled();
  });

  it('getFieldDescription : repli hors-ligne quand le backend ne fournit pas la description', () => {
    cmp.fieldDescriptions = {};
    // Repli codé en dur (parité avec l'ancienne modale inline).
    expect(cmp.getFieldDescription('name')).toContain('Nom officiel');
    expect(cmp.getFieldDescription('type_display')).toContain('Cabinet privé');
    // Champ inconnu → chaîne vide.
    expect(cmp.getFieldDescription('inconnu')).toBe('');
  });

  it('getFieldDescription : le backend est prioritaire sur le repli codé en dur', () => {
    cmp.fieldDescriptions = { name: 'Description backend' };
    expect(cmp.getFieldDescription('name')).toBe('Description backend');
  });

  it('loadColumnMetadata enrichit le catalogue curé SANS y ajouter de champ hors allowlist', () => {
    // Le backend renvoie des champs du modèle ABSENTS du catalogue (type, parent, logo, ...) :
    // ils ne doivent PAS être injectés dans this.columns, sinon la sauvegarde échoue (400).
    const metadataMap = new Map<string, any>([
      ['code', { field: 'code', label: 'Code (backend)', type: 'CharField' }],
      ['name', { field: 'name', label: 'Nom (backend)', type: 'CharField' }],
      ['type', { field: 'type', label: 'Type brut', type: 'CharField' }],
      ['parent', { field: 'parent', label: 'Parent', type: 'ForeignKey' }],
      ['logo', { field: 'logo', label: 'Logo', type: 'ImageField' }],
    ]);
    (cmp as any).preferencesService = { getColumnMetadata: () => of(metadataMap) };
    (cmp as any).loadUserPreferences = () => {};
    (cmp as any).loadColumnMetadata();
    // Colonnes limitées au catalogue, labels enrichis depuis le backend.
    expect(cmp.columns.map(c => c.field)).toEqual(['code', 'name']);
    expect(cmp.columns.find(c => c.field === 'code')?.label).toBe('Code (backend)');
    // Sérialisation persistée : aucun champ hors allowlist.
    const fields = toColumnPrefs(cmp.columns).map(p => p.field);
    expect(fields).not.toContain('type');
    expect(fields).not.toContain('parent');
    expect(fields).not.toContain('logo');
  });
});
