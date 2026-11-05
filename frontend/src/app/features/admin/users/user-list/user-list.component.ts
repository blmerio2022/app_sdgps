import { formatDateTime } from '../../../../shared/utils/date-format.util';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../../../../shared/components/table-pagination/table-pagination.component';
import { Component, OnInit, OnDestroy, HostListener, ChangeDetectorRef, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { UserService } from '../../../../core/services/user.service';
import { OrganizationService } from '../../../../core/services/organization.service';
import { UserPreferencesService } from '../../../../core/services/user-preferences.service';
import { ToastService } from '../../../../core/services/toast.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { ProfileService } from '../../../profile/services/profile.service';
import { User, CreateUserPayload, UpdateUserPayload, UserRole } from '../../../../core/models/user.model';
import { Organization } from '../../../../core/models/organization.model';
import { TableSortConfigService, OrgSortLevel } from '../../../../core/services/table-sort-config.service';
import { SortableField, compareByLevels, sortLevelOf, sortDirOf } from '../../../../shared/components/multi-level-sort/multi-level-sort.util';
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
  width?: string;
  type?: 'text' | 'email' | 'date' | 'boolean' | 'role' | 'status' | 'actions';
}

interface MenuItem {
  label: string;
  icon: string;
  action: string;
  danger?: boolean;
  divider?: boolean;
}

@Component({
  selector: 'app-user-list',
  templateUrl: './user-list.component.html',
  styleUrls: ['./user-list.component.scss'],
})
export class UserListComponent implements OnInit, OnDestroy {
  readonly Math = Math;
  private destroy$ = new Subject<void>();
  private boundHandleClickOutside!: (event: Event) => void;

  // Données
  users: User[] = [];
  organizations: Organization[] = [];
  filteredUsers: User[] = [];
  paginatedUsers: User[] = [];

  // Configuration des colonnes
  columns: ColumnConfig[] = [
    { field: 'first_name',    label: 'Nom complet',       visible: true,  width: '200px', type: 'text' },
    { field: 'email',         label: 'Email',              visible: true,  width: '220px', type: 'email' },
    { field: 'role',          label: 'Rôle',               visible: true,  width: '140px', type: 'role' },
    { field: 'organization_name', label: 'Organisation',  visible: true,  width: '180px', type: 'text' },
    { field: 'is_active',     label: 'Statut',             visible: true,  width: '120px', type: 'status' },
    { field: 'last_connection_at', label: 'Dernière connexion', visible: true, width: '150px', type: 'date' },
    { field: 'must_change_password', label: 'MDP à changer', visible: false, width: '130px', type: 'boolean' },
    { field: 'date_joined',   label: 'Date d\'inscription', visible: false, width: '150px', type: 'date' },
    { field: 'password_changed_at', label: 'Dernier changement MDP', visible: false, width: '150px', type: 'date' },
    { field: 'is_superuser',  label: 'Superuser',          visible: false, width: '100px', type: 'boolean' },
    // Colonnes d'audit standard (libellés unifiés, cf. CLAUDE.md).
    ...(auditColumns() as unknown as ColumnConfig[]),
  ];

  // Filtres
  searchText = '';
  selectedRole = '';
  selectedStatus = '';
  selectedOrganization = '';
  displayMode: 'all' | 'selected' = 'all';
  activeFieldFilter: string | null = null;
  activeFieldFilterLabel = '';
  fieldFilterValue = '';

  // Tri mono-colonne (clic en-tête) — repli quand aucun tri multi-niveaux.
  sortColumn = 'date_joined';
  sortDirection: 'asc' | 'desc' = 'desc';

  // --- Tri MULTI-NIVEAUX (config opérateur, héritée du super admin) — parité liste organisations ---
  private readonly SORT_KEY = 'users';
  readonly sortableFields: SortableField[] = [
    { field: 'first_name', label: 'Nom complet' },
    { field: 'email', label: 'Email' },
    { field: 'role', label: 'Rôle' },
    { field: 'organization_name', label: 'Organisation' },
    { field: 'is_active', label: 'Statut' },
    { field: 'last_connection_at', label: 'Dernière connexion' },
    { field: 'must_change_password', label: 'MDP à changer' },
    { field: 'date_joined', label: "Date d'inscription" },
    { field: 'password_changed_at', label: 'Dernier changement MDP' },
    { field: 'is_superuser', label: 'Superuser' },
    // Colonnes d'audit standard : libellés unifiés (cf. CLAUDE.md).
    ...AUDIT_COLUMN_ORDER.map(field => ({ field, label: AUDIT_COLUMN_LABELS[field] })),
  ];
  sortLevels: OrgSortLevel[] = [];
  savingSort = false;
  savedSortFlash = false;
  resettingSort = false;
  private sortSaveTimer: any;

  // --- Configuration des COLONNES (config opérateur, héritée du super admin) — composant partagé ---
  private readonly COLUMNS_KEY = 'users';
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

  // Modales CRUD & Confirmation
  showAddModal = false;
  showEditModal = false;
  showDetailModal = false;
  showDeleteModal = false;
  showConfirmToggleModal = false;
  toggleTargetUser: User | null = null;
  toggleAction: 'activer' | 'désactiver' = 'activer';
  showDetailUser: User | null = null;
  editUser: User | null = null;
  deleteUser: User | null = null;
  isBulkDelete = false;
  addForm: FormGroup;
  editForm: FormGroup;
  submitting = false;
  deleting = false;
  bulkDeleting = false;
  isRoleChangeBlocked = false;

  // Onglets Actifs / Corbeille
  showDeleted = false;
  get nonDeletedCount(): number { return this.users.filter(u => !u.is_deleted).length; }
  get deletedUsersCount(): number { return this.users.filter(u => u.is_deleted).length; }

  // Restore Modal
  showRestoreModal = false;
  restoreUser_target: User | null = null;
  isBulkRestore = false;
  restoring = false;

  // Suppression définitive (unitaire / masse)
  showPermanentDeleteModal = false;
  permanentDeleteTarget: User | null = null;
  isBulkPermanent = false;
  permanentDeleting = false;

  // Reset Password Modal
  showResetPasswordModal = false;
  resetPasswordUser: User | null = null;
  newPassword = '';
  resetting = false;
  regenerating = false;
  showPassword = false;
  copied = false;


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
  contextMenuUser: User | null = null;
  contextMenuField: string | null = null;
  selectedCellValue: string | null = null;

  // UI
  loading = false;

  // Pas de mot de passe généré automatiquement, mais bouton pour générer
  showAddPassword = true;
  generatedPassword = '';

  currentUserId: number | null = null;

  // Organisation de l'utilisateur connecté (renseignée via /auth/me/ pour l'Admin Organisation)
  currentUserOrgId: string | null = null;
  currentUserOrgName: string | null = null;

  constructor(
    private userService: UserService,
    private organizationService: OrganizationService,
    private preferencesService: UserPreferencesService,
    private toastService: ToastService,
    private authService: AuthService,
    private profileService: ProfileService,
    private fb: FormBuilder,
    private cdr: ChangeDetectorRef,
    private sortConfigService: TableSortConfigService,
    private columnsConfigService: TableColumnsConfigService,
  ) {
    this.currentUserId = this.authService.getUserId();
    this.addForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      first_name: ['', Validators.required],
      last_name: ['', Validators.required],
      password: [''],
      role: ['ROLE_ORGANISATION_AGENT', Validators.required],
      organization_id: ['', Validators.required],
      must_change_password: [true],
    });
    this.editForm = this.fb.group({
      first_name: ['', Validators.required],
      last_name: ['', Validators.required],
      is_active: [true],
      role: ['', Validators.required],
      organization_id: [''],
    });
  }

  ngOnInit(): void {
    this.loadUsers();
    this.loadSortConfig();
    this.loadColumnsConfig();
    this.loadOrganizations();
    this.loadPreferences();
    this.applyOrgAdminDefaults();
    if (this.isOrgAdmin) {
      this.loadCurrentUserOrg();
    }
    this.boundHandleClickOutside = this.handleGlobalClick.bind(this);
    document.addEventListener('click', this.boundHandleClickOutside);

    this.addForm.get('role')?.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(role => {
      const orgCtrl = this.addForm.get('organization_id');
      if (role === 'ROLE_ADMIN_SYSTEME') {
        orgCtrl?.clearValidators();
        orgCtrl?.setValue('');
      } else {
        orgCtrl?.setValidators([Validators.required]);
      }
      orgCtrl?.updateValueAndValidity();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.boundHandleClickOutside) {
      document.removeEventListener('click', this.boundHandleClickOutside);
    }
  }

  // ============================================
  // Chargement des données
  // ============================================

  loadUsers(): void {
    this.loading = true;
    const params: any = {
      show_deleted: true,
    };
    this.userService.getUsers(params).pipe(takeUntil(this.destroy$)).subscribe({
      next: (users) => {
        this.users = users;
        this.applyFiltersAndSort();
        this.loading = false;
      },
      error: () => {
        this.toastService.error('Erreur', 'Erreur lors du chargement des utilisateurs');
        this.loading = false;
      },
    });
  }

  loadOrganizations(): void {
    this.organizationService.getOrganizations().pipe(takeUntil(this.destroy$)).subscribe({
      next: (orgs) => {
        this.organizations = orgs;
      },
    });
  }

  loadPreferences(): void {
    const saved = localStorage.getItem('sdgps_user_table_prefs');
    if (saved) {
      try {
        const prefs = JSON.parse(saved);
        // Les colonnes (visibilité + ordre) sont désormais persistées par utilisateur côté serveur
        // (TableColumnsConfigService), plus en localStorage. Cf. loadColumnsConfig().
        if (prefs.sortColumn) this.sortColumn = prefs.sortColumn;
        if (prefs.sortDirection) this.sortDirection = prefs.sortDirection;
        if (prefs.pageSize) this.pageSize = prefs.pageSize;
        if (prefs.displayMode) this.displayMode = prefs.displayMode;
      } catch (e) {
        console.warn('Erreur lors du chargement des préférences:', e);
      }
    }
  }

  savePreferences(): void {
    const prefs = {
      sortColumn: this.sortColumn,
      sortDirection: this.sortDirection,
      pageSize: this.pageSize,
      displayMode: this.displayMode,
    };
    localStorage.setItem('sdgps_user_table_prefs', JSON.stringify(prefs));
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

  /** Masque une colonne (depuis le menu de filtre) — auto-save comme la modale des colonnes. */
  hideColumnField(field: string): void {
    this.onColumnsChange(this.columns.map(c => (c.field === field ? { ...c, visible: false } : { ...c })));
  }

  applyFiltersAndSort(): void {
    let result = [...this.users];

    // Filtres de colonne (ET entre colonnes, OU entre valeurs d'une même colonne).
    if (activeFilterCount(this.columnFilters)) {
      result = result.filter(u => rowMatchesColumnFilters(u, this.columnFilters, this.cellText));
    }

    if (this.displayMode === 'selected') {
      result = result.filter(u => this.selectedIds.has(String(u.id)));
    }

    if (this.searchText) {
      const q = this.searchText.toLowerCase();
      result = result.filter(u =>
        u.first_name.toLowerCase().includes(q) ||
        u.last_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      );
    }
    if (this.selectedRole) {
      result = result.filter(u => u.role === this.selectedRole);
    }
    // L'onglet (showDeleted) pilote la séparation actifs / corbeille.
    if (this.showDeleted) {
      result = result.filter(u => u.is_deleted);
    } else if (this.selectedStatus === 'active') {
      result = result.filter(u => u.is_active && !u.is_deleted);
    } else if (this.selectedStatus === 'inactive') {
      result = result.filter(u => !u.is_active && !u.is_deleted);
    } else {
      result = result.filter(u => !u.is_deleted);
    }
    if (this.selectedOrganization) {
      result = result.filter(u => u.organization_id === this.selectedOrganization);
    }
    if (this.activeFieldFilter && this.fieldFilterValue) {
      const ff = this.activeFieldFilter;
      const fv = this.fieldFilterValue.toLowerCase();
      result = result.filter(u => {
        const val = (u as any)[ff];
        return val != null && String(val).toLowerCase().includes(fv);
      });
    }

    // Tri : le tri MULTI-NIVEAUX prime ; à défaut, repli sur le tri mono-colonne (clic en-tête).
    if (this.sortLevels.length) {
      result.sort((a, b) => compareByLevels(a, b, this.sortLevels));
    } else {
      result.sort((a, b) => {
        let valA: any, valB: any;
        switch (this.sortColumn) {
          case 'email': valA = a.email; valB = b.email; break;
          case 'first_name': valA = a.first_name; valB = b.first_name; break;
          case 'role': valA = a.role_display; valB = b.role_display; break;
          case 'organization_name': valA = a.organization_name || ''; valB = b.organization_name || ''; break;
          case 'is_active': valA = a.is_active ? 1 : 0; valB = b.is_active ? 1 : 0; break;
          case 'last_connection_at': valA = a.last_connection_at || ''; valB = b.last_connection_at || ''; break;
          case 'date_joined': valA = a.date_joined; valB = b.date_joined; break;
          default: valA = a.date_joined; valB = b.date_joined; break;
        }
        if (valA < valB) return this.sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return this.sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    this.filteredUsers = result;
    this.currentPage = 1;
    this.updatePagination();
    this.savePreferences();
  }

  updatePagination(): void {
    const start = (this.currentPage - 1) * this.pageSize;
    this.paginatedUsers = this.filteredUsers.slice(start, start + this.pageSize);
    this.isAllSelected = this.paginatedUsers.length > 0 && this.paginatedUsers.every(u => this.selectedIds.has(String(u.id)));
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredUsers.length / this.pageSize));
  }

  get pageNumbers(): number[] {
    const pages: number[] = [];
    const total = this.totalPages;
    const start = Math.max(1, this.currentPage - 2);
    const end = Math.min(total, this.currentPage + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.updatePagination();
  }

  onSearchChange(): void {
    this.applyFiltersAndSort();
  }

  onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchText = input.value;
    this.applyFiltersAndSort();
  }

  clearSearch(): void {
    this.searchText = '';
    this.applyFiltersAndSort();
  }

  onRoleFilterChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.selectedRole = select.value;
    this.applyFiltersAndSort();
  }

  onStatusFilterChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const prevStatus = this.selectedStatus;
    this.selectedStatus = select.value;
    if (this.selectedStatus === 'deleted' || prevStatus === 'deleted') {
      this.loadUsers();
    } else {
      this.applyFiltersAndSort();
    }
  }

  onOrganizationFilterChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.selectedOrganization = select.value;
    this.applyFiltersAndSort();
  }

  onFilterChange(): void {
    this.applyFiltersAndSort();
  }

  onPageSizeChange(): void {
    this.currentPage = 1;
    this.updatePagination();
    this.savePreferences();
  }

  sortBy(column: string): void {
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
  /** Rang (1..n) du champ dans le tri multi-niveaux, ou 0. */
  sortLevelOf(field: string): number { return sortLevelOf(this.sortLevels, field); }
  /** Sens de tri du champ ('asc'/'desc'), ou '' s'il n'est pas trié. */
  sortDirOf(field: string): '' | 'asc' | 'desc' { return sortDirOf(this.sortLevels, field); }

  /** Charge le tri multi-niveaux de l'opérateur (hérité du super admin). */
  private loadSortConfig(): void {
    this.sortConfigService.get(this.SORT_KEY).subscribe(levels => {
      this.sortLevels = levels;
      this.applyFiltersAndSort();
    });
  }

  /** Réception d'une modification depuis la modale : applique + enregistrement auto (anti-rebond). */
  onSortLevelsChange(levels: OrgSortLevel[]): void {
    this.sortLevels = levels;
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
      error: (err) => { this.savingSort = false; this.toastService.error('Erreur', err?.error?.detail || 'Enregistrement du tri impossible'); },
    });
  }

  /** Réinitialise le tri avec la configuration SOURCE (compte administrateur). */
  onResetSort(): void {
    if (this.resettingSort) return;
    this.resettingSort = true;
    this.sortConfigService.resetToSource(this.SORT_KEY).subscribe({
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

  // ============================================
  // Sélection
  // ============================================

  toggleSelection(id: string): void {
    const idStr = String(id);
    if (this.selectedIds.has(idStr)) {
      this.selectedIds.delete(idStr);
    } else {
      this.selectedIds.add(idStr);
    }
    this.isAllSelected = this.paginatedUsers.length > 0 && this.paginatedUsers.every(u => this.selectedIds.has(String(u.id)));
  }

  selectAll(): void {
    this.filteredUsers.forEach(u => this.selectedIds.add(String(u.id)));
    this.isAllSelected = true;
  }

  deselectAll(): void {
    this.selectedIds.clear();
    this.isAllSelected = false;
  }

  toggleSelectAll(): void {
    if (this.isAllSelected) {
      this.deselectAll();
    } else {
      this.selectAll();
    }
  }

  invertSelection(): void {
    this.paginatedUsers.forEach(u => {
      const idStr = String(u.id);
      if (this.selectedIds.has(idStr)) {
        this.selectedIds.delete(idStr);
      } else {
        this.selectedIds.add(idStr);
      }
    });
    this.isAllSelected = this.paginatedUsers.length > 0 && this.paginatedUsers.every(u => this.selectedIds.has(String(u.id)));
  }

  isSelected(user: User): boolean {
    return this.selectedIds.has(String(user.id));
  }

  isCurrentUserSelected(): boolean {
    if (this.currentUserId === null) return false;
    return this.selectedIds.has(String(this.currentUserId));
  }

  moveSelectionToTop(): void {
    if (this.selectedIds.size === 0) return;
    const selected = this.users.filter(u => this.selectedIds.has(String(u.id)));
    const notSelected = this.users.filter(u => !this.selectedIds.has(String(u.id)));
    this.users = [...selected, ...notSelected];
    this.applyFiltersAndSort();
    const selectedFiltered = this.filteredUsers.filter(u => this.selectedIds.has(String(u.id)));
    const notSelectedFiltered = this.filteredUsers.filter(u => !this.selectedIds.has(String(u.id)));
    this.filteredUsers = [...selectedFiltered, ...notSelectedFiltered];
    this.currentPage = 1;
    this.updatePagination();
  }

  getSelectedUsersList(): User[] {
    return this.users.filter(u => this.selectedIds.has(String(u.id)));
  }

  get allSelectedAreDeleted(): boolean {
    if (this.selectedIds.size === 0) return false;
    return this.getSelectedUsersList().every(u => u.is_deleted);
  }

  // ============================================
  // Menu contextuel cellules (clic droit)
  // ============================================

  onCellRightClick(event: MouseEvent, user: User, field: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenuPosition = { x: event.clientX, y: event.clientY };
    this.contextMenuUser = user;
    this.contextMenuField = field;
    this.selectedCellValue = field ? String((user as any)[field] ?? '') : null;
    this.showRowContextMenu = true;
  }

  toggleRowSelectionFromContext(): void {
    if (this.contextMenuUser) {
      this.toggleSelection(this.contextMenuUser.id);
    }
    this.closeAllContextMenus();
  }

  selectAllFromContext(): void {
    this.selectAll();
    this.closeAllContextMenus();
  }

  copyCellValueFromContext(): void {
    if (this.selectedCellValue != null) {
      navigator.clipboard.writeText(this.selectedCellValue).then(() => {
        this.toastService.success('Copié', 'Valeur copiée dans le presse-papier');
      });
    }
    this.closeAllContextMenus();
  }

  openDetailFromContext(): void {
    if (this.contextMenuUser) {
      this.openDetailModal(this.contextMenuUser);
    }
    this.closeAllContextMenus();
  }

  openEditFromContext(): void {
    if (this.contextMenuUser) {
      this.openEditModal(this.contextMenuUser);
    }
    this.closeAllContextMenus();
  }

  openDeleteFromContext(): void {
    if (this.contextMenuUser) {
      this.openDeleteModal(this.contextMenuUser);
    }
    this.closeAllContextMenus();
  }

  openResetPasswordFromContext(): void {
    if (this.contextMenuUser) {
      this.openResetPasswordModal(this.contextMenuUser);
    }
    this.closeAllContextMenus();
  }

  openToggleFromContext(): void {
    if (this.contextMenuUser) {
      this.openToggleModal(this.contextMenuUser);
    }
    this.closeAllContextMenus();
  }

  openRestoreFromContext(): void {
    if (this.contextMenuUser) {
      this.openRestoreModal(this.contextMenuUser);
    }
    this.closeAllContextMenus();
  }

  // ============================================
  // Mode d'affichage / Filtre
  // ============================================

  setDisplayMode(mode: 'all' | 'selected'): void {
    this.displayMode = mode;
    this.applyFiltersAndSort();
  }

  toggleFilterMenu(): void {
    this.showFilterMenu = !this.showFilterMenu;
    if (this.showFilterMenu) {
      this.showExportMenu = false;
    }
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
    const input = event.target as HTMLInputElement;
    this.fieldFilterValue = input.value;
    this.applyFiltersAndSort();
  }

  clearFieldFilter(): void {
    this.activeFieldFilter = null;
    this.activeFieldFilterLabel = '';
    this.fieldFilterValue = '';
    this.displayMode = 'all';
    this.applyFiltersAndSort();
  }

  // ============================================
  // Pagination
  // ============================================

  setPageSize(size: number): void {
    this.pageSize = size;
    this.currentPage = 1;
    this.updatePagination();
    this.savePreferences();
  }

  goToFirstPage(): void {
    this.goToPage(1);
  }

  goToLastPage(): void {
    this.goToPage(this.totalPages);
  }

  prevPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.updatePagination();
    }
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.updatePagination();
    }
  }

  formatDate(value: any): string {
    return formatDateTime(value);
  }

  // ============================================
  // Colonnes — Configuration
  // ============================================

  getVisibleColumns(): ColumnConfig[] {
    return this.columns.filter(c => c.visible);
  }

  /** Ouvre la modale d'organisation des colonnes (composant partagé). */
  openColumnConfig(): void { this.columnCfg?.open(); }

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
      error: (err) => { this.savingColumns = false; this.toastService.error('Erreur', err?.error?.detail || 'Enregistrement des colonnes impossible'); },
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
        this.toastService.success('Succès', 'Colonnes réinitialisées avec la configuration source');
      },
      error: (e) => { this.resettingColumns = false; this.toastService.error('Erreur', e?.error?.detail || 'Réinitialisation impossible'); },
    });
  }

  onColumnHeaderRightClick(event: MouseEvent, col: ColumnConfig): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenuPosition = { x: event.clientX, y: event.clientY };
    this.contextMenuColumn = col;
    this.showColumnContextMenu = true;
  }

  hideColumnFromContext(): void {
    const field = this.contextMenuColumn?.field;
    this.showColumnContextMenu = false;
    this.contextMenuColumn = null;
    if (!field) return;
    this.onColumnsChange(this.columns.map(c => (c.field === field ? { ...c, visible: false } : { ...c })));
  }

  openColumnConfigFromContext(): void {
    this.showColumnContextMenu = false;
    this.openColumnConfig();
  }

  /** Ouvrir la modale de tri multi-niveaux depuis le menu contextuel (clic droit en-tête). */
  openSortFromContext(): void {
    this.showColumnContextMenu = false;
    this.sortCmp?.open();
  }

  getTypeLabel(type?: string): string {
    const labels: Record<string, string> = {
      text: 'TEXTE',
      email: 'EMAIL',
      date: 'DATE',
      boolean: 'BOOLÉEN',
      role: 'RÔLE',
      status: 'STATUT',
      actions: 'ACTIONS',
    };
    return type ? (labels[type] || 'TEXTE') : 'TEXTE';
  }

  getFieldDescription(field: string): string {
    const descriptions: Record<string, string> = {
      first_name: 'Nom complet de l\'utilisateur (prénom et nom)',
      email: 'Adresse email utilisée pour la connexion',
      role: 'Rôle principal de l\'utilisateur dans le système',
      organization_name: 'Organisation principale à laquelle appartient l\'utilisateur',
      is_active: 'Indique si le compte est actif ou désactivé',
      last_connection_at: 'Date et heure de la dernière connexion réussie',
      must_change_password: 'L\'utilisateur doit changer son mot de passe à la prochaine connexion',
      date_joined: 'Date et heure de création du compte',
      password_changed_at: 'Date du dernier changement de mot de passe',
      is_deleted: 'Indique si l\'utilisateur a été supprimé (soft delete)',
      is_superuser: 'Indique si l\'utilisateur a les droits super-admin',
    };
    return descriptions[field] || '';
  }

  // ============================================
  // Export
  // ============================================

  toggleExportMenu(event?: Event): void {
    if (event) event.stopPropagation();
    this.showExportMenu = !this.showExportMenu;
  }

  exportCSV(selectedOnly: boolean = false): void {
    this.showExportMenu = false;
    const data = selectedOnly
      ? this.filteredUsers.filter(u => this.selectedIds.has(String(u.id)))
      : this.filteredUsers;
    if (data.length === 0) {
      this.toastService.warning('Export', 'Aucune donnée à exporter');
      return;
    }
    const visibleCols = this.getVisibleColumns();
    const headers = visibleCols.map(c => c.label).join(';');
    const rows = data.map(u =>
      visibleCols.map(c => {
        let val: any;
        switch (c.field) {
          case 'first_name': val = `${u.first_name} ${u.last_name}`; break;
          case 'is_active': val = u.is_active ? 'Actif' : 'Inactif'; break;
          case 'is_deleted': val = u.is_deleted ? 'Oui' : 'Non'; break;
          case 'is_superuser': val = u.is_superuser ? 'Oui' : 'Non'; break;
          case 'must_change_password': val = u.must_change_password ? 'Oui' : 'Non'; break;
          case 'role': val = u.role_display; break;
          default: val = (u as any)[c.field] ?? ''; break;
        }
        return `"${String(val).replace(/"/g, '""')}"`;
      }).join(';')
    );
    const csv = '\uFEFF' + [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().slice(0, 10);
    link.download = selectedOnly ? `utilisateurs_selectionnes_${timestamp}.csv` : `tous_utilisateurs_${timestamp}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    this.toastService.success('Export', 'Export CSV réussi');
  }

  // ============================================
  // CRUD
  // ============================================

  get activeUsersCount(): number {
    return this.users.filter(u => u.is_active).length;
  }

  openAddModal(): void {
    this.addForm.reset({
      role: 'ROLE_ORGANISATION_AGENT',
      must_change_password: true,
    });
    // Un Admin Organisation ne crée que des agents, et uniquement dans sa propre organisation.
    if (this.isOrgAdmin && this.currentUserOrgId) {
      this.addForm.patchValue({
        role: 'ROLE_ORGANISATION_AGENT',
        organization_id: this.currentUserOrgId,
      });
    }
    this.showAddPassword = true;
    this.generatedPassword = this.generatePassword();
    this.addForm.patchValue({ password: this.generatedPassword });
    this.showAddModal = true;
    document.body.style.overflow = 'hidden';
  }

  closeAddModal(): void {
    if (this.submitting) return;
    this.showAddModal = false;
    document.body.style.overflow = '';
  }

  generatePassword(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let pwd = '';
    for (let i = 0; i < 12; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pwd;
  }

  regeneratePassword(): void {
    this.generatedPassword = this.generatePassword();
    this.addForm.patchValue({ password: this.generatedPassword });
  }

  copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text).then(() => {
      this.copied = true;
      this.toastService.success('Succès', 'Copié dans le presse-papier');
      setTimeout(() => { this.copied = false; }, 2000);
    });
  }

  onSubmitAdd(): void {
    if (this.addForm.invalid || this.submitting) {
      Object.keys(this.addForm.controls).forEach(key => {
        this.addForm.get(key)?.markAsTouched();
      });
      if (this.addForm.invalid) {
        this.toastService.error('Formulaire Invalide', 'Veuillez corriger les erreurs avant de soumettre.');
        return;
      }
      return;
    }
    this.submitting = true;
    const payload: CreateUserPayload = this.addForm.value;
    this.userService.createUser(payload).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.submitting = false;
        this.toastService.success('Succès', 'Utilisateur créé avec succès');
        this.closeAddModal();
        this.loadUsers();
      },
      error: (error) => {
        this.submitting = false;
        let msg = 'Erreur lors de la création';
        if (error.status === 400 && error.error) {
          if (error.error.email) msg = `Email : ${error.error.email}`;
          else if (error.error.detail) msg = error.error.detail;
        } else if (error.status === 409) {
          msg = 'Cet email est déjà utilisé.';
        }
        this.toastService.error('Échec de la Création', msg);
      },
    });
  }

  get isRoleDisabled(): boolean {
    return !!(this.editUser?.is_superuser || (this.editUser && this.currentUserRole !== 'ROLE_SUPER_ADMIN' && this.isAppAdmin(this.editUser)) || this.isRoleChangeBlocked);
  }

  get isActiveChecked(): boolean {
    return this.editForm?.get('is_active')?.value ?? false;
  }

  openEditModal(user: User): void {
    this.editUser = user;
    this.isRoleChangeBlocked = user.role === 'ROLE_ADMIN_SYSTEME' && this.activeAppAdminCount <= 2;
    this.showEditModal = true;
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      this.editForm.patchValue({
        first_name: user.first_name,
        last_name: user.last_name,
        is_active: user.is_active,
        role: user.role,
        organization_id: user.organization_id || '',
      });
      const isActiveCtrl = this.editForm.get('is_active');
      if (this.isCurrentUser(user) || this.isBlockedForAppAdmin(user) || user.is_deleted || this.isCriticalSuperAdmin(user) || this.isCriticalAppAdmin(user) || this.isCriticalOrgAdmin(user)) {
        isActiveCtrl?.disable({ onlySelf: true, emitEvent: false });
      } else {
        isActiveCtrl?.enable({ onlySelf: true, emitEvent: false });
      }
    });
  }

  closeEditModal(): void {
    if (this.submitting) return;
    this.showEditModal = false;
    this.editUser = null;
    this.isRoleChangeBlocked = false;
    this.editForm.get('is_active')?.enable({ onlySelf: true, emitEvent: false });
    document.body.style.overflow = '';
  }

  onSubmitEdit(): void {
    if (!this.editUser || this.editForm.invalid || this.submitting) {
      Object.keys(this.editForm.controls).forEach(key => {
        this.editForm.get(key)?.markAsTouched();
      });
      return;
    }
    const payload: UpdateUserPayload = {};
    const formVal = this.editForm.value;
    this.submitting = true;
    if (formVal.first_name !== this.editUser.first_name) payload.first_name = formVal.first_name;
    if (formVal.last_name !== this.editUser.last_name) payload.last_name = formVal.last_name;
    if (formVal.is_active !== this.editUser.is_active) payload.is_active = formVal.is_active;
    if (!this.editUser.is_superuser && !this.isCurrentUser(this.editUser) && formVal.role !== this.editUser.role) payload.role = formVal.role;
    // Un Admin Organisation ne peut jamais changer l'organisation d'un utilisateur.
    if (!this.isOrgAdmin && formVal.organization_id !== (this.editUser.organization_id || '')) payload.organization_id = formVal.organization_id;

    if ('is_active' in payload && this.editUser) {
      if (this.editUser.is_superuser && this.isCriticalSuperAdmin(this.editUser)) {
        this.submitting = false;
        this.toastService.error('Action bloquée', 'Impossible : cela laisserait moins de deux super administrateurs actifs.');
        return;
      }
      if (this.isAppAdmin(this.editUser) && this.isCriticalAppAdmin(this.editUser)) {
        this.submitting = false;
        this.toastService.error('Action bloquée', 'Impossible : cela laisserait moins de deux administrateurs système actifs.');
        return;
      }
      if (this.isCriticalOrgAdmin(this.editUser)) {
        this.submitting = false;
        this.toastService.error('Action bloquée', 'Impossible : cette organisation n\'aurait plus aucun administrateur actif.');
        return;
      }
    }

    if ('role' in payload && this.editUser
        && this.editUser.role === 'ROLE_ORGANISATION_ADMIN' && payload.role !== 'ROLE_ORGANISATION_ADMIN'
        && this.isCriticalOrgAdmin(this.editUser)) {
      this.submitting = false;
      this.toastService.error('Action bloquée', 'Impossible de rétrograder : cette organisation n\'aurait plus aucun administrateur actif.');
      return;
    }

    this.userService.updateUser(this.editUser.id, payload).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.submitting = false;
        this.toastService.success('Succès', 'Utilisateur modifié avec succès');
        this.closeEditModal();
        this.loadUsers();
      },
      error: (error) => {
        this.submitting = false;
        let msg = 'Erreur lors de la modification';
        if (error.status === 400 && error.error) {
          if (error.error.detail) msg = error.error.detail;
        }
        this.toastService.error('Échec de la Modification', msg);
      },
    });
  }

  openDetailModal(user: User): void {
    this.showDetailUser = user;
    this.showDetailModal = true;
    document.body.style.overflow = 'hidden';
  }

  closeDetailModal(): void {
    this.showDetailModal = false;
    this.showDetailUser = null;
    document.body.style.overflow = '';
  }

  openDeleteModal(user: User): void {
    this.deleteUser = user;
    this.isBulkDelete = false;
    this.showDeleteModal = true;
    document.body.style.overflow = 'hidden';
  }

  openBulkDeleteModal(): void {
    this.deleteUser = null;
    this.isBulkDelete = true;
    this.showDeleteModal = true;
    document.body.style.overflow = 'hidden';
  }

  closeDeleteModal(): void {
    if (this.deleting || this.bulkDeleting) return;
    this.showDeleteModal = false;
    this.deleteUser = null;
    this.isBulkDelete = false;
    document.body.style.overflow = '';
  }

  confirmDelete(): void {
    if (this.isBulkDelete) {
      if (this.bulkDeleting || this.selectedIds.size === 0) return;
      if (this.isCurrentUserSelected() || this.criticalSuperAdminSelectedCount > 0 || this.criticalAppAdminSelectedCount > 0 || this.bulkBlockedPairSelectedCount > 0) return;
      this.bulkDeleting = true;
      const ids = Array.from(this.selectedIds);
      let completed = 0;
      let hasError = false;
      ids.forEach(id => {
        this.userService.deleteUser(id).pipe(takeUntil(this.destroy$)).subscribe({
          next: () => {
            completed++;
            if (completed === ids.length) {
              this.bulkDeleting = false;
              if (!hasError) {
                this.toastService.success('Succès', `${ids.length} utilisateur(s) supprimé(s)`);
              }
              this.closeDeleteModal();
              this.selectedIds.clear();
              this.loadUsers();
            }
          },
          error: () => {
            hasError = true;
            completed++;
            if (completed === ids.length) {
              this.bulkDeleting = false;
              this.closeDeleteModal();
              this.selectedIds.clear();
              this.loadUsers();
            }
          },
        });
      });
    } else if (this.deleteUser) {
      if (this.deleting) return;
      if (this.isDeleteBlockedByCritical(this.deleteUser)) return;
      this.deleting = true;
      this.userService.deleteUser(this.deleteUser.id).pipe(takeUntil(this.destroy$)).subscribe({
        next: () => {
          this.deleting = false;
          this.toastService.success('Suppression Réussie', `L'utilisateur "${this.deleteUser!.first_name} ${this.deleteUser!.last_name}" a été supprimé.`);
          this.closeDeleteModal();
          this.loadUsers();
        },
        error: (error) => {
          this.deleting = false;
          let msg = 'Erreur lors de la suppression';
          if (error.status === 400 && error.error?.detail) msg = error.error.detail;
          this.toastService.error('Suppression Impossible', msg);
        },
      });
    }
  }

  openResetPasswordModal(user: User): void {
    if (this.isCurrentUser(user)) return;
    this.resetPasswordUser = user;
    this.newPassword = '';
    this.resetting = false;
    this.regenerating = false;
    this.showResetPasswordModal = true;
    document.body.style.overflow = 'hidden';
  }

  closeResetPasswordModal(): void {
    this.showResetPasswordModal = false;
    this.resetPasswordUser = null;
    this.newPassword = '';
    this.resetting = false;
    this.regenerating = false;
    this.showPassword = false;
    this.copied = false;
    document.body.style.overflow = '';
  }

  confirmResetPassword(): void {
    if (!this.resetPasswordUser) return;
    this.resetting = true;
    this.userService.resetPassword(this.resetPasswordUser.id, { must_change_password: true }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.newPassword = res.new_password;
        this.resetting = false;
      },
      error: () => {
        this.resetting = false;
        this.toastService.error('Erreur', 'Erreur lors de la réinitialisation');
      },
    });
  }

  regenerateResetPassword(): void {
    if (!this.resetPasswordUser) return;
    this.regenerating = true;
    this.copied = false;
    this.userService.resetPassword(this.resetPasswordUser.id, { must_change_password: true }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.newPassword = res.new_password;
        this.regenerating = false;
      },
      error: () => {
        this.regenerating = false;
        this.toastService.error('Erreur', 'Erreur lors de la régénération');
      },
    });
  }

  isCurrentUser(user: User): boolean {
    return this.currentUserId !== null && Number(user.id) === this.currentUserId;
  }

  get activeSuperAdminCount(): number {
    return this.users.filter(u => u.is_superuser && u.is_active && !u.is_deleted).length;
  }

  isCriticalSuperAdmin(user: User): boolean {
    return user.is_superuser && user.is_active && !user.is_deleted && this.activeSuperAdminCount <= 2;
  }

  get criticalSuperAdminSelectedIds(): string[] {
    return this.users
      .filter(u => this.selectedIds.has(String(u.id)) && this.isCriticalSuperAdmin(u))
      .map(u => String(u.id));
  }

  get activeAppAdminCount(): number {
    return this.users.filter(u => u.role === 'ROLE_ADMIN_SYSTEME' && u.is_active && !u.is_deleted).length;
  }

  get inactiveAppAdminCount(): number {
    return this.users.filter(u => u.role === 'ROLE_ADMIN_SYSTEME' && !u.is_active && !u.is_deleted).length;
  }

  get deletedAppAdminCount(): number {
    return this.users.filter(u => u.role === 'ROLE_ADMIN_SYSTEME' && u.is_deleted).length;
  }

  get roleChangeBlockedMessage(): string {
    const options: string[] = [];
    const inactive = this.inactiveAppAdminCount;
    const deleted = this.deletedAppAdminCount;
    if (inactive > 0) {
      options.push(`réactivez un compte désactivé (${inactive})`);
    } else {
      options.push('réactivez un compte désactivé');
    }
    if (deleted > 0) {
      options.push(`restaurez un compte supprimé (${deleted})`);
    } else {
      options.push('restaurez un compte supprimé');
    }
    options.push('créez-en un nouveau');
    return `Besoin de 2 Admin Système actifs. Options : ${options.join(', ')}.`;
  }

  isCriticalAppAdmin(user: User): boolean {
    return user.role === 'ROLE_ADMIN_SYSTEME' && user.is_active && !user.is_deleted && this.activeAppAdminCount <= 2;
  }

  get criticalAppAdminSelectedIds(): string[] {
    return this.users
      .filter(u => this.selectedIds.has(String(u.id)) && this.isCriticalAppAdmin(u))
      .map(u => String(u.id));
  }

  get criticalAppAdminSelectedCount(): number {
    return this.criticalAppAdminSelectedIds.length;
  }

  /**
   * Nombre d'admins d'organisation actifs pour une organisation donnée (org principale).
   * Aide visuelle : le backend fait foi (vérif sur toutes les adhésions).
   */
  activeOrgAdminCount(orgId: string | null | undefined): number {
    if (!orgId) return 0;
    return this.users.filter(u =>
      u.role === 'ROLE_ORGANISATION_ADMIN' && u.organization_id === orgId
      && u.is_active && !u.is_deleted).length;
  }

  /** Dernier admin actif de son organisation : le supprimer/désactiver orphelinerait l'org. */
  isCriticalOrgAdmin(user: User): boolean {
    return user.role === 'ROLE_ORGANISATION_ADMIN' && user.is_active && !user.is_deleted
      && this.activeOrgAdminCount(user.organization_id) <= 1;
  }

  get criticalOrgAdminSelectedIds(): string[] {
    return this.users
      .filter(u => this.selectedIds.has(String(u.id)) && this.isCriticalOrgAdmin(u))
      .map(u => String(u.id));
  }

  get criticalOrgAdminSelectedCount(): number {
    return this.criticalOrgAdminSelectedIds.length;
  }

  get bulkBlockedPairSelectedIds(): string[] {
    if (this.currentUserRole !== 'ROLE_ADMIN_SYSTEME') return [];
    return this.getSelectedUsersList()
      .filter(u => this.isAppAdmin(u))
      .map(u => String(u.id));
  }

  get bulkBlockedPairSelectedCount(): number {
    return this.bulkBlockedPairSelectedIds.length;
  }

  get bulkBlockedOrgAdminSelectedIds(): string[] {
    if (this.currentUserRole !== 'ROLE_ORGANISATION_ADMIN') return [];
    return this.getSelectedUsersList()
      .filter(u => this.isBlockedForOrgAdmin(u))
      .map(u => String(u.id));
  }

  get bulkBlockedOrgAdminSelectedCount(): number {
    return this.bulkBlockedOrgAdminSelectedIds.length;
  }

  get hasBulkBlockingIssues(): boolean {
    return this.isCurrentUserSelected() || this.bulkBlockedPairSelectedCount > 0
      || this.criticalSuperAdminSelectedCount > 0 || this.criticalAppAdminSelectedCount > 0
      || this.bulkBlockedOrgAdminSelectedCount > 0 || this.criticalOrgAdminSelectedCount > 0;
  }

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

  /** L'utilisateur connecté est un Admin Organisation (ne gère que les agents de son org). */
  get isOrgAdmin(): boolean {
    return this.currentUserRole === 'ROLE_ORGANISATION_ADMIN';
  }

  /** Récupère l'organisation de l'org admin connecté (via /auth/me/) pour verrouiller le formulaire d'ajout. */
  private loadCurrentUserOrg(): void {
    this.profileService.getCurrentUser().pipe(takeUntil(this.destroy$)).subscribe({
      next: (me) => {
        this.currentUserOrgId = me.organization_id ?? null;
        this.currentUserOrgName = me.organization_name ?? null;
      },
      error: () => { /* silencieux : l'ajout restera possible sans pré-remplissage */ },
    });
  }

  /**
   * Défauts spécifiques à l'Admin Organisation :
   * - masque par défaut les colonnes Rôle et Organisation (constantes pour ce rôle),
   *   sauf si l'utilisateur a déjà personnalisé ses colonnes ;
   * - neutralise les filtres rôle/organisation (leurs selects sont masqués dans le template).
   */
  private applyOrgAdminDefaults(): void {
    if (!this.isOrgAdmin) return;

    let hasColumnPrefs = false;
    try {
      const saved = localStorage.getItem('sdgps_user_table_prefs');
      hasColumnPrefs = !!(saved && JSON.parse(saved).columns);
    } catch {
      hasColumnPrefs = false;
    }
    if (!hasColumnPrefs) {
      ['role', 'organization_name'].forEach(field => {
        const col = this.columns.find(c => c.field === field);
        if (col) col.visible = false;
      });
    }

    this.selectedRole = '';
    this.selectedOrganization = '';
  }

  isAppAdmin(user: User): boolean {
    return user.role === 'ROLE_ADMIN_SYSTEME';
  }

  /** Empêcher un App Admin de gérer un autre App Admin (y compris lui-même) */
  isBlockedForAppAdmin(user: User): boolean {
    return this.currentUserRole === 'ROLE_ADMIN_SYSTEME' && this.isAppAdmin(user);
  }

  /** Empêcher un Admin Org de gérer des utilisateurs qui ne sont pas des agents de son org */
  isBlockedForOrgAdmin(user: User): boolean {
    if (this.currentUserRole !== 'ROLE_ORGANISATION_ADMIN') return false;
    return user.role !== 'ROLE_ORGANISATION_AGENT';
  }

  isActionDisabled(user: User): boolean {
    return this.isBlockedForAppAdmin(user) || this.isBlockedForOrgAdmin(user) || this.isCurrentUser(user) || user.is_deleted;
  }

  isToggleDeleteDisabled(user: User): boolean {
    return this.isBlockedForAppAdmin(user) || this.isBlockedForOrgAdmin(user) || this.isCurrentUser(user) || user.is_deleted || this.isCriticalSuperAdmin(user) || this.isCriticalAppAdmin(user) || this.isCriticalOrgAdmin(user);
  }

  isEditToggleDisabled(): boolean {
    if (!this.editUser) return true;
    return this.isCurrentUser(this.editUser) || this.isBlockedForAppAdmin(this.editUser) || this.isBlockedForOrgAdmin(this.editUser) || this.editUser.is_deleted || this.isCriticalSuperAdmin(this.editUser) || this.isCriticalAppAdmin(this.editUser) || this.isCriticalOrgAdmin(this.editUser);
  }

  isDeleteBlockedByCritical(user: User): boolean {
    return this.isCriticalSuperAdmin(user) || this.isCriticalAppAdmin(user) || this.isCriticalOrgAdmin(user);
  }

  actionTitle(user: User, action: 'edit' | 'reset' | 'toggle' | 'delete'): string {
    if (user.is_deleted) return 'Compte supprimé';
    if (this.isBlockedForAppAdmin(user)) {
      if (this.isCurrentUser(user)) {
        const msgs: Record<string, string> = {
          edit: 'Vous ne pouvez pas modifier votre propre compte',
          reset: 'Vous ne pouvez pas réinitialiser votre propre mot de passe',
          toggle: 'Vous ne pouvez pas modifier votre statut',
          delete: 'Vous ne pouvez pas vous supprimer',
        };
        return msgs[action];
      }
      return 'Seul un Super Admin peut gérer un Admin Système';
    }
    if (this.isBlockedForOrgAdmin(user)) {
      return 'Vous ne pouvez gérer que les agents de votre organisation';
    }
    if (this.isCurrentUser(user)) {
      const msgs: Record<string, string> = {
        edit: 'Vous ne pouvez pas modifier votre propre compte',
        reset: 'Vous ne pouvez pas réinitialiser votre propre mot de passe',
        toggle: 'Vous ne pouvez pas vous désactiver',
        delete: 'Vous ne pouvez pas vous supprimer',
      };
      return msgs[action];
    }
    if ((action === 'toggle' || action === 'delete') && this.isCriticalSuperAdmin(user)) return 'Impossible : cela laisserait moins de deux super administrateurs actifs';
    if ((action === 'toggle' || action === 'delete') && this.isCriticalAppAdmin(user)) return 'Impossible : cela laisserait moins de deux administrateurs système actifs';
    if ((action === 'toggle' || action === 'delete') && this.isCriticalOrgAdmin(user)) return 'Impossible : cette organisation n\'aurait plus aucun administrateur actif';
    const labels: Record<string, string> = { edit: 'Modifier', reset: 'Réinitialiser le mot de passe', toggle: user.is_active ? 'Désactiver' : 'Activer', delete: 'Supprimer' };
    return labels[action];
  }

  get criticalSuperAdminSelectedCount(): number {
    return this.criticalSuperAdminSelectedIds.length;
  }

  openToggleModal(user: User): void {
    this.toggleTargetUser = user;
    this.toggleAction = user.is_active ? 'désactiver' : 'activer';
    this.showConfirmToggleModal = true;
    document.body.style.overflow = 'hidden';
  }

  closeToggleModal(): void {
    this.showConfirmToggleModal = false;
    this.toggleTargetUser = null;
    document.body.style.overflow = '';
  }

  confirmToggle(): void {
    if (!this.toggleTargetUser) return;
    this.userService.toggleActive(this.toggleTargetUser.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.toastService.success('Succès', `Compte ${this.toggleAction} avec succès`);
        this.closeToggleModal();
        this.loadUsers();
      },
      error: () => this.toastService.error('Erreur', 'Erreur lors du changement de statut'),
    });
  }

  // ============================================
  // Restauration de comptes
  // ============================================

  openRestoreModal(user: User): void {
    this.restoreUser_target = user;
    this.isBulkRestore = false;
    this.restoring = false;
    this.showRestoreModal = true;
    document.body.style.overflow = 'hidden';
  }

  openBulkRestoreModal(): void {
    this.restoreUser_target = null;
    this.isBulkRestore = true;
    this.restoring = false;
    this.showRestoreModal = true;
    document.body.style.overflow = 'hidden';
  }

  closeRestoreModal(): void {
    if (this.restoring) return;
    this.showRestoreModal = false;
    this.restoreUser_target = null;
    this.isBulkRestore = false;
    document.body.style.overflow = '';
  }

  confirmRestore(): void {
    if (this.isBulkRestore) {
      if (this.restoring || this.selectedIds.size === 0) return;
      this.restoring = true;
      const ids = Array.from(this.selectedIds);
      this.userService.bulkRestoreUsers(ids).pipe(takeUntil(this.destroy$)).subscribe({
        next: (res) => {
          this.restoring = false;
          this.toastService.success('Succès', `${res.restored_count} utilisateur(s) restauré(s)`);
          this.closeRestoreModal();
          this.selectedIds.clear();
          this.loadUsers();
        },
        error: () => {
          this.restoring = false;
          this.toastService.error('Erreur', 'Erreur lors de la restauration');
        },
      });
    } else if (this.restoreUser_target) {
      if (this.restoring) return;
      this.restoring = true;
      this.userService.restoreUser(this.restoreUser_target.id).pipe(takeUntil(this.destroy$)).subscribe({
        next: () => {
          this.restoring = false;
          this.toastService.success('Succès', `Compte de "${this.restoreUser_target!.first_name} ${this.restoreUser_target!.last_name}" restauré`);
          this.closeRestoreModal();
          this.loadUsers();
        },
        error: () => {
          this.restoring = false;
          this.toastService.error('Erreur', 'Erreur lors de la restauration');
        },
      });
    }
  }

  // ============================================
  // Onglets Actifs / Corbeille
  // ============================================
  setTab(deleted: boolean): void {
    if (this.showDeleted === deleted) return;
    this.showDeleted = deleted;
    this.selectedIds.clear();
    this.searchText = '';
    this.displayMode = 'all';
    this.currentPage = 1;
    this.applyFiltersAndSort();
  }

  // ============================================
  // Suppression définitive (irréversible)
  // ============================================
  openPermanentDeleteModal(user: User): void {
    this.permanentDeleteTarget = user;
    this.isBulkPermanent = false;
    this.permanentDeleting = false;
    this.showPermanentDeleteModal = true;
    document.body.style.overflow = 'hidden';
  }

  openBulkPermanentDeleteModal(): void {
    if (this.selectedIds.size === 0) return;
    this.permanentDeleteTarget = null;
    this.isBulkPermanent = true;
    this.permanentDeleting = false;
    this.showPermanentDeleteModal = true;
    document.body.style.overflow = 'hidden';
  }

  closePermanentDeleteModal(): void {
    if (this.permanentDeleting) return;
    this.showPermanentDeleteModal = false;
    this.permanentDeleteTarget = null;
    this.isBulkPermanent = false;
    document.body.style.overflow = '';
  }

  confirmPermanentDelete(): void {
    if (this.permanentDeleting) return;
    const done = (n: number) => {
      this.permanentDeleting = false;
      this.closePermanentDeleteModal();
      this.selectedIds.clear();
      this.loadUsers();
      this.toastService.success('Suppression définitive', `${n} utilisateur(s) supprimé(s) définitivement`);
    };
    const fail = () => {
      this.permanentDeleting = false;
      this.toastService.error('Erreur', 'Suppression définitive impossible');
    };
    if (this.isBulkPermanent) {
      if (this.selectedIds.size === 0) return;
      this.permanentDeleting = true;
      const ids = Array.from(this.selectedIds);
      this.userService.bulkPermanentDeleteUsers(ids).pipe(takeUntil(this.destroy$)).subscribe({
        next: (res) => done(res.deleted_count), error: fail,
      });
    } else if (this.permanentDeleteTarget) {
      this.permanentDeleting = true;
      this.userService.permanentDeleteUser(this.permanentDeleteTarget.id).pipe(takeUntil(this.destroy$)).subscribe({
        next: () => done(1), error: fail,
      });
    }
  }

  // ============================================
  // Menu contextuel des lignes (clic droit)
  // ============================================

  onRowRightClick(event: MouseEvent, user: User, field?: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenuPosition = { x: event.clientX, y: event.clientY };
    this.contextMenuUser = user;
    this.contextMenuField = field || null;
    this.selectedCellValue = field ? String((user as any)[field] ?? '') : null;
    this.showRowContextMenu = true;
  }

  // ============================================
  // Helpers globaux
  // ============================================

  getRoleBadgeClass(role: string): string {
    switch (role) {
      case 'ROLE_SUPER_ADMIN': return 'badge-super-admin';
      case 'ROLE_ADMIN_SYSTEME': return 'badge-admin';
      case 'ROLE_ORGANISATION_ADMIN': return 'badge-org-admin';
      case 'ROLE_ORGANISATION_AGENT': return 'badge-agent';
      default: return 'badge-default';
    }
  }

  getRoleLongName(role: string): string {
    switch (role) {
      case 'ROLE_SUPER_ADMIN': return 'Super Admin';
      case 'ROLE_ADMIN_SYSTEME': return 'Admin Système';
      case 'ROLE_ORGANISATION_ADMIN': return 'Admin Organisation';
      case 'ROLE_ORGANISATION_AGENT': return 'Agent Organisation';
      default: return role;
    }
  }

  getCellValue(user: User, field: string): string {
    switch (field) {
      case 'first_name': return `${user.first_name} ${user.last_name}`;
      case 'role': return this.getRoleLongName(user.role);
      case 'is_active': return user.is_active ? 'Actif' : (user.is_deleted ? 'Supprimé' : 'Inactif');
      case 'is_deleted': return user.is_deleted ? 'Oui' : 'Non';
      case 'is_superuser': return user.is_superuser ? 'Oui' : 'Non';
      case 'must_change_password': return user.must_change_password ? 'Oui' : 'Non';
      default: return String((user as any)[field] ?? '—');
    }
  }

  closeAllContextMenus(): void {
    this.showColumnContextMenu = false;
    this.showRowContextMenu = false;
    this.contextMenuColumn = null;
    this.contextMenuUser = null;
    this.contextMenuField = null;
  }

  private handleGlobalClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.filter-menu-wrapper') && !target.closest('.context-menu')) {
      this.showExportMenu = false;
      this.showFilterMenu = false;
      this.showFieldFilterMenu = false;
      this.closeAllContextMenus();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.showAddModal) { this.closeAddModal(); return; }
    if (this.showEditModal) { this.closeEditModal(); return; }
    if (this.showDetailModal) { this.closeDetailModal(); return; }
    if (this.showDeleteModal) { this.closeDeleteModal(); return; }
    if (this.showResetPasswordModal) { this.closeResetPasswordModal(); return; }
    if (this.showConfirmToggleModal) { this.closeToggleModal(); return; }
    if (this.showRestoreModal) { this.closeRestoreModal(); return; }
  }
}