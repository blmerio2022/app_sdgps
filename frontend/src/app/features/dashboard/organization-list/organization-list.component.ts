import { formatDateTime } from '../../../shared/utils/date-format.util';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../../../shared/components/table-pagination/table-pagination.component';
import { Component, OnInit, ChangeDetectorRef, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { OrganizationService } from '../../../core/services/organization.service';
import { OrganizationMetadataService } from '../../../core/services/organization-metadata.service';
import { UserPreferencesService, ColumnMetadata } from '../../../core/services/user-preferences.service';
import { ToastService } from '../../../core/services/toast.service';
import { OrgSortConfigService, OrgSortLevel } from '../../../core/services/org-sort-config.service';
import { ColumnConfigComponent } from '../../../shared/components/column-config/column-config.component';
import { applyColumnsConfig, toColumnPrefs, ManagedColumn } from '../../../shared/components/column-config/column-config.util';
import { auditColumns, isAuditColumn, AUDIT_COLUMN_DESCRIPTIONS, AUDIT_COLUMN_LABELS, AUDIT_COLUMN_ORDER } from '../../../shared/components/column-config/audit-columns';
import { ColumnFilterMap, withColumnFilter, rowMatchesColumnFilters, activeFilterCount } from '../../../shared/components/column-filter/column-filter.util';
import { TableColumnsConfigService } from '../../../core/services/table-columns-config.service';
import { Organization } from '../../../core/models/organization.model';
import { MultiLevelSortComponent } from '../../../shared/components/multi-level-sort/multi-level-sort.component';
import { debounceTime, forkJoin, Subject } from 'rxjs';

interface ColumnConfig {
  field: keyof Organization;
  label: string;
  visible: boolean;
  width?: string;
  type?: 'text' | 'number' | 'date' | 'email' | 'boolean'; // Type de données
}

/** Colonnes triables (allowlist alignée sur le backend ORG_SORT_FIELDS), avec libellé. */
const SORTABLE_FIELDS: { field: string; label: string }[] = [
  { field: 'code', label: 'Code' },
  { field: 'name', label: 'Nom' },
  { field: 'type_display', label: 'Type' },
  { field: 'legal_id', label: 'ID Légal' },
  { field: 'address', label: 'Adresse' },
  { field: 'phone', label: 'Téléphone' },
  { field: 'email', label: 'Email' },
  { field: 'website', label: 'Site Web' },
  { field: 'is_active', label: 'Statut' },
  { field: 'member_count', label: 'Membres' },
  // Colonnes d'audit standard : libellés unifiés (cf. CLAUDE.md).
  ...AUDIT_COLUMN_ORDER.map(field => ({ field, label: AUDIT_COLUMN_LABELS[field] })),
];

@Component({
  selector: 'app-organization-list',
  templateUrl: './organization-list.component.html',
  styleUrls: ['./organization-list.component.scss']
})
export class OrganizationListComponent implements OnInit {
  // Exposer Math pour le template
  readonly Math = Math;
  
  organizations: Organization[] = [];
  filteredOrganizations: Organization[] = [];
  selectedOrganizations: Set<string> = new Set();  // IDs sont des strings (UUID)
  
  // Configuration des colonnes
  columns: ColumnConfig[] = [
    { field: 'code', label: 'Code', visible: true, width: '100px', type: 'text' },
    { field: 'name', label: 'Nom', visible: true, width: '200px', type: 'text' },
    { field: 'type_display', label: 'Type', visible: true, width: '150px', type: 'text' },
    { field: 'legal_id', label: 'ID Légal', visible: false, width: '120px', type: 'text' },
    { field: 'address', label: 'Adresse', visible: false, width: '200px', type: 'text' },
    { field: 'phone', label: 'Téléphone', visible: false, width: '130px', type: 'text' },
    { field: 'email', label: 'Email', visible: true, width: '200px', type: 'email' },
    { field: 'website', label: 'Site Web', visible: false, width: '180px', type: 'text' },
    { field: 'is_active', label: 'Statut', visible: true, width: '100px', type: 'boolean' },
    { field: 'member_count', label: 'Membres', visible: true, width: '90px', type: 'number' },
    // Colonnes d'audit standard (libellés unifiés via `auditColumns()`, cf. CLAUDE.md).
    ...(auditColumns() as unknown as ColumnConfig[]),
  ];

  // Tri mono-colonne (clic en-tête) — conservé comme repli quand aucun tri multi-niveaux.
  sortColumn: keyof Organization | null = null;
  sortDirection: 'asc' | 'desc' = 'asc';

  // --- Tri MULTI-NIVEAUX (config opérateur, héritée du super admin) — miroir des SSDGPS ---
  /** Niveaux de tri appliqués au tableau (niveau 0 = prioritaire). */
  sortLevels: OrgSortLevel[] = [];
  /** Champs triables proposés dans le panneau de configuration. */
  readonly sortableFields = SORTABLE_FIELDS;
  @ViewChild(MultiLevelSortComponent) private sortCmp?: MultiLevelSortComponent;
  savingSort = false;
  savedSortFlash = false;
  resettingSort = false;
  private sortSaveTimer: any;

  // Filtrage
  searchQuery: string = '';
  typeFilter: string = 'all';
  displayMode: 'all' | 'selected' = 'all';
  buttonLabel: string = 'Toutes les organisations'; // Texte affiché dans le bouton

  // Menus déroulants
  showExportMenu: boolean = false;
  showFilterMenu: boolean = false;
  showFieldFilterMenu: boolean = false;

  // Filtre par champ
  activeFieldFilter: string | null = null;
  activeFieldFilterLabel: string = '';
  fieldFilterValue: string = '';

  // Pagination
  currentPage: number = 1;
  pageSize: number = DEFAULT_PAGE_SIZE;
  pageSizeOptions: number[] = [...PAGE_SIZE_OPTIONS];

  // UI
  loading: boolean = false;
  private boundHandleClickOutside!: (event: Event) => void;

  // Métadonnées des champs (descriptions)
  fieldDescriptions: { [fieldName: string]: string } = {};

  // --- Configuration des COLONNES (config opérateur, héritée du super admin) — composant partagé ---
  private readonly COLUMNS_KEY = 'organizations';
  @ViewChild(ColumnConfigComponent) private columnCfg?: ColumnConfigComponent;
  /** Description d'une colonne pour la modale partagée (référence stable). */
  describeColumn = (field: string): string => this.getFieldDescription(field);
  savingColumns = false;
  savedColumnsFlash = false;
  resettingColumns = false;
  private columnsSaveTimer: any;

  // Menus contextuels (clic droit)
  showColumnContextMenu: boolean = false;
  showRowContextMenu: boolean = false;
  contextMenuPosition: { x: number; y: number } = { x: 0, y: 0 };
  selectedColumnForContext: ColumnConfig | null = null;
  selectedRowForContext: Organization | null = null;
  selectedCellForContext: { row: Organization; field: keyof Organization; value: any } | null = null;

  // Modal d'ajout d'organisation
  showAddOrgModal: boolean = false;
  addOrgForm!: FormGroup;
  submitting: boolean = false;

  // Modal de suppression
  showDeleteModal: boolean = false;
  organizationToDelete: Organization | null = null;
  deleting: boolean = false;

  // Modal de suppression en groupe
  showBulkDeleteModal: boolean = false;
  bulkDeleting: boolean = false;

  // Modal de détails d'organisation
  showDetailModal: boolean = false;
  organizationToView: Organization | null = null;

  // Modal d'édition d'organisation
  showEditModal: boolean = false;
  organizationToEdit: Organization | null = null;
  editOrgForm!: FormGroup;
  editing: boolean = false;

  // Onglets Actifs / Corbeille
  showDeleted = false;
  activeOrganizations: Organization[] = [];
  deletedOrganizations: Organization[] = [];
  get activeCount(): number { return this.activeOrganizations.length; }
  get deletedCount(): number { return this.deletedOrganizations.length; }

  // Modal de restauration (unitaire / masse)
  showRestoreModal = false;
  restoreTarget: Organization | null = null;
  isBulkRestore = false;
  restoring = false;

  // Modal de suppression définitive (unitaire / masse)
  showPermanentDeleteModal = false;
  permanentDeleteTarget: Organization | null = null;
  isBulkPermanent = false;
  permanentDeleting = false;

  get currentUserRole(): string {
    try {
      const token = localStorage.getItem('authToken');
      if (!token) return 'ROLE_ORGANISATION_AGENT';
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.platform_role || payload.role || 'ROLE_ORGANISATION_AGENT';
    } catch {
      return 'ROLE_ORGANISATION_AGENT';
    }
  }

  get canCreateOrganization(): boolean {
    return this.currentUserRole === 'ROLE_SUPER_ADMIN' || this.currentUserRole === 'ROLE_ADMIN_SYSTEME';
  }

  // Subject pour sauvegarde différée des préférences
  private savePreferencesSubject = new Subject<void>();

  constructor(
    private organizationService: OrganizationService, 
    private metadataService: OrganizationMetadataService,
    private preferencesService: UserPreferencesService,
    private cdr: ChangeDetectorRef,
    private fb: FormBuilder,
    private toastService: ToastService,
    private orgSortConfigService: OrgSortConfigService,
    private columnsConfigService: TableColumnsConfigService
  ) { }

  ngOnInit(): void {
    // Initialiser le formulaire d'ajout d'organisation
    this.initAddOrgForm();
    
    // Charger les métadonnées des colonnes depuis le backend
    this.loadColumnMetadata();
    
    // Configurer la sauvegarde différée des préférences (debounce 1 seconde)
    this.savePreferencesSubject.pipe(
      debounceTime(1000) // Attendre 1s après le dernier changement
    ).subscribe(() => {
      this.savePreferencesToBackend();
    });
    
    this.loadOrganizations();
    this.loadSortConfig();

    // Fermer les menus en cliquant en dehors
    this.boundHandleClickOutside = this.handleClickOutside.bind(this);
    document.addEventListener('click', this.boundHandleClickOutside);
  }

  ngOnDestroy(): void {
    // Sauvegarder avant destruction du composant
    this.savePreferencesToBackend();
    this.savePreferencesSubject.complete();
    
    // Nettoyer l'écouteur d'événements
    document.removeEventListener('click', this.boundHandleClickOutside);
  }

  private handleClickOutside(event: Event): void {
    const target = event.target as HTMLElement;
    // Fermer seulement si le clic n'est PAS dans un menu de filtrage ou un context-menu
    if (!target.closest('.filter-menu-wrapper') && !target.closest('.context-menu')) {
      this.closeAllMenus();
      this.closeAllContextMenus();
    }
  }

  loadOrganizations(): void {
    this.loading = true;
    // Charge les deux listes (actives + corbeille) pour alimenter les compteurs d'onglets ;
    // le tableau affiche celle de l'onglet courant.
    forkJoin({
      active: this.organizationService.getOrganizations(),
      deleted: this.organizationService.getOrganizations({ show_deleted: 'true' }),
    }).subscribe({
      next: ({ active, deleted }) => {
        this.activeOrganizations = active;
        this.deletedOrganizations = deleted;
        this.organizations = this.showDeleted ? deleted : active;
        this.applyFiltersAndSort();
        this.loading = false;
      },
      error: (err: any) => {
        console.error('❌ Erreur lors du chargement des organisations:', err);
        this.loading = false;
      }
    });
  }

  loadFieldDescriptions(): void {
    this.metadataService.getAllDescriptions().subscribe(descriptions => {
      this.fieldDescriptions = descriptions;
      console.log('📝 Descriptions des champs chargées:', Object.keys(descriptions).length);
    });
  }

  /**
   * Charger les métadonnées des colonnes depuis le backend
   * et initialiser la configuration des colonnes avec les labels du modèle Django
   */
  private loadColumnMetadata(): void {
    this.preferencesService.getColumnMetadata().subscribe({
      next: (metadataMap: Map<string, ColumnMetadata>) => {
        console.log('✅ Métadonnées reçues:', metadataMap.size, 'colonnes');
        
        // Mettre à jour les descriptions pour les infobulles AVANT de reconstruire les colonnes
        metadataMap.forEach((meta, fieldName) => {
          this.fieldDescriptions[fieldName] = meta.description;
        });
        console.log('📝 Descriptions mises à jour:', Object.keys(this.fieldDescriptions).length);
        
        // ENRICHIR le catalogue curé des colonnes (labels/type depuis le backend) SANS le remplacer.
        // Le catalogue `this.columns` est la source de vérité et doit rester STRICTEMENT aligné sur
        // l'allowlist backend `TABLE_COLUMN_FIELDS['organizations']` : y injecter tous les champs du
        // modèle (type, parent, logo, is_deleted, ...) ferait échouer la sauvegarde des colonnes
        // (400 « Colonne invalide ») à chaque modification.
        this.columns = this.columns.map(col => {
          const meta = metadataMap.get(col.field as string);
          if (!meta) return { ...col };
          // Les colonnes d'audit conservent leur libellé UNIFIÉ : le backend ne doit pas
          // réintroduire de variantes locales (« Email du créateur », ...). Cf. CLAUDE.md.
          const label = isAuditColumn(col.field as string) ? col.label : (meta.label || col.label);
          return { ...col, label, type: this.mapFieldType(meta.type) || col.type };
        });
        console.log('📊 Colonnes configurées:', this.columns.length);
        
        // Forcer la détection des changements pour afficher les descriptions
        this.cdr.markForCheck();
        
        // Charger ensuite les préférences utilisateur
        this.loadUserPreferences();
      },
      error: (error) => {
        console.error('❌ Erreur chargement métadonnées:', error);
        // Fallback : charger les descriptions depuis l'ancien service
        this.loadFieldDescriptions();
        // Puis charger les préférences
        this.loadUserPreferences();
      }
    });
  }

  /**
   * Mapper le type Django vers le type TypeScript
   */
  private mapFieldType(djangoType: string): 'text' | 'number' | 'date' | 'email' | 'boolean' {
    const typeMap: { [key: string]: 'text' | 'number' | 'date' | 'email' | 'boolean' } = {
      'CharField': 'text',
      'TextField': 'text',
      'IntegerField': 'number',
      'FloatField': 'number',
      'DecimalField': 'number',
      'EmailField': 'email',
      'BooleanField': 'boolean',
      'DateTimeField': 'date',
      'DateField': 'date',
      'URLField': 'text',
      'ImageField': 'text',
    };
    return typeMap[djangoType] || 'text';
  }

  /**
   * Charger les préférences utilisateur depuis le backend
   */
  private loadUserPreferences(): void {
    this.preferencesService.getTablePreferences().subscribe({
      next: (preferences) => {
        console.log('📥 Préférences chargées:', preferences);
        
        // La configuration des colonnes (visibilité + ordre) est désormais gérée par
        // TableColumnsConfigService (source super admin + réinitialisation). Cf. loadColumnsConfig().

        // Restaurer le tri
        if (preferences.sort_config && preferences.sort_config.column) {
          this.sortColumn = preferences.sort_config.column as keyof Organization;
          this.sortDirection = preferences.sort_config.direction || 'asc';
        }

        // Restaurer le mode d'affichage
        if (preferences.display_mode) {
          this.displayMode = preferences.display_mode as 'all' | 'selected';
        }

        // Appliquer les changements
        this.applyFiltersAndSort();
        this.loadColumnsConfig();
        this.cdr.markForCheck();
      },
      error: (error) => {
        console.error('❌ Erreur chargement préférences:', error);
        this.loadColumnsConfig();
      }
    });
  }

  /**
   * Déclencher la sauvegarde des préférences (avec debounce)
   */
  private triggerSavePreferences(): void {
    this.savePreferencesSubject.next();
  }

  /**
   * Sauvegarder les préférences vers le backend
   */
  private savePreferencesToBackend(): void {
    const preferences = {
      sort_config: {
        column: this.sortColumn,
        direction: this.sortDirection
      },
      display_mode: this.displayMode,
      active_filters: {
        searchQuery: this.searchQuery,
        activeFieldFilter: this.activeFieldFilter,
        fieldFilterValue: this.fieldFilterValue
      }
    };

    this.preferencesService.saveTablePreferences(preferences).subscribe({
      next: () => console.log('✅ Préférences sauvegardées'),
      error: (error) => console.error('❌ Erreur sauvegarde préférences:', error)
    });
  }

  /**
   * Récupère la description d'un champ pour affichage en infobulle
   */
  /**
   * Descriptions de repli par colonne (info-bulle + libellé de la modale « Organiser les colonnes »).
   * Reprennent les textes de l'ancienne modale inline pour garantir un descriptif MÊME quand les
   * métadonnées backend sont indisponibles. Le backend (`fieldDescriptions`) reste prioritaire.
   */
  private readonly COLUMN_DESCRIPTIONS: { [field: string]: string } = {
    code: "Code unique d'identification de l'organisation (ex : CAB-001, DIR-FIN)",
    name: "Nom officiel ou raison sociale de l'organisation",
    type_display: 'Catégorie : Cabinet privé/entreprise ou entité publique/administration',
    legal_id: 'Numéro de registre de commerce pour les privés ou numéro de décret pour les publics',
    address: "Adresse postale complète de l'organisation (rue, ville, code postal)",
    phone: 'Numéro de téléphone principal de contact (format international recommandé)',
    email: "Adresse email de contact principale ou générique de l'organisation",
    website: "URL du site web officiel de l'organisation (doit commencer par http:// ou https://)",
    is_active: "Statut d'activité de l'organisation",
    member_count: 'Nombre total de membres actifs appartenant à cette organisation',
    modified_by_email: 'Utilisateur ayant effectué la dernière modification de cette organisation',
    // Colonnes d'audit standard : descriptions unifiées (cf. CLAUDE.md).
    ...AUDIT_COLUMN_DESCRIPTIONS,
  };

  getFieldDescription(fieldName: string): string {
    // Les colonnes d'audit gardent TOUJOURS la description unifiée : le backend ne doit pas
    // réintroduire de variantes locales (« Date de création dans le système », ...).
    return AUDIT_COLUMN_DESCRIPTIONS[fieldName]
      || this.fieldDescriptions[fieldName]
      || this.COLUMN_DESCRIPTIONS[fieldName]
      || '';
  }

  // --- Configuration des COLONNES (composant partagé, source super admin + réinitialisation) ---

  /** Ouvre la modale d'organisation des colonnes (composant partagé). */
  openColumnConfig(): void { this.columnCfg?.open(); }

  private loadColumnsConfig(): void {
    this.columnsConfigService.get(this.COLUMNS_KEY).subscribe(prefs => {
      this.columns = applyColumnsConfig(this.columns, prefs);
      this.cdr.markForCheck();
    });
  }
  /** Réception d'une modif de colonnes (visibilité/ordre) : applique + enregistrement auto (anti-rebond). */
  onColumnsChange(cols: ManagedColumn[]): void {
    this.columns = cols as ColumnConfig[];
    clearTimeout(this.columnsSaveTimer);
    this.columnsSaveTimer = setTimeout(() => this.saveColumnsConfig(), 500);
    this.cdr.markForCheck();
  }
  private saveColumnsConfig(): void {
    this.savingColumns = true;
    this.columnsConfigService.save(this.COLUMNS_KEY, toColumnPrefs(this.columns)).subscribe({
      next: () => {
        this.savingColumns = false; this.savedColumnsFlash = true; this.cdr.markForCheck();
        setTimeout(() => { this.savedColumnsFlash = false; this.cdr.markForCheck(); }, 2500);
      },
      error: (err) => { this.savingColumns = false; this.cdr.markForCheck(); this.toastService.error('Erreur', err?.error?.detail || 'Enregistrement des colonnes impossible'); },
    });
  }
  /** Réinitialise les colonnes avec la configuration SOURCE (compte administrateur). */
  onResetColumns(): void {
    if (this.resettingColumns) return;
    this.resettingColumns = true;
    this.columnsConfigService.resetToSource(this.COLUMNS_KEY).subscribe({
      next: (prefs) => {
        this.columns = applyColumnsConfig(this.columns, prefs);
        this.resettingColumns = false; this.cdr.markForCheck();
        this.toastService.success('Succès', 'Colonnes réinitialisées avec la configuration source');
      },
      error: (e) => { this.resettingColumns = false; this.cdr.markForCheck(); this.toastService.error('Erreur', e?.error?.detail || 'Réinitialisation impossible'); },
    });
  }

  // --- Menus contextuels (clic droit) ---

  /**
   * Ouvrir le menu contextuel sur un en-tête de colonne
   */
  onColumnHeaderRightClick(event: MouseEvent, column: ColumnConfig): void {
    event.preventDefault();
    event.stopPropagation();
    
    this.selectedColumnForContext = column;
    this.contextMenuPosition = { x: event.clientX, y: event.clientY };
    this.showColumnContextMenu = true;
    this.showRowContextMenu = false;
  }

  /**
   * Ouvrir le menu contextuel sur une ligne
   */
  onRowRightClick(event: MouseEvent, org: Organization): void {
    event.preventDefault();
    event.stopPropagation();
    
    this.selectedRowForContext = org;
    this.contextMenuPosition = { x: event.clientX, y: event.clientY };
    this.showRowContextMenu = true;
    this.showColumnContextMenu = false;
  }

  /**
   * Ouvrir le menu contextuel sur une cellule
   */
  onCellRightClick(event: MouseEvent, org: Organization, field: keyof Organization): void {
    event.preventDefault();
    event.stopPropagation();
    
    const value = org[field];
    this.selectedCellForContext = { row: org, field, value };
    this.selectedRowForContext = org;
    this.contextMenuPosition = { x: event.clientX, y: event.clientY };
    this.showRowContextMenu = true;
    this.showColumnContextMenu = false;
  }

  /**
   * Fermer tous les menus contextuels
   */
  closeAllContextMenus(): void {
    this.showColumnContextMenu = false;
    this.showRowContextMenu = false;
    this.selectedColumnForContext = null;
    this.selectedRowForContext = null;
    this.selectedCellForContext = null;
  }

  /**
   * Masquer la colonne depuis le menu contextuel
   */
  hideColumnFromContext(): void {
    const field = this.selectedColumnForContext?.field;
    this.closeAllContextMenus();
    if (!field) return;
    this.onColumnsChange(this.columns.map(c => (c.field === field ? { ...c, visible: false } : { ...c })));
  }

  /**
   * Ouvrir la fenêtre d'organisation des colonnes depuis le menu contextuel
   */
  openColumnConfigFromContext(): void {
    this.closeAllContextMenus();
    this.openColumnConfig();
  }

  /**
   * Ouvrir la modale de tri multi-niveaux depuis le menu contextuel (clic droit en-tête).
   */
  openSortConfigFromContext(): void {
    this.closeAllContextMenus();
    this.openSortConfig();
  }

  /**
   * Sélectionner/Désélectionner la ligne depuis le menu contextuel
   */
  toggleRowSelectionFromContext(): void {
    if (this.selectedRowForContext) {
      this.toggleSelection(this.selectedRowForContext.id);
    }
    this.closeAllContextMenus();
  }

  /**
   * Sélectionner toutes les lignes depuis le menu contextuel
   */
  selectAllFromContext(): void {
    this.selectAll();
    this.closeAllContextMenus();
  }

  /**
   * Copier la valeur de la cellule depuis le menu contextuel
   */
  copyCellValueFromContext(): void {
    if (this.selectedCellForContext) {
      const value = this.selectedCellForContext.value;
      const textToCopy = value !== null && value !== undefined ? String(value) : '';
      
      navigator.clipboard.writeText(textToCopy).then(() => {
        console.log('✅ Valeur copiée:', textToCopy);
      }).catch(err => {
        console.error('❌ Erreur lors de la copie:', err);
      });
    }
    this.closeAllContextMenus();
  }

  openOrganizationDetailFromContext(): void {
    if (this.selectedRowForContext) {
      this.openOrganizationDetail(this.selectedRowForContext);
    }
    this.closeAllContextMenus();
  }

  openEditOrganizationFromContext(): void {
    if (this.selectedRowForContext) {
      this.openEditOrganization(this.selectedRowForContext);
    }
    this.closeAllContextMenus();
  }

  openDeleteConfirmationFromContext(): void {
    if (this.selectedRowForContext) {
      this.openDeleteConfirmation(this.selectedRowForContext);
    }
    this.closeAllContextMenus();
  }

  // --- Tri ---
  sort(column: keyof Organization): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
    this.applyFiltersAndSort();
    this.triggerSavePreferences(); // Sauvegarder le changement de tri
  }

  getSortIcon(column: keyof Organization): string {
    if (this.sortColumn !== column) return 'fas fa-sort';
    return this.sortDirection === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
  }

  // ============================================
  // Tri MULTI-NIVEAUX (config opérateur, héritée du super admin) — miroir des SSDGPS
  // ============================================
  /** Charge le tri multi-niveaux de l'opérateur (hérité du super admin par défaut). */
  private loadSortConfig(): void {
    this.orgSortConfigService.get().subscribe(levels => {
      this.sortLevels = levels;
      this.applyFiltersAndSort();
      this.cdr.markForCheck();
    });
  }

  /** Comparateur multi-niveaux : parcourt les niveaux dans l'ordre, le premier départage. */
  private compareByLevels(a: Organization, b: Organization): number {
    for (const lvl of this.sortLevels) {
      const va = this.fieldSortValue(a, lvl.field);
      const vb = this.fieldSortValue(b, lvl.field);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      if (cmp !== 0) return lvl.dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  }
  private fieldSortValue(o: Organization, field: string): number | string {
    const v = (o as any)[field];
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

  /** Réception d'une modification depuis la modale partagée : applique + enregistrement auto. */
  onSortLevelsChange(levels: OrgSortLevel[]): void {
    this.sortLevels = levels;
    this.currentPage = 1;
    this.applyFiltersAndSort();
    clearTimeout(this.sortSaveTimer);
    this.sortSaveTimer = setTimeout(() => this.saveSortConfig(), 500);
  }
  private saveSortConfig(): void {
    this.savingSort = true;
    this.orgSortConfigService.save(this.sortLevels).subscribe({
      next: (saved) => {
        this.sortLevels = saved; this.savingSort = false; this.savedSortFlash = true;
        this.applyFiltersAndSort();
        setTimeout(() => { this.savedSortFlash = false; }, 2500);
      },
      error: (err) => { this.savingSort = false; this.toastService.error('Erreur', err?.error?.detail || 'Enregistrement du tri impossible'); },
    });
  }

  // --- Réinitialisation avec la configuration SOURCE (compte administrateur) ---
  onResetSort(): void {
    if (this.resettingSort) return;
    this.resettingSort = true;
    this.orgSortConfigService.resetToSource().subscribe({
      next: (levels) => {
        this.sortLevels = levels; this.resettingSort = false;
        this.currentPage = 1; this.applyFiltersAndSort();
        this.toastService.success('Succès', 'Tri réinitialisé avec la configuration source');
      },
      error: (e) => {
        this.resettingSort = false;
        this.toastService.error('Erreur', e?.error?.detail || 'Réinitialisation impossible');
      },
    });
  }

  // --- Gestion des menus ---
  toggleExportMenu(): void {
    this.showExportMenu = !this.showExportMenu;
    if (this.showExportMenu) {
      this.showFilterMenu = false;
    }
  }

  toggleFilterMenu(): void {
    this.showFilterMenu = !this.showFilterMenu;
    if (this.showFilterMenu) {
      this.showExportMenu = false;
    }
  }

  setDisplayMode(mode: 'all' | 'selected'): void {
    this.displayMode = mode;
    // Mettre à jour le texte du bouton selon l'option choisie
    if (mode === 'all') {
      this.buttonLabel = 'Toutes les organisations';
    } else if (mode === 'selected') {
      this.buttonLabel = 'N\'afficher que les organisations sélectionnées';
    }
    this.applyFiltersAndSort();
    this.triggerSavePreferences(); // Sauvegarder le changement de mode
    // Forcer la détection des changements pour mettre à jour le texte du bouton
    this.cdr.markForCheck();
  }

  getDisplayModeLabel(): string {
    switch (this.displayMode) {
      case 'selected':
        return `Sélectionnées (${this.selectedOrganizations.size})`;
      case 'all':
      default:
        return 'Toutes les organisations';
    }
  }

  // --- Gestion du filtre par champ ---
  onFieldFilterMenuLeave(): void {
    // Délai pour permettre le clic avant de fermer
    setTimeout(() => {
      this.showFieldFilterMenu = false;
    }, 200);
  }

  selectFieldForFilter(field: string, label: string): void {
    this.activeFieldFilter = field;
    this.activeFieldFilterLabel = label;
    this.fieldFilterValue = '';
    // Mettre à jour le texte du bouton
    this.buttonLabel = `Filtre sur ${label}`;
    this.showFieldFilterMenu = false;
    this.showFilterMenu = false;
    this.applyFiltersAndSort();
    // Forcer la détection des changements
    this.cdr.markForCheck();
  }

  onFieldFilterInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.fieldFilterValue = input.value;
    this.applyFiltersAndSort();
  }

  clearFieldFilter(): void {
    this.activeFieldFilter = null;
    this.activeFieldFilterLabel = '';
    this.fieldFilterValue = '';
    // Remettre le texte du bouton à "Toutes les organisations"
    this.buttonLabel = 'Toutes les organisations';
    this.displayMode = 'all';
    this.applyFiltersAndSort();
    // Forcer la détection des changements
    this.cdr.markForCheck();
  }

  closeAllMenus(): void {
    this.showExportMenu = false;
    this.showFilterMenu = false;
  }
  onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchQuery = input.value;
    this.applyFiltersAndSort();
    this.triggerSavePreferences(); // Sauvegarder le changement de filtre
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.applyFiltersAndSort();
  }

  onSearchChange(): void {
    this.applyFiltersAndSort();
  }

  onTypeFilterChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.typeFilter = select.value;
    this.applyFiltersAndSort();
  }

  // --- FILTRES DE COLONNE (façon Excel, composant partagé `<app-column-filter>`) ---
  /** Valeurs retenues par colonne ; une colonne absente n'est pas filtrée. */
  columnFilters: ColumnFilterMap = {};

  /** Texte affiché d'une cellule — doit refléter le rendu du tableau (référence stable). */
  cellText = (row: any, field: string): string => {
    if (field === 'type_display') return this.formatTypeDisplay(row.type, row.type_display);
    if (field === 'is_active') return this.getStatusText(row.is_active);
    if (field === 'is_deleted') return row.is_deleted ? 'Oui' : 'Non';
    if (field === 'created_at' || field === 'updated_at' || field === 'deleted_at') {
      return this.formatDate(row[field]);
    }
    const v = row[field];
    return v != null && v !== '' ? String(v) : '-';
  };

  onColumnFilterChange(field: string, values: string[] | null): void {
    this.columnFilters = withColumnFilter(this.columnFilters, field, values);
    this.applyFiltersAndSort();
  }

  /** Masque une colonne (depuis le menu de filtre) — auto-save comme la modale des colonnes. */
  hideColumnField(field: string): void {
    this.onColumnsChange(this.columns.map(c => (c.field === field ? { ...c, visible: false } : { ...c })));
  }

  private applyFiltersAndSort(): void {
    let result = [...this.organizations];

    // Filtres de colonne (ET entre colonnes, OU entre valeurs d'une même colonne).
    if (activeFilterCount(this.columnFilters)) {
      result = result.filter(org => rowMatchesColumnFilters(org, this.columnFilters, this.cellText));
    }

    // Filtre par mode d'affichage
    if (this.displayMode === 'selected') {
      result = result.filter(org => this.selectedOrganizations.has(org.id));
    }

    // Filtre par recherche globale
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      result = result.filter(org => 
        org.name.toLowerCase().includes(query) || 
        org.code.toLowerCase().includes(query) ||
        (org.email && org.email.toLowerCase().includes(query))
      );
    }

    // Filtre par type
    if (this.typeFilter !== 'all') {
      result = result.filter(org => org.type === this.typeFilter);
    }

    // Filtre par champ spécifique
    if (this.activeFieldFilter && this.fieldFilterValue) {
      const filterValue = this.fieldFilterValue.toLowerCase();
      result = result.filter(org => {
        const fieldValue = org[this.activeFieldFilter as keyof Organization];
        if (fieldValue == null) return false;
        return String(fieldValue).toLowerCase().includes(filterValue);
      });
    }

    // Tri : le tri MULTI-NIVEAUX prime ; à défaut, repli sur le tri mono-colonne (clic en-tête).
    if (this.sortLevels.length) {
      result.sort((a, b) => this.compareByLevels(a, b));
    } else if (this.sortColumn) {
      result.sort((a, b) => {
        const valueA = a[this.sortColumn as keyof Organization];
        const valueB = b[this.sortColumn as keyof Organization];

        if (valueA == null) return 1;
        if (valueB == null) return -1;

        let comparison = 0;
        if (typeof valueA === 'string' && typeof valueB === 'string') {
          comparison = valueA.localeCompare(valueB);
        } else if (typeof valueA === 'number' && typeof valueB === 'number') {
          comparison = valueA - valueB;
        } else {
          comparison = String(valueA).localeCompare(String(valueB));
        }

        return this.sortDirection === 'asc' ? comparison : -comparison;
      });
    }

    this.filteredOrganizations = result;
  }

  // --- Sélection ---
  toggleSelection(orgId: string): void {
    if (this.selectedOrganizations.has(orgId)) {
      this.selectedOrganizations.delete(orgId);
    } else {
      this.selectedOrganizations.add(orgId);
    }
  }

  selectAll(): void {
    this.filteredOrganizations.forEach(org => {
      this.selectedOrganizations.add(org.id);
    });
  }

  deselectAll(): void {
    this.selectedOrganizations.clear();
  }

  invertSelection(): void {
    const newSelection = new Set<string>();
    this.filteredOrganizations.forEach(org => {
      if (!this.selectedOrganizations.has(org.id)) {
        newSelection.add(org.id);
      }
    });
    this.selectedOrganizations = newSelection;
  }

  moveSelectionToTop(): void {
    if (this.selectedOrganizations.size === 0) return;
    
    const selected = this.organizations.filter(org => 
      this.selectedOrganizations.has(org.id)
    );
    const notSelected = this.organizations.filter(org => 
      !this.selectedOrganizations.has(org.id)
    );
    
    this.organizations = [...selected, ...notSelected];
    this.applyFiltersAndSort();
  }

  toggleSelectAll(): void {
    if (this.selectedOrganizations.size === this.filteredOrganizations.length) {
      this.deselectAll();
    } else {
      this.selectAll();
    }
  }

  isAllSelected(): boolean {
    return this.filteredOrganizations.length > 0 && 
           this.selectedOrganizations.size === this.filteredOrganizations.length;
  }

  getTypeLabel(type?: string): string {
    const labels: { [key: string]: string } = {
      'text': 'Texte',
      'number': 'Nombre',
      'date': 'Date',
      'email': 'Email',
      'boolean': 'Booléen'
    };
    return labels[type || 'text'] || 'Texte';
  }

  // --- Actions ---
  deleteOrganization(orgId: string): void {
    const org = this.organizations.find(o => o.id === orgId);
    if (!org) return;

    if (confirm(`Êtes-vous sûr de vouloir supprimer l'organisation "${org.name}" ?`)) {
      // TODO: Implémenter la suppression via API
      console.log('Suppression de l\'organisation:', orgId);
      
      // Supprimer localement pour l'instant
      this.organizations = this.organizations.filter(o => o.id !== orgId);
      this.selectedOrganizations.delete(orgId);
      this.applyFiltersAndSort();
    }
  }

  deleteSelected(): void {
    if (this.selectedOrganizations.size === 0) return;
    
    if (confirm(`Êtes-vous sûr de vouloir supprimer ${this.selectedOrganizations.size} organisation(s) ?`)) {
      // TODO: Implémenter la suppression via API
      console.log('Suppression des organisations:', Array.from(this.selectedOrganizations));
      this.selectedOrganizations.clear();
    }
  }

  exportToExcel(selectedOnly: boolean = false): void {
    const dataToExport = selectedOnly 
      ? this.organizations.filter(org => this.selectedOrganizations.has(org.id))
      : this.organizations;

    if (dataToExport.length === 0) {
      alert('Aucune donnée à exporter');
      return;
    }

    // Créer le contenu CSV
    const headers = [
      'Code',
      'Nom',
      'Type',
      'ID Légal',
      'Adresse',
      'Téléphone',
      'Email',
      'Site Web',
      'Statut',
      'Membres',
      'Créé par',
      'Date Création',
      'Date Modification'
    ];

    const rows = dataToExport.map(org => [
      org.code,
      org.name,
      org.type_display,
      org.legal_id || '',
      org.address || '',
      org.phone || '',
      org.email || '',
      org.website || '',
      org.is_active ? 'Actif' : 'Inactif',
      org.member_count,
      org.created_by_email || '',
      this.formatDate(org.created_at),
      this.formatDate(org.updated_at)
    ]);

    // Convertir en CSV avec BOM pour Excel
    const csvContent = [
      headers.join(';'),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(';'))
    ].join('\n');

    // Ajouter le BOM UTF-8 pour qu'Excel reconnaisse l'encodage
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    
    // Créer le lien de téléchargement
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = selectedOnly 
      ? `organisations_selectionnees_${timestamp}.csv`
      : `toutes_organisations_${timestamp}.csv`;
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // --- Utilitaires ---
  getVisibleColumns(): ColumnConfig[] {
    return this.columns.filter(col => col.visible);
  }

  getStatusBadgeClass(isActive: boolean): string {
    return isActive ? 'badge badge-success' : 'badge badge-danger';
  }

  getStatusText(isActive: boolean): string {
    return isActive ? 'Active' : 'Inactive';
  }

  getTypeBadgeClass(type: string): string {
    return type === 'PRIVATE' ? 'badge badge-primary' : 'badge badge-info';
  }

  formatTypeDisplay(typeValue: string | undefined, fullLabel: string): string {
    if (typeValue === 'PUBLIC') return 'Administration';
    if (typeValue === 'PRIVATE') return 'Entreprise';
    return fullLabel;
  }

  formatDate(dateString: string): string {
    return formatDateTime(dateString, '-');
  }

  // --- Pagination ---
  get paginatedOrganizations(): Organization[] {
    const startIndex = (this.currentPage - 1) * this.pageSize;
    const endIndex = startIndex + this.pageSize;
    return this.filteredOrganizations.slice(startIndex, endIndex);
  }

  get totalPages(): number {
    return Math.ceil(this.filteredOrganizations.length / this.pageSize);
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
    }
  }

  goToFirstPage(): void {
    this.goToPage(1);
  }

  goToLastPage(): void {
    this.goToPage(this.totalPages);
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }

  prevPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  setPageSize(size: number): void {
    this.pageSize = size;
    this.currentPage = 1;
  }

  getPageNumbers(): number[] {
    const pages: number[] = [];
    const maxVisible = 5;
    let start = Math.max(1, this.currentPage - Math.floor(maxVisible / 2));
    let end = Math.min(this.totalPages, start + maxVisible - 1);
    
    if (end - start < maxVisible - 1) {
      start = Math.max(1, end - maxVisible + 1);
    }
    
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    
    return pages;
  }

  // ==========================================
  // GESTION DU FORMULAIRE D'AJOUT D'ORGANISATION
  // ==========================================

  /**
   * Initialiser le formulaire réactif d'ajout d'organisation
   */
  private initAddOrgForm(): void {
    this.addOrgForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(3)]],
      code: ['', [
        Validators.required,
        Validators.pattern(/^[A-Z0-9\-]+$/)
      ]],
      type: ['', Validators.required],
      legal_id: [''],
      address: [''],
      phone: ['', Validators.pattern(/^[\+]?[0-9\s\-]{8,15}$/)],
      email: ['', Validators.email],
      website: ['', Validators.pattern(/^https?:\/\/.+/)],
      is_active: [true]
    });
  }

  /**
   * Ouvrir la modale d'ajout d'organisation
   */
  openAddOrganizationModal(): void {
    this.showAddOrgModal = true;
    this.initAddOrgForm(); // Réinitialiser le formulaire
    document.body.style.overflow = 'hidden'; // Empêcher le scroll du body
  }

  /**
   * Fermer la modale d'ajout d'organisation
   */
  closeAddOrganizationModal(): void {
    if (!this.submitting) {
      this.showAddOrgModal = false;
      this.addOrgForm.reset();
      document.body.style.overflow = ''; // Réactiver le scroll
    }
  }

  /**
   * Soumettre le formulaire d'ajout d'organisation
   */
  onSubmitAddOrganization(): void {
    if (this.addOrgForm.invalid || this.submitting) {
      // Marquer tous les champs comme touchés pour afficher les erreurs
      Object.keys(this.addOrgForm.controls).forEach(key => {
        const control = this.addOrgForm.get(key);
        control?.markAsTouched();
      });
      
      // Afficher un toast d'erreur si formulaire invalide
      this.toastService.error(
        'Formulaire Invalide',
        'Veuillez corriger les erreurs avant de soumettre.'
      );
      return;
    }

    this.submitting = true;

    // Préparer les données
    const formData = this.addOrgForm.value;
    const newOrganization: Partial<Organization> = {
      name: formData.name.trim(),
      code: formData.code.trim().toUpperCase(),
      type: formData.type,
      legal_id: formData.legal_id?.trim() || null,
      address: formData.address?.trim() || null,
      phone: formData.phone?.trim() || null,
      email: formData.email?.trim() || null,
      website: formData.website?.trim() || null,
      is_active: formData.is_active
    };

    console.log('📤 Création de l\'organisation:', newOrganization);

    // Appel API pour créer l'organisation
    this.organizationService.createOrganization(newOrganization).subscribe({
      next: (createdOrg: Organization) => {
        console.log('✅ Organisation créée avec succès:', createdOrg);
        
        // Mettre submitting à false AVANT de fermer
        this.submitting = false;
        
        // Fermer la modale
        this.showAddOrgModal = false;
        this.addOrgForm.reset();
        document.body.style.overflow = '';
        
        // Recharger la liste des organisations
        this.loadOrganizations();
        
        // Afficher un toast de succès
        this.toastService.success(
          'Organisation Ajoutée',
          `L'organisation "${createdOrg.name}" a été ajoutée avec succès.`
        );
      },
      error: (error) => {
        console.error('❌ Erreur lors de la création:', error);
        
        let errorMessage = 'Une erreur est survenue lors de la création.';
        
        if (error.status === 400 && error.error) {
          // Erreurs de validation du backend
          if (error.error.code) {
            errorMessage = `Code invalide : ${error.error.code}`;
          } else if (error.error.name) {
            errorMessage = `Nom invalide : ${error.error.name}`;
          } else if (error.error.detail) {
            errorMessage = error.error.detail;
          }
        } else if (error.status === 409) {
          errorMessage = 'Ce code d\'organisation existe déjà. Veuillez en choisir un autre.';
        } else if (error.status === 500) {
          errorMessage = 'Erreur serveur. Veuillez réessayer plus tard.';
        }
        
        // Afficher un toast d'erreur
        this.toastService.error(
          'Échec de l\'Ajout',
          `L'organisation n'a pas pu être ajoutée. ${errorMessage}`
        );
        
        this.submitting = false;
      }
    });
  }

  // ==========================================
  // GESTION DES DÉTAILS D'ORGANISATION
  // ==========================================

  /**
   * Ouvrir le modal de détails d'une organisation
   */
  openOrganizationDetail(org: Organization): void {
    this.organizationToView = org;
    this.showDetailModal = true;
    document.body.style.overflow = 'hidden';
  }

  /**
   * Fermer le modal de détails
   */
  closeDetailModal(): void {
    this.showDetailModal = false;
    this.organizationToView = null;
    document.body.style.overflow = '';
  }

  // ==========================================
  // GESTION DE L'ÉDITION D'ORGANISATION
  // ==========================================

  /**
   * Ouvrir le modal d'édition d'une organisation
   */
  openEditOrganization(org: Organization): void {
    this.organizationToEdit = org;
    this.showEditModal = true;
    document.body.style.overflow = 'hidden';
    
    // Initialiser le formulaire avec les données existantes
    this.editOrgForm = this.fb.group({
      name: [org.name, [Validators.required, Validators.minLength(3)]],
      code: [org.code, [Validators.required, Validators.pattern('^[A-Za-z0-9_-]+$')]],
      type: [org.type, Validators.required],
      legal_id: [org.legal_id || ''],
      address: [org.address || ''],
      phone: [org.phone || '', [Validators.pattern('^[+]?[0-9\\s-]+$')]],
      email: [org.email || '', [Validators.email]],
      website: [org.website || '', [Validators.pattern('^https?://.+')]],
      is_active: [org.is_active]
    });
  }

  /**
   * Fermer le modal d'édition
   */
  closeEditModal(): void {
    if (!this.editing) {
      this.showEditModal = false;
      this.organizationToEdit = null;
      this.editOrgForm.reset();
      document.body.style.overflow = '';
    }
  }

  /**
   * Soumettre le formulaire d'édition
   */
  onSubmitEditOrganization(): void {
    if (this.editOrgForm.invalid || this.editing || !this.organizationToEdit) {
      Object.keys(this.editOrgForm.controls).forEach(key => {
        const control = this.editOrgForm.get(key);
        control?.markAsTouched();
      });
      
      this.toastService.error(
        'Formulaire Invalide',
        'Veuillez corriger les erreurs avant de soumettre.'
      );
      return;
    }

    this.editing = true;
    const formData = this.editOrgForm.value;
    const updatedOrganization: Partial<Organization> = {
      name: formData.name.trim(),
      code: formData.code.trim().toUpperCase(),
      type: formData.type,
      legal_id: formData.legal_id?.trim() || null,
      address: formData.address?.trim() || null,
      phone: formData.phone?.trim() || null,
      email: formData.email?.trim() || null,
      website: formData.website?.trim() || null,
      is_active: formData.is_active
    };

    console.log('📝 Mise à jour de l\'organisation:', updatedOrganization);

    this.organizationService.updateOrganization(this.organizationToEdit.id, updatedOrganization).subscribe({
      next: (updatedOrg: Organization) => {
        console.log('✅ Organisation mise à jour avec succès:', updatedOrg);
        
        // Mettre editing à false avant de fermer
        this.editing = false;
        
        // Fermer le modal
        this.showEditModal = false;
        this.organizationToEdit = null;
        this.editOrgForm.reset();
        document.body.style.overflow = '';
        
        // Recharger la liste
        this.loadOrganizations();
        
        // Afficher le toast de succès
        this.toastService.success(
          'Organisation Modifiée',
          `L'organisation "${updatedOrg.name}" a été modifiée avec succès.`
        );
      },
      error: (error) => {
        console.error('❌ Erreur lors de la modification:', error);
        
        let errorMessage = 'Une erreur est survenue lors de la modification.';
        
        if (error.status === 400 && error.error) {
          if (error.error.code) {
            errorMessage = `Code invalide : ${error.error.code}`;
          } else if (error.error.name) {
            errorMessage = `Nom invalide : ${error.error.name}`;
          } else if (error.error.detail) {
            errorMessage = error.error.detail;
          }
        } else if (error.status === 409) {
          errorMessage = 'Ce code d\'organisation existe déjà. Veuillez en choisir un autre.';
        } else if (error.status === 500) {
          errorMessage = 'Erreur serveur. Veuillez réessayer plus tard.';
        }
        
        this.toastService.error(
          'Échec de la Modification',
          `L'organisation n'a pas pu être modifiée. ${errorMessage}`
        );
        
        this.editing = false;
      }
    });
  }

  // ==========================================
  // GESTION DE LA SUPPRESSION D'ORGANISATION
  // ==========================================

  /**
   * Ouvrir la fenêtre de confirmation de suppression
   */
  openDeleteConfirmation(org: Organization): void {
    this.organizationToDelete = org;
    this.showDeleteModal = true;
    document.body.style.overflow = 'hidden';
  }

  /**
   * Fermer la fenêtre de confirmation
   */
  closeDeleteConfirmation(): void {
    if (!this.deleting) {
      this.showDeleteModal = false;
      this.organizationToDelete = null;
      document.body.style.overflow = '';
    }
  }

  /**
   * Confirmer et exécuter la suppression
   */
  confirmDelete(): void {
    if (!this.organizationToDelete || this.deleting) {
      return;
    }

    this.deleting = true;
    const orgId = this.organizationToDelete.id;
    const orgName = this.organizationToDelete.name;

    console.log('🗑️ Suppression de l\'organisation:', orgId);

    this.organizationService.deleteOrganization(orgId).subscribe({
      next: () => {
        console.log('✅ Organisation supprimée avec succès');
        
        // Fermer le modal
        this.deleting = false;
        this.showDeleteModal = false;
        this.organizationToDelete = null;
        document.body.style.overflow = '';
        
        // Recharger la liste
        this.loadOrganizations();
        
        // Afficher un toast de succès
        this.toastService.success(
          'Organisation Supprimée',
          `L'organisation "${orgName}" a été supprimée avec succès.`
        );
      },
      error: (error) => {
        console.error('❌ Erreur lors de la suppression:', error);
        
        let errorMessage = 'Une erreur est survenue lors de la suppression.';
        
        if (error.status === 400 && error.error) {
          // Erreur de validation du backend (membres présents)
          if (error.error.detail) {
            errorMessage = error.error.detail;
          } else if (error.error.non_field_errors) {
            errorMessage = error.error.non_field_errors[0];
          }
        } else if (error.status === 404) {
          errorMessage = 'Cette organisation n\'existe plus.';
        } else if (error.status === 403) {
          errorMessage = 'Vous n\'avez pas les permissions pour supprimer cette organisation.';
        } else if (error.status === 500) {
          errorMessage = 'Erreur serveur. Veuillez réessayer plus tard.';
        }
        
        // Afficher un toast d'erreur
        this.toastService.error(
          'Suppression Impossible',
          errorMessage
        );
        
        this.deleting = false;
      }
    });
  }

  // ==========================================
  // GESTION DE LA SUPPRESSION EN GROUPE
  // ==========================================

  /**
   * Obtenir la liste des organisations sélectionnées
   */
  getSelectedOrganizationsList(): Organization[] {
    return this.organizations.filter(org => this.selectedOrganizations.has(org.id));
  }

  /**
   * Ouvrir la fenêtre de confirmation de suppression en groupe
   */
  openBulkDeleteConfirmation(): void {
    if (this.selectedOrganizations.size === 0) {
      this.toastService.warning(
        'Aucune Sélection',
        'Veuillez sélectionner au moins une organisation à supprimer.'
      );
      return;
    }
    
    this.showBulkDeleteModal = true;
    document.body.style.overflow = 'hidden';
  }

  /**
   * Fermer la fenêtre de confirmation de suppression en groupe
   */
  closeBulkDeleteConfirmation(): void {
    if (!this.bulkDeleting) {
      this.showBulkDeleteModal = false;
      document.body.style.overflow = '';
    }
  }

  /**
   * Confirmer et exécuter la suppression en groupe
   */
  confirmBulkDelete(): void {
    if (this.selectedOrganizations.size === 0 || this.bulkDeleting) {
      return;
    }

    this.bulkDeleting = true;
    const selectedIds = Array.from(this.selectedOrganizations);

    console.log('🗑️ Suppression en groupe des organisations:', selectedIds);

    this.organizationService.bulkDeleteOrganizations(selectedIds).subscribe({
      next: (response) => {
        console.log('✅ Suppression en groupe réussie:', response);
        
        const deletedCount = response.deleted_count || 0;
        const totalRequested = response.total_requested || 0;
        const nonDeletable = response.non_deletable || [];
        
        // Fermer le modal
        this.bulkDeleting = false;
        this.showBulkDeleteModal = false;
        document.body.style.overflow = '';
        
        // Vider la sélection
        this.selectedOrganizations.clear();
        
        // Recharger la liste
        this.loadOrganizations();
        
        // Construire le message de succès détaillé
        let successMessage = `${deletedCount} organisation(s) sur ${totalRequested} ont été supprimées avec succès.`;
        
        if (nonDeletable.length > 0) {
          const orgNames = nonDeletable.map((org: any) => `"${org.name}" (${org.member_count} membre(s))`).join(', ');
          successMessage += `\n\nLes organisations suivantes n'ont pas pu être supprimées car elles contiennent des membres actifs : ${orgNames}`;
          
          this.toastService.warning(
            'Suppression Partielle',
            successMessage
          );
        } else {
          this.toastService.success(
            'Suppression Réussie',
            successMessage
          );
        }
      },
      error: (error) => {
        console.error('❌ Erreur lors de la suppression en groupe:', error);
        
        let errorMessage = 'Une erreur est survenue lors de la suppression.';
        
        if (error.status === 400 && error.error) {
          if (error.error.detail) {
            errorMessage = error.error.detail;
          }
          
          // Si des organisations ne peuvent pas être supprimées
          if (error.error.non_deletable && error.error.non_deletable.length > 0) {
            const orgNames = error.error.non_deletable.map((org: any) => `"${org.name}" (${org.member_count} membre(s))`).join(', ');
            errorMessage += `\n\nOrganisations concernées : ${orgNames}`;
          }
        } else if (error.status === 403) {
          errorMessage = 'Vous n\'avez pas les permissions pour supprimer des organisations.';
        } else if (error.status === 404) {
          errorMessage = 'Aucune organisation trouvée.';
        } else if (error.status === 500) {
          errorMessage = 'Erreur serveur. Veuillez réessayer plus tard.';
        }
        
        this.toastService.error(
          'Échec de la Suppression',
          errorMessage
        );

        this.bulkDeleting = false;
      }
    });
  }

  // ==========================================
  // ONGLETS ACTIFS / CORBEILLE
  // ==========================================
  setTab(deleted: boolean): void {
    if (this.showDeleted === deleted) return;
    this.showDeleted = deleted;
    this.selectedOrganizations.clear();
    this.searchQuery = '';
    this.currentPage = 1;
    this.displayMode = 'all';
    this.organizations = deleted ? this.deletedOrganizations : this.activeOrganizations;
    this.applyFiltersAndSort();
  }

  // --- Restauration ---
  openRestore(org: Organization): void {
    this.restoreTarget = org; this.isBulkRestore = false; this.showRestoreModal = true;
  }
  openBulkRestore(): void {
    if (this.selectedOrganizations.size === 0) return;
    this.restoreTarget = null; this.isBulkRestore = true; this.showRestoreModal = true;
  }
  closeRestore(): void { if (!this.restoring) { this.showRestoreModal = false; this.restoreTarget = null; } }

  confirmRestore(): void {
    if (this.restoring) return;
    this.restoring = true;
    const done = (n: number) => {
      this.restoring = false; this.showRestoreModal = false; this.restoreTarget = null;
      this.selectedOrganizations.clear(); this.loadOrganizations();
      this.toastService.success('Restauration', `${n} organisation(s) restaurée(s)`);
    };
    const fail = () => { this.restoring = false; this.toastService.error('Erreur', 'Restauration impossible'); };
    if (this.isBulkRestore) {
      const ids = Array.from(this.selectedOrganizations);
      this.organizationService.bulkRestoreOrganizations(ids).subscribe({ next: (r) => done(r.restored_count), error: fail });
    } else if (this.restoreTarget) {
      this.organizationService.restoreOrganization(this.restoreTarget.id).subscribe({ next: () => done(1), error: fail });
    }
  }

  // --- Suppression définitive ---
  openPermanentDelete(org: Organization): void {
    this.permanentDeleteTarget = org; this.isBulkPermanent = false; this.showPermanentDeleteModal = true;
  }
  openBulkPermanentDelete(): void {
    if (this.selectedOrganizations.size === 0) return;
    this.permanentDeleteTarget = null; this.isBulkPermanent = true; this.showPermanentDeleteModal = true;
  }
  closePermanentDelete(): void {
    if (!this.permanentDeleting) { this.showPermanentDeleteModal = false; this.permanentDeleteTarget = null; }
  }

  confirmPermanentDelete(): void {
    if (this.permanentDeleting) return;
    this.permanentDeleting = true;

    const close = () => {
      this.permanentDeleting = false;
      this.showPermanentDeleteModal = false;
      this.permanentDeleteTarget = null;
    };
    const fail = (error?: any) => {
      close();
      const msg = error?.error?.detail || 'Suppression définitive impossible.';
      this.toastService.error('Suppression impossible', msg);
    };

    if (this.isBulkPermanent) {
      const total = this.selectedOrganizations.size;
      const ids = Array.from(this.selectedOrganizations);
      this.organizationService.bulkPermanentDeleteOrganizations(ids).subscribe({
        next: (res) => {
          close();
          this.selectedOrganizations.clear();
          this.loadOrganizations();
          const deleted = res.deleted_count || 0;
          const failed = (res.errors || []).length;
          if (deleted > 0 && failed === 0) {
            this.toastService.success('Suppression définitive', `${deleted} organisation(s) supprimée(s) définitivement`);
          } else if (deleted > 0 && failed > 0) {
            this.toastService.warning('Suppression partielle',
              `${deleted} supprimée(s) définitivement ; ${failed} non supprimée(s) (projets rattachés).`);
          } else {
            this.toastService.error('Aucune suppression',
              `${total} organisation(s) non supprimée(s) : des projets y sont rattachés. Supprimez-les d'abord.`);
          }
        },
        error: fail,
      });
    } else if (this.permanentDeleteTarget) {
      this.organizationService.permanentDeleteOrganization(this.permanentDeleteTarget.id).subscribe({
        next: () => {
          close();
          this.selectedOrganizations.clear();
          this.loadOrganizations();
          this.toastService.success('Suppression définitive', 'Organisation supprimée définitivement');
        },
        error: fail,
      });
    }
  }
}
