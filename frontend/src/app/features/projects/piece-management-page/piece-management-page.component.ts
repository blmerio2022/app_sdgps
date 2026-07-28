import { formatDateTime, formatFieldDate } from '../../../shared/utils/date-format.util';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../../../shared/components/table-pagination/table-pagination.component';
import { Component, HostListener, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ProjectsService } from '../../../core/services/projects.service';
import { PiecesService } from '../../../core/services/pieces.service';
import { ToastService } from '../../../core/services/toast.service';
import { BreadcrumbService } from '../../../core/layout/services/breadcrumb.service';
import { BreadcrumbItem } from '../../../core/layout/interfaces/menu.interface';
import { Piece, PieceTypeDef } from '../../../core/models/piece.model';
import { Ssdgps, Session, Projet } from '../../../core/models/project.model';
import { TableSortConfigService, OrgSortLevel } from '../../../core/services/table-sort-config.service';
import { SortableField, sortLevelOf, sortDirOf } from '../../../shared/components/multi-level-sort/multi-level-sort.util';
import { MultiLevelSortComponent } from '../../../shared/components/multi-level-sort/multi-level-sort.component';
import { ColumnConfigComponent } from '../../../shared/components/column-config/column-config.component';
import { applyColumnsConfig, toColumnPrefs, ManagedColumn } from '../../../shared/components/column-config/column-config.util';
import { ColumnFilterMap, withColumnFilter, rowMatchesColumnFilters, activeFilterCount } from '../../../shared/components/column-filter/column-filter.util';
import { TableColumnsConfigService } from '../../../core/services/table-columns-config.service';

interface ColumnConfig {
  field: string;
  label: string;
  visible: boolean;
  type?: 'text' | 'date' | 'number' | 'boolean';
}

const VIEW_MODE_KEY = 'sdgps_pieces_view_mode';

const PIECE_COLUMNS: ColumnConfig[] = [
  { field: 'ordre', label: '#', visible: true, type: 'number' },
  { field: 'type_piece_display', label: 'Type de pièce', visible: true, type: 'text' },
  { field: 'numero', label: 'N°', visible: false, type: 'number' },
  { field: 'portee_label', label: 'Portée', visible: true, type: 'text' },
  { field: 'source_saisie', label: 'Source', visible: true, type: 'text' },
  { field: 'statut', label: 'Statut', visible: true, type: 'text' },
  { field: 'commentaire', label: 'Commentaire', visible: false, type: 'text' },
  { field: 'created_at', label: 'Créé le', visible: false, type: 'date' },
  { field: 'updated_at', label: 'Modifié le', visible: false, type: 'date' },
  { field: 'is_deleted', label: 'Supprimé', visible: false, type: 'boolean' },
  { field: 'deleted_at', label: 'Supprimé le', visible: false, type: 'date' },
  { field: 'created_by_email', label: 'Créé par', visible: false, type: 'text' },
  { field: 'updated_by_email', label: 'Modifié par', visible: false, type: 'text' },
  { field: 'deleted_by_email', label: 'Supprimé par', visible: false, type: 'text' },
];

const SOURCE_LABELS: Record<string, string> = {
  manuel: 'Saisie manuelle', import: 'Import CSV/Excel', image: 'Upload image', ui: 'Généré automatiquement',
};
const STATUT_LABELS: Record<string, string> = { brouillon: 'Brouillon', valide: 'Validée', rejete: 'Rejetée' };

@Component({
  selector: 'app-piece-management-page',
  templateUrl: './piece-management-page.component.html',
  styleUrls: ['./piece-management-page.component.scss'],
})
export class PieceManagementPageComponent implements OnInit {
  loading = false;
  ssdgps!: Ssdgps;
  sessions: Session[] = [];
  catalog: PieceTypeDef[] = [];

  activePieces: Piece[] = [];
  deletedPieces: Piece[] = [];
  showDeleted = false;
  get items(): Piece[] { return this.scopeBySession(this.showDeleted ? this.deletedPieces : this.activePieces); }
  get activeCount(): number { return this.scopeBySession(this.activePieces).length; }
  get deletedCount(): number { return this.scopeBySession(this.deletedPieces).length; }

  /** En vue d'une session multi-session, ne garder que les pièces de cette session
   * plus les pièces communes (session nulle). Mono-session (pas de `currentSessionId`) :
   * liste inchangée. */
  private scopeBySession(list: Piece[]): Piece[] {
    if (!this.currentSessionId) return list;
    return list.filter(p => !p.session || p.session === this.currentSessionId);
  }

  // Vue Cartes / Tableau
  viewMode: 'cards' | 'table' = 'table';

  // Recherche & sélection
  searchText = '';
  selectedIds = new Set<string>();
  displayMode: 'all' | 'selected' = 'all';
  activeFieldFilter: string | null = null;
  activeFieldFilterLabel = '';
  fieldFilterValue = '';
  showFilterMenu = false;
  showFieldFilterMenu = false;

  // Tri / pin d'affichage (indépendant de l'ordre du rapport)
  sortColumn = 'ordre';
  sortDirection: 'asc' | 'desc' = 'asc';
  private manualOrder: string[] | null = null;

  @ViewChild(MultiLevelSortComponent) private sortCmp?: MultiLevelSortComponent;
  /** Ouvre la modale de tri (depuis un clic d'en-tête). */
  openSort(): void { this.sortCmp?.open(); }

  // --- Tri MULTI-NIVEAUX de la LISTE des pièces (config opérateur, héritée du super admin) ---
  // NB : distinct du tri des DONNÉES internes d'une pièce (Profil → Paramètres de tri des pièces).
  private readonly SORT_KEY = 'pieces';
  readonly sortableFields: SortableField[] = PIECE_COLUMNS.map(c => ({ field: c.field, label: c.label }));
  sortLevels: OrgSortLevel[] = [];
  savingSort = false;
  savedSortFlash = false;
  resettingSort = false;
  private sortSaveTimer: any;

  // Colonnes (vue Tableau) — config opérateur, héritée du super admin, via composant partagé
  columns: ColumnConfig[] = PIECE_COLUMNS.map(c => ({ ...c }));
  private readonly COLUMNS_KEY = 'pieces';
  @ViewChild(ColumnConfigComponent) private columnCfg?: ColumnConfigComponent;
  /** Description d'une colonne pour la modale partagée (référence stable). */
  describeColumn = (field: string): string => this.getFieldDescription(field);
  savingColumns = false;
  savedColumnsFlash = false;
  resettingColumns = false;
  private columnsSaveTimer: any;

  // Pagination (vue Tableau)
  currentPage = 1;
  pageSize = DEFAULT_PAGE_SIZE;
  pageSizeOptions = [...PAGE_SIZE_OPTIONS];

  // Suppression / restauration
  showDeleteModal = false;
  deleteTarget: Piece | null = null;
  isBulkDelete = false;
  deleting = false;
  showRestoreModal = false;
  restoreTarget: Piece | null = null;
  isBulkRestore = false;
  restoring = false;

  // Suppression définitive (corbeille)
  showPermanentDeleteModal = false;
  permanentDeleteTarget: Piece | null = null;
  isBulkPermanent = false;
  permanentDeleting = false;

  // Édition en masse du statut
  showStatusModal = false;
  bulkStatusValue = '';
  updatingStatus = false;
  statutOptions = Object.entries(STATUT_LABELS).map(([value, label]) => ({ value, label }));

  // Réordonnancement du rapport (glisser-déposer)
  draggedPieceIndex: number | null = null;
  dragOverPieceIndex: number | null = null;
  reordering = false;

  // Menu contextuel des lignes
  showRowContextMenu = false;
  contextMenuPosition = { x: 0, y: 0 };
  contextMenuPiece: Piece | null = null;
  contextMenuField: string | null = null;
  selectedCellValue: string | null = null;

  private boundHandleClickOutside!: (event: Event) => void;
  private projectId!: string;
  private proprieteId: string | null = null;
  private affaireId: string | null = null;
  currentSessionId: string | null = null;

  constructor(
    private projectsService: ProjectsService,
    private piecesService: PiecesService,
    private toast: ToastService,
    private router: Router,
    private route: ActivatedRoute,
    private breadcrumb: BreadcrumbService,
    private sortConfigService: TableSortConfigService,
    private columnsConfigService: TableColumnsConfigService,
  ) {}

  private projet: Projet | null = null;

  ngOnInit(): void {
    this.viewMode = (localStorage.getItem(VIEW_MODE_KEY) as 'cards' | 'table') || 'table';
    this.boundHandleClickOutside = this.handleGlobalClick.bind(this);
    document.addEventListener('click', this.boundHandleClickOutside);
    this.loadSortConfig();
    this.loadColumnsConfig();

    const ssdgpsId = this.route.snapshot.paramMap.get('ssdgpsId')!;
    this.projectId = this.route.snapshot.paramMap.get('id')!;
    this.proprieteId = this.route.snapshot.queryParamMap.get('proprieteId');
    this.affaireId = this.route.snapshot.queryParamMap.get('affaireId');
    this.currentSessionId = this.route.snapshot.queryParamMap.get('session');
    this.loading = true;
    forkJoin([
      this.projectsService.getSsdgpsById(ssdgpsId),
      this.projectsService.getSessions(ssdgpsId),
      this.piecesService.getCatalog(),
    ]).subscribe({
      next: ([ssdgps, sessions, catalog]) => {
        this.ssdgps = ssdgps;
        this.sessions = sessions;
        this.catalog = catalog;
        this.updateTopbarBreadcrumb();
        this.loadPieces();
      },
      error: () => { this.toast.error('Erreur', 'SSDGPS introuvable'); this.goBack(); },
    });

    // Nom du projet pour le fil d'Ariane (fetch séparé : son échec ne casse pas la page).
    this.projectsService.getProjet(this.projectId).subscribe({
      next: (p) => { this.projet = p; this.updateTopbarBreadcrumb(); },
      error: () => {},
    });
  }

  ngOnDestroy(): void {
    this.breadcrumb.clear();
    if (this.boundHandleClickOutside) document.removeEventListener('click', this.boundHandleClickOutside);
    this.stopReportTimer();
  }

  /**
   * Fil d'Ariane métier : Accueil › Projets › <Projet> › <Propriété> › <Affaire> ›
   * <SSDGPS N°x> › [Session N°y si multi-session] › Pièces. Les crumps Affaire / SSDGPS
   * ramènent à l'explorateur au bon niveau (via queryParams de restauration) quand le
   * contexte parent (propriété/affaire) est connu ; Propriété et Session sont affichés.
   */
  private updateTopbarBreadcrumb(): void {
    if (!this.ssdgps) return;
    const base = this.router.url.startsWith('/admin') ? '/admin/projets' : '/projets';
    const projRoute = `${base}/${this.projectId}`;
    const s = this.ssdgps as any;
    const hasParents = !!(this.proprieteId && this.affaireId);

    const trail: BreadcrumbItem[] = [
      { label: 'Accueil', route: '/home', icon: 'fa-house' },
      { label: 'Projets', route: base, icon: 'fa-folder-open' },
      { label: this.projet?.nom_projet || this.projet?.code_projet || 'Projet', route: projRoute, icon: 'fa-diagram-project' },
    ];
    // Propriété : TOUJOURS l'identifiant (titre foncier, sinon réquisition), jamais la
    // propriété-dite — cohérent avec le fil interne de l'explorateur (proprieteBreadcrumbLabel).
    // Cliquable → explorateur au niveau Affaire de cette propriété (restoreToAffaireLevel).
    const proprieteLabel = s.propriete_id_titre || s.propriete_id_requisition || s.propriete_nom;
    if (proprieteLabel) {
      trail.push({
        label: proprieteLabel, icon: 'fa-map-marker-alt',
        ...(this.proprieteId ? { route: projRoute, queryParams: { proprieteId: this.proprieteId } } : {}),
      });
    }
    if (s.affaire_numero != null) {
      trail.push({
        label: `SD ${s.affaire_numero}`, icon: 'fa-file-signature',
        ...(hasParents ? { route: projRoute, queryParams: { proprieteId: this.proprieteId, affaireId: this.affaireId } } : {}),
      });
    }
    trail.push({
      label: `SSDGPS ${this.ssdgps.numero_ssdgps}`, icon: 'fa-satellite-dish',
      ...(hasParents ? {
        route: projRoute,
        queryParams: this.isMultiSession
          ? { proprieteId: this.proprieteId, affaireId: this.affaireId, ssdgpsId: this.ssdgps.id }
          : { proprieteId: this.proprieteId, affaireId: this.affaireId },
      } : {}),
    });
    if (this.isMultiSession && this.currentSession) {
      trail.push({ label: `Session ${this.currentSession.numero_session}`, icon: 'fa-clock' });
    }
    trail.push({ label: 'Pièces', icon: 'fa-paperclip', isActive: true });
    this.breadcrumb.set(trail);
  }

  loadPieces(): void {
    this.loading = true;
    forkJoin([
      this.piecesService.listBySsdgps(this.ssdgps.id, false),
      this.piecesService.listBySsdgps(this.ssdgps.id, true),
    ]).subscribe({
      next: ([active, deleted]) => {
        this.activePieces = active;
        this.deletedPieces = deleted;
        this.manualOrder = null;
        this.selectedIds.clear();
        this.loading = false;
      },
      error: () => { this.toast.error('Erreur', 'Chargement des pièces impossible'); this.loading = false; },
    });
  }

  goBack(): void {
    const base = { proprieteId: this.proprieteId, affaireId: this.affaireId };
    if (this.ssdgps?.type_ssdgps === 'multi-session' && this.currentSessionId) {
      // Multi-session : retour à la liste des sessions du SSDGPS
      this.router.navigate(['/projets', this.projectId], {
        queryParams: { ...base, ssdgpsId: this.ssdgps!.id },
      });
    } else {
      // Mono-session ou pas de contexte session : retour au niveau SSDGPS
      this.router.navigate(['/projets', this.projectId], { queryParams: base });
    }
  }

  /** Remonte au niveau SSDGPS depuis le segment SSDGPS du fil d'Ariane (multi-session). */
  goBackToSsdgps(): void {
    this.router.navigate(['/projets', this.projectId], {
      queryParams: { proprieteId: this.proprieteId, affaireId: this.affaireId },
    });
  }

  get currentSession(): Session | undefined {
    return this.currentSessionId ? this.sessions.find(s => s.id === this.currentSessionId) : undefined;
  }

  toggleViewMode(mode: 'cards' | 'table'): void {
    this.viewMode = mode;
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }

  // ============================================
  // Onglets Actifs / Corbeille
  // ============================================
  setTab(deleted: boolean): void {
    if (this.showDeleted === deleted) return;
    this.showDeleted = deleted;
    this.selectedIds.clear();
    this.searchText = '';
    this.manualOrder = null;
    this.currentPage = 1;
  }

  // ============================================
  // Libellés / valeurs calculées
  // ============================================
  /** Vrai si le SSDGPS est multi-session : la notion de session (portée, sélecteur, n° de
   * session) n'a de sens que dans ce cas. En mono-session, aucune session n'est affichée. */
  get isMultiSession(): boolean { return this.ssdgps?.type_ssdgps === 'multi-session'; }

  /** Le niveau (SSDGPS commun / Session spécifique) est un choix libre par pièce,
   * matérialisé uniquement par la présence de `session` — indépendant du niveau
   * par défaut suggéré par le catalogue pour son type. Vide en mono-session (la portée
   * par session n'a pas de sens : une seule session implicite). */
  portee_label(p: Piece): string {
    if (!this.isMultiSession) return '';
    return p.session ? `Niveau Session — n°${p.session_numero ?? '?'}` : 'Niveau SSDGPS (commune)';
  }
  catalogDef(typePiece: string): PieceTypeDef | undefined { return this.catalog.find(d => d.code === typePiece); }
  /** Sélecteur de portée (rattachement à une session) : uniquement en multi-session et hors
   * corbeille. En mono-session, la session n'a pas de sens → pas de sélecteur. */
  showScopeSelector(p: Piece): boolean { return !p.is_deleted && this.isMultiSession; }
  sourceLabel(v: string): string { return SOURCE_LABELS[v] || v; }
  statutLabel(v: string): string { return STATUT_LABELS[v] || v; }
  statutBadgeClass(v: string): string {
    return { brouillon: 'badge-warning', valide: 'badge-success', rejete: 'badge-secondary' }[v] || 'badge-secondary';
  }
  /** Format unifié (cf. `date-format.util`) — passer le champ pour les dates sans heure. */
  formatDate(value: any, field?: string): string {
    return formatFieldDate(value, field);
  }

  changeScope(piece: Piece, sessionId: string): void {
    this.piecesService.setScope(piece.id, sessionId || null).subscribe({
      next: (updated) => { Object.assign(piece, updated); this.toast.success('Succès', 'Portée mise à jour'); },
      error: (e) => this.toast.error('Échec', e?.error?.session?.[0] || 'Changement de portée impossible'),
    });
  }

  // ============================================
  // Filtrage, tri, pagination (affichage)
  // ============================================
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

  get filteredItems(): Piece[] {
    let result = this.items;
    if (this.displayMode === 'selected') result = result.filter(p => this.selectedIds.has(p.id));
    if (this.searchText) {
      const q = this.searchText.toLowerCase();
      result = result.filter(p => (p.type_piece_display || '').toLowerCase().includes(q) || p.type_piece.toLowerCase().includes(q));
    }
    if (this.activeFieldFilter && this.fieldFilterValue) {
      const ff = this.activeFieldFilter;
      const fv = this.fieldFilterValue.toLowerCase();
      result = result.filter(p => {
        const val = this.getFieldRaw(p, ff);
        return val != null && String(val).toLowerCase().includes(fv);
      });
    }

    // Filtres de colonne (façon Excel).
    if (activeFilterCount(this.columnFilters)) {
      result = result.filter(p => rowMatchesColumnFilters(p, this.columnFilters, this.cellText));
    }
    if (this.manualOrder) {
      const idx = new Map(this.manualOrder.map((id, i) => [id, i]));
      result = [...result].sort((a, b) => {
        const ia = idx.has(a.id) ? idx.get(a.id)! : Number.MAX_SAFE_INTEGER;
        const ib = idx.has(b.id) ? idx.get(b.id)! : Number.MAX_SAFE_INTEGER;
        return ia - ib;
      });
    } else if (this.sortLevels.length) {
      // Le tri MULTI-NIVEAUX prime ; comparateur local (réutilise getFieldRaw pour portee_label).
      result = [...result].sort((a, b) => this.compareByLevelsPiece(a, b));
    } else {
      result = [...result].sort((a, b) => {
        const va = this.getFieldRaw(a, this.sortColumn);
        const vb = this.getFieldRaw(b, this.sortColumn);
        const cmp = va < vb ? -1 : va > vb ? 1 : 0;
        return this.sortDirection === 'asc' ? cmp : -cmp;
      });
    }
    return result;
  }

  get paginatedItems(): Piece[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredItems.slice(start, start + this.pageSize);
  }

  get totalPages(): number { return Math.max(1, Math.ceil(this.filteredItems.length / this.pageSize)); }
  get pageNumbers(): number[] {
    const pages: number[] = [];
    const start = Math.max(1, this.currentPage - 2);
    const end = Math.min(this.totalPages, this.currentPage + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }
  goToPage(page: number): void { if (page >= 1 && page <= this.totalPages) this.currentPage = page; }
  goToFirstPage(): void { this.goToPage(1); }
  goToLastPage(): void { this.goToPage(this.totalPages); }
  prevPage(): void { if (this.currentPage > 1) this.currentPage--; }
  nextPage(): void { if (this.currentPage < this.totalPages) this.currentPage++; }
  setPageSize(size: number): void { this.pageSize = size; this.currentPage = 1; }

  sortBy(field: string): void {
    this.manualOrder = null;
    if (this.sortColumn === field) this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    else { this.sortColumn = field; this.sortDirection = 'asc'; }
    this.currentPage = 1;
  }
  getSortIcon(field: string): string {
    if (this.sortColumn !== field) return 'fas fa-sort';
    return this.sortDirection === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
  }

  // --- Tri MULTI-NIVEAUX (config opérateur, héritée du super admin) — parité liste organisations ---
  sortLevelOf(field: string): number { return sortLevelOf(this.sortLevels, field); }
  sortDirOf(field: string): '' | 'asc' | 'desc' { return sortDirOf(this.sortLevels, field); }
  /** Comparateur multi-niveaux réutilisant `getFieldRaw` (gère `portee_label`). */
  private compareByLevelsPiece(a: Piece, b: Piece): number {
    for (const lvl of this.sortLevels) {
      const va = this.getFieldRaw(a, lvl.field);
      const vb = this.getFieldRaw(b, lvl.field);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      if (cmp !== 0) return lvl.dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  }

  private loadSortConfig(): void {
    this.sortConfigService.get(this.SORT_KEY).subscribe(levels => { this.sortLevels = levels; });
  }
  /** Réception d'une modification depuis la modale : applique + enregistrement auto (anti-rebond). */
  onSortLevelsChange(levels: OrgSortLevel[]): void {
    this.sortLevels = levels;
    this.manualOrder = null;
    this.currentPage = 1;
    clearTimeout(this.sortSaveTimer);
    this.sortSaveTimer = setTimeout(() => this.saveSortConfig(), 500);
  }
  private saveSortConfig(): void {
    this.savingSort = true;
    this.sortConfigService.save(this.SORT_KEY, this.sortLevels).subscribe({
      next: (saved) => {
        this.sortLevels = saved; this.savingSort = false; this.savedSortFlash = true;
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
        this.manualOrder = null; this.currentPage = 1;
        this.toast.success('Succès', 'Tri réinitialisé avec la configuration source');
      },
      error: (e) => {
        this.resettingSort = false;
        this.toast.error('Erreur', e?.error?.detail || 'Réinitialisation impossible');
      },
    });
  }

  private getFieldRaw(p: Piece, field: string): any {
    if (field === 'portee_label') return this.portee_label(p);
    const v = (p as any)[field];
    if (v == null) return '';
    return typeof v === 'string' ? v.toLowerCase() : v;
  }

  getCellValue(p: Piece, field: string): string {
    if (field === 'created_at' || field === 'updated_at' || field === 'deleted_at') return this.formatDate((p as any)[field]);
    if (field === 'is_deleted') return p.is_deleted ? 'Oui' : 'Non';
    if (field === 'portee_label') return this.portee_label(p);
    if (field === 'source_saisie') return this.sourceLabel(p.source_saisie);
    if (field === 'statut') return this.statutLabel(p.statut);
    return String((p as any)[field] ?? '—');
  }

  // ============================================
  // Recherche / filtre par champ (pied de page)
  // ============================================
  setDisplayMode(mode: 'all' | 'selected'): void { this.displayMode = mode; this.currentPage = 1; }
  toggleFilterMenu(): void { this.showFilterMenu = !this.showFilterMenu; }
  selectFieldForFilter(field: string, label: string): void {
    this.activeFieldFilter = field;
    this.activeFieldFilterLabel = label;
    this.fieldFilterValue = '';
    this.showFieldFilterMenu = false;
    this.showFilterMenu = false;
    this.currentPage = 1;
  }
  onFieldFilterInput(event: Event): void {
    this.fieldFilterValue = (event.target as HTMLInputElement).value;
    this.currentPage = 1;
  }
  clearFieldFilter(): void { this.activeFieldFilter = null; this.activeFieldFilterLabel = ''; this.fieldFilterValue = ''; }

  // ============================================
  // Sélection
  // ============================================
  isSelected(p: Piece): boolean { return this.selectedIds.has(p.id); }
  toggleSelect(p: Piece, ev: Event): void {
    ev.stopPropagation();
    this.selectedIds.has(p.id) ? this.selectedIds.delete(p.id) : this.selectedIds.add(p.id);
  }
  get selectedCount(): number { return this.selectedIds.size; }
  get isAllSelected(): boolean {
    const f = this.viewMode === 'table' ? this.paginatedItems : this.filteredItems;
    return f.length > 0 && f.every(p => this.selectedIds.has(p.id));
  }
  toggleSelectAll(): void {
    const f = this.viewMode === 'table' ? this.paginatedItems : this.filteredItems;
    if (this.isAllSelected) f.forEach(p => this.selectedIds.delete(p.id));
    else f.forEach(p => this.selectedIds.add(p.id));
  }
  selectAll(): void { this.filteredItems.forEach(p => this.selectedIds.add(p.id)); }
  deselectAll(): void { this.selectedIds.clear(); }
  invertSelection(): void {
    const f = this.viewMode === 'table' ? this.paginatedItems : this.filteredItems;
    f.forEach(p => this.selectedIds.has(p.id) ? this.selectedIds.delete(p.id) : this.selectedIds.add(p.id));
  }
  getSelectedList(): Piece[] { return this.items.filter(p => this.selectedIds.has(p.id)); }

  /** Épingle l'affichage courant (tri local uniquement) — distinct du réordonnancement
   * du rapport (§ ci-dessous), qui persiste `ordre` côté serveur. */
  pinSelectionToTop(): void {
    if (this.selectedIds.size === 0) return;
    const selected = this.filteredItems.filter(p => this.selectedIds.has(p.id)).map(p => p.id);
    const rest = this.filteredItems.filter(p => !this.selectedIds.has(p.id)).map(p => p.id);
    this.manualOrder = [...selected, ...rest];
  }

  // ============================================
  // Réordonnancement dans le rapport (ordre)
  // ============================================
  get reorderModeActive(): boolean {
    return this.sortColumn === 'ordre' && this.sortDirection === 'asc' && !this.manualOrder
      && !this.searchText && !this.activeFieldFilter && this.displayMode === 'all' && !this.showDeleted;
  }
  enableReorderMode(): void {
    this.searchText = '';
    this.activeFieldFilter = null;
    this.fieldFilterValue = '';
    this.displayMode = 'all';
    this.manualOrder = null;
    this.sortColumn = 'ordre';
    this.sortDirection = 'asc';
    this.showDeleted = false;
  }

  /** Reconstruit l'ordre complet des pièces actives du SSDGPS à partir du sous-ensemble
   * visible réordonné : l'endpoint reorder exige l'ensemble exact de toutes les pièces
   * actives. En vue session, seules les pièces visibles sont réordonnées ; les pièces
   * des autres sessions conservent leur emplacement. */
  private buildFullOrder(newOrder: Piece[]): string[] {
    const visibleIds = new Set(newOrder.map(p => p.id));
    const queue = [...newOrder];
    const full = [...this.activePieces].sort((a, b) => a.ordre - b.ordre);
    return full.map(p => (visibleIds.has(p.id) ? queue.shift()!.id : p.id));
  }

  private persistReorder(newOrder: Piece[]): void {
    if (this.reordering) return;
    this.reordering = true;
    this.piecesService.reorder(this.ssdgps.id, this.buildFullOrder(newOrder)).subscribe({
      next: (updated) => {
        this.reordering = false;
        const byId = new Map(updated.map(p => [p.id, p]));
        this.activePieces.forEach(p => { const u = byId.get(p.id); if (u) p.ordre = u.ordre; });
      },
      error: () => { this.reordering = false; this.toast.error('Erreur', 'Réordonnancement impossible'); this.loadPieces(); },
    });
  }

  private reorderList(piece: Piece, action: 'first' | 'prev' | 'next' | 'last'): void {
    const list = [...this.filteredItems];
    const i = list.findIndex(p => p.id === piece.id);
    if (i < 0) return;
    list.splice(i, 1);
    if (action === 'first') list.unshift(piece);
    else if (action === 'prev') list.splice(Math.max(0, i - 1), 0, piece);
    else if (action === 'next') list.splice(Math.min(list.length, i + 1), 0, piece);
    else list.push(piece);
    this.persistReorder(list);
  }
  moveFirst(p: Piece): void { this.reorderList(p, 'first'); }
  movePrevious(p: Piece): void { this.reorderList(p, 'prev'); }
  moveNext(p: Piece): void { this.reorderList(p, 'next'); }
  moveLast(p: Piece): void { this.reorderList(p, 'last'); }
  isFirst(p: Piece): boolean { return this.filteredItems[0]?.id === p.id; }
  isLast(p: Piece): boolean { return this.filteredItems[this.filteredItems.length - 1]?.id === p.id; }

  onPieceDragStart(index: number): void { if (this.reorderModeActive) this.draggedPieceIndex = index; }
  onPieceDragOver(event: DragEvent, index: number): void {
    if (!this.reorderModeActive) return;
    event.preventDefault();
    this.dragOverPieceIndex = index;
  }
  onPieceDragLeave(): void { this.dragOverPieceIndex = null; }
  onPieceDrop(index: number): void {
    if (!this.reorderModeActive || this.draggedPieceIndex === null || this.draggedPieceIndex === index) {
      this.draggedPieceIndex = null; this.dragOverPieceIndex = null; return;
    }
    const list = [...this.filteredItems];
    const [dragged] = list.splice(this.draggedPieceIndex, 1);
    list.splice(index, 0, dragged);
    this.draggedPieceIndex = null; this.dragOverPieceIndex = null;
    this.persistReorder(list);
  }
  onPieceDragEnd(): void { this.draggedPieceIndex = null; this.dragOverPieceIndex = null; }

  // ============================================
  // Colonnes (vue Tableau)
  // ============================================
  getVisibleColumns(): ColumnConfig[] {
    // En mono-session, la colonne « Portée » (session/commune) n'a pas de sens : on la masque.
    return this.columns.filter(c => c.visible && (this.isMultiSession || c.field !== 'portee_label'));
  }
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

  getTypeLabel(type?: string): string {
    return { text: 'TEXTE', date: 'DATE', number: 'NOMBRE', boolean: 'BOOLÉEN' }[type || 'text'] || 'TEXTE';
  }
  getFieldDescription(field: string): string {
    const d: Record<string, string> = {
      ordre: 'Position de la pièce dans le rapport SSDGPS',
      type_piece_display: 'Type de pièce (catalogue)',
      numero: 'Numéro (types répétables, ex. déterminations)',
      portee_label: 'Niveau de la pièce : SSDGPS (commune à toutes les sessions) ou Session (spécifique), modifiable librement',
      source_saisie: 'Origine des données de la pièce',
      statut: 'Statut de validation de la pièce',
      commentaire: 'Note ou remarque libre associée à la pièce',
      created_at: "Date de création de l'enregistrement",
      updated_at: "Date de dernière modification de l'enregistrement",
      is_deleted: "Indique si l'enregistrement a été supprimé (logique)",
      deleted_at: "Date de suppression de l'enregistrement",
      created_by_email: "Utilisateur ayant créé l'enregistrement",
      updated_by_email: "Utilisateur ayant modifié l'enregistrement en dernier",
      deleted_by_email: "Utilisateur ayant supprimé l'enregistrement",
    };
    return d[field] || '';
  }

  // ============================================
  // Export CSV
  // ============================================
  showExportMenu = false;
  toggleExportMenu(): void { this.showExportMenu = !this.showExportMenu; if (this.showExportMenu) this.showFilterMenu = false; }
  private csvEscape(v: any): string {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  exportCSV(onlySelected: boolean): void {
    const items = onlySelected ? this.getSelectedList() : this.filteredItems;
    const cols = this.columns.filter(c => c.visible);
    const header = cols.map(c => c.label).join(';');
    const rows = items.map(p => cols.map(c => this.csvEscape(this.getCellValue(p, c.field))).join(';'));
    const csv = '﻿' + [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pieces_ssdgps_${this.ssdgps.numero_ssdgps}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast.success('Export', `${items.length} pièce(s) exportée(s)`);
  }

  // ============================================
  // Génération du rapport PDF (modale + barre de progression)
  // ============================================
  showReportModal = false;
  reportGenerating = false;
  reportProgress = 0;
  reportError = '';
  reportFilename = '';
  /** Mode d'impression choisi dans la modale : recto-verso (défaut) ou recto seul. */
  reportDuplex = true;
  /** false = écran de configuration (choix du mode) ; true = génération lancée. */
  reportStarted = false;
  private reportBlob: Blob | null = null;
  private reportTimer: any = null;

  /** Nombre de pièces valides incluables dans le rapport (portée session comprise). */
  get validCount(): number {
    return this.scopeBySession(this.activePieces).filter(p => p.statut === 'valide').length;
  }

  /** Ouvre la modale en état « configuration » (choix du mode d'impression), sans générer. */
  openReportModal(): void {
    if (this.reportGenerating) return;
    this.showReportModal = true;
    this.reportStarted = false;
    this.reportError = '';
    this.reportBlob = null;
    this.reportFilename = '';
    this.reportProgress = 0;
  }

  /** Revient à l'écran de configuration (pour changer de mode et régénérer). */
  backToReportConfig(): void {
    if (this.reportGenerating) return;
    this.stopReportTimer();
    this.reportStarted = false;
    this.reportError = '';
    this.reportBlob = null;
    this.reportProgress = 0;
  }

  /** Lance la génération avec le mode choisi. Le backend produit le PDF en une seule
   * requête (pas de progression serveur) : la barre est donc simulée — elle progresse
   * jusqu'à ~90 % pendant l'attente, puis saute à 100 % à la réception du fichier. */
  generateReport(): void {
    if (this.reportGenerating) return;
    this.reportStarted = true;
    this.reportError = '';
    this.reportBlob = null;
    this.reportFilename = '';
    this.reportProgress = 0;
    this.reportGenerating = true;

    this.reportTimer = setInterval(() => {
      if (this.reportProgress < 90) {
        this.reportProgress = Math.min(90, this.reportProgress + Math.max(1, Math.round((90 - this.reportProgress) / 12)));
      }
    }, 200);

    this.piecesService.downloadReport(this.ssdgps.id, this.currentSessionId || undefined, this.reportDuplex).subscribe({
      next: (res) => {
        this.stopReportTimer();
        this.reportBlob = this.base64ToBlob(res.data, res.content_type || 'application/pdf');
        this.reportFilename = res.filename || `RAPPORT_SDGPS_SDGPS-N${this.ssdgps.numero_ssdgps}.pdf`;
        this.reportProgress = 100;
        this.reportGenerating = false;
      },
      error: (err) => {
        this.stopReportTimer();
        this.reportGenerating = false;
        this.reportProgress = 0;
        this.reportError = err?.error?.detail || 'Erreur lors de la génération du rapport.';
      },
    });
  }

  /** Reconstruit un Blob (PDF) à partir de la chaîne base64 renvoyée par le serveur. */
  private base64ToBlob(base64: string, type: string): Blob {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  private stopReportTimer(): void {
    if (this.reportTimer) { clearInterval(this.reportTimer); this.reportTimer = null; }
  }

  /** Télécharge le PDF déjà généré (blob en mémoire) via le bouton de la modale. */
  downloadReportFile(): void {
    if (!this.reportBlob) return;
    const url = URL.createObjectURL(this.reportBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.reportFilename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Ferme la modale (impossible tant que la génération est en cours). */
  closeReportModal(): void {
    if (this.reportGenerating) return;
    this.stopReportTimer();
    this.showReportModal = false;
    this.reportStarted = false;
    this.reportBlob = null;
  }


  // ============================================
  // Ajout de pièce
  // ============================================
  /** Ajout = page dédiée (l'assistant multi-images a besoin d'espace). */
  openAddWizard(): void { this.goToAddPage(); }

  // ============================================
  // Consultation / modification d'une pièce
  // ============================================
  /** Consultation et édition sont désormais des pages dédiées (comme l'ajout). */
  openDetail(p: Piece, ev: Event, mode: 'view' | 'edit' = 'view'): void {
    ev.stopPropagation();
    mode === 'edit' ? this.goToEditPage(p) : this.goToViewPage(p);
  }

  // --- Navigation vers les pages dédiées (ajout / consultation / édition) ---
  private pieceQueryParams(): { [k: string]: any } {
    return { proprieteId: this.proprieteId, affaireId: this.affaireId, session: this.currentSessionId };
  }
  private pieceBase(): any[] {
    return ['/projets', this.projectId, 'pieces', this.ssdgps.id];
  }
  goToAddPage(): void {
    this.router.navigate([...this.pieceBase(), 'ajouter'], { queryParams: this.pieceQueryParams() });
  }
  goToViewPage(p: Piece): void {
    this.router.navigate([...this.pieceBase(), 'piece', p.id], { queryParams: this.pieceQueryParams() });
  }
  goToEditPage(p: Piece): void {
    this.router.navigate([...this.pieceBase(), 'piece', p.id, 'modifier'], { queryParams: this.pieceQueryParams() });
  }

  // ============================================
  // Suppression (avec confirmation) / Restauration
  // ============================================
  openDeleteModal(p: Piece, ev: Event): void { ev.stopPropagation(); this.deleteTarget = p; this.isBulkDelete = false; this.showDeleteModal = true; }
  openBulkDeleteModal(): void { if (this.selectedCount === 0) return; this.deleteTarget = null; this.isBulkDelete = true; this.showDeleteModal = true; }
  closeDeleteModal(): void { if (!this.deleting) { this.showDeleteModal = false; this.deleteTarget = null; } }

  confirmDelete(): void {
    this.deleting = true;
    const finish = (n: number) => {
      this.deleting = false; this.showDeleteModal = false; this.deleteTarget = null;
      this.deselectAll(); this.loadPieces(); this.toast.success('Succès', `${n} pièce(s) supprimée(s)`);
    };
    const fail = () => { this.deleting = false; this.toast.error('Erreur', 'Suppression impossible'); };
    if (this.isBulkDelete) {
      const ids = Array.from(this.selectedIds);
      forkJoin(ids.map(id => this.piecesService.delete(id))).subscribe({ next: () => finish(ids.length), error: fail });
    } else if (this.deleteTarget) {
      this.piecesService.delete(this.deleteTarget.id).subscribe({ next: () => finish(1), error: fail });
    }
  }

  openRestoreModal(p: Piece): void { this.restoreTarget = p; this.isBulkRestore = false; this.showRestoreModal = true; }
  openBulkRestoreModal(): void { if (this.selectedCount === 0) return; this.restoreTarget = null; this.isBulkRestore = true; this.showRestoreModal = true; }
  closeRestoreModal(): void { if (!this.restoring) { this.showRestoreModal = false; this.restoreTarget = null; } }

  confirmRestore(): void {
    this.restoring = true;
    const finish = (n: number) => {
      this.restoring = false; this.showRestoreModal = false; this.restoreTarget = null;
      this.deselectAll(); this.loadPieces(); this.toast.success('Succès', `${n} pièce(s) restaurée(s)`);
    };
    const fail = () => { this.restoring = false; this.toast.error('Erreur', 'Restauration impossible'); };
    if (this.isBulkRestore) {
      const ids = Array.from(this.selectedIds);
      this.piecesService.bulkRestore(ids).subscribe({ next: (res) => finish(res.restored_count), error: fail });
    } else if (this.restoreTarget) {
      this.piecesService.restore(this.restoreTarget.id).subscribe({ next: () => finish(1), error: fail });
    }
  }

  // ============================================
  // Suppression définitive (irréversible)
  // ============================================
  openPermanentDeleteModal(p: Piece): void { this.permanentDeleteTarget = p; this.isBulkPermanent = false; this.showPermanentDeleteModal = true; }
  openBulkPermanentDeleteModal(): void { if (this.selectedCount === 0) return; this.permanentDeleteTarget = null; this.isBulkPermanent = true; this.showPermanentDeleteModal = true; }
  closePermanentDeleteModal(): void { if (!this.permanentDeleting) { this.showPermanentDeleteModal = false; this.permanentDeleteTarget = null; } }

  confirmPermanentDelete(): void {
    if (this.permanentDeleting) return;
    const close = () => { this.permanentDeleting = false; this.showPermanentDeleteModal = false; this.permanentDeleteTarget = null; };
    if (this.isBulkPermanent) {
      if (this.selectedCount === 0) return;
      this.permanentDeleting = true;
      const ids = Array.from(this.selectedIds);
      this.piecesService.bulkPermanentDelete(ids).subscribe({
        next: (res) => { close(); this.deselectAll(); this.loadPieces(); this.toast.success('Suppression définitive', `${res.deleted_count} pièce(s) supprimée(s) définitivement`); },
        error: () => { this.permanentDeleting = false; this.toast.error('Erreur', 'Suppression définitive impossible'); },
      });
    } else if (this.permanentDeleteTarget) {
      this.permanentDeleting = true;
      this.piecesService.permanentDelete(this.permanentDeleteTarget.id).subscribe({
        next: () => { close(); this.loadPieces(); this.toast.success('Suppression définitive', 'Pièce supprimée définitivement'); },
        error: (e) => { this.permanentDeleting = false; this.toast.error('Suppression impossible', e?.error?.detail || 'Suppression définitive impossible'); },
      });
    }
  }

  // ============================================
  // Édition en masse du statut
  // ============================================
  openBulkStatusModal(): void {
    if (this.selectedCount === 0) return;
    // Pré-sélectionne le statut commun si toutes les pièces sélectionnées le partagent.
    const statuts = new Set(this.getSelectedList().map(p => p.statut));
    this.bulkStatusValue = statuts.size === 1 ? [...statuts][0] : '';
    this.showStatusModal = true;
  }
  closeStatusModal(): void { if (!this.updatingStatus) { this.showStatusModal = false; } }

  confirmBulkStatus(): void {
    if (!this.bulkStatusValue || this.selectedCount === 0) return;
    // N'appelle l'API que sur les pièces dont le statut change réellement.
    const targets = this.getSelectedList().filter(p => p.statut !== this.bulkStatusValue);
    if (targets.length === 0) {
      this.toast.info('Aucun changement', 'Les pièces sélectionnées ont déjà ce statut.');
      this.showStatusModal = false;
      return;
    }
    this.updatingStatus = true;
    // Chaque PATCH peut échouer indépendamment (ex. validation PPA/PPN → « valide ») :
    // on isole les erreurs pour appliquer les statuts valides et rapporter les échecs.
    forkJoin(
      targets.map(p =>
        this.piecesService.update(p.id, { statut: this.bulkStatusValue } as Partial<Piece>).pipe(
          map(updated => ({ ok: true, piece: p, updated })),
          catchError(() => of({ ok: false, piece: p, updated: null as Piece | null })),
        ),
      ),
    ).subscribe(results => {
      const succeeded = results.filter(r => r.ok);
      const failed = results.filter(r => !r.ok);
      // Applique localement les mises à jour réussies sans recharger toute la liste.
      succeeded.forEach(r => { if (r.updated) Object.assign(r.piece, r.updated); });
      this.updatingStatus = false;
      this.showStatusModal = false;
      const label = this.statutLabel(this.bulkStatusValue);
      if (succeeded.length) this.toast.success('Statut mis à jour', `${succeeded.length} pièce(s) → « ${label} »`);
      if (failed.length) this.toast.error('Échecs', `${failed.length} pièce(s) non modifiée(s) (validation).`);
    });
  }

  // ============================================
  // Menu contextuel des lignes
  // ============================================
  onRowRightClick(event: MouseEvent, p: Piece, field: string | null = null): void {
    event.preventDefault(); event.stopPropagation();
    this.contextMenuPosition = { x: event.clientX, y: event.clientY };
    this.contextMenuPiece = p;
    this.contextMenuField = field;
    this.selectedCellValue = field ? this.getCellValue(p, field) : null;
    this.showRowContextMenu = true;
  }
  toggleSelectFromContext(): void { if (this.contextMenuPiece) this.toggleSelect(this.contextMenuPiece, new Event('click')); this.closeContextMenu(); }
  selectAllFromContext(): void { this.selectAll(); this.closeContextMenu(); }
  copyCellValueFromContext(): void {
    if (this.selectedCellValue != null) {
      navigator.clipboard.writeText(this.selectedCellValue).then(() => this.toast.success('Copié', 'Valeur copiée dans le presse-papier'));
    }
    this.closeContextMenu();
  }
  openDetailFromContext(mode: 'view' | 'edit' = 'view'): void {
    const p = this.contextMenuPiece;
    this.closeContextMenu();
    if (!p || p.is_deleted) return;
    mode === 'edit' ? this.goToEditPage(p) : this.goToViewPage(p);
  }
  openDeleteFromContext(): void {
    if (this.contextMenuPiece && !this.contextMenuPiece.is_deleted) { this.deleteTarget = this.contextMenuPiece; this.isBulkDelete = false; this.showDeleteModal = true; }
    this.closeContextMenu();
  }
  openRestoreFromContext(): void {
    if (this.contextMenuPiece?.is_deleted) this.openRestoreModal(this.contextMenuPiece);
    this.closeContextMenu();
  }
  closeContextMenu(): void { this.showRowContextMenu = false; this.contextMenuPiece = null; this.contextMenuField = null; }

  showColumnContextMenu = false;
  contextMenuColumn: ColumnConfig | null = null;
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
  openSortFromContext(): void { this.showColumnContextMenu = false; this.openSort(); }
  closeAllContextMenus(): void { this.showColumnContextMenu = false; this.contextMenuColumn = null; this.closeContextMenu(); }

  private handleGlobalClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.filter-menu-wrapper') && !target.closest('.context-menu') && !target.closest('.dropdown-container')) {
      this.showFilterMenu = false;
      this.showFieldFilterMenu = false;
      this.showExportMenu = false;
      this.closeAllContextMenus();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.showRowContextMenu || this.showColumnContextMenu) { this.closeAllContextMenus(); return; }
    if (this.showDeleteModal) { this.closeDeleteModal(); return; }
    if (this.showRestoreModal) { this.closeRestoreModal(); return; }
    if (this.showStatusModal) { this.closeStatusModal(); return; }
  }
}
