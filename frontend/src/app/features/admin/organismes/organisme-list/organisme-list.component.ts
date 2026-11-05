import { formatDateTime } from '../../../../shared/utils/date-format.util';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../../../../shared/components/table-pagination/table-pagination.component';
import { Component, OnInit, HostListener, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Observable, forkJoin } from 'rxjs';
import { OrganismeService } from '../../../../core/services/organisme.service';
import { ToastService } from '../../../../core/services/toast.service';
import { OrganismeSortConfigService, OrgSortLevel } from '../../../../core/services/organisme-sort-config.service';
import { OrganismeNiveau1 } from '../../../../core/models/organisme.model';
import { MultiLevelSortComponent } from '../../../../shared/components/multi-level-sort/multi-level-sort.component';
import { ColumnConfigComponent } from '../../../../shared/components/column-config/column-config.component';
import { applyColumnsConfig, toColumnPrefs, ManagedColumn } from '../../../../shared/components/column-config/column-config.util';
import { ColumnFilterMap, withColumnFilter, rowMatchesColumnFilters, activeFilterCount } from '../../../../shared/components/column-filter/column-filter.util';
import { TableColumnsConfigService } from '../../../../core/services/table-columns-config.service';
import { auditColumns, AUDIT_COLUMN_DESCRIPTIONS, AUDIT_COLUMN_LABELS, AUDIT_COLUMN_ORDER } from '../../../../shared/components/column-config/audit-columns';

interface ColumnConfig {
  field: string;
  label: string;
  visible: boolean;
  type: 'text' | 'number' | 'boolean' | 'date';
}

/** Colonnes triables (allowlist alignée sur le backend ORGANISME_N1_SORT_FIELDS), avec libellé. */
const N1_SORTABLE_FIELDS: { field: string; label: string }[] = [
  { field: 'code', label: 'Code' },
  { field: 'nom', label: 'Nom' },
  { field: 'sigle', label: 'Sigle' },
  { field: 'nbr_niveaux2', label: 'Nb. 2e niveau' },
  { field: 'is_active', label: 'Statut' },
  // Colonnes d'audit standard : libellés unifiés (cf. CLAUDE.md).
  ...AUDIT_COLUMN_ORDER.map(field => ({ field, label: AUDIT_COLUMN_LABELS[field] })),
];

/** Colonnes triables (allowlist alignée sur le backend ORGANISME_N2_SORT_FIELDS), avec libellé. */
const N2_SORTABLE_FIELDS: { field: string; label: string }[] = [
  { field: 'code', label: 'Code' },
  { field: 'nom', label: 'Nom' },
  { field: 'niveau1_nom', label: 'Premier niveau' },
  { field: 'niveau1_sigle', label: 'Sigle premier niveau' },
  { field: 'ville', label: 'Ville / province' },
  { field: 'sigle', label: 'Sigle' },
  { field: 'is_active', label: 'Statut' },
  // Colonnes d'audit standard : libellés unifiés (cf. CLAUDE.md).
  ...AUDIT_COLUMN_ORDER.map(field => ({ field, label: AUDIT_COLUMN_LABELS[field] })),
];

/**
 * Gestion (CRUD) des organismes — composant unique piloté par `route.data.niveau` (1 ou 2).
 * Aligné sur la page « gestion des projets » : onglets Actifs / Corbeille, tableau avec tous
 * les outils (sélection, export, organisation des colonnes, filtres footer gauche, pagination
 * footer droite, menus contextuels) et modales au design du design system. UI réservée à
 * SUPER_ADMIN / ADMIN_SYSTEME.
 */
@Component({
  selector: 'app-organisme-list',
  templateUrl: './organisme-list.component.html',
  styleUrls: ['./organisme-list.component.scss'],
})
export class OrganismeListComponent implements OnInit {
  readonly Math = Math;

  niveau: 1 | 2 = 1;
  title = 'Organismes';

  // Onglets Actifs / Corbeille : les deux listes sont chargées en une fois.
  activeRows: any[] = [];
  deletedRows: any[] = [];
  showDeleted = false;
  get rows(): any[] { return this.showDeleted ? this.deletedRows : this.activeRows; }
  get activeCount(): number { return this.activeRows.length; }
  get deletedCount(): number { return this.deletedRows.length; }

  filtered: any[] = [];
  selectedIds = new Set<string>();
  niveau1Options: OrganismeNiveau1[] = [];

  columns: ColumnConfig[] = [];
  // --- Configuration des COLONNES (config opérateur, héritée du super admin) — composant partagé ---
  @ViewChild(ColumnConfigComponent) private columnCfg?: ColumnConfigComponent;
  /** Description d'une colonne pour la modale partagée (référence stable). */
  describeColumn = (field: string): string => this.getFieldDescription(field);
  savingColumns = false;
  savedColumnsFlash = false;
  resettingColumns = false;
  private columnsSaveTimer: any;
  /** Clé backend de la config de colonnes selon le niveau (1 ou 2). */
  private get columnsKey(): string { return this.isN2 ? 'organisme_niveau2' : 'organisme_niveau1'; }

  // Tri mono-colonne (clic en-tête) — conservé comme repli quand aucun tri multi-niveaux.
  sortColumn: string | null = 'nom';
  sortDirection: 'asc' | 'desc' = 'asc';

  // --- Tri MULTI-NIVEAUX (config opérateur, héritée du super admin) — miroir des organisations ---
  /** Niveaux de tri appliqués au tableau (niveau 0 = prioritaire). */
  sortLevels: OrgSortLevel[] = [];
  @ViewChild(MultiLevelSortComponent) private sortCmp?: MultiLevelSortComponent;
  savingSort = false;
  savedSortFlash = false;
  resettingSort = false;
  private sortSaveTimer: any;

  // Recherche + filtres
  searchQuery = '';
  statusFilter: 'all' | 'active' | 'inactive' = 'all';
  displayMode: 'all' | 'selected' = 'all';

  // Filtre par champ (footer gauche)
  activeFieldFilter: string | null = null;
  activeFieldFilterLabel = '';
  fieldFilterValue = '';

  // Pagination
  currentPage = 1;
  pageSize = DEFAULT_PAGE_SIZE;
  pageSizeOptions = [...PAGE_SIZE_OPTIONS];

  // Menus
  showExportMenu = false;
  showFilterMenu = false;
  showFieldFilterMenu = false;

  // Menus contextuels
  showColumnContextMenu = false;
  showRowContextMenu = false;
  contextMenuPosition = { x: 0, y: 0 };
  columnForContext: ColumnConfig | null = null;
  rowForContext: any = null;
  cellForContext: { row: any; field: string; value: any } | null = null;

  // État UI
  loading = false;
  submitting = false;
  deleting = false;
  bulkBusy = false;

  // Modales
  showFormModal = false;
  editing: any = null;
  form!: FormGroup;
  showDeleteModal = false;
  toDelete: any = null;
  isBulkDelete = false;
  // Suppression DÉFINITIVE (corbeille uniquement) — composant partagé de confirmation.
  showPermanentDeleteModal = false;
  permanentDeleteTarget: any = null;
  isBulkPermanent = false;
  permanentDeleting = false;

  showRestoreModal = false;
  toRestore: any = null;
  isBulkRestore = false;

  private readonly descriptions: { [k: string]: string } = {
    code: "Identifiant court unique de l'organisme.",
    nom: "Nom officiel de l'organisme.",
    sigle: 'Abréviation / sigle.',
    ville: 'Ville ou province de rattachement (deuxième niveau).',
    niveau1_nom: 'Organisme de premier niveau dont dépend cette entité.',
    niveau1_sigle: "Sigle / abréviation de l'organisme de premier niveau de rattachement.",
    nbr_niveaux2: "Nombre d'organismes de deuxième niveau rattachés.",
    is_active: 'Organisme actif ou désactivé.',
    // Colonnes d'audit standard : descriptions unifiées (cf. CLAUDE.md).
    ...AUDIT_COLUMN_DESCRIPTIONS,
  };

  constructor(
    private fb: FormBuilder,
    private service: OrganismeService,
    private toast: ToastService,
    private route: ActivatedRoute,
    private sortConfigService: OrganismeSortConfigService,
    private columnsConfigService: TableColumnsConfigService,
  ) {}

  ngOnInit(): void {
    this.route.data.subscribe(d => {
      this.niveau = d['niveau'] === 2 ? 2 : 1;
      this.title = d['title'] || (this.niveau === 1 ? 'Organismes — premier niveau'
                                                    : 'Organismes — deuxième niveau');
      this.sortColumn = 'nom';
      this.sortLevels = [];
      this.showDeleted = false;
      this.selectedIds.clear();
      this.initColumns();
      this.loadColumnsConfig();
      this.buildForm();
      this.loadNiveau1Options();
      this.load();
      this.loadSortConfig();
    });
  }

  // ------------------------------------------------------------------ rôles
  get isN2(): boolean { return this.niveau === 2; }

  get currentUserRole(): string {
    try {
      const token = localStorage.getItem('authToken');
      if (!token) return 'ROLE_ORGANISATION_AGENT';
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.platform_role || payload.role || 'ROLE_ORGANISATION_AGENT';
    } catch { return 'ROLE_ORGANISATION_AGENT'; }
  }

  get canManage(): boolean {
    return this.currentUserRole === 'ROLE_SUPER_ADMIN'
        || this.currentUserRole === 'ROLE_ADMIN_SYSTEME';
  }

  // ------------------------------------------------------------------ colonnes
  private initColumns(): void {
    // Colonnes d'audit standard (libellés unifiés, cf. CLAUDE.md). `created_at` reste visible
    // par défaut pour ce tableau, contrairement au défaut du catalogue partagé.
    const audit: ColumnConfig[] = (auditColumns() as unknown as ColumnConfig[])
      .map(c => (c.field === 'created_at' ? { ...c, visible: true } : { ...c }));
    const defaults: ColumnConfig[] = this.isN2 ? [
      { field: 'code', label: 'Code', visible: true, type: 'text' },
      { field: 'nom', label: 'Nom', visible: true, type: 'text' },
      { field: 'niveau1_nom', label: 'Premier niveau', visible: true, type: 'text' },
      { field: 'niveau1_sigle', label: 'Sigle premier niveau', visible: true, type: 'text' },
      { field: 'ville', label: 'Ville / province', visible: true, type: 'text' },
      { field: 'sigle', label: 'Sigle', visible: false, type: 'text' },
      { field: 'is_active', label: 'Statut', visible: true, type: 'boolean' },
      ...audit,
    ] : [
      { field: 'code', label: 'Code', visible: true, type: 'text' },
      { field: 'nom', label: 'Nom', visible: true, type: 'text' },
      { field: 'sigle', label: 'Sigle', visible: true, type: 'text' },
      { field: 'nbr_niveaux2', label: 'Nb. 2e niveau', visible: true, type: 'number' },
      { field: 'is_active', label: 'Statut', visible: true, type: 'boolean' },
      ...audit,
    ];
    // Catalogue par défaut ; la config opérateur (visibilité + ordre) est appliquée par
    // loadColumnsConfig() (backend, source super admin).
    this.columns = defaults;
  }

  private loadColumnsConfig(): void {
    this.columnsConfigService.get(this.columnsKey).subscribe(prefs => {
      this.columns = applyColumnsConfig(this.columns, prefs);
    });
  }

  getVisibleColumns(): ColumnConfig[] { return this.columns.filter(c => c.visible); }
  getFieldDescription(field: string): string { return this.descriptions[field] || ''; }
  getTypeLabel(type: string): string {
    return { text: 'Texte', number: 'Nombre', boolean: 'Booléen', date: 'Date' }[type] || 'Texte';
  }

  // ------------------------------------------------------------------ chargement
  private buildForm(item?: any): void {
    const base: any = {
      code: [item?.code || '', Validators.required],
      nom: [item?.nom || '', Validators.required],
      sigle: [item?.sigle || ''],
      is_active: [item?.is_active ?? true],
    };
    if (this.isN2) {
      base.niveau1 = [item?.niveau1 || '', Validators.required];
      base.ville = [item?.ville || ''];
    }
    this.form = this.fb.group(base);
  }

  private loadNiveau1Options(): void {
    this.service.getNiveau1().subscribe({
      next: opts => (this.niveau1Options = opts),
      error: () => (this.niveau1Options = []),
    });
  }

  load(): void {
    this.loading = true;
    const active$ = this.isN2 ? this.service.getNiveau2({ show_deleted: false }) : this.service.getNiveau1({ show_deleted: false });
    const deleted$ = this.isN2 ? this.service.getNiveau2({ show_deleted: true }) : this.service.getNiveau1({ show_deleted: true });
    forkJoin([active$, deleted$]).subscribe({
      next: ([active, deleted]) => {
        this.activeRows = active; this.deletedRows = deleted;
        this.selectedIds.clear(); this.applyFilters(); this.loading = false;
      },
      error: () => { this.toast.error('Erreur', 'Chargement des organismes impossible.'); this.activeRows = []; this.deletedRows = []; this.applyFilters(); this.loading = false; },
    });
  }

  setTab(deleted: boolean): void {
    if (this.showDeleted === deleted) return;
    this.showDeleted = deleted;
    this.selectedIds.clear();
    this.searchQuery = '';
    this.statusFilter = 'all';
    this.displayMode = 'all';
    this.activeFieldFilter = null;
    this.currentPage = 1;
    this.applyFilters();
  }

  // ------------------------------------------------------------------ filtres/tri
  // --- FILTRES DE COLONNE (façon Excel, composant partagé `<app-column-filter>`) ---
  /** Valeurs retenues par colonne ; une colonne absente n'est pas filtrée. */
  columnFilters: ColumnFilterMap = {};

  /** Texte affiché d'une cellule — doit refléter le rendu du tableau (référence stable). */
  cellText = (row: any, field: string): string => {
    const col = this.columns.find(c => c.field === field);
    if (field === 'is_active') return this.getStatusText(row.is_active);
    if (col?.type === 'date') return this.formatDate(row[field]);
    const v = row[field];
    return v != null && v !== '' ? String(v) : '-';
  };

  onColumnFilterChange(field: string, values: string[] | null): void {
    this.columnFilters = withColumnFilter(this.columnFilters, field, values);
    this.applyFilters();
  }

  /** Masque une colonne (depuis le menu de filtre) — auto-save comme la modale des colonnes. */
  hideColumnField(field: string): void {
    this.onColumnsChange(this.columns.map(c => (c.field === field ? { ...c, visible: false } : { ...c })));
  }

  applyFilters(): void {
    let data = [...this.rows];

    // Filtres de colonne (ET entre colonnes, OU entre valeurs d'une même colonne).
    if (activeFilterCount(this.columnFilters)) {
      data = data.filter(r => rowMatchesColumnFilters(r, this.columnFilters, this.cellText));
    }

    if (this.displayMode === 'selected') data = data.filter(r => this.selectedIds.has(r.id));

    const q = this.searchQuery.trim().toLowerCase();
    if (q) {
      data = data.filter(r => [r.code, r.nom, r.sigle, r.ville, r.niveau1_nom]
        .filter(v => v != null).some(v => String(v).toLowerCase().includes(q)));
    }

    if (!this.showDeleted) {
      if (this.statusFilter === 'active') data = data.filter(r => r.is_active);
      else if (this.statusFilter === 'inactive') data = data.filter(r => !r.is_active);
    }

    if (this.activeFieldFilter && this.fieldFilterValue.trim()) {
      const fv = this.fieldFilterValue.trim().toLowerCase();
      const f = this.activeFieldFilter;
      data = data.filter(r => String(r[f] ?? '').toLowerCase().includes(fv));
    }

    // Tri : le tri MULTI-NIVEAUX prime ; à défaut, repli sur le tri mono-colonne (clic en-tête).
    if (this.sortLevels.length) {
      data.sort((a, b) => this.compareByLevels(a, b));
    } else if (this.sortColumn) {
      const col = this.sortColumn, dir = this.sortDirection === 'asc' ? 1 : -1;
      data.sort((a, b) => {
        const av = a[col] ?? '', bv = b[col] ?? '';
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av).localeCompare(String(bv), 'fr', { numeric: true }) * dir;
      });
    }

    this.filtered = data;
    if (this.currentPage > this.totalPages) this.currentPage = this.totalPages;
  }

  onSearchInput(ev: Event): void { this.searchQuery = (ev.target as HTMLInputElement).value; this.currentPage = 1; this.applyFilters(); }
  clearSearch(): void { this.searchQuery = ''; this.currentPage = 1; this.applyFilters(); }
  onStatusFilterChange(ev: Event): void { this.statusFilter = (ev.target as HTMLSelectElement).value as any; this.currentPage = 1; this.applyFilters(); }

  sort(field: string): void {
    if (this.sortColumn === field) this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    else { this.sortColumn = field; this.sortDirection = 'asc'; }
    this.applyFilters();
  }
  getSortIcon(field: string): string {
    if (this.sortColumn !== field) return 'fas fa-sort';
    return this.sortDirection === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
  }

  // ============================================
  // Tri MULTI-NIVEAUX (config opérateur, héritée du super admin) — miroir des organisations
  // ============================================
  /** Champs triables proposés dans le panneau, selon le niveau (1 ou 2). */
  get sortableFields(): { field: string; label: string }[] {
    return this.isN2 ? N2_SORTABLE_FIELDS : N1_SORTABLE_FIELDS;
  }

  /** Charge le tri multi-niveaux de l'opérateur pour le niveau courant (hérité du super admin). */
  private loadSortConfig(): void {
    this.sortConfigService.get(this.niveau).subscribe(levels => {
      this.sortLevels = levels;
      this.applyFilters();
    });
  }

  /** Comparateur multi-niveaux : parcourt les niveaux dans l'ordre, le premier départage. */
  private compareByLevels(a: any, b: any): number {
    for (const lvl of this.sortLevels) {
      const va = this.fieldSortValue(a, lvl.field);
      const vb = this.fieldSortValue(b, lvl.field);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      if (cmp !== 0) return lvl.dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  }
  private fieldSortValue(o: any, field: string): number | string {
    const v = o?.[field];
    if (v == null) return '';
    if (typeof v === 'boolean') return v ? 1 : 0;
    return typeof v === 'string' ? v.toLowerCase() : v;
  }

  /** Rang (1..n) du champ dans le tri multi-niveaux, ou 0 s'il n'est pas trié. */
  sortLevelOf(field: string): number {
    const i = this.sortLevels.findIndex(l => l.field === field);
    return i < 0 ? 0 : i + 1;
  }
  /** Sens de tri du champ ('asc'/'desc') s'il est trié, sinon ''. */
  sortDirOf(field: string): '' | 'asc' | 'desc' {
    return this.sortLevels.find(l => l.field === field)?.dir || '';
  }
  /** Ouvre la modale de tri (composant partagé). */
  openSortConfig(): void { this.sortCmp?.open(); }
  /** Ouvre la modale de tri multi-niveaux depuis le menu contextuel (clic droit en-tête). */
  openSortConfigFromContext(): void { this.closeContextMenus(); this.openSortConfig(); }

  /** Réception d'une modification depuis la modale partagée : applique + enregistrement auto. */
  onSortLevelsChange(levels: OrgSortLevel[]): void {
    this.sortLevels = levels;
    this.currentPage = 1;
    this.applyFilters();
    clearTimeout(this.sortSaveTimer);
    this.sortSaveTimer = setTimeout(() => this.saveSortConfig(), 500);
  }
  private saveSortConfig(): void {
    this.savingSort = true;
    this.sortConfigService.save(this.niveau, this.sortLevels).subscribe({
      next: (saved) => {
        this.sortLevels = saved; this.savingSort = false; this.savedSortFlash = true;
        this.applyFilters();
        setTimeout(() => { this.savedSortFlash = false; }, 2500);
      },
      error: (err) => { this.savingSort = false; this.toast.error('Erreur', err?.error?.detail || 'Enregistrement du tri impossible'); },
    });
  }

  // --- Réinitialisation avec la configuration SOURCE (compte administrateur) ---
  onResetSort(): void {
    if (this.resettingSort) return;
    this.resettingSort = true;
    this.sortConfigService.resetToSource(this.niveau).subscribe({
      next: (levels) => {
        this.sortLevels = levels; this.resettingSort = false;
        this.currentPage = 1; this.applyFilters();
        this.toast.success('Succès', 'Tri réinitialisé avec la configuration source');
      },
      error: (e) => {
        this.resettingSort = false;
        this.toast.error('Erreur', e?.error?.detail || 'Réinitialisation impossible');
      },
    });
  }

  // Footer gauche : menu filtres
  toggleFilterMenu(): void { this.showFilterMenu = !this.showFilterMenu; if (!this.showFilterMenu) this.showFieldFilterMenu = false; }
  setDisplayMode(mode: 'all' | 'selected'): void {
    if (mode === 'selected' && this.selectedIds.size === 0) return;
    this.displayMode = mode; this.currentPage = 1; this.applyFilters();
  }
  selectFieldForFilter(field: string, label: string): void {
    this.activeFieldFilter = field; this.activeFieldFilterLabel = label; this.fieldFilterValue = '';
    this.showFilterMenu = false; this.showFieldFilterMenu = false; this.applyFilters();
  }
  onFieldFilterInput(ev: Event): void { this.fieldFilterValue = (ev.target as HTMLInputElement).value; this.currentPage = 1; this.applyFilters(); }
  clearFieldFilter(): void { this.activeFieldFilter = null; this.activeFieldFilterLabel = ''; this.fieldFilterValue = ''; this.applyFilters(); }

  // ------------------------------------------------------------------ pagination
  get totalPages(): number { return Math.max(1, Math.ceil(this.filtered.length / this.pageSize)); }
  get paginatedRows(): any[] { const s = (this.currentPage - 1) * this.pageSize; return this.filtered.slice(s, s + this.pageSize); }
  setPageSize(n: number): void { this.pageSize = n; this.currentPage = 1; }
  goToFirstPage(): void { this.currentPage = 1; }
  goToLastPage(): void { this.currentPage = this.totalPages; }
  prevPage(): void { if (this.currentPage > 1) this.currentPage--; }
  nextPage(): void { if (this.currentPage < this.totalPages) this.currentPage++; }

  // ------------------------------------------------------------------ sélection
  toggleSelection(id: string): void { this.selectedIds.has(id) ? this.selectedIds.delete(id) : this.selectedIds.add(id); }
  isAllSelected(): boolean { const p = this.paginatedRows; return p.length > 0 && p.every(r => this.selectedIds.has(r.id)); }
  toggleSelectAll(): void { const p = this.paginatedRows; this.isAllSelected() ? p.forEach(r => this.selectedIds.delete(r.id)) : p.forEach(r => this.selectedIds.add(r.id)); }
  selectAll(): void { this.filtered.forEach(r => this.selectedIds.add(r.id)); }
  deselectAll(): void { this.selectedIds.clear(); if (this.displayMode === 'selected') this.setDisplayMode('all'); }
  invertSelection(): void { this.filtered.forEach(r => this.toggleSelection(r.id)); }
  moveSelectionToTop(): void {
    if (!this.selectedIds.size) return;
    const arr = this.showDeleted ? this.deletedRows : this.activeRows;
    const sel = arr.filter(r => this.selectedIds.has(r.id));
    const rest = arr.filter(r => !this.selectedIds.has(r.id));
    const reordered = [...sel, ...rest];
    if (this.showDeleted) this.deletedRows = reordered; else this.activeRows = reordered;
    this.sortColumn = null;
    this.applyFilters();
  }

  // ------------------------------------------------------------------ badges/format
  getStatusBadgeClass(active: boolean): string { return active ? 'badge badge-success' : 'badge badge-secondary'; }
  getStatusText(active: boolean): string { return active ? 'Actif' : 'Inactif'; }
  formatDate(v: string): string {
    return formatDateTime(v, '-');
  }

  // ------------------------------------------------------------------ CRUD
  openCreate(): void { if (!this.canManage) return; this.editing = null; this.buildForm(); this.showFormModal = true; }
  openEdit(item: any): void { if (!this.canManage) return; this.editing = item; this.buildForm(item); this.showFormModal = true; }
  closeForm(): void { this.showFormModal = false; this.editing = null; }

  submit(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.submitting = true;
    const payload = this.form.value;
    const id = this.editing?.id;
    const obs: Observable<any> = this.isN2
      ? (id ? this.service.updateNiveau2(id, payload) : this.service.createNiveau2(payload))
      : (id ? this.service.updateNiveau1(id, payload) : this.service.createNiveau1(payload));
    obs.subscribe({
      next: () => { this.toast.success('Succès', id ? 'Organisme mis à jour.' : 'Organisme créé.'); this.submitting = false; this.closeForm(); this.load(); },
      error: err => { this.submitting = false; this.toast.error('Erreur', this.firstError(err) || 'Enregistrement impossible.'); },
    });
  }

  // Suppression (unitaire + groupée)
  askDelete(item: any): void { this.toDelete = item; this.isBulkDelete = false; this.showDeleteModal = true; }
  openBulkDeleteModal(): void { if (this.selectedIds.size) { this.isBulkDelete = true; this.toDelete = null; this.showDeleteModal = true; } }
  closeDeleteModal(): void { this.toDelete = null; this.isBulkDelete = false; this.showDeleteModal = false; }
  confirmDelete(): void {
    this.deleting = true;
    const ids = this.isBulkDelete ? Array.from(this.selectedIds) : [this.toDelete.id];
    const obs: Observable<any> = this.isBulkDelete
      ? (this.isN2 ? this.service.bulkDeleteNiveau2(ids) : this.service.bulkDeleteNiveau1(ids))
      : (this.isN2 ? this.service.deleteNiveau2(ids[0]) : this.service.deleteNiveau1(ids[0]));
    obs.subscribe({
      next: (r: any) => { this.toast.success('Succès', `${this.isBulkDelete ? (r?.deleted_count ?? ids.length) : 1} organisme(s) supprimé(s).`); this.deleting = false; this.closeDeleteModal(); this.load(); },
      error: err => { this.deleting = false; this.toast.error('Erreur', this.firstError(err) || 'Suppression impossible.'); },
    });
  }

  // Restauration (unitaire + groupée)
  askRestore(item: any): void { this.toRestore = item; this.isBulkRestore = false; this.showRestoreModal = true; }
  openBulkRestoreModal(): void { if (this.selectedIds.size) { this.isBulkRestore = true; this.toRestore = null; this.showRestoreModal = true; } }
  closeRestoreModal(): void { this.toRestore = null; this.isBulkRestore = false; this.showRestoreModal = false; }
  confirmRestore(): void {
    this.bulkBusy = true;
    const ids = this.isBulkRestore ? Array.from(this.selectedIds) : [this.toRestore.id];
    const obs: Observable<any> = this.isBulkRestore
      ? (this.isN2 ? this.service.bulkRestoreNiveau2(ids) : this.service.bulkRestoreNiveau1(ids))
      : (this.isN2 ? this.service.restoreNiveau2(ids[0]) : this.service.restoreNiveau1(ids[0]));
    obs.subscribe({
      next: (r: any) => { this.toast.success('Succès', `${this.isBulkRestore ? (r?.restored_count ?? ids.length) : 1} organisme(s) restauré(s).`); this.bulkBusy = false; this.closeRestoreModal(); this.load(); },
      error: () => { this.bulkBusy = false; this.toast.error('Erreur', 'Restauration impossible.'); },
    });
  }

  // ------------------------------------------------------- suppression DÉFINITIVE (corbeille)
  /** Désignation de la cible dans la confirmation (nom, à défaut code). */
  get permanentDeleteLabel(): string {
    const t = this.permanentDeleteTarget;
    return t ? (t.nom || t.code || '') : '';
  }

  /**
   * Sous-données bloquant la purge : seuls les organismes de 1er niveau en portent.
   * La clé étrangère est en `PROTECT` côté base — les enfants en corbeille bloquent AUSSI,
   * on le dit explicitement pour que l'opérateur sache quoi purger en premier.
   */
  get permanentDeleteBlockedBy(): string {
    return this.isN2 ? '' : 'organismes de deuxième niveau (y compris ceux en corbeille)';
  }

  askPermanentDelete(item: any): void {
    if (!item?.is_deleted) return;      // purge réservée aux éléments en corbeille
    this.permanentDeleteTarget = item;
    this.isBulkPermanent = false;
    this.showPermanentDeleteModal = true;
  }

  openBulkPermanentDelete(): void {
    if (!this.showDeleted || !this.selectedIds.size) return;
    this.permanentDeleteTarget = null;
    this.isBulkPermanent = true;
    this.showPermanentDeleteModal = true;
  }

  closePermanentDelete(): void {
    this.permanentDeleteTarget = null;
    this.isBulkPermanent = false;
    this.showPermanentDeleteModal = false;
  }

  confirmPermanentDelete(): void {
    if (this.permanentDeleting) return;
    this.permanentDeleting = true;
    const ids = this.isBulkPermanent
      ? Array.from(this.selectedIds)
      : [this.permanentDeleteTarget.id];
    const obs: Observable<any> = this.isBulkPermanent
      ? (this.isN2 ? this.service.bulkPermanentDeleteNiveau2(ids)
                   : this.service.bulkPermanentDeleteNiveau1(ids))
      : (this.isN2 ? this.service.permanentDeleteNiveau2(ids[0])
                   : this.service.permanentDeleteNiveau1(ids[0]));
    obs.subscribe({
      next: (r: any) => {
        this.permanentDeleting = false;
        const purges = this.isBulkPermanent ? (r?.deleted_count ?? 0) : 1;
        const conserves = this.isBulkPermanent ? (r?.errors?.length ?? 0) : 0;
        if (purges) {
          this.toast.success('Succès',
            `${purges} organisme(s) supprimé(s) définitivement.`);
        }
        // Le serveur conserve les éléments portant encore des sous-données : on le dit.
        if (conserves) {
          this.toast.warning('Partiel',
            `${conserves} organisme(s) conservé(s) : des sous-éléments y sont rattachés.`);
        }
        this.selectedIds.clear();
        this.closePermanentDelete();
        this.load();
      },
      error: (e: any) => {
        this.permanentDeleting = false;
        this.toast.error('Erreur',
          e?.error?.detail || 'Suppression définitive impossible.');
      },
    });
  }

  // ------------------------------------------------------------------ export
  toggleExportMenu(): void { this.showExportMenu = !this.showExportMenu; }
  exportCSV(selectedOnly: boolean): void {
    this.showExportMenu = false;
    const source = selectedOnly ? this.filtered.filter(r => this.selectedIds.has(r.id)) : this.filtered;
    if (!source.length) { this.toast.warning('Attention', 'Aucune ligne à exporter.'); return; }
    const cols = this.getVisibleColumns();
    const sep = ';';
    const header = cols.map(c => c.label).join(sep);
    const lines = source.map(r => cols.map(c => {
      let v = r[c.field];
      if (c.type === 'boolean') v = v ? 'Actif' : 'Inactif';
      if (c.type === 'date') v = this.formatDate(v);
      if (v == null) v = '';
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(sep));
    const csv = '﻿' + [header, ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `organismes_niveau${this.niveau}${this.showDeleted ? '_corbeille' : ''}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ------------------------------------------------------------------ config colonnes (composant partagé)
  /** Ouvre la modale d'organisation des colonnes (composant partagé). */
  openColumnConfig(): void { this.columnCfg?.open(); }
  onColumnsChange(cols: ManagedColumn[]): void {
    this.columns = cols as ColumnConfig[];
    const key = this.columnsKey;
    const prefs = toColumnPrefs(cols);
    clearTimeout(this.columnsSaveTimer);
    this.columnsSaveTimer = setTimeout(() => this.saveColumnsConfig(key, prefs), 500);
  }
  private saveColumnsConfig(key: string, prefs: { field: string; visible: boolean }[]): void {
    this.savingColumns = true;
    this.columnsConfigService.save(key, prefs).subscribe({
      next: () => {
        this.savingColumns = false; this.savedColumnsFlash = true;
        setTimeout(() => { this.savedColumnsFlash = false; }, 2500);
      },
      error: (err) => { this.savingColumns = false; this.toast.error('Erreur', err?.error?.detail || 'Enregistrement des colonnes impossible'); },
    });
  }
  onResetColumns(): void {
    if (this.resettingColumns) return;
    this.resettingColumns = true;
    const key = this.columnsKey;
    this.columnsConfigService.resetToSource(key).subscribe({
      next: (prefs) => {
        this.columns = applyColumnsConfig(this.columns, prefs);
        this.resettingColumns = false;
        this.toast.success('Succès', 'Colonnes réinitialisées avec la configuration source');
      },
      error: (e) => { this.resettingColumns = false; this.toast.error('Erreur', e?.error?.detail || 'Réinitialisation impossible'); },
    });
  }

  // ------------------------------------------------------------------ menus contextuels
  onColumnHeaderRightClick(ev: MouseEvent, col: ColumnConfig): void {
    ev.preventDefault(); this.closeContextMenus();
    this.columnForContext = col; this.contextMenuPosition = { x: ev.clientX, y: ev.clientY }; this.showColumnContextMenu = true;
  }
  onRowRightClick(ev: MouseEvent, row: any): void {
    ev.preventDefault(); this.closeContextMenus();
    this.rowForContext = row; this.cellForContext = null;
    this.contextMenuPosition = { x: ev.clientX, y: ev.clientY }; this.showRowContextMenu = true;
  }
  onCellRightClick(ev: MouseEvent, row: any, field: string): void {
    ev.preventDefault(); ev.stopPropagation(); this.closeContextMenus();
    this.rowForContext = row; this.cellForContext = { row, field, value: row[field] };
    this.contextMenuPosition = { x: ev.clientX, y: ev.clientY }; this.showRowContextMenu = true;
  }
  hideColumnFromContext(): void {
    const field = this.columnForContext?.field;
    this.closeContextMenus();
    if (!field) return;
    this.onColumnsChange(this.columns.map(c => (c.field === field ? { ...c, visible: false } : { ...c })));
  }
  openColumnConfigFromContext(): void { this.closeContextMenus(); this.openColumnConfig(); }
  toggleRowSelectionFromContext(): void { if (this.rowForContext) this.toggleSelection(this.rowForContext.id); this.closeContextMenus(); }
  selectAllFromContext(): void { this.selectAll(); this.closeContextMenus(); }
  copyCellValueFromContext(): void {
    if (this.cellForContext) { try { navigator.clipboard.writeText(String(this.cellForContext.value ?? '')); this.toast.success('Copié', 'Valeur copiée.'); } catch {} }
    this.closeContextMenus();
  }
  editFromContext(): void { const r = this.rowForContext; this.closeContextMenus(); if (r) this.openEdit(r); }
  deleteFromContext(): void { const r = this.rowForContext; this.closeContextMenus(); if (r && !r.is_deleted) this.askDelete(r); }
  restoreFromContext(): void { const r = this.rowForContext; this.closeContextMenus(); if (r && r.is_deleted) this.askRestore(r); }
  private closeContextMenus(): void { this.showColumnContextMenu = false; this.showRowContextMenu = false; }

  // ------------------------------------------------------------------ global
  @HostListener('document:click')
  onDocumentClick(): void { this.showExportMenu = false; this.showFilterMenu = false; this.showFieldFilterMenu = false; this.closeContextMenus(); }

  @HostListener('document:keydown.escape')
  onEscape(): void { this.showFormModal = false; this.showDeleteModal = false; this.showRestoreModal = false; this.showPermanentDeleteModal = false; this.onDocumentClick(); }

  private firstError(err: any): string {
    const e = err?.error; if (!e) return '';
    if (typeof e === 'string') return e;
    const k = Object.keys(e)[0]; const v = e[k];
    return Array.isArray(v) ? v[0] : String(v);
  }
}
