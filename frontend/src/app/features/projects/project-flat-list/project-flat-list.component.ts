import { Component, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, Observable, of, Subscription } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ProjectsService } from '../../../core/services/projects.service';
import { BreadcrumbService } from '../../../core/layout/services/breadcrumb.service';
import { ToastService } from '../../../core/services/toast.service';
import { TableSortConfigService } from '../../../core/services/table-sort-config.service';
import { TableColumnsConfigService } from '../../../core/services/table-columns-config.service';
import { OrgSortLevel } from '../../../core/services/org-sort-config.service';
import { Projet } from '../../../core/models/project.model';
import { MultiLevelSortComponent } from '../../../shared/components/multi-level-sort/multi-level-sort.component';
import { compareByLevels, sortLevelOf, sortDirOf } from '../../../shared/components/multi-level-sort/multi-level-sort.util';
import { ColumnConfigComponent } from '../../../shared/components/column-config/column-config.component';
import { applyColumnsConfig, toColumnPrefs, ManagedColumn } from '../../../shared/components/column-config/column-config.util';
import { ColumnFilterMap, withColumnFilter, rowMatchesColumnFilters } from '../../../shared/components/column-filter/column-filter.util';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../../../shared/components/table-pagination/table-pagination.component';
import { formatDateTime, formatFieldDate } from '../../../shared/utils/date-format.util';
import { NiveauEntite, projetsBase } from '../sous-niveaux-menu/sous-niveaux.util';
import { colonnesDe, descriptionDe, FlatColumn, NiveauPlat, NIVEAUX_PLATS, triablesDe } from './project-flat-list.config';

/** Portée de la vue : tout le projet, ou une propriété / une affaire / un SSDGPS. */
export interface PorteePlat { propriete?: string; affaire?: string; ssdgps?: string; }

/**
 * Vue à plat de TOUTES les propriétés, affaires ou sessions d'un projet — ou d'une
 * propriété, d'une affaire, d'un SSDGPS — sans parcourir la hiérarchie niveau par niveau.
 *
 * Même outillage que « Tous les SSDGPS » (règles de parité du dépôt) : onglets Actifs /
 * Corbeille, recherche, colonnes configurables (clé `flat_<niveau>`), tri multi-niveaux,
 * filtres de colonne, export CSV, sélection, suppression / restauration, pagination.
 * La création n'y est pas proposée : un élément se crée sous UN parent, dans l'explorateur.
 */
@Component({
  selector: 'app-project-flat-list',
  templateUrl: './project-flat-list.component.html',
  styleUrls: ['../project-ssdgps-list/project-ssdgps-list.component.scss', './project-flat-list.component.scss'],
})
export class ProjectFlatListComponent implements OnInit, OnDestroy {
  niveau!: NiveauPlat;
  projectId!: string;
  projet: Projet | null = null;
  portee: PorteePlat = {};
  /** Libellé du parent qui restreint la vue (« Propriété T1/A », « Affaire SD 3 »…). */
  porteeLabel = '';

  loading = true;
  private activeItems: any[] = [];
  private deletedItems: any[] = [];
  showDeleted = false;
  searchText = '';
  selectedIds = new Set<string>();
  restoring: string | null = null;
  busy = false;
  confirm: { kind: 'delete' | 'permanent'; ids: string[] } | null = null;

  columns: FlatColumn[] = [];
  @ViewChild(ColumnConfigComponent) private columnCfg?: ColumnConfigComponent;
  @ViewChild(MultiLevelSortComponent) private sortCmp?: MultiLevelSortComponent;
  savingColumns = false; savedColumnsFlash = false; resettingColumns = false;
  sortLevels: OrgSortLevel[] = [];
  savingSort = false; savedSortFlash = false; resettingSort = false;
  private sortTimer: any; private columnsTimer: any;
  columnFilters: ColumnFilterMap = {};

  pageSize = DEFAULT_PAGE_SIZE;
  currentPage = 1;
  pageSizeOptions = [...PAGE_SIZE_OPTIONS];
  private sub?: Subscription;

  describeColumn = (field: string): string => descriptionDe(this.niveau, field);
  cellText = (row: any, field: string): string => this.getCellValue(row, field);

  constructor(
    private service: ProjectsService,
    private toast: ToastService,
    private route: ActivatedRoute,
    private router: Router,
    private breadcrumb: BreadcrumbService,
    private sortConfig: TableSortConfigService,
    private columnsConfig: TableColumnsConfigService,
  ) {}

  get def() { return NIVEAUX_PLATS[this.niveau]; }
  get sortableFields() { return triablesDe(this.niveau); }
  /** Le menu « sous-niveaux » d'une ligne reçoit le niveau de l'entité affichée. */
  get niveauEntite(): NiveauEntite { return this.niveau; }

  ngOnInit(): void {
    // Une même instance sert plusieurs URL (passage d'une vue à plat à une autre) :
    // on réagit aux changements de paramètres plutôt qu'au seul instantané.
    this.sub = this.route.queryParamMap.subscribe(qp => {
      this.niveau = this.route.snapshot.data['niveau'];
      this.projectId = this.route.snapshot.paramMap.get('id')!;
      this.portee = {
        propriete: qp.get('propriete') || undefined,
        affaire: qp.get('affaire') || undefined,
        ssdgps: qp.get('ssdgps') || undefined,
      };
      this.columns = colonnesDe(this.niveau);
      this.columnFilters = {};
      this.selectedIds.clear();
      this.currentPage = 1;
      this.loadConfig();
      this.load();
    });
    this.service.getProjet(this.route.snapshot.paramMap.get('id')!).subscribe({
      next: p => { this.projet = p; this.updateBreadcrumb(); },
      error: () => {},
    });
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); this.breadcrumb.clear(); }

  // --- Chargement -------------------------------------------------------------------

  /** Paramètres de filtre : la portée la plus fine l'emporte. */
  filtres(): Record<string, string> {
    const p = this.portee;
    if (p.ssdgps) return { ssdgps: p.ssdgps };
    if (p.affaire) return { affaire: p.affaire };
    if (p.propriete) return { propriete: p.propriete };
    return { projet: this.projectId };
  }

  private fetch(extra: Record<string, any>): Observable<any[]> {
    const f = { ...this.filtres(), ...extra };
    switch (this.niveau) {
      case 'propriete': return this.service.getProprietes(this.projectId, extra);
      case 'affaire': return this.service.listAffaires(f);
      case 'session': return this.service.listSessions(f);
    }
  }

  load(): void {
    this.loading = true;
    forkJoin([this.fetch({}), this.fetch({ show_deleted: true })]).subscribe({
      next: ([actifs, supprimes]) => {
        this.activeItems = actifs; this.deletedItems = supprimes; this.loading = false;
        this.resolvePorteeLabel();
      },
      error: () => { this.loading = false; this.toast.error('Erreur', 'Chargement impossible'); },
    });
  }

  /** Libellé du parent, déduit des lignes (contexte parent renvoyé par l'API) ou chargé. */
  private resolvePorteeLabel(): void {
    const p = this.portee;
    const ligne = this.activeItems[0] || this.deletedItems[0];
    const propLabel = (o: any) => o?.propriete_id_titre || o?.propriete_id_requisition || o?.propriete_nom || '';
    if (p.ssdgps) {
      this.porteeLabel = ligne ? `SSDGPS n°${ligne.ssdgps_numero}` : 'SSDGPS';
    } else if (p.affaire) {
      this.porteeLabel = ligne ? `Affaire SD ${ligne.affaire_numero ?? ligne.numero_sd_affaire ?? ''} · ${propLabel(ligne)}` : 'Affaire';
    } else if (p.propriete) {
      this.porteeLabel = ligne && propLabel(ligne) ? `Propriété ${propLabel(ligne)}` : 'Propriété';
      if (!ligne || !propLabel(ligne)) {
        this.service.getPropriete(p.propriete).pipe(catchError(() => of(null))).subscribe(pr => {
          if (pr) this.porteeLabel = `Propriété ${pr.id_titre || pr.id_requisition || pr.nom_propriete}`;
          this.updateBreadcrumb();
        });
      }
    } else {
      this.porteeLabel = '';
    }
    this.updateBreadcrumb();
  }

  private updateBreadcrumb(): void {
    const base = projetsBase(this.router.url).slice(1).join('/');
    const trail: any[] = [
      { label: 'Accueil', route: '/home', icon: 'fa-house' },
      { label: 'Projets', route: '/' + base, icon: 'fa-folder-open' },
      { label: this.projet?.nom_projet || this.projet?.code_projet || 'Projet', route: `/${base}/${this.projectId}`, icon: 'fa-diagram-project' },
    ];
    if (this.porteeLabel) trail.push({ label: this.porteeLabel, icon: 'fa-filter' });
    trail.push({ label: this.def.titre, icon: this.def.icon, isActive: true });
    this.breadcrumb.set(trail);
  }

  // --- Configuration (tri + colonnes) ---------------------------------------------

  private loadConfig(): void {
    const cle = this.def.cle;
    this.columnsConfig.get(cle).subscribe(prefs => { this.columns = applyColumnsConfig(this.columns, prefs) as FlatColumn[]; });
    this.sortConfig.get(cle).subscribe(levels => { this.sortLevels = levels; });
  }
  openColumnConfig(): void { this.columnCfg?.open(); }
  openSortConfig(): void { this.sortCmp?.open(); }
  onColumnsChange(cols: ManagedColumn[]): void {
    this.columns = cols as FlatColumn[];
    clearTimeout(this.columnsTimer);
    this.columnsTimer = setTimeout(() => {
      this.savingColumns = true;
      this.columnsConfig.save(this.def.cle, toColumnPrefs(this.columns)).subscribe({
        next: () => { this.savingColumns = false; this.savedColumnsFlash = true; setTimeout(() => (this.savedColumnsFlash = false), 2500); },
        error: () => { this.savingColumns = false; this.toast.error('Erreur', 'Enregistrement des colonnes impossible'); },
      });
    }, 500);
  }
  onResetColumns(): void {
    this.resettingColumns = true;
    this.columnsConfig.resetToSource(this.def.cle).subscribe({
      next: prefs => { this.columns = applyColumnsConfig(colonnesDe(this.niveau), prefs) as FlatColumn[]; this.resettingColumns = false; },
      error: e => { this.resettingColumns = false; this.toast.error('Erreur', e?.error?.detail || 'Réinitialisation impossible'); },
    });
  }
  onSortLevelsChange(levels: OrgSortLevel[]): void {
    this.sortLevels = levels; this.currentPage = 1;
    clearTimeout(this.sortTimer);
    this.sortTimer = setTimeout(() => {
      this.savingSort = true;
      this.sortConfig.save(this.def.cle, this.sortLevels).subscribe({
        next: saved => { this.sortLevels = saved; this.savingSort = false; this.savedSortFlash = true; setTimeout(() => (this.savedSortFlash = false), 2500); },
        error: () => { this.savingSort = false; this.toast.error('Erreur', 'Enregistrement du tri impossible'); },
      });
    }, 500);
  }
  onResetSort(): void {
    this.resettingSort = true;
    this.sortConfig.resetToSource(this.def.cle).subscribe({
      next: levels => { this.sortLevels = levels; this.resettingSort = false; },
      error: e => { this.resettingSort = false; this.toast.error('Erreur', e?.error?.detail || 'Réinitialisation impossible'); },
    });
  }
  sortLevelOf(field: string): number { return sortLevelOf(this.sortLevels, field); }
  sortDirOf(field: string): '' | 'asc' | 'desc' { return sortDirOf(this.sortLevels, field); }
  hideColumnField(field: string): void { this.onColumnsChange(this.columns.map(c => (c.field === field ? { ...c, visible: false } : { ...c }))); }
  onColumnFilterChange(field: string, values: string[] | null): void { this.columnFilters = withColumnFilter(this.columnFilters, field, values); this.currentPage = 1; }
  get visibleColumns(): FlatColumn[] { return this.columns.filter(c => c.visible); }

  // --- Lignes -----------------------------------------------------------------------

  setTab(deleted: boolean): void { this.showDeleted = deleted; this.selectedIds.clear(); this.currentPage = 1; }
  get items(): any[] { return this.showDeleted ? this.deletedItems : this.activeItems; }
  get activeCount(): number { return this.activeItems.length; }
  get deletedCount(): number { return this.deletedItems.length; }

  /** Valeur de tri d'un champ calculé (libellés), sinon la valeur brute. */
  private sortRow = (row: any): any => ({
    ...row,
    propriete_label: this.getCellValue(row, 'propriete_label').toLowerCase(),
    id_propriete: (row.id_propriete || '').toLowerCase(),
    ssdgps_label: row.ssdgps_numero ?? 0,
  });

  get filteredItems(): any[] {
    const q = this.searchText.trim().toLowerCase();
    let rows = this.items.filter(r =>
      (!q || this.visibleColumns.some(c => this.getCellValue(r, c.field).toLowerCase().includes(q)))
      && rowMatchesColumnFilters(r, this.columnFilters, this.cellText));
    if (this.sortLevels.length) {
      rows = rows.map(r => ({ r, k: this.sortRow(r) }))
        .sort((a, b) => compareByLevels(a.k, b.k, this.sortLevels)).map(x => x.r);
    }
    return rows;
  }
  get paginatedItems(): any[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredItems.slice(start, start + this.pageSize);
  }
  get totalPages(): number { return Math.max(1, Math.ceil(this.filteredItems.length / this.pageSize)); }
  goToPage(p: number): void { this.currentPage = Math.min(Math.max(1, p), this.totalPages); }
  setPageSize(n: number): void { this.pageSize = n; this.currentPage = 1; }

  getCellValue(r: any, field: string): string {
    const propLabel = r.propriete_id_titre || r.propriete_id_requisition || r.propriete_nom;
    switch (field) {
      case 'propriete_label': return propLabel || '—';
      case 'id_propriete': return r.id_propriete || r.id_titre || r.id_requisition || '—';
      case 'ssdgps_label': return r.ssdgps_numero != null ? `SSDGPS n°${r.ssdgps_numero}` : '—';
      case 'affaire_numero': return r.affaire_numero != null ? `SD ${r.affaire_numero}` : '—';
      case 'numero_sd_affaire': return r.numero_sd_affaire != null ? `SD ${r.numero_sd_affaire}` : '—';
      case 'numero_session': return r.numero_session != null ? `Session n°${r.numero_session}` : '—';
      case 'date_bornage': case 'date_session': return formatFieldDate(r[field], field);
      case 'created_at': case 'updated_at': case 'deleted_at': return formatDateTime(r[field]);
      case 'is_deleted': return r.is_deleted ? 'Oui' : 'Non';
      default: { const v = r[field]; return v == null || v === '' ? '—' : String(v); }
    }
  }

  // --- Sélection --------------------------------------------------------------------

  toggleSelect(r: any, ev: Event): void { ev.stopPropagation(); this.selectedIds.has(r.id) ? this.selectedIds.delete(r.id) : this.selectedIds.add(r.id); }
  get isAllSelected(): boolean { return this.paginatedItems.length > 0 && this.paginatedItems.every(r => this.selectedIds.has(r.id)); }
  toggleSelectAll(): void {
    const all = this.isAllSelected;
    this.paginatedItems.forEach(r => (all ? this.selectedIds.delete(r.id) : this.selectedIds.add(r.id)));
  }

  // --- Navigation -------------------------------------------------------------------

  /** Ouvre l'élément là où il se travaille : l'explorateur au bon niveau, ou les pièces. */
  open(r: any): void {
    if (r.is_deleted) return;
    const base = [...projetsBase(this.router.url), this.projectId];
    if (this.niveau === 'propriete') {
      this.router.navigate(base, { queryParams: { proprieteId: r.id } });
    } else if (this.niveau === 'affaire') {
      this.router.navigate(base, { queryParams: { proprieteId: r.propriete, affaireId: r.id } });
    } else {
      this.router.navigate([...base, 'pieces', r.ssdgps], {
        queryParams: { proprieteId: r.propriete, affaireId: r.affaire, session: r.id },
      });
    }
  }
  /** Retire la portée : la même vue pour tout le projet. */
  elargir(): void {
    this.router.navigate([...projetsBase(this.router.url), this.projectId, this.niveau === 'session' ? 'sessions' : this.niveau === 'affaire' ? 'affaires' : 'proprietes']);
  }
  backToExplorer(): void { this.router.navigate([...projetsBase(this.router.url), this.projectId]); }

  // --- Suppression / restauration -----------------------------------------------------

  private api(): { del: (id: string) => Observable<any>; restore: (ids: string[]) => Observable<any>; purge: (ids: string[]) => Observable<any> } {
    const s = this.service;
    switch (this.niveau) {
      case 'propriete': return { del: id => s.deletePropriete(id), restore: ids => s.bulkRestoreProprietes(ids), purge: ids => s.bulkPermanentDeleteProprietes(ids) };
      case 'affaire': return { del: id => s.deleteAffaire(id), restore: ids => s.bulkRestoreAffaires(ids), purge: ids => s.bulkPermanentDeleteAffaires(ids) };
      default: return { del: id => s.deleteSession(id), restore: ids => s.bulkRestoreSessions(ids), purge: ids => s.bulkPermanentDeleteSessions(ids) };
    }
  }
  askDelete(ids: string[]): void { if (ids.length) this.confirm = { kind: 'delete', ids }; }
  askPermanent(ids: string[]): void { if (ids.length) this.confirm = { kind: 'permanent', ids }; }
  get selection(): string[] { return [...this.selectedIds]; }

  confirmAction(): void {
    if (!this.confirm || this.busy) return;
    const { kind, ids } = this.confirm;
    this.busy = true;
    const done = (msg: string) => { this.busy = false; this.confirm = null; this.selectedIds.clear(); this.toast.success('Succès', msg); this.load(); };
    const fail = (e: any) => { this.busy = false; this.toast.error('Erreur', e?.error?.detail || 'Action impossible'); };
    if (kind === 'delete') {
      forkJoin(ids.map(id => this.api().del(id))).subscribe({ next: () => done(`${ids.length} élément(s) mis à la corbeille`), error: fail });
    } else {
      this.api().purge(ids).subscribe({
        next: r => done(`${r.deleted_count || 0} supprimé(s) définitivement${(r.errors || []).length ? ` ; ${(r.errors || []).length} conservé(s) (sous-données rattachées)` : ''}`),
        error: fail,
      });
    }
  }

  restore(ids: string[]): void {
    if (!ids.length || this.busy) return;
    this.busy = true;
    this.api().restore(ids).subscribe({
      next: r => { this.busy = false; this.selectedIds.clear(); this.toast.success('Restauré', `${r.restored_count} élément(s) restauré(s)`); this.load(); },
      error: () => { this.busy = false; this.toast.error('Erreur', 'Restauration impossible'); },
    });
  }

  // --- Export CSV ---------------------------------------------------------------------

  exportCsv(): void {
    const cols = this.visibleColumns;
    const esc = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lignes = this.filteredItems.map(r => cols.map(c => esc(this.getCellValue(r, c.field))).join(';'));
    const csv = '﻿' + [cols.map(c => c.label).join(';'), ...lignes].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `${this.def.cle}_${this.projet?.code_projet || this.projectId}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void { if (!this.busy) this.confirm = null; }
}
