import { formatDateTime, formatFieldDate } from '../../../shared/utils/date-format.util';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../../../shared/components/table-pagination/table-pagination.component';
import { Component, OnInit, OnDestroy, HostListener, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Observable, forkJoin, Subscription } from 'rxjs';
import { skip } from 'rxjs/operators';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { ProjectsService } from '../../../core/services/projects.service';
import { BreadcrumbService } from '../../../core/layout/services/breadcrumb.service';
import { BreadcrumbItem } from '../../../core/layout/interfaces/menu.interface';
import { OrganismeService } from '../../../core/services/organisme.service';
import { ToastService } from '../../../core/services/toast.service';
import { OrganismeNiveau1, OrganismeNiveau2 } from '../../../core/models/organisme.model';
import {
  Projet, Propriete, Affaire, Ssdgps, Session,
  PROCEDURE_OPTIONS, PROCEDURE_NATURES, PROCEDURES_SANS_DATE_BORNAGE,
  NATURE_AFFAIRE_LABELS, NATURE_SSDGPS_OPTIONS, TYPE_SSDGPS_OPTIONS, NatureAffaire,
} from '../../../core/models/project.model';
import { TableSortConfigService, OrgSortLevel } from '../../../core/services/table-sort-config.service';
import { SortableField, compareByLevels, sortLevelOf, sortDirOf } from '../../../shared/components/multi-level-sort/multi-level-sort.util';
import { MultiLevelSortComponent } from '../../../shared/components/multi-level-sort/multi-level-sort.component';
import { ColumnConfigComponent } from '../../../shared/components/column-config/column-config.component';
import { applyColumnsConfig, toColumnPrefs, ManagedColumn, StoredColumnPref } from '../../../shared/components/column-config/column-config.util';
import { ColumnFilterMap, withColumnFilter, rowMatchesColumnFilters, activeFilterCount } from '../../../shared/components/column-filter/column-filter.util';
import { TableColumnsConfigService } from '../../../core/services/table-columns-config.service';

type Level = 'propriete' | 'affaire' | 'ssdgps' | 'session';

interface ColumnConfig {
  field: string;
  label: string;
  visible: boolean;
  type?: 'text' | 'date' | 'number' | 'boolean';
}

const VIEW_MODE_KEY = 'sdgps_explorer_view_mode';

const COLUMNS_BY_LEVEL: Record<Level, ColumnConfig[]> = {
  propriete: [
    { field: 'nom_propriete', label: 'Propriété-dite', visible: true, type: 'text' },
    { field: 'id_propriete', label: 'ID propriété', visible: true, type: 'text' },
    { field: 'id_requisition', label: 'Réquisition', visible: true, type: 'text' },
    { field: 'id_titre', label: 'Titre foncier', visible: true, type: 'text' },
    { field: 'nbr_total_affaires', label: 'Affaires', visible: true, type: 'number' },
    { field: 'nbr_total_ssdgps', label: 'SSDGPS', visible: true, type: 'number' },
    { field: 'nbr_total_sessions', label: 'Sessions', visible: true, type: 'number' },
    { field: 'nbr_total_pieces', label: 'Pièces', visible: true, type: 'number' },
    { field: 'created_at', label: 'Créé le', visible: false, type: 'date' },
    { field: 'updated_at', label: 'Modifié le', visible: false, type: 'date' },
    { field: 'is_deleted', label: 'Supprimé', visible: false, type: 'boolean' },
    { field: 'deleted_at', label: 'Supprimé le', visible: false, type: 'date' },
    { field: 'created_by_email', label: 'Créé par', visible: false, type: 'text' },
    { field: 'updated_by_email', label: 'Modifié par', visible: false, type: 'text' },
    { field: 'deleted_by_email', label: 'Supprimé par', visible: false, type: 'text' },
  ],
  affaire: [
    { field: 'numero_sd_affaire', label: 'N° SD', visible: true, type: 'number' },
    { field: 'nature_procedure_affaire', label: 'Procédure', visible: true, type: 'text' },
    { field: 'nature_affaire', label: 'Nature', visible: true, type: 'text' },
    { field: 'date_bornage', label: 'Date bornage', visible: true, type: 'date' },
    { field: 'nbr_total_ssdgps', label: 'SSDGPS', visible: true, type: 'number' },
    { field: 'nbr_total_sessions', label: 'Sessions', visible: true, type: 'number' },
    { field: 'nbr_total_pieces', label: 'Pièces', visible: true, type: 'number' },
    { field: 'created_at', label: 'Créé le', visible: false, type: 'date' },
    { field: 'updated_at', label: 'Modifié le', visible: false, type: 'date' },
    { field: 'is_deleted', label: 'Supprimé', visible: false, type: 'boolean' },
    { field: 'deleted_at', label: 'Supprimé le', visible: false, type: 'date' },
    { field: 'created_by_email', label: 'Créé par', visible: false, type: 'text' },
    { field: 'updated_by_email', label: 'Modifié par', visible: false, type: 'text' },
    { field: 'deleted_by_email', label: 'Supprimé par', visible: false, type: 'text' },
  ],
  ssdgps: [
    { field: 'nature_ssdgps', label: 'Nature SSDGPS', visible: true, type: 'text' },
    { field: 'numero_ssdgps', label: 'Numéro', visible: true, type: 'number' },
    { field: 'type_ssdgps', label: 'Type', visible: true, type: 'text' },
    { field: 'nbr_total_sessions', label: 'Sessions', visible: true, type: 'number' },
    { field: 'nbr_total_pieces', label: 'Pièces', visible: true, type: 'number' },
    { field: 'created_at', label: 'Créé le', visible: false, type: 'date' },
    { field: 'updated_at', label: 'Modifié le', visible: false, type: 'date' },
    { field: 'is_deleted', label: 'Supprimé', visible: false, type: 'boolean' },
    { field: 'deleted_at', label: 'Supprimé le', visible: false, type: 'date' },
    { field: 'created_by_email', label: 'Créé par', visible: false, type: 'text' },
    { field: 'updated_by_email', label: 'Modifié par', visible: false, type: 'text' },
    { field: 'deleted_by_email', label: 'Supprimé par', visible: false, type: 'text' },
  ],
  session: [
    { field: 'numero_session', label: 'N° Session', visible: true, type: 'number' },
    { field: 'date_session', label: 'Date session', visible: true, type: 'date' },
    { field: 'nbr_total_pieces', label: 'Pièces', visible: true, type: 'number' },
    { field: 'created_at', label: 'Créé le', visible: false, type: 'date' },
    { field: 'updated_at', label: 'Modifié le', visible: false, type: 'date' },
    { field: 'is_deleted', label: 'Supprimé', visible: false, type: 'boolean' },
    { field: 'deleted_at', label: 'Supprimé le', visible: false, type: 'date' },
    { field: 'created_by_email', label: 'Créé par', visible: false, type: 'text' },
    { field: 'updated_by_email', label: 'Modifié par', visible: false, type: 'text' },
    { field: 'deleted_by_email', label: 'Supprimé par', visible: false, type: 'text' },
  ],
};

const DEFAULT_SORT_BY_LEVEL: Record<Level, string> = {
  propriete: 'nom_propriete', affaire: 'numero_sd_affaire', ssdgps: 'numero_ssdgps', session: 'numero_session',
};

// Clé de persistance du tri MULTI-NIVEAUX (backend) par niveau de l'explorateur.
const SORT_KEY_BY_LEVEL: Record<Level, string> = {
  propriete: 'project_proprietes', affaire: 'project_affaires',
  ssdgps: 'project_ssdgps', session: 'project_sessions',
};
// Champs triables proposés par niveau (dérivés des colonnes du niveau).
const SORTABLE_FIELDS_BY_LEVEL: Record<Level, SortableField[]> = {
  propriete: COLUMNS_BY_LEVEL.propriete.map(c => ({ field: c.field, label: c.label })),
  affaire: COLUMNS_BY_LEVEL.affaire.map(c => ({ field: c.field, label: c.label })),
  ssdgps: COLUMNS_BY_LEVEL.ssdgps.map(c => ({ field: c.field, label: c.label })),
  session: COLUMNS_BY_LEVEL.session.map(c => ({ field: c.field, label: c.label })),
};

const FIELD_DESCRIPTIONS: Record<string, string> = {
  nom_propriete: 'Nom de la propriété (propriété-dite)',
  id_requisition: 'Identifiant de réquisition (R<numéro>/<indice>)',
  id_titre: 'Identifiant du titre foncier (T<numéro>/<indice>)',
  id_propriete: 'Identifiant de la propriété : le titre foncier s\'il est renseigné, sinon la réquisition',
  numero_sd_affaire: "Numéro d'ordre du SD d'affaire dans la propriété",
  nature_procedure_affaire: "Type de procédure d'immatriculation",
  nature_affaire: "Nature précise de l'affaire (dépend de la procédure)",
  date_bornage: 'Date de bornage ou de recollement',
  nature_ssdgps: 'Nature du sous-sous-dossier GPS',
  numero_ssdgps: "Numéro d'ordre du SSDGPS dans l'affaire",
  type_ssdgps: 'Mono-session ou multi-session',
  nbr_total_affaires: 'Nombre total d\'affaires (SD) rattachées',
  nbr_total_ssdgps: 'Nombre total de SSDGPS rattachés',
  nbr_total_sessions: 'Nombre total de sessions rattachées',
  nbr_total_pieces: 'Nombre total de pièces rattachées',
  numero_session: "Numéro d'ordre de la session",
  date_session: "Date de l'observation",
  created_at: "Date de création de l'enregistrement",
  updated_at: "Date de dernière modification de l'enregistrement",
  is_deleted: "Indique si l'enregistrement a été supprimé (logique)",
  deleted_at: "Date de suppression de l'enregistrement",
  created_by_email: "Utilisateur ayant créé l'enregistrement",
  updated_by_email: "Utilisateur ayant modifié l'enregistrement en dernier",
  deleted_by_email: "Utilisateur ayant supprimé l'enregistrement",
};

@Component({
  selector: 'app-project-explorer',
  templateUrl: './project-explorer.component.html',
  styleUrls: ['./project-explorer.component.scss'],
})
export class ProjectExplorerComponent implements OnInit, OnDestroy {
  readonly procedureOptions = PROCEDURE_OPTIONS;
  readonly natureSsdgpsOptions = NATURE_SSDGPS_OPTIONS;
  readonly typeSsdgpsOptions = TYPE_SSDGPS_OPTIONS;

  private boundHandleClickOutside!: (event: Event) => void;
  private qpSub?: Subscription;

  projet: Projet | null = null;
  level: Level = 'propriete';
  chain: { propriete?: Propriete; affaire?: Affaire; ssdgps?: Ssdgps } = {};
  activeItems: any[] = [];
  deletedItems: any[] = [];
  loading = false;
  private manualOrder: string[] | null = null;

  /** Éléments du niveau courant selon l'onglet sélectionné (Actifs / Corbeille). */
  get items(): any[] { return this.showDeleted ? this.deletedItems : this.activeItems; }
  get activeCount(): number { return this.activeItems.length; }
  get deletedCount(): number { return this.deletedItems.length; }

  // Vue Cartes / Tableau
  viewMode: 'cards' | 'table' = 'cards';

  // Recherche & sélection
  searchText = '';
  selectedIds = new Set<string>();

  // Mode d'affichage (footer) / filtre par champ
  displayMode: 'all' | 'selected' = 'all';
  activeFieldFilter: string | null = null;
  activeFieldFilterLabel = '';
  fieldFilterValue = '';
  showFilterMenu = false;
  showFieldFilterMenu = false;

  // Tri (générique, partagé entre les modes Cartes et Tableau)
  sortColumn = DEFAULT_SORT_BY_LEVEL.propriete;
  sortDirection: 'asc' | 'desc' = 'asc';

  // --- Tri MULTI-NIVEAUX par niveau (config opérateur, héritée du super admin) — parité orgs ---
  sortLevelsByLevel: Record<Level, OrgSortLevel[]> = {
    propriete: [], affaire: [], ssdgps: [], session: [],
  };
  savingSort = false;
  savedSortFlash = false;
  resettingSort = false;
  private sortSaveTimer: any;
  @ViewChild(MultiLevelSortComponent) private sortCmp?: MultiLevelSortComponent;
  /** Ouvre la modale de tri (depuis un clic d'en-tête). */
  openSort(): void { this.sortCmp?.open(); }
  /** Niveaux de tri du niveau courant (source de vérité pour la modale + le tri). */
  get sortLevels(): OrgSortLevel[] { return this.sortLevelsByLevel[this.level]; }
  /** Clé de persistance backend du niveau courant. */
  get sortKey(): string { return SORT_KEY_BY_LEVEL[this.level]; }
  /** Champs triables du niveau courant. */
  get sortableFields(): SortableField[] { return SORTABLE_FIELDS_BY_LEVEL[this.level]; }

  // Colonnes (mode Tableau) — config opérateur PAR NIVEAU, héritée du super admin, via composant partagé
  columns: ColumnConfig[] = [];
  @ViewChild(ColumnConfigComponent) private columnCfg?: ColumnConfigComponent;
  /** Description d'une colonne pour la modale partagée (référence stable). */
  describeColumn = (field: string): string => this.getFieldDescription(field);
  savingColumns = false;
  savedColumnsFlash = false;
  resettingColumns = false;
  private columnsSaveTimer: any;

  // Pagination (mode Tableau)
  currentPage = 1;
  pageSize = DEFAULT_PAGE_SIZE;
  pageSizeOptions = [...PAGE_SIZE_OPTIONS];

  // Affichage des éléments supprimés
  showDeleted = false;

  // Suppression (confirmation)
  showDeleteModal = false;
  deleteTarget: any = null;
  isBulkDelete = false;
  deleting = false;

  // Restauration
  showRestoreModal = false;
  restoreTarget: any = null;
  isBulkRestore = false;
  restoring = false;

  // Suppression définitive (corbeille)
  showPermanentDeleteModal = false;
  permanentDeleteTarget: any = null;
  isBulkPermanent = false;
  permanentDeleting = false;

  /** Vue à plat de tous les SSDGPS du projet (page dédiée `:id/ssdgps`). */
  viewAllSsdgps(): void {
    this.router.navigate(['ssdgps'], { relativeTo: this.route });
  }

  // Pièces (Phase 6.5) — page dédiée par SSDGPS
  openPieces(item: any, ev: Event): void {
    ev.stopPropagation();
    const base = { proprieteId: this.chain.propriete?.id, affaireId: this.chain.affaire?.id };
    if (this.level === 'ssdgps') {
      if (item.type_ssdgps === 'mono-session') {
        // Mono-session : accès direct aux pièces, aucune sélection de session intermédiaire
        this.router.navigate(['pieces', item.id], { relativeTo: this.route, queryParams: base });
      } else {
        // Multi-session : descendre en liste sessions (même effet que clic carte)
        this.descend(item);
      }
    } else if (this.level === 'session') {
      // Session précise → passer ssdgpsId pour que goBack() revienne ici
      this.router.navigate(['pieces', this.chain.ssdgps!.id], {
        relativeTo: this.route,
        queryParams: { ...base, session: item.id, ssdgpsId: this.chain.ssdgps!.id },
      });
    }
  }

  // Modale de saisie
  showModal = false;
  editing: any = null;
  submitting = false;
  form!: FormGroup;

  // Formulaire Affaire dynamique
  availableNatures: { value: NatureAffaire; label: string }[] = [];
  dateBornageRequired = true;

  // Formulaire Propriété : organismes (le 2e niveau dépend du 1er choisi)
  organismeN1Options: OrganismeNiveau1[] = [];
  organismeN2All: OrganismeNiveau2[] = [];
  availableN2: OrganismeNiveau2[] = [];
  private organismesLoaded = false;

  // Menu contextuel des lignes/cellules
  showContextMenu = false;
  contextMenuPosition = { x: 0, y: 0 };
  contextMenuItem: any = null;
  contextMenuField: string | null = null;
  selectedCellValue: string | null = null;

  // Menu contextuel des colonnes
  showColumnContextMenu = false;
  contextMenuColumn: ColumnConfig | null = null;

  constructor(
    private service: ProjectsService,
    private organismeService: OrganismeService,
    private route: ActivatedRoute,
    private router: Router,
    private toast: ToastService,
    private fb: FormBuilder,
    private breadcrumb: BreadcrumbService,
    private sortConfigService: TableSortConfigService,
    private columnsConfigService: TableColumnsConfigService,
  ) {}

  ngOnInit(): void {
    this.viewMode = (localStorage.getItem(VIEW_MODE_KEY) as 'cards' | 'table') || 'cards';
    this.boundHandleClickOutside = this.handleGlobalClick.bind(this);
    document.addEventListener('click', this.boundHandleClickOutside);

    const id = this.route.snapshot.paramMap.get('id')!;
    this.service.getProjet(id).subscribe({
      next: (p) => {
        this.projet = p;
        // Niveau initial déduit des query params (forcé : on applique même si « vide »).
        this.applyQueryParams(this.route.snapshot.queryParamMap, true);
        // Réagir aux CHANGEMENTS de query params sur la MÊME route : c'est ce qui rend
        // cliquables les crumps du fil du topbar (projet / propriété / affaire / SSDGPS),
        // l'URL de l'explorateur restant `:id`. `skip(1)` ignore l'émission initiale
        // (déjà traitée) ; le garde d'idempotence évite tout double chargement.
        this.qpSub = this.route.queryParamMap.pipe(skip(1)).subscribe(qp => this.applyQueryParams(qp, false));
      },
      error: () => { this.toast.error('Erreur', 'Projet introuvable'); this.backToList(); },
    });
  }

  /**
   * Restaure le niveau de l'explorateur d'après les query params (propriété/affaire/SSDGPS).
   * `force` = true pour l'application initiale ; sinon un garde d'idempotence évite de
   * recharger quand les params correspondent déjà à l'état courant (ex. URL synchronisée par
   * nous-mêmes après une navigation par carte / fil interne).
   */
  private applyQueryParams(qp: ParamMap, force: boolean): void {
    const proprieteId = qp.get('proprieteId');
    const affaireId = qp.get('affaireId');
    const ssdgpsId = qp.get('ssdgpsId');
    if (!force && this.matchesCurrentState(proprieteId, affaireId, ssdgpsId)) return;
    if (proprieteId && affaireId && ssdgpsId) this.restoreToSessionLevel(proprieteId, affaireId, ssdgpsId);
    else if (proprieteId && affaireId) this.restoreToSsdgpsLevel(proprieteId, affaireId);
    else if (proprieteId) this.restoreToAffaireLevel(proprieteId);
    else this.goToLevel('propriete');
  }

  /** Vrai si les query params correspondent déjà au niveau/chaîne courant. */
  private matchesCurrentState(proprieteId: string | null, affaireId: string | null, ssdgpsId: string | null): boolean {
    return (proprieteId || null) === (this.chain.propriete?.id || null)
        && (affaireId || null) === (this.chain.affaire?.id || null)
        && (ssdgpsId || null) === (this.chain.ssdgps?.id || null);
  }

  /**
   * Aligne l'URL (query params) sur le niveau/chaîne courant. Appelé à CHAQUE changement de
   * niveau (cartes, fil interne, restauration) → l'URL reflète toujours la position, ce qui
   * rend TOUS les crumps du fil du topbar réellement navigables quel que soit le niveau.
   */
  private syncUrlToState(): void {
    if (!this.projet) return;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        proprieteId: this.chain.propriete?.id ?? null,
        affaireId: this.chain.affaire?.id ?? null,
        ssdgpsId: this.chain.ssdgps?.id ?? null,
      },
      replaceUrl: true,
    });
  }

  /**
   * Revient directement au niveau SSDGPS d'une affaire donnée (retour depuis la page
   * dédiée des pièces, qui vit sur une route sœur de `:id` et ne peut donc pas
   * reconstruire la chaîne propriété/affaire via une navigation relative `..`).
   */
  private restoreToSsdgpsLevel(proprieteId: string, affaireId: string): void {
    this.service.getProprietes(this.projet!.id).subscribe({
      next: (proprietes) => {
        const propriete = proprietes.find(p => p.id === proprieteId);
        if (!propriete) { this.goToLevel('propriete'); return; }
        this.service.getAffaires(propriete.id).subscribe({
          next: (affaires) => {
            const affaire = affaires.find(a => a.id === affaireId);
            if (!affaire) { this.goToLevel('propriete'); return; }
            this.chain = { propriete, affaire };
            this.level = 'ssdgps';
            this.showDeleted = false;
            this.resetLevelState();
            this.loadLevel();
          },
          error: () => this.goToLevel('propriete'),
        });
      },
      error: () => this.goToLevel('propriete'),
    });
  }

  /**
   * Restaure la chaîne jusqu'au niveau AFFAIRE (liste des affaires d'une propriété) — utilisé
   * quand on clique le crumb « propriété » du fil du topbar depuis une page pièces.
   */
  private restoreToAffaireLevel(proprieteId: string): void {
    this.service.getProprietes(this.projet!.id).subscribe({
      next: (proprietes) => {
        const propriete = proprietes.find(p => p.id === proprieteId);
        if (!propriete) { this.goToLevel('propriete'); return; }
        this.chain = { propriete };
        this.level = 'affaire';
        this.showDeleted = false;
        this.resetLevelState();
        this.loadLevel();
      },
      error: () => this.goToLevel('propriete'),
    });
  }

  /** Restaure la chaîne jusqu'au niveau session (retour depuis la page pièces d'un SSDGPS multi-session). */
  private restoreToSessionLevel(proprieteId: string, affaireId: string, ssdgpsId: string): void {
    this.service.getProprietes(this.projet!.id).subscribe({
      next: (proprietes) => {
        const propriete = proprietes.find(p => p.id === proprieteId);
        if (!propriete) { this.goToLevel('propriete'); return; }
        this.service.getAffaires(propriete.id).subscribe({
          next: (affaires) => {
            const affaire = affaires.find(a => a.id === affaireId);
            if (!affaire) { this.goToLevel('propriete'); return; }
            this.service.getSsdgps(affaire.id).subscribe({
              next: (ssdgpsList) => {
                const ssdgps = ssdgpsList.find(s => s.id === ssdgpsId);
                if (!ssdgps) {
                  this.chain = { propriete, affaire };
                  this.level = 'ssdgps';
                  this.resetLevelState();
                  this.loadLevel();
                  return;
                }
                this.chain = { propriete, affaire, ssdgps };
                this.level = 'session';
                this.showDeleted = false;
                this.resetLevelState();
                this.loadLevel();
              },
              error: () => this.goToLevel('propriete'),
            });
          },
          error: () => this.goToLevel('propriete'),
        });
      },
      error: () => this.goToLevel('propriete'),
    });
  }

  ngOnDestroy(): void {
    this.breadcrumb.clear();
    this.qpSub?.unsubscribe();
    if (this.boundHandleClickOutside) document.removeEventListener('click', this.boundHandleClickOutside);
  }

  toggleViewMode(mode: 'cards' | 'table'): void {
    this.viewMode = mode;
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }

  // --- Navigation ---
  private childOf(level: Level): Level | null {
    return ({ propriete: 'affaire', affaire: 'ssdgps', ssdgps: 'session', session: null } as any)[level];
  }

  private resetLevelState(): void {
    this.manualOrder = null;
    this.columns = COLUMNS_BY_LEVEL[this.level].map(c => ({ ...c }));
    this.loadColumnsConfig();
    this.sortColumn = DEFAULT_SORT_BY_LEVEL[this.level];
    this.sortDirection = 'asc';
    this.loadSortConfig();
    this.currentPage = 1;
    this.displayMode = 'all';
    this.clearFieldFilter();
    this.closeAllContextMenus();
    this.updateTopbarBreadcrumb();
    // L'URL doit TOUJOURS refléter le niveau/chaîne courant, y compris après une navigation
    // interne (cartes, fil d'Ariane interne). Sans cela, les crumps du fil du topbar pointant
    // vers le même état (ex. « projet en cours ») ne déclenchent aucune navigation → clic sans
    // effet. La synchronisation rend ainsi tous les crumps réellement cliquables quel que soit
    // le niveau. Idempotent : re-synchroniser vers les mêmes params est un no-op (cf. `qpSub`).
    this.syncUrlToState();
  }

  /**
   * Publie le fil d'Ariane MÉTIER dans le topbar : Accueil › Projets › <Projet> › …chaîne
   * (Propriété/Affaire/SSDGPS)… › <niveau courant>. Les crumbs de la chaîne sont affichés
   * (non cliquables) ; la navigation dans l'explorateur reste assurée par son fil interne.
   */
  private updateTopbarBreadcrumb(): void {
    if (!this.projet) return;
    const base = this.router.url.startsWith('/admin') ? '/admin/projets' : '/projets';
    const projRoute = `${base}/${this.projet.id}`;
    const propId = this.chain.propriete?.id;
    const affId = this.chain.affaire?.id;
    const ssId = this.chain.ssdgps?.id;

    // Les crumps de niveau pointent vers `:id` + query params : l'explorateur réagit à ces
    // changements (cf. `applyQueryParams`) et restaure le bon niveau sans quitter la page.
    const trail: BreadcrumbItem[] = [
      { label: 'Accueil', route: '/home', icon: 'fa-house' },
      { label: 'Projets', route: base, icon: 'fa-folder-open' },
      { label: this.projet.nom_projet || this.projet.code_projet, icon: 'fa-diagram-project', route: projRoute },
    ];
    if (this.chain.propriete) {
      trail.push({
        label: this.proprieteBreadcrumbLabel(this.chain.propriete), icon: 'fa-map-marker-alt',
        route: projRoute, queryParams: { proprieteId: propId },
      });
    }
    if (this.chain.affaire) {
      trail.push({
        label: `SD ${this.chain.affaire.numero_sd_affaire}`, icon: 'fa-file-signature',
        route: projRoute, queryParams: { proprieteId: propId, affaireId: affId },
      });
    }
    if (this.chain.ssdgps) {
      trail.push({
        label: `SSDGPS ${this.chain.ssdgps.numero_ssdgps}`, icon: 'fa-satellite-dish',
        route: projRoute, queryParams: { proprieteId: propId, affaireId: affId, ssdgpsId: ssId },
      });
    }
    trail.push({ label: this.levelTitle, icon: this.levelIcon(), isActive: true });
    this.breadcrumb.set(trail);
  }

  goToLevel(level: Level): void {
    this.level = level;
    this.showDeleted = false;
    // Nettoie la chaîne au-delà du niveau courant
    if (level === 'propriete') this.chain = {};
    else if (level === 'affaire') this.chain = { propriete: this.chain.propriete };
    else if (level === 'ssdgps') this.chain = { propriete: this.chain.propriete, affaire: this.chain.affaire };
    this.resetLevelState();
    this.loadLevel();
  }

  /**
   * Charge en une fois les éléments actifs ET supprimés du niveau courant, afin d'afficher
   * les deux compteurs des onglets Actifs/Corbeille sans aller-retour réseau supplémentaire
   * lors du changement d'onglet.
   */
  loadLevel(): void {
    this.loading = true;
    this.searchText = '';
    this.selectedIds.clear();
    const done = ([active, deleted]: [any[], any[]]) => {
      this.activeItems = active;
      this.deletedItems = deleted;
      this.loading = false;
    };
    const fail = () => { this.toast.error('Erreur', 'Chargement impossible'); this.loading = false; };
    const deletedParams = { show_deleted: true };
    let active$: Observable<any[]>;
    let deleted$: Observable<any[]>;
    switch (this.level) {
      case 'propriete':
        active$ = this.service.getProprietes(this.projet!.id);
        deleted$ = this.service.getProprietes(this.projet!.id, deletedParams);
        break;
      case 'affaire':
        active$ = this.service.getAffaires(this.chain.propriete!.id);
        deleted$ = this.service.getAffaires(this.chain.propriete!.id, deletedParams);
        break;
      case 'ssdgps':
        active$ = this.service.getSsdgps(this.chain.affaire!.id);
        deleted$ = this.service.getSsdgps(this.chain.affaire!.id, deletedParams);
        break;
      case 'session':
        active$ = this.service.getSessions(this.chain.ssdgps!.id);
        deleted$ = this.service.getSessions(this.chain.ssdgps!.id, deletedParams);
        break;
    }
    forkJoin([active$, deleted$]).subscribe({ next: done, error: fail });
  }

  descend(item: any): void {
    if (item.is_deleted) return;
    const child = this.childOf(this.level);
    if (!child) return;
    // Mono-session : aller directement aux pièces (aucun niveau session intermédiaire)
    if (this.level === 'ssdgps' && item.type_ssdgps === 'mono-session') {
      const qp = { proprieteId: this.chain.propriete?.id, affaireId: this.chain.affaire?.id };
      this.router.navigate(['pieces', item.id], { relativeTo: this.route, queryParams: qp });
      return;
    }
    if (this.level === 'propriete') this.chain.propriete = item;
    else if (this.level === 'affaire') this.chain.affaire = item;
    else if (this.level === 'ssdgps') this.chain.ssdgps = item;
    this.level = child;
    this.showDeleted = false;
    this.resetLevelState();
    this.loadLevel();
  }

  // --- Onglets Actifs / Corbeille ---
  setTab(deleted: boolean): void {
    if (this.showDeleted === deleted) return;
    this.showDeleted = deleted;
    this.selectedIds.clear();
    this.searchText = '';
    this.manualOrder = null;
    this.currentPage = 1;
  }

  // --- Tri ---
  toggleSort(): void {
    this.manualOrder = null;
    this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
  }

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

  // --- Tri MULTI-NIVEAUX (config opérateur par niveau, héritée du super admin) — parité orgs ---
  sortLevelOf(field: string): number { return sortLevelOf(this.sortLevels, field); }
  sortDirOf(field: string): '' | 'asc' | 'desc' { return sortDirOf(this.sortLevels, field); }

  /** Charge le tri multi-niveaux du niveau courant (hérité du super admin). */
  private loadSortConfig(): void {
    const level = this.level;
    this.sortConfigService.get(SORT_KEY_BY_LEVEL[level]).subscribe(levels => {
      this.sortLevelsByLevel[level] = levels;
    });
  }

  /** Réception d'une modification depuis la modale : applique + enregistrement auto (anti-rebond). */
  onSortLevelsChange(levels: OrgSortLevel[]): void {
    const level = this.level;
    this.sortLevelsByLevel[level] = levels;
    this.manualOrder = null;
    this.currentPage = 1;
    clearTimeout(this.sortSaveTimer);
    this.sortSaveTimer = setTimeout(() => this.saveSortConfig(level), 500);
  }
  private saveSortConfig(level: Level): void {
    this.savingSort = true;
    this.sortConfigService.save(SORT_KEY_BY_LEVEL[level], this.sortLevelsByLevel[level]).subscribe({
      next: (saved) => {
        this.sortLevelsByLevel[level] = saved; this.savingSort = false; this.savedSortFlash = true;
        setTimeout(() => { this.savedSortFlash = false; }, 2500);
      },
      error: (err) => { this.savingSort = false; this.toast.error('Erreur', err?.error?.detail || 'Enregistrement du tri impossible'); },
    });
  }

  /** Réinitialise le tri du niveau courant avec la configuration SOURCE (compte administrateur). */
  onResetSort(): void {
    if (this.resettingSort) return;
    const level = this.level;
    this.resettingSort = true;
    this.sortConfigService.resetToSource(SORT_KEY_BY_LEVEL[level]).subscribe({
      next: (levels) => {
        this.sortLevelsByLevel[level] = levels; this.resettingSort = false;
        this.manualOrder = null; this.currentPage = 1;
        this.toast.success('Succès', 'Tri réinitialisé avec la configuration source');
      },
      error: (e) => {
        this.resettingSort = false;
        this.toast.error('Erreur', e?.error?.detail || 'Réinitialisation impossible');
      },
    });
  }

  private sortValue(item: any): number | string {
    const v = item[this.sortColumn];
    if (v == null) return '';
    return typeof v === 'string' ? v.toLowerCase() : v;
  }

  // --- Libellés ---
  get levelTitle(): string {
    return { propriete: 'Propriétés', affaire: 'Affaires (SD)', ssdgps: 'SSDGPS', session: 'Sessions' }[this.level];
  }

  itemLabel(item: any, level: Level = this.level): string {
    switch (level) {
      case 'propriete': {
        // Identifiant affiché : le titre foncier s'il existe, sinon la réquisition.
        const idPropriete = this.proprieteIdentifier(item);
        return item.nom_propriete + (idPropriete ? ` (${idPropriete})` : '');
      }
      // Note : le fil d'Ariane utilise `proprieteBreadcrumbLabel` (identifiant seul).
      case 'affaire': return `SD ${item.numero_sd_affaire} — ${item.nature_affaire}`;
      case 'ssdgps': return `SSDGPS ${item.numero_ssdgps} (${item.nature_ssdgps})`;
      case 'session': return `Session ${item.numero_session}`;
      default: return '';
    }
  }

  /**
   * Identifiant d'une propriété : le titre foncier s'il est renseigné, sinon la réquisition
   * (chaîne vide si aucun des deux). Le backend l'expose déjà sous `id_propriete` ; le repli
   * sur les deux champs sources couvre les objets construits côté client (chaîne de navigation).
   */
  proprieteIdentifier(item: any): string {
    return item?.id_propriete || item?.id_titre || item?.id_requisition || '';
  }

  /** Libellé de propriété pour le fil d'Ariane : uniquement l'identifiant
   * (titre foncier s'il existe, sinon réquisition), sans le nom de la propriété. */
  proprieteBreadcrumbLabel(item: any): string {
    return this.proprieteIdentifier(item) || item?.nom_propriete || '';
  }

  natureLabel(v: string): string { return NATURE_AFFAIRE_LABELS[v as NatureAffaire] || v; }
  isLeaf(): boolean { return this.level === 'session'; }

  levelIcon(level: Level = this.level): string {
    return { propriete: 'fa-map-marker-alt', affaire: 'fa-file-signature', ssdgps: 'fa-satellite-dish', session: 'fa-clock' }[level];
  }

  childLabel(): string {
    return { propriete: 'propriété', affaire: 'affaire', ssdgps: 'SSDGPS', session: '' }[this.level];
  }

  /**
   * Format unifié (cf. `date-format.util`) : `date_bornage` et `date_session` s'affichent SANS
   * heure ; toutes les autres dates en `jj/mm/aaaa hh:mm:ss`. Passer le nom du champ quand il
   * est connu pour que la règle s'applique.
   */
  formatDate(value: any, field?: string): string {
    return formatFieldDate(value, field);
  }

  /**
   * Convertit une valeur du backend vers le format attendu par un `<input type="date">`
   * (« YYYY-MM-DD », heure locale). Les seules dates saisies dans l'explorateur sont
   * `date_bornage` et `date_session`, qui ne portent pas d'heure (cf. `date-format.util`).
   */
  private toDateInput(value: any): string | null {
    if (!value) return null;
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    const p = (n: number) => String(n).padStart(2, '0');
    // Composantes UTC (et non locales) : ces dates sont enregistrées à minuit UTC. Lire en heure
    // locale décalerait le jour pré-rempli dans le formulaire pour les fuseaux négatifs.
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }

  // --- Recherche, filtre, tri & sélection ---
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

  get filteredItems(): any[] {
    let result = this.items;
    if (this.displayMode === 'selected') {
      result = result.filter(it => this.selectedIds.has(it.id));
    }
    if (this.searchText) {
      const q = this.searchText.toLowerCase();
      result = result.filter(it => this.itemLabel(it).toLowerCase().includes(q));
    }
    if (this.activeFieldFilter && this.fieldFilterValue) {
      const ff = this.activeFieldFilter;
      const fv = this.fieldFilterValue.toLowerCase();
      result = result.filter(it => {
        const val = it[ff];
        return val != null && String(val).toLowerCase().includes(fv);
      });
    }
    // Filtres de colonne (façon Excel).
    if (activeFilterCount(this.columnFilters)) {
      result = result.filter(it => rowMatchesColumnFilters(it, this.columnFilters, this.cellText));
    }

    if (this.manualOrder) {
      const idx = new Map(this.manualOrder.map((id, i) => [id, i]));
      result = [...result].sort((a, b) => {
        const ia = idx.has(a.id) ? idx.get(a.id)! : Number.MAX_SAFE_INTEGER;
        const ib = idx.has(b.id) ? idx.get(b.id)! : Number.MAX_SAFE_INTEGER;
        return ia - ib;
      });
    } else if (this.sortLevels.length) {
      // Le tri MULTI-NIVEAUX prime sur le tri mono-colonne.
      result = [...result].sort((a, b) => compareByLevels(a, b, this.sortLevels));
    } else {
      result = [...result].sort((a, b) => {
        const ka = this.sortValue(a), kb = this.sortValue(b);
        const cmp = ka < kb ? -1 : ka > kb ? 1 : 0;
        return this.sortDirection === 'asc' ? cmp : -cmp;
      });
    }
    return result;
  }

  get paginatedItems(): any[] {
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

  isSelected(it: any): boolean { return this.selectedIds.has(it.id); }
  toggleSelect(it: any, ev: Event): void {
    ev.stopPropagation();
    this.selectedIds.has(it.id) ? this.selectedIds.delete(it.id) : this.selectedIds.add(it.id);
  }
  get selectedCount(): number { return this.selectedIds.size; }
  clearSelection(): void { this.selectedIds.clear(); }
  get isAllSelected(): boolean {
    const f = this.viewMode === 'table' ? this.paginatedItems : this.filteredItems;
    return f.length > 0 && f.every(it => this.selectedIds.has(it.id));
  }
  toggleSelectAll(): void {
    const f = this.viewMode === 'table' ? this.paginatedItems : this.filteredItems;
    if (this.isAllSelected) f.forEach(it => this.selectedIds.delete(it.id));
    else f.forEach(it => this.selectedIds.add(it.id));
  }
  selectAll(): void { this.filteredItems.forEach(it => this.selectedIds.add(it.id)); }
  deselectAll(): void { this.selectedIds.clear(); }
  invertSelection(): void {
    const f = this.viewMode === 'table' ? this.paginatedItems : this.filteredItems;
    f.forEach(it => this.selectedIds.has(it.id) ? this.selectedIds.delete(it.id) : this.selectedIds.add(it.id));
  }

  getSelectedItemsList(): any[] { return this.items.filter(it => this.selectedIds.has(it.id)); }

  get allSelectedAreDeleted(): boolean {
    if (this.selectedCount === 0) return false;
    return this.getSelectedItemsList().every(it => it.is_deleted);
  }

  moveSelectionToTop(): void {
    if (this.selectedIds.size === 0) return;
    const selected = this.filteredItems.filter(it => this.selectedIds.has(it.id)).map(it => it.id);
    const rest = this.filteredItems.filter(it => !this.selectedIds.has(it.id)).map(it => it.id);
    this.manualOrder = [...selected, ...rest];
    this.currentPage = 1;
  }

  // --- Mode d'affichage / filtre par champ (pied de tableau) ---
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

  clearFieldFilter(): void {
    this.activeFieldFilter = null;
    this.activeFieldFilterLabel = '';
    this.fieldFilterValue = '';
  }

  // --- Colonnes (mode Tableau) — composant partagé, config PAR NIVEAU, source super admin ---
  getVisibleColumns(): ColumnConfig[] { return this.columns.filter(c => c.visible); }

  /** Ouvre la modale d'organisation des colonnes (composant partagé). */
  openColumnConfig(): void { this.columnCfg?.open(); }

  private loadColumnsConfig(): void {
    // La clé dépend du niveau courant (project_proprietes / _affaires / _ssdgps / _sessions).
    this.columnsConfigService.get(this.sortKey).subscribe(prefs => {
      this.columns = applyColumnsConfig(this.columns, prefs);
    });
  }
  onColumnsChange(cols: ManagedColumn[]): void {
    this.columns = cols as ColumnConfig[];
    // Capturer clé + préférences AU MOMENT du changement (le niveau peut changer avant le timeout).
    const key = this.sortKey;
    const prefs = toColumnPrefs(cols);
    clearTimeout(this.columnsSaveTimer);
    this.columnsSaveTimer = setTimeout(() => this.saveColumnsConfig(key, prefs), 500);
  }
  private saveColumnsConfig(key: string, prefs: StoredColumnPref[]): void {
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
    const key = this.sortKey;
    this.columnsConfigService.resetToSource(key).subscribe({
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
    this.onColumnsChange(this.columns.map(c => (c.field === field ? { ...c, visible: false } : { ...c })));
  }
  openColumnConfigFromContext(): void { this.showColumnContextMenu = false; this.openColumnConfig(); }
  /** Ouvrir la modale de tri multi-niveaux depuis le menu contextuel (clic droit en-tête). */
  openSortFromContext(): void { this.showColumnContextMenu = false; this.openSort(); }

  getTypeLabel(type?: string): string {
    return { text: 'TEXTE', date: 'DATE', number: 'NOMBRE', boolean: 'BOOLÉEN' }[type || 'text'] || 'TEXTE';
  }
  getFieldDescription(field: string): string { return FIELD_DESCRIPTIONS[field] || ''; }

  /** Vrai pour les colonnes de comptage (rendu numérique aligné à droite, repli 0). */
  isCountField(field: string): boolean { return field.startsWith('nbr_total_'); }

  getCellValue(item: any, field: string): string {
    if (field === 'date_bornage' || field === 'date_session' || field === 'created_at' || field === 'updated_at' || field === 'deleted_at') return this.formatDate(item[field], field);
    if (field === 'nature_affaire') return this.natureLabel(item[field]);
    if (field === 'is_deleted') return item[field] ? 'Oui' : 'Non';
    if (field === 'id_propriete') return this.proprieteIdentifier(item) || '—';
    if (this.isCountField(field)) return String(item[field] ?? 0);
    return String(item[field] ?? '—');
  }

  // --- Export CSV ---
  private csvEscape(v: any): string {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  exportCsv(): void {
    const cols = this.columns.filter(c => c.visible);
    const header = cols.map(c => c.label).join(';');
    const rows = this.filteredItems.map(it => cols.map(c => this.csvEscape(this.getCellValue(it, c.field))).join(';'));
    const csv = '﻿' + [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.level}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast.success('Export', `${this.filteredItems.length} élément(s) exporté(s)`);
  }

  // --- Formulaire ---
  openCreate(): void { this.editing = null; this.buildForm(); this.showModal = true; }
  openEdit(item: any, ev: Event): void { ev.stopPropagation(); this.editing = item; this.buildForm(item); this.showModal = true; }
  closeModal(): void { if (this.submitting) return; this.showModal = false; this.editing = null; }

  private buildForm(item?: any): void {
    switch (this.level) {
      case 'propriete':
        this.form = this.fb.group({
          nom_propriete: [item?.nom_propriete || '', Validators.required],
          id_requisition: [item?.id_requisition || ''],
          id_titre: [item?.id_titre || ''],
          organisme_niveau1: [item?.organisme_niveau1 || '', Validators.required],
          organisme_niveau2: [item?.organisme_niveau2 || '', Validators.required],
        });
        this.loadOrganismeOptions();
        this.form.get('organisme_niveau1')!.valueChanges.subscribe(v => this.onOrganismeN1Change(v));
        break;
      case 'affaire':
        this.form = this.fb.group({
          numero_sd_affaire: [item?.numero_sd_affaire ?? null, Validators.required],
          nature_procedure_affaire: [item?.nature_procedure_affaire || '', Validators.required],
          nature_affaire: [item?.nature_affaire || '', Validators.required],
          date_bornage: [this.toDateInput(item?.date_bornage)],
        });
        this.onProcedureChange(item?.nature_procedure_affaire || '');
        this.form.get('nature_procedure_affaire')!.valueChanges.subscribe(v => this.onProcedureChange(v));
        break;
      case 'ssdgps':
        this.form = this.fb.group({
          nature_ssdgps: [item?.nature_ssdgps || '', Validators.required],
          numero_ssdgps: [item?.numero_ssdgps ?? null, Validators.required],
          type_ssdgps: [item?.type_ssdgps || 'mono-session', Validators.required],
        });
        break;
      case 'session':
        this.form = this.fb.group({
          numero_session: [item?.numero_session ?? null, Validators.required],
          date_session: [this.toDateInput(item?.date_session)],
        });
        break;
    }
  }

  /** Charge (une fois) les organismes N1/N2 puis recalcule la liste N2 disponible. */
  private loadOrganismeOptions(): void {
    if (this.organismesLoaded) { this.recomputeAvailableN2(); return; }
    forkJoin({
      n1: this.organismeService.getNiveau1(),
      n2: this.organismeService.getNiveau2(),
    }).subscribe({
      next: ({ n1, n2 }) => {
        this.organismeN1Options = n1;
        this.organismeN2All = n2;
        this.organismesLoaded = true;
        this.recomputeAvailableN2();
      },
      error: () => { this.organismeN1Options = []; this.organismeN2All = []; },
    });
  }

  /** Select dépendant : au changement du 1er niveau, filtre le 2e et le réinitialise si invalide. */
  onOrganismeN1Change(n1Id: string): void {
    this.recomputeAvailableN2(n1Id);
    const n2Ctrl = this.form.get('organisme_niveau2');
    if (n2Ctrl && !this.availableN2.some(o => o.id === n2Ctrl.value)) n2Ctrl.setValue('');
  }

  private recomputeAvailableN2(n1Id?: string): void {
    const id = n1Id ?? this.form?.get('organisme_niveau1')?.value ?? '';
    this.availableN2 = this.organismeN2All.filter(o => o.niveau1 === id);
  }

  /** Met à jour les natures disponibles + l'obligation de date selon la procédure. */
  onProcedureChange(procedure: string): void {
    const natures = PROCEDURE_NATURES[procedure as keyof typeof PROCEDURE_NATURES] || [];
    this.availableNatures = natures.map(n => ({ value: n, label: `${n} — ${NATURE_AFFAIRE_LABELS[n]}` }));
    this.dateBornageRequired = !!procedure && !PROCEDURES_SANS_DATE_BORNAGE.includes(procedure as any);
    const natureCtrl = this.form.get('nature_affaire');
    if (natureCtrl && !natures.includes(natureCtrl.value)) natureCtrl.setValue('');
    if (procedure && !this.dateBornageRequired) this.form.get('date_bornage')?.setValue(null);
  }

  get isProprieteInvalid(): boolean {
    if (this.level !== 'propriete') return false;
    return !this.form.value.id_requisition && !this.form.value.id_titre;
  }

  submit(): void {
    if (this.form.invalid || this.submitting) { this.form.markAllAsTouched(); return; }
    if (this.isProprieteInvalid) { this.toast.error('Validation', 'Renseignez au moins la réquisition ou le titre.'); return; }
    if (this.level === 'affaire' && this.dateBornageRequired && !this.form.value.date_bornage) {
      this.toast.error('Validation', 'La date de bornage/recollement est requise pour cette procédure.'); return;
    }
    this.submitting = true;
    const payload: any = { ...this.form.value };
    // Rattache le parent
    if (this.level === 'propriete') payload.projet = this.projet!.id;
    else if (this.level === 'affaire') payload.propriete = this.chain.propriete!.id;
    else if (this.level === 'ssdgps') payload.affaire = this.chain.affaire!.id;
    else if (this.level === 'session') payload.ssdgps = this.chain.ssdgps!.id;

    const done = () => { this.submitting = false; this.closeModal(); this.loadLevel(); this.toast.success('Succès', 'Enregistré'); };
    const fail = (e: any) => {
      this.submitting = false;
      const err = e?.error;
      const msg = typeof err === 'object' && err ? Object.values(err).flat().join(' ') : 'Erreur lors de l\'enregistrement';
      this.toast.error('Échec', String(msg));
    };
    const svc = this.service;
    const id = this.editing?.id;
    const call: Observable<any> = {
      propriete: () => id ? svc.updatePropriete(id, payload) : svc.createPropriete(payload),
      affaire: () => id ? svc.updateAffaire(id, payload) : svc.createAffaire(payload),
      ssdgps: () => id ? svc.updateSsdgps(id, payload) : svc.createSsdgps(payload),
      session: () => id ? svc.updateSession(id, payload) : svc.createSession(payload),
    }[this.level]();
    call.subscribe({ next: done, error: fail });
  }

  // --- Suppression (avec confirmation) ---
  private deleteCall(id: string): Observable<any> {
    const svc = this.service;
    return {
      propriete: () => svc.deletePropriete(id),
      affaire: () => svc.deleteAffaire(id),
      ssdgps: () => svc.deleteSsdgps(id),
      session: () => svc.deleteSession(id),
    }[this.level]();
  }

  openDeleteModal(item: any, ev: Event): void {
    ev.stopPropagation();
    this.deleteTarget = item; this.isBulkDelete = false; this.showDeleteModal = true;
  }
  openBulkDelete(): void {
    if (this.selectedCount === 0) return;
    this.deleteTarget = null; this.isBulkDelete = true; this.showDeleteModal = true;
  }
  closeDeleteModal(): void { if (!this.deleting) { this.showDeleteModal = false; this.deleteTarget = null; } }

  confirmDelete(): void {
    this.deleting = true;
    const finish = (n: number) => {
      this.deleting = false; this.showDeleteModal = false; this.deleteTarget = null;
      this.clearSelection(); this.loadLevel(); this.toast.success('Succès', `${n} élément(s) supprimé(s)`);
    };
    const fail = () => { this.deleting = false; this.toast.error('Erreur', 'Suppression impossible'); };
    if (this.isBulkDelete) {
      const ids = Array.from(this.selectedIds);
      forkJoin(ids.map(id => this.deleteCall(id))).subscribe({ next: () => finish(ids.length), error: fail });
    } else if (this.deleteTarget) {
      this.deleteCall(this.deleteTarget.id).subscribe({ next: () => finish(1), error: fail });
    }
  }

  // --- Restauration ---
  private restoreCall(id: string): Observable<any> {
    const svc = this.service;
    return {
      propriete: () => svc.restorePropriete(id),
      affaire: () => svc.restoreAffaire(id),
      ssdgps: () => svc.restoreSsdgps(id),
      session: () => svc.restoreSession(id),
    }[this.level]();
  }

  openRestoreModal(item: any): void { this.restoreTarget = item; this.isBulkRestore = false; this.showRestoreModal = true; }
  openBulkRestoreModal(): void { if (this.selectedCount === 0) return; this.restoreTarget = null; this.isBulkRestore = true; this.showRestoreModal = true; }
  closeRestoreModal(): void { if (!this.restoring) { this.showRestoreModal = false; this.restoreTarget = null; } }

  confirmRestore(): void {
    this.restoring = true;
    const finish = (n: number) => {
      this.restoring = false; this.showRestoreModal = false; this.restoreTarget = null;
      this.clearSelection(); this.loadLevel(); this.toast.success('Succès', `${n} élément(s) restauré(s)`);
    };
    const fail = () => { this.restoring = false; this.toast.error('Erreur', 'Restauration impossible'); };
    if (this.isBulkRestore) {
      const ids = Array.from(this.selectedIds);
      forkJoin(ids.map(id => this.restoreCall(id))).subscribe({ next: () => finish(ids.length), error: fail });
    } else if (this.restoreTarget) {
      this.restoreCall(this.restoreTarget.id).subscribe({ next: () => finish(1), error: fail });
    }
  }

  // --- Suppression définitive (dispatch par niveau) ---
  private permanentDeleteCall(id: string): Observable<any> {
    const svc = this.service;
    return {
      propriete: () => svc.permanentDeletePropriete(id),
      affaire: () => svc.permanentDeleteAffaire(id),
      ssdgps: () => svc.permanentDeleteSsdgps(id),
      session: () => svc.permanentDeleteSession(id),
    }[this.level]();
  }

  private bulkPermanentDeleteCall(ids: string[]): Observable<{ deleted_count: number; errors: any[] }> {
    const svc = this.service;
    return {
      propriete: () => svc.bulkPermanentDeleteProprietes(ids),
      affaire: () => svc.bulkPermanentDeleteAffaires(ids),
      ssdgps: () => svc.bulkPermanentDeleteSsdgps(ids),
      session: () => svc.bulkPermanentDeleteSessions(ids),
    }[this.level]();
  }

  openPermanentDeleteModal(item: any): void { this.permanentDeleteTarget = item; this.isBulkPermanent = false; this.showPermanentDeleteModal = true; }
  openBulkPermanentDeleteModal(): void { if (this.selectedCount === 0) return; this.permanentDeleteTarget = null; this.isBulkPermanent = true; this.showPermanentDeleteModal = true; }
  closePermanentDeleteModal(): void { if (!this.permanentDeleting) { this.showPermanentDeleteModal = false; this.permanentDeleteTarget = null; } }

  confirmPermanentDelete(): void {
    if (this.permanentDeleting) return;
    const close = () => { this.permanentDeleting = false; this.showPermanentDeleteModal = false; this.permanentDeleteTarget = null; };
    if (this.isBulkPermanent) {
      if (this.selectedCount === 0) return;
      this.permanentDeleting = true;
      const total = this.selectedIds.size;
      const ids = Array.from(this.selectedIds);
      this.bulkPermanentDeleteCall(ids).subscribe({
        next: (res) => {
          close(); this.clearSelection(); this.loadLevel();
          const d = res.deleted_count || 0, f = (res.errors || []).length;
          if (d > 0 && f === 0) this.toast.success('Suppression définitive', `${d} élément(s) supprimé(s) définitivement`);
          else if (d > 0 && f > 0) this.toast.warning('Suppression partielle', `${d} supprimé(s) ; ${f} conservé(s) (sous-données rattachées).`);
          else this.toast.error('Aucune suppression', `${total} élément(s) non supprimé(s) : des sous-données y sont rattachées.`);
        },
        error: () => { this.permanentDeleting = false; this.toast.error('Erreur', 'Suppression définitive impossible'); },
      });
    } else if (this.permanentDeleteTarget) {
      this.permanentDeleting = true;
      this.permanentDeleteCall(this.permanentDeleteTarget.id).subscribe({
        next: () => { close(); this.loadLevel(); this.toast.success('Suppression définitive', 'Élément supprimé définitivement'); },
        error: (e) => { this.permanentDeleting = false; this.toast.error('Suppression impossible', e?.error?.detail || 'Suppression définitive impossible'); },
      });
    }
  }

  // --- Menu contextuel des lignes/cellules (clic droit) ---
  onItemRightClick(event: MouseEvent, item: any, field: string | null = null): void {
    event.preventDefault(); event.stopPropagation();
    this.contextMenuPosition = { x: event.clientX, y: event.clientY };
    this.contextMenuItem = item;
    this.contextMenuField = field;
    this.selectedCellValue = field ? this.getCellValue(item, field) : null;
    this.showContextMenu = true;
  }
  toggleSelectFromContext(): void { if (this.contextMenuItem) this.toggleSelect(this.contextMenuItem, new Event('click')); this.closeContextMenu(); }
  selectAllFromContext(): void { this.selectAll(); this.closeContextMenu(); }
  copyCellValueFromContext(): void {
    if (this.selectedCellValue != null) {
      navigator.clipboard.writeText(this.selectedCellValue).then(() => this.toast.success('Copié', 'Valeur copiée dans le presse-papier'));
    }
    this.closeContextMenu();
  }
  openFromContext(): void { if (this.contextMenuItem && !this.contextMenuItem.is_deleted) this.descend(this.contextMenuItem); this.closeContextMenu(); }
  openEditFromContext(): void {
    if (this.contextMenuItem && !this.contextMenuItem.is_deleted) { this.editing = this.contextMenuItem; this.buildForm(this.contextMenuItem); this.showModal = true; }
    this.closeContextMenu();
  }
  openDeleteFromContext(): void {
    if (this.contextMenuItem && !this.contextMenuItem.is_deleted) { this.deleteTarget = this.contextMenuItem; this.isBulkDelete = false; this.showDeleteModal = true; }
    this.closeContextMenu();
  }
  openRestoreFromContext(): void {
    if (this.contextMenuItem?.is_deleted) this.openRestoreModal(this.contextMenuItem);
    this.closeContextMenu();
  }
  closeContextMenu(): void { this.showContextMenu = false; this.contextMenuItem = null; this.contextMenuField = null; }

  closeAllContextMenus(): void {
    this.showColumnContextMenu = false; this.contextMenuColumn = null;
    this.closeContextMenu();
  }

  private handleGlobalClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.filter-menu-wrapper') && !target.closest('.context-menu') && !target.closest('.dropdown-container')) {
      this.showFilterMenu = false;
      this.showFieldFilterMenu = false;
      this.closeAllContextMenus();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.showContextMenu || this.showColumnContextMenu) { this.closeAllContextMenus(); return; }
    if (this.showModal) { this.closeModal(); return; }
    if (this.showDeleteModal) { this.closeDeleteModal(); return; }
    if (this.showRestoreModal) { this.closeRestoreModal(); return; }
  }

  backToList(): void {
    // Navigation relative : remonte de /…/projets/:id vers /…/projets (admin ou dashboard).
    this.router.navigate(['..'], { relativeTo: this.route });
  }
}
