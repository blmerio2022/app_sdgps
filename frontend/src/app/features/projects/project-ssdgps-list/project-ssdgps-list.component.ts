import { formatDateTime } from '../../../shared/utils/date-format.util';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../../../shared/components/table-pagination/table-pagination.component';
import { Component, OnInit, OnDestroy, HostListener, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ProjectsService } from '../../../core/services/projects.service';
import { BreadcrumbService } from '../../../core/layout/services/breadcrumb.service';
import { ToastService } from '../../../core/services/toast.service';
import { SsdgpsSortConfigService, SsdgpsSortLevel } from '../../../core/services/ssdgps-sort-config.service';
import { MultiLevelSortComponent } from '../../../shared/components/multi-level-sort/multi-level-sort.component';
import { ColumnConfigComponent } from '../../../shared/components/column-config/column-config.component';
import { applyColumnsConfig, toColumnPrefs, ManagedColumn } from '../../../shared/components/column-config/column-config.util';
import { ColumnFilterMap, withColumnFilter, rowMatchesColumnFilters, activeFilterCount } from '../../../shared/components/column-filter/column-filter.util';
import { TableColumnsConfigService } from '../../../core/services/table-columns-config.service';
import {
  Projet, Ssdgps, proprieteLabel, NATURE_SSDGPS_OPTIONS, TYPE_SSDGPS_OPTIONS,
} from '../../../core/models/project.model';

interface ColumnConfig {
  field: string;
  label: string;
  visible: boolean;
  type?: 'text' | 'date' | 'number' | 'boolean';
}


const DEFAULT_COLUMNS: ColumnConfig[] = [
  { field: 'numero_ssdgps', label: 'SSDGPS', visible: true, type: 'number' },
  { field: 'nature_ssdgps', label: 'Nature', visible: true, type: 'text' },
  { field: 'type_ssdgps', label: 'Type', visible: true, type: 'text' },
  { field: 'propriete_label', label: 'Propriété', visible: true, type: 'text' },
  { field: 'affaire_numero', label: 'Affaire (SD)', visible: true, type: 'text' },
  { field: 'nbr_total_sessions', label: 'Sessions', visible: true, type: 'number' },
  { field: 'nbr_total_pieces', label: 'Pièces', visible: true, type: 'number' },
  { field: 'propriete_nom', label: 'Propriété-dite', visible: false, type: 'text' },
  { field: 'propriete_id_titre', label: 'Titre foncier', visible: false, type: 'text' },
  { field: 'propriete_id_requisition', label: 'Réquisition', visible: false, type: 'text' },
  { field: 'created_at', label: 'Créé le', visible: false, type: 'date' },
  { field: 'updated_at', label: 'Modifié le', visible: false, type: 'date' },
  { field: 'is_deleted', label: 'Supprimé', visible: false, type: 'boolean' },
  { field: 'deleted_at', label: 'Supprimé le', visible: false, type: 'date' },
  { field: 'created_by_email', label: 'Créé par', visible: false, type: 'text' },
  { field: 'updated_by_email', label: 'Modifié par', visible: false, type: 'text' },
  { field: 'deleted_by_email', label: 'Supprimé par', visible: false, type: 'text' },
];

/** Colonnes triables (allowlist alignée sur le backend SSDGPS_SORT_FIELDS), avec libellé. */
const SORTABLE_FIELDS: { field: string; label: string }[] = [
  { field: 'numero_ssdgps', label: 'SSDGPS (numéro)' },
  { field: 'nature_ssdgps', label: 'Nature' },
  { field: 'type_ssdgps', label: 'Type' },
  { field: 'propriete_label', label: 'Propriété' },
  { field: 'affaire_numero', label: 'Affaire (SD)' },
  { field: 'nbr_total_sessions', label: 'Sessions' },
  { field: 'nbr_total_pieces', label: 'Pièces' },
  { field: 'propriete_nom', label: 'Propriété-dite' },
  { field: 'propriete_id_titre', label: 'Titre foncier' },
  { field: 'propriete_id_requisition', label: 'Réquisition' },
  { field: 'created_at', label: 'Créé le' },
  { field: 'updated_at', label: 'Modifié le' },
];

const FIELD_DESCRIPTIONS: Record<string, string> = {
  numero_ssdgps: "Numéro d'ordre du SSDGPS dans l'affaire",
  nature_ssdgps: 'Nature du sous-sous-dossier GPS',
  type_ssdgps: 'Mono-session ou multi-session',
  propriete_label: 'Propriété de rattachement (titre foncier, sinon réquisition)',
  affaire_numero: "Numéro du SD d'affaire de rattachement",
  nbr_total_sessions: 'Nombre total de sessions rattachées',
  nbr_total_pieces: 'Nombre total de pièces rattachées au rapport',
  propriete_nom: 'Nom de la propriété (propriété-dite)',
  propriete_id_titre: 'Identifiant du titre foncier',
  propriete_id_requisition: 'Identifiant de réquisition',
  created_at: "Date de création de l'enregistrement",
  updated_at: "Date de dernière modification de l'enregistrement",
  is_deleted: "Indique si l'enregistrement a été supprimé (logique)",
  deleted_at: "Date de suppression de l'enregistrement",
  created_by_email: "Utilisateur ayant créé l'enregistrement",
  updated_by_email: "Utilisateur ayant modifié l'enregistrement en dernier",
  deleted_by_email: "Utilisateur ayant supprimé l'enregistrement",
};

/**
 * Vue à plat de TOUS les SSDGPS d'un projet (toutes propriétés / affaires confondues) —
 * raccourci évitant de parcourir la hiérarchie Projet > Propriété > Affaire > SSDGPS.
 * Reprend l'outillage du tableau de l'explorateur : sélection, colonnes configurables,
 * filtres (recherche + par champ), export CSV, onglets Actifs/Corbeille, pagination.
 */
@Component({
  selector: 'app-project-ssdgps-list',
  templateUrl: './project-ssdgps-list.component.html',
  styleUrls: ['./project-ssdgps-list.component.scss'],
})
export class ProjectSsdgpsListComponent implements OnInit, OnDestroy {
  loading = true;
  projectId!: string;
  projet: Projet | null = null;

  private activeItems: Ssdgps[] = [];
  private deletedItems: Ssdgps[] = [];
  showDeleted = false;

  searchText = '';
  natureFilter = '';
  typeFilter = '';
  private manualOrder: string[] | null = null;

  // --- Tri MULTI-NIVEAUX (config opérateur, héritée du super admin) ---
  /** Niveaux de tri appliqués au tableau (niveau 0 = prioritaire). */
  sortLevels: SsdgpsSortLevel[] = [];
  /** Champs triables proposés dans le panneau de configuration. */
  readonly sortableFields = SORTABLE_FIELDS;
  @ViewChild(MultiLevelSortComponent) private sortCmp?: MultiLevelSortComponent;
  savingSort = false;
  savedSortFlash = false;
  resettingSort = false;
  private sortSaveTimer: any;

  pageSize = DEFAULT_PAGE_SIZE;
  currentPage = 1;
  pageSizeOptions = [...PAGE_SIZE_OPTIONS];

  natureOptions = NATURE_SSDGPS_OPTIONS;
  typeOptions = TYPE_SSDGPS_OPTIONS;
  proprieteLabel = proprieteLabel;

  restoring: string | null = null;
  bulkRestoring = false;

  // Sélection
  selectedIds = new Set<string>();

  // Mode d'affichage / filtre par champ (pied de tableau)
  displayMode: 'all' | 'selected' = 'all';
  activeFieldFilter: string | null = null;
  activeFieldFilterLabel = '';
  fieldFilterValue = '';
  showFilterMenu = false;
  showFieldFilterMenu = false;

  // Colonnes (config opérateur, héritée du super admin) — composant partagé
  columns: ColumnConfig[] = DEFAULT_COLUMNS.map(c => ({ ...c }));
  private readonly COLUMNS_KEY = 'ssdgps';
  @ViewChild(ColumnConfigComponent) private columnCfg?: ColumnConfigComponent;
  /** Description d'une colonne pour la modale partagée (référence stable). */
  describeColumn = (field: string): string => this.getFieldDescription(field);
  savingColumns = false;
  savedColumnsFlash = false;
  resettingColumns = false;
  private columnsSaveTimer: any;

  // Menu contextuel de colonne
  showColumnContextMenu = false;
  contextMenuPosition = { x: 0, y: 0 };
  contextMenuColumn: ColumnConfig | null = null;

  // Consultation (détail), édition et suppression d'un SSDGPS
  showDetailModal = false;
  detailTarget: Ssdgps | null = null;
  showEditModal = false;
  editTarget: Ssdgps | null = null;
  editForm!: FormGroup;
  submitting = false;
  showDeleteModal = false;
  deleteTarget: Ssdgps | null = null;
  isBulkDelete = false;
  deleting = false;
  // Suppression définitive (corbeille) : unitaire + masse
  showPermanentDeleteModal = false;
  permanentDeleteTarget: Ssdgps | null = null;
  isBulkPermanent = false;
  permanentDeleting = false;

  constructor(
    private service: ProjectsService,
    private toast: ToastService,
    private route: ActivatedRoute,
    private router: Router,
    private sortConfigService: SsdgpsSortConfigService,
    private breadcrumb: BreadcrumbService,
    private fb: FormBuilder,
    private columnsConfigService: TableColumnsConfigService,
  ) {}

  ngOnInit(): void {
    this.projectId = this.route.snapshot.paramMap.get('id')!;
    this.loadColumnsConfig();
    this.load();
    this.loadSortConfig();
    this.service.getProjet(this.projectId).subscribe({
      next: (p) => { this.projet = p; this.updateTopbarBreadcrumb(); },
      error: () => {},
    });
  }

  ngOnDestroy(): void {
    this.breadcrumb.clear();
  }

  /** Fil d'Ariane métier : Accueil › Projets › <Projet> › Tous les SSDGPS. */
  private updateTopbarBreadcrumb(): void {
    const base = this.router.url.startsWith('/admin') ? '/admin/projets' : '/projets';
    this.breadcrumb.set([
      { label: 'Accueil', route: '/home', icon: 'fa-house' },
      { label: 'Projets', route: base, icon: 'fa-folder-open' },
      { label: this.projet?.nom_projet || this.projet?.code_projet || 'Projet', route: `${base}/${this.projectId}`, icon: 'fa-diagram-project' },
      { label: 'Tous les SSDGPS', icon: 'fa-satellite-dish', isActive: true },
    ]);
  }

  /** Charge le tri multi-niveaux de l'opérateur (hérité du super admin par défaut). */
  private loadSortConfig(): void {
    this.sortConfigService.get().subscribe(levels => { this.sortLevels = levels; });
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.showFilterMenu = false;
    this.showFieldFilterMenu = false;
    this.showColumnContextMenu = false;
  }

  load(): void {
    this.loading = true;
    forkJoin([
      this.service.getSsdgpsByProjet(this.projectId),
      this.service.getSsdgpsByProjet(this.projectId, { show_deleted: true }),
    ]).subscribe({
      next: ([active, deleted]) => {
        this.activeItems = active;
        this.deletedItems = deleted;
        this.selectedIds.clear();
        this.manualOrder = null;
        this.loading = false;
      },
      error: () => { this.toast.error('Erreur', 'Chargement des SSDGPS impossible'); this.loading = false; },
    });
  }

  // --- Onglets Actifs / Corbeille ---
  get activeCount(): number { return this.activeItems.length; }
  get deletedCount(): number { return this.deletedItems.length; }
  setTab(deleted: boolean): void {
    if (this.showDeleted === deleted) return;
    this.showDeleted = deleted;
    this.selectedIds.clear();
    this.manualOrder = null;
    this.displayMode = 'all';
    this.currentPage = 1;
  }
  get items(): Ssdgps[] { return this.showDeleted ? this.deletedItems : this.activeItems; }

  // --- Recherche / filtres / tri ---
  private matchesSearch(s: Ssdgps, q: string): boolean {
    if (!q) return true;
    const hay = [
      `ssdgps ${s.numero_ssdgps}`, s.nature_ssdgps, s.type_ssdgps,
      this.proprieteLabel(s), s.propriete_nom, s.affaire_numero,
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  }

  // --- FILTRES DE COLONNE (façon Excel, composant partagé `<app-column-filter>`) ---
  /** Valeurs retenues par colonne ; une colonne absente n'est pas filtrée. */
  columnFilters: ColumnFilterMap = {};
  /** Texte affiché d'une cellule : le filtre porte sur la valeur VUE (référence stable). */
  cellText = (row: any, field: string): string => this.getCellValue(row, field);

  onColumnFilterChange(field: string, values: string[] | null): void {
    this.columnFilters = withColumnFilter(this.columnFilters, field, values);
  }

  /** Masque une colonne (depuis le menu de filtre) — auto-save comme la modale des colonnes. */
  hideColumnField(field: string): void {
    this.onColumnsChange(this.columns.map(c => (c.field === field ? { ...c, visible: false } : { ...c })));
  }

  get filteredItems(): Ssdgps[] {
    const q = this.searchText.trim().toLowerCase();
    let rows = this.items.filter((s) => {
      if (this.displayMode === 'selected' && !this.selectedIds.has(s.id)) return false;
      if (this.natureFilter && s.nature_ssdgps !== this.natureFilter) return false;
      if (this.typeFilter && s.type_ssdgps !== this.typeFilter) return false;
      if (!this.matchesSearch(s, q)) return false;
      if (this.activeFieldFilter && this.fieldFilterValue) {
        const v = this.getCellValue(s, this.activeFieldFilter).toLowerCase();
        if (!v.includes(this.fieldFilterValue.toLowerCase())) return false;
      }
      // Filtres de colonne (façon Excel).
      if (!rowMatchesColumnFilters(s, this.columnFilters, this.cellText)) return false;
      return true;
    });
    if (this.manualOrder) {
      const idx = new Map(this.manualOrder.map((id, i) => [id, i]));
      rows = [...rows].sort((a, b) =>
        (idx.has(a.id) ? idx.get(a.id)! : Number.MAX_SAFE_INTEGER) -
        (idx.has(b.id) ? idx.get(b.id)! : Number.MAX_SAFE_INTEGER));
    } else if (this.sortLevels.length) {
      rows = [...rows].sort((a, b) => this.compareByLevels(a, b));
    }
    return rows;
  }

  /** Comparateur multi-niveaux : parcourt les niveaux dans l'ordre, le premier départage. */
  private compareByLevels(a: Ssdgps, b: Ssdgps): number {
    for (const lvl of this.sortLevels) {
      const va = this.fieldSortValue(a, lvl.field);
      const vb = this.fieldSortValue(b, lvl.field);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      if (cmp !== 0) return lvl.dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  }

  private fieldSortValue(s: Ssdgps, field: string): number | string {
    if (field === 'propriete_label') return (this.proprieteLabel(s) || '').toLowerCase();
    const v = (s as any)[field];
    if (v == null) return '';
    return typeof v === 'string' ? v.toLowerCase() : v;
  }

  // --- Marqueurs de tri sur les en-têtes de colonnes ---
  /** Rang (1..n) du champ dans le tri multi-niveaux, ou 0 s'il n'est pas trié. */
  sortLevelOf(field: string): number {
    const i = this.sortLevels.findIndex(l => l.field === field);
    return i < 0 ? 0 : i + 1;
  }
  /** Sens de tri du champ ('asc'/'desc') s'il est trié, sinon ''. */
  sortDirOf(field: string): '' | 'asc' | 'desc' {
    return this.sortLevels.find(l => l.field === field)?.dir || '';
  }
  // ============================================
  // Tri multi-niveaux (modale fournie par le composant partagé <app-multi-level-sort>)
  // ============================================
  /** Ouvre la modale de tri (composant partagé). */
  openSortConfig(): void { this.sortCmp?.open(); }

  /** Réception d'une modification depuis la modale partagée : applique + enregistrement auto. */
  onSortLevelsChange(levels: SsdgpsSortLevel[]): void {
    this.sortLevels = levels;
    this.queueSaveSort();
  }

  /** Enregistrement automatique (anti-rebond) de la config de tri. */
  private queueSaveSort(): void {
    this.currentPage = 1;
    clearTimeout(this.sortSaveTimer);
    this.sortSaveTimer = setTimeout(() => this.saveSortConfig(), 500);
  }
  private saveSortConfig(): void {
    this.savingSort = true;
    this.sortConfigService.save(this.sortLevels).subscribe({
      next: (saved) => {
        this.sortLevels = saved; this.savingSort = false; this.savedSortFlash = true;
        setTimeout(() => { this.savedSortFlash = false; }, 2500);
      },
      error: (err) => { this.savingSort = false; this.toast.error('Erreur', err?.error?.detail || 'Enregistrement du tri impossible'); },
    });
  }

  // --- Réinitialisation avec la configuration SOURCE (compte administrateur) ---
  onResetSort(): void {
    if (this.resettingSort) return;
    this.resettingSort = true;
    this.sortConfigService.resetToSource().subscribe({
      next: (levels) => {
        this.sortLevels = levels; this.resettingSort = false;
        this.currentPage = 1;
        this.toast.success('Succès', 'Tri réinitialisé avec la configuration source');
      },
      error: (e) => {
        this.resettingSort = false;
        this.toast.error('Erreur', e?.error?.detail || 'Réinitialisation impossible');
      },
    });
  }
  clearFilters(): void {
    this.searchText = ''; this.natureFilter = ''; this.typeFilter = '';
    this.clearFieldFilter(); this.displayMode = 'all'; this.currentPage = 1;
  }
  get hasActiveFilter(): boolean {
    return !!(this.searchText || this.natureFilter || this.typeFilter || this.activeFieldFilter || this.displayMode !== 'all');
  }

  typeBadgeClass(type: string): string {
    return type === 'multi-session' ? 'badge badge-primary' : 'badge badge-secondary';
  }

  // --- Sélection ---
  isSelected(s: Ssdgps): boolean { return this.selectedIds.has(s.id); }
  toggleSelect(s: Ssdgps, ev: Event): void {
    ev.stopPropagation();
    this.selectedIds.has(s.id) ? this.selectedIds.delete(s.id) : this.selectedIds.add(s.id);
  }
  get selectedCount(): number { return this.selectedIds.size; }
  get isAllSelected(): boolean {
    const f = this.paginatedItems;
    return f.length > 0 && f.every(s => this.selectedIds.has(s.id));
  }
  toggleSelectAll(): void {
    const f = this.paginatedItems;
    if (this.isAllSelected) f.forEach(s => this.selectedIds.delete(s.id));
    else f.forEach(s => this.selectedIds.add(s.id));
  }
  invertSelection(): void {
    this.paginatedItems.forEach(s => this.selectedIds.has(s.id) ? this.selectedIds.delete(s.id) : this.selectedIds.add(s.id));
  }
  private selectedList(): Ssdgps[] { return this.items.filter(s => this.selectedIds.has(s.id)); }
  moveSelectionToTop(): void {
    if (this.selectedIds.size === 0) return;
    const sel = this.filteredItems.filter(s => this.selectedIds.has(s.id)).map(s => s.id);
    const rest = this.filteredItems.filter(s => !this.selectedIds.has(s.id)).map(s => s.id);
    this.manualOrder = [...sel, ...rest];
    this.currentPage = 1;
  }

  // --- Mode d'affichage / filtre par champ (pied) ---
  setDisplayMode(mode: 'all' | 'selected'): void {
    if (mode === 'selected' && this.selectedCount === 0) return;
    this.displayMode = mode; this.currentPage = 1;
  }
  toggleFilterMenu(): void { this.showFilterMenu = !this.showFilterMenu; }
  selectFieldForFilter(field: string, label: string): void {
    this.activeFieldFilter = field; this.activeFieldFilterLabel = label; this.fieldFilterValue = '';
    this.showFieldFilterMenu = false; this.showFilterMenu = false; this.currentPage = 1;
  }
  onFieldFilterInput(event: Event): void {
    this.fieldFilterValue = (event.target as HTMLInputElement).value; this.currentPage = 1;
  }
  clearFieldFilter(): void { this.activeFieldFilter = null; this.activeFieldFilterLabel = ''; this.fieldFilterValue = ''; }

  // --- Colonnes (composant partagé, source super admin + réinitialisation) ---
  getVisibleColumns(): ColumnConfig[] { return this.columns.filter(c => c.visible); }
  getTypeLabel(type?: string): string { return { text: 'TEXTE', date: 'DATE', number: 'NOMBRE', boolean: 'BOOLÉEN' }[type || 'text'] || 'TEXTE'; }
  getFieldDescription(field: string): string { return FIELD_DESCRIPTIONS[field] || ''; }

  /** Ouvre la modale d'organisation des colonnes (composant partagé). */
  openColumnConfig(): void { this.columnCfg?.open(); }
  private loadColumnsConfig(): void {
    this.columnsConfigService.get(this.COLUMNS_KEY).subscribe(prefs => {
      this.columns = applyColumnsConfig(this.columns, prefs);
    });
  }
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

  // Menu contextuel de colonne (clic droit sur l'en-tête)
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
    this.onColumnsChange(this.columns.map(c => (c.field === field ? { ...c, visible: false } : { ...c })));
  }
  openColumnConfigFromContext(): void { this.showColumnContextMenu = false; this.openColumnConfig(); }
  /** Ouvrir la modale de tri multi-niveaux depuis le menu contextuel (clic droit en-tête). */
  openSortConfigFromContext(): void { this.showColumnContextMenu = false; this.openSortConfig(); }

  // --- Valeur de cellule (affichage + CSV + filtre par champ) ---
  formatDate(value: any): string {
    return formatDateTime(value);
  }
  getCellValue(s: Ssdgps, field: string): string {
    switch (field) {
      case 'propriete_label': return this.proprieteLabel(s) || '—';
      case 'affaire_numero': return s.affaire_numero ? `SD ${s.affaire_numero}` : '—';
      case 'type_ssdgps': return s.type_ssdgps === 'multi-session' ? 'Multi-session' : 'Mono-session';
      case 'created_at': case 'updated_at': case 'deleted_at': return this.formatDate((s as any)[field]);
      case 'is_deleted': return s.is_deleted ? 'Oui' : 'Non';
      default: { const v = (s as any)[field]; return v == null || v === '' ? '—' : String(v); }
    }
  }

  // --- Export CSV ---
  private csvEscape(v: any): string { const t = v == null ? '' : String(v); return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }
  exportCsv(): void {
    const cols = this.columns.filter(c => c.visible);
    const header = cols.map(c => c.label).join(';');
    const rows = this.filteredItems.map(s => cols.map(c => this.csvEscape(this.getCellValue(s, c.field))).join(';'));
    const csv = '﻿' + [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ssdgps_${this.projet?.code_projet || this.projectId}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    this.toast.success('Export', `${this.filteredItems.length} SSDGPS exporté(s)`);
  }

  // --- Pagination ---
  get totalPages(): number { return Math.max(1, Math.ceil(this.filteredItems.length / this.pageSize)); }
  get paginatedItems(): Ssdgps[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredItems.slice(start, start + this.pageSize);
  }
  get pageNumbers(): number[] {
    const total = this.totalPages; const out: number[] = [];
    const start = Math.max(1, this.currentPage - 2); const end = Math.min(total, this.currentPage + 2);
    for (let p = start; p <= end; p++) out.push(p);
    return out;
  }
  setPageSize(n: number): void { this.pageSize = n; this.currentPage = 1; }
  goToPage(p: number): void { this.currentPage = Math.min(Math.max(1, p), this.totalPages); }
  prevPage(): void { this.goToPage(this.currentPage - 1); }
  nextPage(): void { this.goToPage(this.currentPage + 1); }
  goToFirstPage(): void { this.goToPage(1); }
  goToLastPage(): void { this.goToPage(this.totalPages); }

  // --- Navigation ---
  /** Base absolue « …/projets » (fonctionne sous /projets ET /admin/projets). */
  private projetsBase(): string[] {
    const segs = this.router.url.split('?')[0].split('/').filter(Boolean);
    const idx = segs.lastIndexOf('projets');
    return ['/', ...(idx >= 0 ? segs.slice(0, idx + 1) : ['dashboard', 'projets'])];
  }
  openPieces(s: Ssdgps): void {
    if (s.is_deleted) return;
    this.router.navigate([...this.projetsBase(), this.projectId, 'pieces', s.id], {
      queryParams: { proprieteId: s.propriete, affaireId: s.affaire },
    });
  }
  backToExplorer(): void { this.router.navigate([...this.projetsBase(), this.projectId]); }

  restore(s: Ssdgps): void {
    if (this.restoring) return;
    this.restoring = s.id;
    this.service.restoreSsdgps(s.id).subscribe({
      next: () => { this.restoring = null; this.toast.success('Restauré', 'SSDGPS restauré'); this.load(); },
      error: () => { this.restoring = null; this.toast.error('Échec', 'Restauration impossible'); },
    });
  }
  bulkRestore(): void {
    const ids = this.selectedList().filter(s => s.is_deleted).map(s => s.id);
    if (!ids.length || this.bulkRestoring) return;
    this.bulkRestoring = true;
    this.service.bulkRestoreSsdgps(ids).subscribe({
      next: (r) => { this.bulkRestoring = false; this.toast.success('Restauré', `${r.restored_count} SSDGPS restauré(s)`); this.load(); },
      error: () => { this.bulkRestoring = false; this.toast.error('Échec', 'Restauration impossible'); },
    });
  }

  // ============================================
  // Consulter (détail en lecture seule)
  // ============================================
  openDetail(s: Ssdgps, ev: Event): void { ev.stopPropagation(); this.detailTarget = s; this.showDetailModal = true; }
  closeDetail(): void { this.showDetailModal = false; this.detailTarget = null; }

  // ============================================
  // Modifier (édition d'un SSDGPS)
  // ============================================
  openEdit(s: Ssdgps, ev: Event): void {
    ev.stopPropagation();
    this.editTarget = s;
    this.editForm = this.fb.group({
      nature_ssdgps: [s.nature_ssdgps || '', Validators.required],
      numero_ssdgps: [s.numero_ssdgps ?? null, Validators.required],
      type_ssdgps: [s.type_ssdgps || 'mono-session', Validators.required],
    });
    this.showEditModal = true;
  }
  closeEdit(): void { if (!this.submitting) { this.showEditModal = false; this.editTarget = null; } }

  submitEdit(): void {
    if (!this.editTarget || this.submitting) return;
    if (this.editForm.invalid) { this.editForm.markAllAsTouched(); return; }
    this.submitting = true;
    this.service.updateSsdgps(this.editTarget.id, this.editForm.value).subscribe({
      next: () => { this.submitting = false; this.showEditModal = false; this.editTarget = null; this.toast.success('Succès', 'SSDGPS modifié'); this.load(); },
      error: (e) => {
        this.submitting = false;
        const err = e?.error;
        const msg = typeof err === 'object' && err ? Object.values(err).flat().join(' ') : 'Modification impossible';
        this.toast.error('Échec', String(msg));
      },
    });
  }

  // ============================================
  // Supprimer (suppression logique) — unitaire + masse
  // ============================================
  openDeleteModal(s: Ssdgps, ev: Event): void { ev.stopPropagation(); this.deleteTarget = s; this.isBulkDelete = false; this.showDeleteModal = true; }
  openBulkDelete(): void { if (this.selectedCount === 0) return; this.deleteTarget = null; this.isBulkDelete = true; this.showDeleteModal = true; }
  closeDeleteModal(): void { if (!this.deleting) { this.showDeleteModal = false; this.deleteTarget = null; } }

  confirmDelete(): void {
    if (this.deleting) return;
    this.deleting = true;
    const finish = (n: number) => {
      this.deleting = false; this.showDeleteModal = false; this.deleteTarget = null;
      this.selectedIds.clear(); this.load(); this.toast.success('Succès', `${n} SSDGPS supprimé(s)`);
    };
    const fail = () => { this.deleting = false; this.toast.error('Erreur', 'Suppression impossible'); };
    if (this.isBulkDelete) {
      const ids = this.selectedList().filter(s => !s.is_deleted).map(s => s.id);
      if (!ids.length) { this.deleting = false; this.showDeleteModal = false; return; }
      forkJoin(ids.map(id => this.service.deleteSsdgps(id))).subscribe({ next: () => finish(ids.length), error: fail });
    } else if (this.deleteTarget) {
      this.service.deleteSsdgps(this.deleteTarget.id).subscribe({ next: () => finish(1), error: fail });
    }
  }

  // ============================================
  // Suppression définitive (corbeille) — unitaire + masse
  // ============================================
  openPermanentDeleteModal(s: Ssdgps, ev: Event): void { ev.stopPropagation(); this.permanentDeleteTarget = s; this.isBulkPermanent = false; this.showPermanentDeleteModal = true; }
  openBulkPermanentDelete(): void { if (this.selectedCount === 0) return; this.permanentDeleteTarget = null; this.isBulkPermanent = true; this.showPermanentDeleteModal = true; }
  closePermanentDeleteModal(): void { if (!this.permanentDeleting) { this.showPermanentDeleteModal = false; this.permanentDeleteTarget = null; } }

  confirmPermanentDelete(): void {
    if (this.permanentDeleting) return;
    const close = () => { this.permanentDeleting = false; this.showPermanentDeleteModal = false; this.permanentDeleteTarget = null; };
    if (this.isBulkPermanent) {
      const ids = this.selectedList().filter(s => s.is_deleted).map(s => s.id);
      if (!ids.length) { this.showPermanentDeleteModal = false; return; }
      this.permanentDeleting = true;
      const total = ids.length;
      this.service.bulkPermanentDeleteSsdgps(ids).subscribe({
        next: (res) => {
          close(); this.selectedIds.clear(); this.load();
          const d = res.deleted_count || 0, f = (res.errors || []).length;
          if (d > 0 && f === 0) this.toast.success('Suppression définitive', `${d} SSDGPS supprimé(s) définitivement`);
          else if (d > 0 && f > 0) this.toast.warning('Suppression partielle', `${d} supprimé(s) ; ${f} conservé(s) (sous-données rattachées).`);
          else this.toast.error('Aucune suppression', `${total} SSDGPS non supprimé(s) : des sous-données y sont rattachées.`);
        },
        error: () => { this.permanentDeleting = false; this.toast.error('Erreur', 'Suppression définitive impossible'); },
      });
    } else if (this.permanentDeleteTarget) {
      this.permanentDeleting = true;
      this.service.permanentDeleteSsdgps(this.permanentDeleteTarget.id).subscribe({
        next: () => { close(); this.load(); this.toast.success('Suppression définitive', 'SSDGPS supprimé définitivement'); },
        error: (e) => { this.permanentDeleting = false; this.toast.error('Suppression impossible', e?.error?.detail || 'Suppression définitive impossible'); },
      });
    }
  }
}
