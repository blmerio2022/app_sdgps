import { formatDateTime } from '../../../shared/utils/date-format.util';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../../../shared/components/table-pagination/table-pagination.component';
import { Component, OnInit, OnDestroy, HostListener, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ProjectsService } from '../../../core/services/projects.service';
import { BreadcrumbService } from '../../../core/layout/services/breadcrumb.service';
import { ProfileService } from '../../profile/services/profile.service';
import { OrganizationService } from '../../../core/services/organization.service';
import { ToastService } from '../../../core/services/toast.service';
import { Projet, STATUT_OPTIONS } from '../../../core/models/project.model';
import { Organization } from '../../../core/models/organization.model';
import { TableSortConfigService, OrgSortLevel } from '../../../core/services/table-sort-config.service';
import { SortableField, compareByLevels, sortLevelOf, sortDirOf } from '../../../shared/components/multi-level-sort/multi-level-sort.util';
import { MultiLevelSortComponent } from '../../../shared/components/multi-level-sort/multi-level-sort.component';
import { ColumnConfigComponent } from '../../../shared/components/column-config/column-config.component';
import { applyColumnsConfig, toColumnPrefs, ManagedColumn } from '../../../shared/components/column-config/column-config.util';
import { ColumnFilterMap, withColumnFilter, rowMatchesColumnFilters, activeFilterCount } from '../../../shared/components/column-filter/column-filter.util';
import { TableColumnsConfigService } from '../../../core/services/table-columns-config.service';

interface ColumnConfig {
  field: string;
  label: string;
  visible: boolean;
  type?: 'text' | 'date' | 'number' | 'status' | 'boolean' | 'actions';
}

const PREFS_KEY = 'sdgps_projects_table_prefs';
const VIEW_MODE_KEY = 'sdgps_projects_view_mode';

@Component({
  selector: 'app-project-list',
  templateUrl: './project-list.component.html',
  styleUrls: ['./project-list.component.scss'],
})
export class ProjectListComponent implements OnInit, OnDestroy {
  readonly statutOptions = STATUT_OPTIONS;
  private destroy$ = new Subject<void>();
  private boundHandleClickOutside!: (event: Event) => void;

  // Données
  activeProjets: Projet[] = [];
  deletedProjets: Projet[] = [];
  get projets(): Projet[] { return this.showDeleted ? this.deletedProjets : this.activeProjets; }
  get activeCount(): number { return this.activeProjets.length; }
  get deletedCount(): number { return this.deletedProjets.length; }
  showDeleted = false;
  filteredProjets: Projet[] = [];
  paginatedProjets: Projet[] = [];
  private manualOrder: string[] | null = null;

  // Vue Cartes / Tableau
  viewMode: 'cards' | 'table' = 'table';

  // Configuration des colonnes
  columns: ColumnConfig[] = [
    { field: 'code_projet', label: 'Code', visible: true, type: 'text' },
    { field: 'nom_projet', label: 'Nom du projet', visible: true, type: 'text' },
    { field: 'statut', label: 'Statut', visible: true, type: 'status' },
    { field: 'organization_name', label: 'Organisation', visible: true, type: 'text' },
    { field: 'nbr_total_proprietes', label: 'Propriétés', visible: true, type: 'number' },
    { field: 'nbr_total_affaires', label: 'Affaires', visible: true, type: 'number' },
    { field: 'nbr_total_ssdgps', label: 'SSDGPS', visible: true, type: 'number' },
    { field: 'nbr_total_sessions', label: 'Sessions', visible: true, type: 'number' },
    { field: 'nbr_total_pieces', label: 'Nb Pièces', visible: true, type: 'number' },
    { field: 'created_at', label: 'Date de création', visible: false, type: 'date' },
    { field: 'updated_at', label: 'Dernière modification', visible: false, type: 'date' },
    { field: 'is_deleted', label: 'Supprimé', visible: false, type: 'boolean' },
    { field: 'deleted_at', label: 'Date de suppression', visible: false, type: 'date' },
    { field: 'created_by_email', label: 'Créé par', visible: false, type: 'text' },
    { field: 'updated_by_email', label: 'Modifié par', visible: false, type: 'text' },
    { field: 'deleted_by_email', label: 'Supprimé par', visible: false, type: 'text' },
  ];

  // Filtres
  searchText = '';
  selectedStatut = '';
  selectedOrganization = '';
  displayMode: 'all' | 'selected' = 'all';
  activeFieldFilter: string | null = null;
  activeFieldFilterLabel = '';
  fieldFilterValue = '';

  // Tri mono-colonne (clic en-tête) — repli quand aucun tri multi-niveaux.
  sortColumn = 'created_at';
  sortDirection: 'asc' | 'desc' = 'desc';

  // --- Tri MULTI-NIVEAUX (config opérateur, héritée du super admin) — parité liste organisations ---
  private readonly SORT_KEY = 'projects';
  readonly sortableFields: SortableField[] = [
    { field: 'code_projet', label: 'Code' },
    { field: 'nom_projet', label: 'Nom du projet' },
    { field: 'statut', label: 'Statut' },
    { field: 'organization_name', label: 'Organisation' },
    { field: 'nbr_total_proprietes', label: 'Propriétés' },
    { field: 'nbr_total_affaires', label: 'Affaires' },
    { field: 'nbr_total_ssdgps', label: 'SSDGPS' },
    { field: 'nbr_total_sessions', label: 'Sessions' },
    { field: 'nbr_total_pieces', label: 'Nb Pièces' },
    { field: 'created_at', label: 'Date de création' },
    { field: 'updated_at', label: 'Dernière modification' },
    { field: 'created_by_email', label: 'Créé par' },
    { field: 'updated_by_email', label: 'Modifié par' },
    { field: 'is_deleted', label: 'Supprimé' },
    { field: 'deleted_at', label: 'Date de suppression' },
    { field: 'deleted_by_email', label: 'Supprimé par' },
  ];
  sortLevels: OrgSortLevel[] = [];
  savingSort = false;
  savedSortFlash = false;
  resettingSort = false;
  private sortSaveTimer: any;

  // --- Configuration des COLONNES (config opérateur, héritée du super admin) — composant partagé ---
  private readonly COLUMNS_KEY = 'projects';
  @ViewChild(ColumnConfigComponent) private columnCfg?: ColumnConfigComponent;
  /** Description d'une colonne pour la modale partagée (référence stable). */
  describeColumn = (field: string): string => this.getFieldDescription(field);
  savingColumns = false;
  savedColumnsFlash = false;
  resettingColumns = false;
  private columnsSaveTimer: any;

  // Sélection
  selectedIds = new Set<string>();
  isAllSelected = false;

  // Pagination
  currentPage = 1;
  pageSize = DEFAULT_PAGE_SIZE;
  pageSizeOptions = [...PAGE_SIZE_OPTIONS];

  // Organisation courante (création) / liste des organisations (admin)
  currentOrgId: string | null = null;
  currentOrgName: string | null = null;
  organizations: Organization[] = [];

  // Modale créer / modifier
  showModal = false;
  editing: Projet | null = null;
  submitting = false;
  form: FormGroup;

  // Modale suppression
  showDeleteModal = false;
  deleteTarget: Projet | null = null;
  isBulkDelete = false;
  deleting = false;

  // Modale restauration
  showRestoreModal = false;
  restoreTarget: Projet | null = null;
  isBulkRestore = false;
  restoring = false;

  // Modale suppression définitive (corbeille)
  showPermanentDeleteModal = false;
  permanentDeleteTarget: Projet | null = null;
  isBulkPermanent = false;
  permanentDeleting = false;

  // Dropdowns
  showExportMenu = false;
  showFilterMenu = false;
  showFieldFilterMenu = false;

  // Tri multi-niveaux (composant partagé) — ouverture programmatique depuis le menu contextuel.
  @ViewChild(MultiLevelSortComponent) private sortCmp?: MultiLevelSortComponent;

  // Menus contextuels
  showColumnContextMenu = false;
  showRowContextMenu = false;
  contextMenuPosition = { x: 0, y: 0 };
  contextMenuColumn: ColumnConfig | null = null;
  contextMenuProjet: Projet | null = null;
  contextMenuField: string | null = null;
  selectedCellValue: string | null = null;

  loading = false;

  constructor(
    private service: ProjectsService,
    private profile: ProfileService,
    private orgService: OrganizationService,
    private toast: ToastService,
    private fb: FormBuilder,
    private router: Router,
    private route: ActivatedRoute,
    private breadcrumb: BreadcrumbService,
    private sortConfigService: TableSortConfigService,
    private columnsConfigService: TableColumnsConfigService,
  ) {
    this.form = this.fb.group({
      nom_projet: ['', Validators.required],
      code_projet: ['', Validators.required],
      description_projet: [''],
      statut: ['brouillon', Validators.required],
      organization: ['', Validators.required],
    });
  }

  ngOnInit(): void {
    // Fil d'Ariane métier du topbar : Accueil › Projets.
    const base = this.router.url.startsWith('/admin') ? '/admin/projets' : '/projets';
    this.breadcrumb.set([
      { label: 'Accueil', route: '/home', icon: 'fa-house' },
      { label: 'Projets', route: base, icon: 'fa-folder-open', isActive: true },
    ]);

    this.viewMode = (localStorage.getItem(VIEW_MODE_KEY) as 'cards' | 'table') || 'table';
    this.loadPreferences();
    this.load();
    this.loadSortConfig();
    this.loadColumnsConfig();
    this.boundHandleClickOutside = this.handleGlobalClick.bind(this);
    document.addEventListener('click', this.boundHandleClickOutside);

    this.profile.getCurrentUser().subscribe({
      next: (me: any) => {
        this.currentOrgId = me.organization_id ?? null;
        this.currentOrgName = me.organization_name ?? null;
        if (!this.currentOrgId) {
          this.orgService.getOrganizations().subscribe(orgs => (this.organizations = orgs));
        }
      },
      error: () => {},
    });
  }

  ngOnDestroy(): void {
    this.breadcrumb.clear();
    this.destroy$.next();
    this.destroy$.complete();
    if (this.boundHandleClickOutside) {
      document.removeEventListener('click', this.boundHandleClickOutside);
    }
  }

  get isAdmin(): boolean { return !this.currentOrgId; }

  toggleViewMode(mode: 'cards' | 'table'): void {
    this.viewMode = mode;
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }

  // ============================================
  // Chargement des données
  // ============================================

  load(): void {
    this.loading = true;
    const active$ = this.service.getProjets({});
    const deleted$ = this.service.getProjets({ show_deleted: true });
    forkJoin([active$, deleted$]).pipe(takeUntil(this.destroy$)).subscribe({
      next: ([active, deleted]) => {
        this.activeProjets = active;
        this.deletedProjets = deleted;
        this.manualOrder = null;
        this.applyFiltersAndSort();
        this.loading = false;
      },
      error: () => { this.toast.error('Erreur', 'Chargement des projets impossible'); this.loading = false; },
    });
  }

  setTab(deleted: boolean): void {
    if (this.showDeleted === deleted) return;
    this.showDeleted = deleted;
    this.selectedIds.clear();
    this.searchText = '';
    this.manualOrder = null;
    this.applyFiltersAndSort();
  }

  loadPreferences(): void {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      const prefs = JSON.parse(raw);
      // Les colonnes (visibilité + ordre) sont désormais persistées par utilisateur côté serveur
      // (TableColumnsConfigService), plus en localStorage. Cf. loadColumnsConfig().
      if (prefs.sortColumn) this.sortColumn = prefs.sortColumn;
      if (prefs.sortDirection) this.sortDirection = prefs.sortDirection;
      if (prefs.pageSize) this.pageSize = prefs.pageSize;
      if (prefs.displayMode) this.displayMode = prefs.displayMode;
    } catch { /* ignore */ }
  }

  savePreferences(): void {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      sortColumn: this.sortColumn,
      sortDirection: this.sortDirection,
      pageSize: this.pageSize,
      displayMode: this.displayMode,
    }));
  }

  // ============================================
  // Filtrage, tri, pagination
  // ============================================

  // --- FILTRES DE COLONNE (façon Excel, composant partagé `<app-column-filter>`) ---
  /** Valeurs retenues par colonne ; une colonne absente n'est pas filtrée. */
  columnFilters: ColumnFilterMap = {};
  /** Texte affiché d'une cellule : le filtre porte sur la valeur VUE (référence stable). */
  cellText = (row: any, field: string): string => this.getCellValue(row, field);

  onColumnFilterChange(field: string, values: string[] | null): void {
    this.columnFilters = withColumnFilter(this.columnFilters, field, values);
    this.applyFiltersAndSort();
  }

  applyFiltersAndSort(): void {
    let result = [...this.projets];

    if (this.displayMode === 'selected') {
      result = result.filter(p => this.selectedIds.has(p.id));
    }
    if (this.searchText) {
      const q = this.searchText.toLowerCase();
      result = result.filter(p => p.nom_projet.toLowerCase().includes(q) || p.code_projet.toLowerCase().includes(q));
    }
    if (this.selectedStatut) {
      result = result.filter(p => p.statut === this.selectedStatut);
    }
    if (this.selectedOrganization) {
      result = result.filter(p => p.organization === this.selectedOrganization);
    }
    if (this.activeFieldFilter && this.fieldFilterValue) {
      const ff = this.activeFieldFilter;
      const fv = this.fieldFilterValue.toLowerCase();
      result = result.filter(p => {
        const val = (p as any)[ff];
        return val != null && String(val).toLowerCase().includes(fv);
      });
    }

    // Filtres de colonne (ET entre colonnes, OU entre valeurs d'une même colonne).
    if (activeFilterCount(this.columnFilters)) {
      result = result.filter(p => rowMatchesColumnFilters(p, this.columnFilters, this.cellText));
    }

    if (this.manualOrder) {
      const idx = new Map(this.manualOrder.map((id, i) => [id, i]));
      result.sort((a, b) => {
        const ia = idx.has(a.id) ? idx.get(a.id)! : Number.MAX_SAFE_INTEGER;
        const ib = idx.has(b.id) ? idx.get(b.id)! : Number.MAX_SAFE_INTEGER;
        return ia - ib;
      });
    } else if (this.sortLevels.length) {
      // Le tri MULTI-NIVEAUX prime sur le tri mono-colonne.
      result.sort((a, b) => compareByLevels(a, b, this.sortLevels));
    } else {
      result.sort((a, b) => {
        let valA: any, valB: any;
        switch (this.sortColumn) {
          case 'code_projet': valA = a.code_projet; valB = b.code_projet; break;
          case 'nom_projet': valA = a.nom_projet; valB = b.nom_projet; break;
          case 'statut': valA = a.statut_display || a.statut; valB = b.statut_display || b.statut; break;
          case 'organization_name': valA = a.organization_name || ''; valB = b.organization_name || ''; break;
          case 'nbr_total_proprietes': valA = a.nbr_total_proprietes ?? 0; valB = b.nbr_total_proprietes ?? 0; break;
          case 'nbr_total_affaires': valA = a.nbr_total_affaires ?? 0; valB = b.nbr_total_affaires ?? 0; break;
          case 'nbr_total_ssdgps': valA = a.nbr_total_ssdgps ?? 0; valB = b.nbr_total_ssdgps ?? 0; break;
          case 'nbr_total_sessions': valA = a.nbr_total_sessions ?? 0; valB = b.nbr_total_sessions ?? 0; break;
          case 'nbr_total_pieces': valA = a.nbr_total_pieces ?? 0; valB = b.nbr_total_pieces ?? 0; break;
          case 'updated_at': valA = a.updated_at; valB = b.updated_at; break;
          default: valA = a.created_at; valB = b.created_at; break;
        }
        if (valA < valB) return this.sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return this.sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    this.filteredProjets = result;
    this.currentPage = 1;
    this.updatePagination();
    this.savePreferences();
  }

  updatePagination(): void {
    const start = (this.currentPage - 1) * this.pageSize;
    this.paginatedProjets = this.filteredProjets.slice(start, start + this.pageSize);
    this.isAllSelected = this.paginatedProjets.length > 0 && this.paginatedProjets.every(p => this.selectedIds.has(p.id));
  }

  get totalPages(): number { return Math.max(1, Math.ceil(this.filteredProjets.length / this.pageSize)); }

  get pageNumbers(): number[] {
    const pages: number[] = [];
    const start = Math.max(1, this.currentPage - 2);
    const end = Math.min(this.totalPages, this.currentPage + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.updatePagination();
  }
  goToFirstPage(): void { this.goToPage(1); }
  goToLastPage(): void { this.goToPage(this.totalPages); }
  prevPage(): void { if (this.currentPage > 1) { this.currentPage--; this.updatePagination(); } }
  nextPage(): void { if (this.currentPage < this.totalPages) { this.currentPage++; this.updatePagination(); } }

  onSearchInput(event: Event): void {
    this.searchText = (event.target as HTMLInputElement).value;
    this.applyFiltersAndSort();
  }
  clearSearch(): void { this.searchText = ''; this.applyFiltersAndSort(); }

  onStatutFilterChange(event: Event): void {
    this.selectedStatut = (event.target as HTMLSelectElement).value;
    this.applyFiltersAndSort();
  }

  onOrganizationFilterChange(event: Event): void {
    this.selectedOrganization = (event.target as HTMLSelectElement).value;
    this.applyFiltersAndSort();
  }

  setPageSize(size: number): void {
    this.pageSize = size;
    this.currentPage = 1;
    this.updatePagination();
    this.savePreferences();
  }

  sortBy(column: string): void {
    this.manualOrder = null;
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
    this.applyFiltersAndSort();
  }

  getSortIcon(column: string): string {
    if (this.sortColumn !== column) return 'fas fa-sort';
    return this.sortDirection === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
  }

  // ============================================
  // Tri MULTI-NIVEAUX (config opérateur, héritée du super admin) — parité liste organisations
  // ============================================
  sortLevelOf(field: string): number { return sortLevelOf(this.sortLevels, field); }
  sortDirOf(field: string): '' | 'asc' | 'desc' { return sortDirOf(this.sortLevels, field); }

  private loadSortConfig(): void {
    this.sortConfigService.get(this.SORT_KEY).subscribe(levels => {
      this.sortLevels = levels;
      this.applyFiltersAndSort();
    });
  }

  /** Réception d'une modification depuis la modale : applique + enregistrement auto (anti-rebond). */
  onSortLevelsChange(levels: OrgSortLevel[]): void {
    this.sortLevels = levels;
    this.manualOrder = null;
    this.currentPage = 1;
    this.applyFiltersAndSort();
    clearTimeout(this.sortSaveTimer);
    this.sortSaveTimer = setTimeout(() => this.saveSortConfig(), 500);
  }
  private saveSortConfig(): void {
    this.savingSort = true;
    this.sortConfigService.save(this.SORT_KEY, this.sortLevels).subscribe({
      next: (saved) => {
        this.sortLevels = saved; this.savingSort = false; this.savedSortFlash = true;
        this.applyFiltersAndSort();
        setTimeout(() => { this.savedSortFlash = false; }, 2500);
      },
      error: (err) => { this.savingSort = false; this.toast.error('Erreur', err?.error?.detail || 'Enregistrement du tri impossible'); },
    });
  }

  /** Réinitialise le tri avec la configuration SOURCE (compte administrateur). */
  onResetSort(): void {
    if (this.resettingSort) return;
    this.resettingSort = true;
    this.sortConfigService.resetToSource(this.SORT_KEY).subscribe({
      next: (levels) => {
        this.sortLevels = levels; this.resettingSort = false;
        this.manualOrder = null; this.currentPage = 1; this.applyFiltersAndSort();
        this.toast.success('Succès', 'Tri réinitialisé avec la configuration source');
      },
      error: (e) => {
        this.resettingSort = false;
        this.toast.error('Erreur', e?.error?.detail || 'Réinitialisation impossible');
      },
    });
  }

  /** Format unifié de l'app : `jj/mm/aaaa hh:mm:ss` (cf. `date-format.util`). */
  formatDate(value: any): string {
    return formatDateTime(value);
  }

  // ============================================
  // Sélection
  // ============================================

  toggleSelection(id: string): void {
    this.selectedIds.has(id) ? this.selectedIds.delete(id) : this.selectedIds.add(id);
    this.isAllSelected = this.paginatedProjets.length > 0 && this.paginatedProjets.every(p => this.selectedIds.has(p.id));
  }

  selectAll(): void { this.filteredProjets.forEach(p => this.selectedIds.add(p.id)); this.isAllSelected = true; }
  deselectAll(): void { this.selectedIds.clear(); this.isAllSelected = false; }
  toggleSelectAll(): void { this.isAllSelected ? this.deselectAll() : this.selectAll(); }

  invertSelection(): void {
    this.paginatedProjets.forEach(p => {
      this.selectedIds.has(p.id) ? this.selectedIds.delete(p.id) : this.selectedIds.add(p.id);
    });
    this.isAllSelected = this.paginatedProjets.length > 0 && this.paginatedProjets.every(p => this.selectedIds.has(p.id));
  }

  isSelected(p: Projet): boolean { return this.selectedIds.has(p.id); }

  moveSelectionToTop(): void {
    if (this.selectedIds.size === 0) return;
    const selected = this.filteredProjets.filter(p => this.selectedIds.has(p.id)).map(p => p.id);
    const rest = this.filteredProjets.filter(p => !this.selectedIds.has(p.id)).map(p => p.id);
    this.manualOrder = [...selected, ...rest];
    this.applyFiltersAndSort();
  }

  getSelectedProjetsList(): Projet[] { return this.projets.filter(p => this.selectedIds.has(p.id)); }

  // ============================================
  // Mode d'affichage / filtre par champ
  // ============================================

  setDisplayMode(mode: 'all' | 'selected'): void { this.displayMode = mode; this.applyFiltersAndSort(); }

  toggleFilterMenu(): void {
    this.showFilterMenu = !this.showFilterMenu;
    if (this.showFilterMenu) this.showExportMenu = false;
  }

  selectFieldForFilter(field: string, label: string): void {
    this.activeFieldFilter = field;
    this.activeFieldFilterLabel = label;
    this.fieldFilterValue = '';
    this.showFieldFilterMenu = false;
    this.showFilterMenu = false;
    this.applyFiltersAndSort();
  }

  onFieldFilterInput(event: Event): void {
    this.fieldFilterValue = (event.target as HTMLInputElement).value;
    this.applyFiltersAndSort();
  }

  clearFieldFilter(): void {
    this.activeFieldFilter = null;
    this.activeFieldFilterLabel = '';
    this.fieldFilterValue = '';
    this.applyFiltersAndSort();
  }

  // ============================================
  // Colonnes
  // ============================================

  getVisibleColumns(): ColumnConfig[] { return this.columns.filter(c => c.visible); }

  /** Ouvre la modale d'organisation des colonnes (composant partagé). */
  openColumnConfig(): void { this.columnCfg?.open(); }

  /** Masque une colonne (depuis le menu de filtre) — auto-save comme la modale des colonnes. */
  hideColumnField(field: string): void {
    this.onColumnsChange(this.columns.map(c => (c.field === field ? { ...c, visible: false } : { ...c })));
  }

  private loadColumnsConfig(): void {
    this.columnsConfigService.get(this.COLUMNS_KEY).subscribe(prefs => {
      this.columns = applyColumnsConfig(this.columns, prefs);
    });
  }
  /** Réception d'une modif de colonnes (visibilité/ordre) : applique + enregistrement auto (anti-rebond). */
  onColumnsChange(cols: ManagedColumn[]): void {
    this.columns = cols as ColumnConfig[];
    clearTimeout(this.columnsSaveTimer);
    this.columnsSaveTimer = setTimeout(() => this.saveColumnsConfig(), 500);
  }
  private saveColumnsConfig(): void {
    this.savingColumns = true;
    this.columnsConfigService.save(this.COLUMNS_KEY, toColumnPrefs(this.columns)).subscribe({
      next: () => {
        this.savingColumns = false; this.savedColumnsFlash = true;
        setTimeout(() => { this.savedColumnsFlash = false; }, 2500);
      },
      error: (err) => { this.savingColumns = false; this.toast.error('Erreur', err?.error?.detail || 'Enregistrement des colonnes impossible'); },
    });
  }
  /** Réinitialise les colonnes avec la configuration SOURCE (compte administrateur). */
  onResetColumns(): void {
    if (this.resettingColumns) return;
    this.resettingColumns = true;
    this.columnsConfigService.resetToSource(this.COLUMNS_KEY).subscribe({
      next: (prefs) => {
        this.columns = applyColumnsConfig(this.columns, prefs);
        this.resettingColumns = false;
        this.toast.success('Succès', 'Colonnes réinitialisées avec la configuration source');
      },
      error: (e) => { this.resettingColumns = false; this.toast.error('Erreur', e?.error?.detail || 'Réinitialisation impossible'); },
    });
  }

  onColumnHeaderRightClick(event: MouseEvent, col: ColumnConfig): void {
    event.preventDefault(); event.stopPropagation();
    this.contextMenuPosition = { x: event.clientX, y: event.clientY };
    this.contextMenuColumn = col;
    this.showColumnContextMenu = true;
  }
  hideColumnFromContext(): void {
    const field = this.contextMenuColumn?.field;
    this.showColumnContextMenu = false; this.contextMenuColumn = null;
    if (!field) return;
    // Masque la colonne + enregistre (auto-save), comme depuis la modale.
    this.onColumnsChange(this.columns.map(c => (c.field === field ? { ...c, visible: false } : { ...c })));
  }
  openColumnConfigFromContext(): void { this.showColumnContextMenu = false; this.openColumnConfig(); }
  /** Ouvrir la modale de tri multi-niveaux depuis le menu contextuel (clic droit en-tête). */
  openSortFromContext(): void { this.showColumnContextMenu = false; this.sortCmp?.open(); }

  getTypeLabel(type?: string): string {
    return { text: 'TEXTE', date: 'DATE', number: 'NOMBRE', status: 'STATUT', boolean: 'BOOLÉEN', actions: 'ACTIONS' }[type || 'text'] || 'TEXTE';
  }
  getFieldDescription(field: string): string {
    const d: Record<string, string> = {
      code_projet: 'Identifiant court et unique du projet',
      nom_projet: 'Nom complet du projet',
      statut: 'État d\'avancement du projet',
      organization_name: 'Organisation à laquelle appartient le projet',
      nbr_total_proprietes: 'Nombre total de propriétés rattachées au projet',
      nbr_total_affaires: 'Nombre total d\'affaires (SD) rattachées au projet',
      nbr_total_ssdgps: 'Nombre total de SSDGPS rattachés au projet',
      nbr_total_sessions: 'Nombre total de sessions rattachées au projet',
      nbr_total_pieces: 'Nombre total de pièces rattachées au projet',
      created_at: 'Date de création du projet',
      updated_at: 'Date de dernière modification',
      is_deleted: 'Indique si le projet a été supprimé (logique)',
      deleted_at: 'Date de suppression du projet',
      created_by_email: 'Utilisateur ayant créé le projet',
      updated_by_email: 'Utilisateur ayant modifié le projet en dernier',
      deleted_by_email: 'Utilisateur ayant supprimé le projet',
    };
    return d[field] || '';
  }

  // ============================================
  // Export
  // ============================================

  toggleExportMenu(): void { this.showExportMenu = !this.showExportMenu; if (this.showExportMenu) this.showFilterMenu = false; }

  private csvEscape(v: any): string {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  exportCSV(onlySelected: boolean): void {
    const items = onlySelected ? this.getSelectedProjetsList() : this.filteredProjets;
    const cols = this.columns.filter(c => c.visible);
    const header = cols.map(c => c.label).join(';');
    const rows = items.map(p => cols.map(c => this.csvEscape((p as any)[c.field])).join(';'));
    const csv = '﻿' + [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `projets_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast.success('Export', `${items.length} projet(s) exporté(s)`);
  }

  // ============================================
  // Navigation
  // ============================================

  open(projet: Projet): void { this.router.navigate([projet.id], { relativeTo: this.route }); }

  /** Accès direct à la liste à plat de tous les SSDGPS du projet (sans parcourir la hiérarchie). */
  openAllSsdgps(projet: Projet, ev?: Event): void {
    ev?.stopPropagation();
    this.router.navigate([projet.id, 'ssdgps'], { relativeTo: this.route });
  }

  // ============================================
  // CRUD — Créer / Modifier
  // ============================================

  openCreate(): void {
    this.editing = null;
    this.form.reset({ statut: 'brouillon', organization: this.currentOrgId || '' });
    this.showModal = true;
  }
  openEdit(projet: Projet, ev: Event): void {
    ev.stopPropagation();
    this.editing = projet;
    this.form.reset({
      nom_projet: projet.nom_projet, code_projet: projet.code_projet,
      description_projet: projet.description_projet || '', statut: projet.statut,
      organization: projet.organization,
    });
    this.showModal = true;
  }
  closeModal(): void { this.showModal = false; this.editing = null; }
  get isOrgLocked(): boolean { return !!this.currentOrgId; }

  submit(): void {
    if (this.form.invalid || this.submitting) { this.form.markAllAsTouched(); return; }
    this.submitting = true;
    const payload = { ...this.form.value };
    const done = () => { this.submitting = false; this.closeModal(); this.load(); };
    const fail = (e: any) => {
      this.submitting = false;
      let msg = 'Erreur lors de l\'enregistrement';
      if (e?.error?.code_projet) msg = `Code projet : ${e.error.code_projet}`;
      else if (e?.error?.detail) msg = e.error.detail;
      this.toast.error('Échec', msg);
    };
    if (this.editing) {
      this.service.updateProjet(this.editing.id, payload).subscribe({ next: () => { this.toast.success('Succès', 'Projet modifié'); done(); }, error: fail });
    } else {
      this.service.createProjet(payload).subscribe({ next: () => { this.toast.success('Succès', 'Projet créé'); done(); }, error: fail });
    }
  }

  // ============================================
  // Suppression (avec confirmation)
  // ============================================

  openDeleteModal(projet: Projet, ev: Event): void { ev.stopPropagation(); this.deleteTarget = projet; this.isBulkDelete = false; this.showDeleteModal = true; }
  openBulkDeleteModal(): void { if (this.selectedIds.size === 0) return; this.deleteTarget = null; this.isBulkDelete = true; this.showDeleteModal = true; }
  closeDeleteModal(): void { if (this.deleting) return; this.showDeleteModal = false; this.deleteTarget = null; }

  confirmDelete(): void {
    this.deleting = true;
    const finish = (n: number) => {
      this.deleting = false; this.showDeleteModal = false; this.deleteTarget = null;
      this.selectedIds.clear(); this.load();
      this.toast.success('Succès', `${n} projet(s) supprimé(s)`);
    };
    const fail = () => { this.deleting = false; this.toast.error('Erreur', 'Suppression impossible'); };
    if (this.isBulkDelete) {
      const ids = Array.from(this.selectedIds);
      forkJoin(ids.map(id => this.service.deleteProjet(id))).subscribe({ next: () => finish(ids.length), error: fail });
    } else if (this.deleteTarget) {
      this.service.deleteProjet(this.deleteTarget.id).subscribe({ next: () => finish(1), error: fail });
    }
  }

  // ============================================
  // Restauration
  // ============================================

  openRestoreModal(projet: Projet): void { this.restoreTarget = projet; this.isBulkRestore = false; this.showRestoreModal = true; }
  openBulkRestoreModal(): void { this.restoreTarget = null; this.isBulkRestore = true; this.showRestoreModal = true; }
  closeRestoreModal(): void { if (this.restoring) return; this.showRestoreModal = false; this.restoreTarget = null; }

  confirmRestore(): void {
    if (this.isBulkRestore) {
      if (this.restoring || this.selectedIds.size === 0) return;
      this.restoring = true;
      const ids = Array.from(this.selectedIds);
      this.service.bulkRestoreProjets(ids).subscribe({
        next: (res) => { this.restoring = false; this.toast.success('Succès', `${res.restored_count} projet(s) restauré(s)`); this.closeRestoreModal(); this.selectedIds.clear(); this.load(); },
        error: () => { this.restoring = false; this.toast.error('Erreur', 'Restauration impossible'); },
      });
    } else if (this.restoreTarget) {
      if (this.restoring) return;
      this.restoring = true;
      this.service.restoreProjet(this.restoreTarget.id).subscribe({
        next: () => { this.restoring = false; this.toast.success('Succès', `Projet "${this.restoreTarget!.nom_projet}" restauré`); this.closeRestoreModal(); this.load(); },
        error: () => { this.restoring = false; this.toast.error('Erreur', 'Restauration impossible'); },
      });
    }
  }

  // ============================================
  // Suppression définitive (irréversible)
  // ============================================

  openPermanentDeleteModal(projet: Projet): void { this.permanentDeleteTarget = projet; this.isBulkPermanent = false; this.showPermanentDeleteModal = true; }
  openBulkPermanentDeleteModal(): void { if (this.selectedIds.size === 0) return; this.permanentDeleteTarget = null; this.isBulkPermanent = true; this.showPermanentDeleteModal = true; }
  closePermanentDeleteModal(): void { if (this.permanentDeleting) return; this.showPermanentDeleteModal = false; this.permanentDeleteTarget = null; }

  confirmPermanentDelete(): void {
    if (this.permanentDeleting) return;
    const close = () => { this.permanentDeleting = false; this.showPermanentDeleteModal = false; this.permanentDeleteTarget = null; };
    if (this.isBulkPermanent) {
      if (this.selectedIds.size === 0) return;
      this.permanentDeleting = true;
      const total = this.selectedIds.size;
      const ids = Array.from(this.selectedIds);
      this.service.bulkPermanentDeleteProjets(ids).subscribe({
        next: (res) => {
          close(); this.selectedIds.clear(); this.load();
          const d = res.deleted_count || 0, f = (res.errors || []).length;
          if (d > 0 && f === 0) this.toast.success('Suppression définitive', `${d} projet(s) supprimé(s) définitivement`);
          else if (d > 0 && f > 0) this.toast.warning('Suppression partielle', `${d} supprimé(s) ; ${f} conservé(s) (sous-données rattachées).`);
          else this.toast.error('Aucune suppression', `${total} projet(s) non supprimé(s) : des sous-données y sont rattachées.`);
        },
        error: () => { this.permanentDeleting = false; this.toast.error('Erreur', 'Suppression définitive impossible'); },
      });
    } else if (this.permanentDeleteTarget) {
      this.permanentDeleting = true;
      this.service.permanentDeleteProjet(this.permanentDeleteTarget.id).subscribe({
        next: () => { close(); this.load(); this.toast.success('Suppression définitive', 'Projet supprimé définitivement'); },
        error: (e) => { this.permanentDeleting = false; this.toast.error('Suppression impossible', e?.error?.detail || 'Suppression définitive impossible'); },
      });
    }
  }

  // ============================================
  // Menu contextuel des lignes / cellules
  // ============================================

  onCellRightClick(event: MouseEvent, projet: Projet, field: string): void {
    event.preventDefault(); event.stopPropagation();
    this.contextMenuPosition = { x: event.clientX, y: event.clientY };
    this.contextMenuProjet = projet;
    this.contextMenuField = field;
    this.selectedCellValue = field ? String((projet as any)[field] ?? '') : null;
    this.showRowContextMenu = true;
  }
  onRowRightClick(event: MouseEvent, projet: Projet): void {
    event.preventDefault(); event.stopPropagation();
    this.contextMenuPosition = { x: event.clientX, y: event.clientY };
    this.contextMenuProjet = projet;
    this.contextMenuField = null;
    this.showRowContextMenu = true;
  }

  toggleRowSelectionFromContext(): void { if (this.contextMenuProjet) this.toggleSelection(this.contextMenuProjet.id); this.closeAllContextMenus(); }
  selectAllFromContext(): void { this.selectAll(); this.closeAllContextMenus(); }
  copyCellValueFromContext(): void {
    if (this.selectedCellValue != null) {
      navigator.clipboard.writeText(this.selectedCellValue).then(() => this.toast.success('Copié', 'Valeur copiée dans le presse-papier'));
    }
    this.closeAllContextMenus();
  }
  openFromContext(): void { if (this.contextMenuProjet) this.open(this.contextMenuProjet); this.closeAllContextMenus(); }
  openEditFromContext(): void {
    if (this.contextMenuProjet) { this.editing = this.contextMenuProjet; this.form.reset({ nom_projet: this.contextMenuProjet.nom_projet, code_projet: this.contextMenuProjet.code_projet, description_projet: this.contextMenuProjet.description_projet || '', statut: this.contextMenuProjet.statut, organization: this.contextMenuProjet.organization }); this.showModal = true; }
    this.closeAllContextMenus();
  }
  openDeleteFromContext(): void { if (this.contextMenuProjet) { this.deleteTarget = this.contextMenuProjet; this.isBulkDelete = false; this.showDeleteModal = true; } this.closeAllContextMenus(); }
  openRestoreFromContext(): void { if (this.contextMenuProjet) this.openRestoreModal(this.contextMenuProjet); this.closeAllContextMenus(); }

  closeAllContextMenus(): void {
    this.showColumnContextMenu = false; this.showRowContextMenu = false;
    this.contextMenuColumn = null; this.contextMenuProjet = null; this.contextMenuField = null;
  }

  private handleGlobalClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.filter-menu-wrapper') && !target.closest('.context-menu') && !target.closest('.dropdown-container')) {
      this.showExportMenu = false;
      this.showFilterMenu = false;
      this.showFieldFilterMenu = false;
      this.closeAllContextMenus();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.showModal) { this.closeModal(); return; }
    if (this.showDeleteModal) { this.closeDeleteModal(); return; }
    if (this.showRestoreModal) { this.closeRestoreModal(); return; }
  }

  // ============================================
  // Libellés
  // ============================================

  statutLabel(v: string): string { return this.statutOptions.find(o => o.value === v)?.label || v; }
  statutBadgeClass(v: string): string {
    return { brouillon: 'badge-secondary', en_cours: 'badge-primary', cloture: 'badge-success', archive: 'badge-warning' }[v] || 'badge-secondary';
  }
  getCellValue(p: Projet, field: string): string {
    switch (field) {
      case 'is_deleted': return p.is_deleted ? 'Oui' : 'Non';
      case 'created_at': case 'updated_at': case 'deleted_at': return this.formatDate((p as any)[field]);
      default: return String((p as any)[field] ?? '—');
    }
  }
}
