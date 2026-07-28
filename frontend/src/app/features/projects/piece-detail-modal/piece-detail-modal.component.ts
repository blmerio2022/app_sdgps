import { Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { FormArray, FormBuilder, FormGroup } from '@angular/forms';
import { PiecesService } from '../../../core/services/pieces.service';
import { ToastService } from '../../../core/services/toast.service';
import { PieceSortConfigService, PieceSortConfig, PieceSortVersions, sortVersions } from '../../../core/services/piece-sort-config.service';
import { PieceFieldsConfig, PieceFieldsConfigService } from '../../../core/services/piece-fields-config.service';
import { Piece, PieceChampDef, PieceImportPreview, PieceTypeDef } from '../../../core/models/piece.model';
import { Ssdgps, Session } from '../../../core/models/project.model';
import { findTbcReports, TbcReportCandidate } from '../tbc-report.util';
import { resolveViewChamps } from '../piece-table.util';
import { assembleDeterminationRows, sortDeterminationItems, relabelDeterminationItems,
         fixesLabel, DeterminationFileItem, DetSortKey } from '../rdia.util';

/** État de la sauvegarde automatique, tel que rapporté à l'hôte du composant. */
export type AutoSaveState = 'idle' | 'saving' | 'saved';

const STATUT_OPTIONS: { value: Piece['statut']; label: string }[] = [
  { value: 'brouillon', label: 'Brouillon' },
  { value: 'valide', label: 'Validée' },
  { value: 'rejete', label: 'Rejetée' },
];

/**
 * Modale de consultation/modification d'une pièce existante : statut, commentaire,
 * portée (niveau SSDGPS commun / session spécifique) et données propres à la source
 * de saisie (image, import CSV/Excel, saisie manuelle). Le type et la source de la
 * pièce ne sont pas modifiables — changer de type revient à créer une autre pièce.
 */
@Component({
  selector: 'app-piece-detail-modal',
  templateUrl: './piece-detail-modal.component.html',
  styleUrls: ['./piece-detail-modal.component.scss'],
})
export class PieceDetailModalComponent implements OnInit, OnDestroy {
  @Input() piece!: Piece;
  @Input() ssdgps!: Ssdgps;
  @Input() sessions: Session[] = [];
  @Input() catalog: PieceTypeDef[] = [];
  /** Mode d'ouverture imposé par le parent : chaque action (Voir / Modifier) a sa
   * propre modale à usage unique, sans bascule interne view↔edit. */
  @Input() initialMode: 'view' | 'edit' = 'view';
  /** Rendu inline (page dédiée) plutôt qu'en modale superposée. */
  @Input() embedded = false;
  @Output() saved = new EventEmitter<Piece>();
  @Output() closed = new EventEmitter<void>();
  /** Demande de bascule vers l'édition (page dédiée) depuis la modale de consultation. */
  @Output() editRequested = new EventEmitter<void>();

  readonly statutOptions = STATUT_OPTIONS;
  readonly orientationOptions = [
    { value: 'auto', label: 'Automatique' },
    { value: 'portrait', label: 'Portrait' },
    { value: 'paysage', label: 'Paysage' },
  ];
  readonly versionsRapportOptions = [
    { value: 'both', label: 'Les deux versions' },
    { value: 'brut', label: 'Version brute des données' },
    { value: 'ecarts', label: 'Version des écarts (vs détermination définitive)' },
  ];

  /** Vue = lecture seule ; Édition = formulaires modifiables. Fixé à l'ouverture. */
  mode: 'view' | 'edit' = 'view';

  statutLabel(v: string): string { return this.statutOptions.find(o => o.value === v)?.label || v; }
  orientationLabel(v?: string): string {
    return this.orientationOptions.find(o => o.value === (v || 'auto'))?.label || v || '';
  }
  versionsRapportLabel(v?: string): string {
    return this.versionsRapportOptions.find(o => o.value === (v || 'both'))?.label || v || '';
  }
  statutBadgeClass(v: string): string {
    return { brouillon: 'badge-warning', valide: 'badge-success', rejete: 'badge-secondary' }[v] || 'badge-secondary';
  }
  /** Icône sémantique d'un statut (pastille d'en-tête, sélecteur segmenté, encart de synthèse). */
  statutIcon(v: string): string {
    return { brouillon: 'fa-pen-ruler', valide: 'fa-circle-check', rejete: 'fa-circle-xmark' }[v]
      || 'fa-circle-question';
  }
  /** Statut à afficher : la valeur en cours d'édition si le formulaire est actif, sinon celle
   * enregistrée. Permet à la pastille de l'en-tête de suivre la saisie en temps réel — et de
   * rester lisible quand la section est repliée. */
  get currentStatut(): string {
    return (this.mode === 'edit' && this.metaForm?.value?.statut) || this.piece?.statut || '';
  }
  get isImageFile(): boolean {
    return !!this.piece.fichier_url && /\.(png|jpe?g|gif|webp|bmp)$/i.test(this.piece.fichier_url);
  }

  metaForm!: FormGroup;
  savingMeta = false;

  changingScope = false;

  manualForm: FormGroup | null = null;
  /** Lignes du tableau de données en édition, pilotées par app-piece-data-table. */
  editRows: any[] = [];
  savingManual = false;

  /** Enregistrement AUTOMATIQUE, TOUJOURS actif : chaque modification (champs du formulaire
   * comme données de la grille) déclenche une sauvegarde anti-rebond, sans clic
   * « Enregistrer ». Il n'y a plus de bascule ni de mode manuel — l'état de la sauvegarde
   * est simplement rapporté à l'utilisateur. Ne concerne QUE l'édition manuelle : les imports
   * gardent leur confirmation explicite (remplacement destructif). */
  /** Affiche brièvement « Modifications enregistrées » après une sauvegarde auto réussie
   * (aussi bien les données du tableau que les champs du formulaire). */
  autoSavedFlash = false;
  private dataSaveTimer: any;
  private metaSaveTimer: any;
  private metaValueSub: any;
  /** Vrai si une sauvegarde (données OU champs du formulaire) est en cours. */
  get autoSaving(): boolean { return this.savingManual || this.savingMeta; }

  /** État de la sauvegarde automatique, dérivé des drapeaux internes. */
  get autoSaveState(): AutoSaveState {
    if (this.autoSaving) return 'saving';
    return this.autoSavedFlash ? 'saved' : 'idle';
  }
  /** Remonte l'état au parent : en page dédiée (`embedded`), la mention est affichée dans
   * l'en-tête de page et non dans le corps. Émis depuis des rappels asynchrones uniquement
   * (souscriptions, minuteries) — jamais pendant un cycle de détection en cours. */
  @Output() autoSaveStateChange = new EventEmitter<AutoSaveState>();
  private emitAutoSaveState(): void { this.autoSaveStateChange.emit(this.autoSaveState); }

  replacingFile = false;

  /** Menu « Remplacer » de la barre d'outils du tableau (projeté dans app-piece-data-table). */
  showReplaceMenu = false;
  toggleReplaceMenu(): void { this.showReplaceMenu = !this.showReplaceMenu; }
  closeReplaceMenu(): void { this.showReplaceMenu = false; }
  /** Fermeture au clic extérieur (le déclencheur/menu stoppent la propagation) et sur Échap. */
  @HostListener('document:click')
  onDocumentClick(): void { this.showReplaceMenu = false; }
  @HostListener('document:keydown.escape')
  onEscapeKey(): void { this.showReplaceMenu = false; }

  reimportOpen = false;
  reimportFile: File | null = null;
  reimportPreview: PieceImportPreview | null = null;
  reimportMapping: Record<string, string> = {};
  reimporting = false;

  /** Tri effectif de la version BRUTE du tableau de CETTE pièce : tri propre de la pièce
   * (`payload.sort`, dernier tri appliqué) s'il existe, sinon tri par défaut du type. */
  defaultSort: { field: string; dir: 'asc' | 'desc' }[] | null = null;
  /** Tri effectif de la version ÉCARTS (RDL/RDN/RDIA) — repli sur le tri brut si non défini. */
  defaultSortEcarts: { field: string; dir: 'asc' | 'desc' }[] | null = null;
  /** Tri par défaut du TYPE (config /tri-pieces), par version, repli quand la pièce n'a pas
   * encore son propre tri. */
  private typeSort: PieceSortVersions | null = null;

  /** Application du tri par défaut au tableau STOCKÉ de la pièce (écrase l'ordre en base). */
  applyingSortConfig = false;
  showApplySortConfirm = false;
  /** Signal incrémenté pour demander au(x) tableau(x) d'oublier le tri manuel et de refléter
   * le nouvel ordre après application du tri configuré. */
  resetSortSignal = 0;

  /** Colonnes visibles (vue « affichage app »), par version, selon la config opérateur
   * (`piece_fields_config`). undefined = toutes les colonnes (défaut). */
  private appViewBrut?: string[];
  private appViewEcarts?: string[];
  /** Vue « import » (filtre-maître) : noms des champs bruts réellement importés pour ce type
   * (config opérateur). `undefined` = tous. Contraint la grille d'édition et les vues app/pdf. */
  private importViewBrut?: string[];

  constructor(
    private piecesService: PiecesService,
    private toast: ToastService,
    private fb: FormBuilder,
    private sortConfigService: PieceSortConfigService,
    private fieldsConfigService: PieceFieldsConfigService,
  ) {}

  ordreInput = 1;
  movingOrdre = false;

  ngOnInit(): void {
    this.mode = this.initialMode;
    this.metaForm = this.fb.group({
      statut: [this.piece.statut],
      orientation: [this.piece.orientation || 'auto'],
      versions_rapport: [this.piece.versions_rapport || 'both'],
      commentaire: [this.piece.commentaire || ''],
      notes_internes: [this.piece.notes_internes || ''],
    });
    this.ordreInput = this.piece.ordre + 1;
    // Enregistrement automatique des CHAMPS du formulaire (statut, observations, notes
    // internes, orientation, versions au rapport) : toute modification programme une
    // sauvegarde anti-rebond.
    this.metaValueSub = this.metaForm.valueChanges.subscribe(() => {
      if (this.mode === 'edit') this.queueAutoSaveMeta();
    });
    if (this.isTabularData) this.initManualForm();
    // Tri par défaut du type (config /tri-pieces), par version : repli quand la pièce n'a pas
    // son propre tri.
    this.sortConfigService.get().subscribe(cfg => {
      this.typeSort = sortVersions((cfg as PieceSortConfig)[this.piece.type_piece]);
      this.refreshEffectiveSort();
    });
    // Colonnes de la vue « affichage app » (config opérateur), appliquées aux tableaux en
    // consultation (lecture seule) ; l'édition conserve toutes les colonnes pour la saisie.
    this.fieldsConfigService.get().subscribe(cfg => {
      const typeCfg = (cfg as PieceFieldsConfig)[this.piece.type_piece];
      this.importViewBrut = typeCfg?.import?.brut;
      this.appViewBrut = typeCfg?.app?.brut;
      this.appViewEcarts = typeCfg?.app?.ecarts;
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.dataSaveTimer);
    clearTimeout(this.metaSaveTimer);
    this.metaValueSub?.unsubscribe();
  }

  /** Recalcule le tri effectif de la pièce, par version : son tri propre (`payload.sort`) prime,
   * sinon le tri par défaut du type ; l'écarts retombe sur le tri brut s'il n'est pas défini
   * (même règle que le rapport PDF). Appelé après chaque (re)chargement de la pièce. */
  private refreshEffectiveSort(): void {
    const own = sortVersions((this.piece.payload as any)?.sort);
    const t = this.typeSort || { brut: [], ecarts: [] };
    const brut = own.brut.length ? own.brut : t.brut;
    const ecarts = own.ecarts.length ? own.ecarts : (t.ecarts.length ? t.ecarts : brut);
    this.defaultSort = brut.length ? brut : null;
    this.defaultSortEcarts = ecarts.length ? ecarts : null;
  }

  /** Construit la nouvelle valeur de `payload.sort` en modifiant UNE version (brut/ecarts),
   * en conservant l'autre. Forme à deux versions pour les types RDL/RDN/RDIA, liste sinon. */
  private buildOwnSort(version: 'brut' | 'ecarts', levels: { field: string; dir: 'asc' | 'desc' }[]): any {
    const own = sortVersions((this.piece.payload as any)?.sort);
    own[version] = levels;
    return this.supportsEcarts ? { brut: own.brut, ecarts: own.ecarts } : levels;
  }

  /** Tri manuel sur le tableau « brut » : mémorisé comme tri PROPRE de CETTE pièce
   * (`payload.sort`, version brute), afin que le rapport PDF et l'affichage suivent ce tri —
   * SANS toucher au tri par défaut du type (/tri-pieces). L'application du tri par défaut
   * écrasera ce tri propre. */
  onSortChange(levels: { field: string; dir: 'asc' | 'desc' }[]): void {
    this.persistOwnSort('brut', levels);
  }

  /** Idem pour le tableau « écarts / détermination définitive » (RDL/RDN/RDIA). */
  onSortChangeEcarts(levels: { field: string; dir: 'asc' | 'desc' }[]): void {
    this.persistOwnSort('ecarts', levels);
  }

  private persistOwnSort(version: 'brut' | 'ecarts', levels: { field: string; dir: 'asc' | 'desc' }[]): void {
    if (version === 'ecarts') this.defaultSortEcarts = levels; else this.defaultSort = levels;
    // Reflète localement le tri propre (utilisé au calcul du repli / recalcul effectif).
    this.piece = { ...this.piece, payload: { ...this.piece.payload, sort: this.buildOwnSort(version, levels) } } as Piece;
    this.piecesService.setSort(this.piece.id, levels, version).subscribe({
      next: (updated) => { this.piece = updated; },
      error: () => this.toast.error('Tri non enregistré',
        "Le tri n'a pas pu être mémorisé pour le rapport ; il reste appliqué à l'écran."),
    });
  }

  /** Le tri configuré peut être appliqué au tableau stocké : un tri par défaut existe pour
   * ce type ET la pièce a un tableau de données (tabulaire ou points PPA/PPN) non vide. */
  get canApplyConfiguredSort(): boolean {
    return !!(this.defaultSort && this.defaultSort.length)
      && (this.isTabularData || this.isPhotoPoints)
      && this.previewRows.length > 0;
  }

  askApplySort(): void { if (!this.applyingSortConfig) this.showApplySortConfirm = true; }
  cancelApplySort(): void { this.showApplySortConfirm = false; }

  /** Applique le tri par défaut au tableau stocké de cette pièce (serveur), puis recharge la
   * pièce pour refléter le nouvel ordre (et la renumérotation ID). */
  confirmApplySort(): void {
    if (this.applyingSortConfig) return;
    this.applyingSortConfig = true;
    this.piecesService.applySortConfig([this.piece.id]).subscribe({
      next: (res) => {
        if (!res.updated) {
          this.applyingSortConfig = false;
          this.showApplySortConfirm = false;
          this.toast.info('Déjà trié', 'Le tableau était déjà dans l\'ordre du tri configuré.');
          return;
        }
        // Recharge la pièce : le tableau (consultation/édition) reflète le nouvel ordre.
        this.piecesService.getById(this.piece.id).subscribe({
          next: (updated) => {
            this.applyingSortConfig = false;
            this.showApplySortConfirm = false;
            this.piece = updated;
            if (this.mode === 'edit') this.initManualForm();
            // Le tri appliqué est devenu le tri propre de la pièce → recalcule le tri effectif.
            this.refreshEffectiveSort();
            // Oublie tout tri manuel de la vue pour afficher le nouvel ordre appliqué.
            this.resetSortSignal++;
            this.toast.success('Tri appliqué', 'Les lignes du tableau ont été réordonnées.');
            this.saved.emit(updated);
          },
          error: () => {
            this.applyingSortConfig = false;
            this.showApplySortConfirm = false;
            this.toast.success('Tri appliqué', 'Rechargez la pièce pour voir le nouvel ordre.');
            this.saved.emit(this.piece);
          },
        });
      },
      error: (e) => {
        this.applyingSortConfig = false;
        this.showApplySortConfirm = false;
        this.toast.error('Échec', e?.error?.detail || 'Application du tri impossible');
      },
    });
  }

  moveToPosition(): void {
    const target = Math.max(1, Math.round(this.ordreInput)) - 1;
    if (this.movingOrdre || target === this.piece.ordre) return;
    this.movingOrdre = true;
    this.piecesService.moveToPosition(this.piece.id, target).subscribe({
      next: (updated) => {
        this.movingOrdre = false; this.piece = updated; this.ordreInput = updated.ordre + 1;
        this.toast.success('Succès', 'Position mise à jour'); this.saved.emit(updated);
      },
      error: (e) => { this.movingOrdre = false; this.toast.error('Échec', e?.error?.detail || 'Déplacement impossible'); },
    });
  }

  get catalogDef(): PieceTypeDef | undefined {
    return this.catalog.find(d => d.code === this.piece.type_piece);
  }

  /** Données tabulaires éditables à la main : pièces saisies manuellement ou importées
   * (par opposition aux pièces image, gérées par la galerie). */
  get isTabularData(): boolean {
    const s = this.piece.source_saisie;
    if (s === 'manuel' || s === 'import') return true;
    // RC : rapport calculé (source_saisie 'ui') mais bien tabulaire (champs définis).
    return s === 'ui' && (this.catalogDef?.champs?.length ?? 0) > 0;
  }
  /** Le type accepte aussi l'import CSV/Excel (remplacement des données par un fichier). */
  get supportsImport(): boolean {
    const s = this.catalogDef?.source;
    return s === 'csv_manuel' || s === 'image_csv_manuel';
  }
  /** PPA/PPN : type « photos par point » (chaque point porte un champ `fichier_image`). */
  get isPhotoPoints(): boolean {
    return (this.catalogDef?.champs || []).some(c => c.name === 'fichier_image');
  }
  /** RFB : le type accepte le remplacement des données par un rapport HTML TBC. */
  get supportsHtmlImport(): boolean { return !!this.catalogDef?.html_import; }

  // --- RDIA : réassemblage depuis les déterminations du dossier ---
  get supportsAssemble(): boolean { return !!this.catalogDef?.assemble; }
  reassembling = false;
  reassemble(): void {
    if (this.reassembling) return;
    this.reassembling = true;
    this.piecesService.reassembleRdi(this.piece.id).subscribe({
      next: (updated) => {
        this.reassembling = false;
        this.piece = updated;
        this.dataView = 'brut';
        if (this.mode === 'edit') this.initManualForm();
        this.toast.success('Réassemblé', 'Tableau reconstruit depuis les déterminations. Recalculez les écarts si besoin.');
        this.saved.emit(updated);
      },
      error: (e) => {
        this.reassembling = false;
        this.toast.error('Échec', e?.error?.detail || 'Réassemblage impossible');
      },
    });
  }

  // --- RDIA : import & assemblage de FICHIERS de déterminations ---
  assembleFilesModalOpen = false;
  assembleFilesParsing = false;
  assemblingFiles = false;
  assembleFileItems: DeterminationFileItem[] = [];
  assembleSortKey: DetSortKey | null = 'fixe';
  assembleSortDir: 1 | -1 = 1;
  fixesLabel = fixesLabel;

  openAssembleFilesModal(): void { this.resetAssembleFiles(); this.assembleFilesModalOpen = true; }
  closeAssembleFilesModal(): void { this.assembleFilesModalOpen = false; }
  /** Réinitialise l'import : vide la liste des fichiers de déterminations. */
  resetAssembleFiles(): void { this.assembleFileItems = []; this.assembleSortKey = 'fixe'; this.assembleSortDir = 1; }

  onAssembleCsvSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) this.parseAndAddDeterminations(files.map(f => ({ file: f, displayName: f.name })));
  }
  onAssembleHtmlFolder(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;
    this.assembleFilesParsing = true;
    findTbcReports(files, 'RDN').then(candidates => {
      if (!candidates.length) {
        this.assembleFilesParsing = false;
        this.toast.error('Données introuvables', 'Aucun rapport TBC compatible trouvé dans le dossier.');
        return;
      }
      this.parseAndAddDeterminations(candidates.map(c => ({ file: c.file, displayName: c.source })));
    });
  }
  private parseAndAddDeterminations(entries: { file: File; displayName: string }[]): void {
    this.assembleFilesParsing = true;
    this.piecesService.parseDeterminations(entries.map(e => e.file)).subscribe({
      next: (res) => {
        this.assembleFilesParsing = false;
        res.determinations.forEach((d, i) => {
          this.assembleFileItems.push({
            filename: entries[i]?.displayName || d.filename,
            lastModified: entries[i]?.file.lastModified || 0,
            count: d.count, hasFixe: d.has_fixe, fixes: d.fixes || [], rows: d.rows, label: '',
          });
        });
        this.applyAssembleOrder();
      },
      error: (e) => { this.assembleFilesParsing = false; this.toast.error('Échec', e?.error?.detail || 'Analyse des fichiers impossible'); },
    });
  }
  private applyAssembleOrder(): void {
    if (this.assembleSortKey) sortDeterminationItems(this.assembleFileItems, this.assembleSortKey, this.assembleSortDir);
    relabelDeterminationItems(this.assembleFileItems);
  }
  sortAssembleFiles(key: DetSortKey): void {
    if (this.assembleSortKey === key) this.assembleSortDir = this.assembleSortDir === 1 ? -1 : 1;
    else { this.assembleSortKey = key; this.assembleSortDir = 1; }
    this.applyAssembleOrder();
  }
  moveAssembleFile(i: number, dir: -1 | 1): void {
    const j = i + dir;
    if (j < 0 || j >= this.assembleFileItems.length) return;
    const a = this.assembleFileItems;
    [a[i], a[j]] = [a[j], a[i]];
    this.assembleSortKey = null;
    relabelDeterminationItems(a);
  }
  moveAssembleFileEnd(i: number, toStart: boolean): void {
    const a = this.assembleFileItems;
    if (i < 0 || i >= a.length) return;
    const [it] = a.splice(i, 1);
    if (toStart) a.unshift(it); else a.push(it);
    this.assembleSortKey = null;
    relabelDeterminationItems(a);
  }
  removeAssembleFile(i: number): void {
    this.assembleFileItems.splice(i, 1);
    relabelDeterminationItems(this.assembleFileItems);
  }

  /** Assemble les fichiers (client) et remplace les données brutes de la pièce (écarts invalidés). */
  runAssembleFiles(): void {
    if (!this.assembleFileItems.length || this.assemblingFiles) return;
    this.assemblingFiles = true;
    const rows = assembleDeterminationRows(this.assembleFileItems);
    this.piecesService.update(this.piece.id, { payload: { rows } } as Partial<Piece>).subscribe({
      next: (updated) => {
        this.assemblingFiles = false;
        this.assembleFilesModalOpen = false;
        this.piece = updated;
        this.dataView = 'brut';
        if (this.mode === 'edit') this.initManualForm();
        this.toast.success('Assemblé', `${rows.length} ligne(s) depuis ${this.assembleFileItems.length} détermination(s). Recalculez les écarts si besoin.`);
        this.saved.emit(updated);
      },
      error: (e) => { this.assemblingFiles = false; this.toast.error('Échec', e?.error?.detail || 'Assemblage impossible'); },
    });
  }

  /** Stats du tableau de données actif (affichées dans le titre de la section « Données »). */
  dataStats: { total: number; filtered: number; selected: number } | null = null;

  /** Sections repliables (accordéon) — toutes dépliées par défaut. Clé = identifiant de section. */
  collapsed: Record<string, boolean> = {};
  toggleSection(key: string): void { this.collapsed[key] = !this.collapsed[key]; }
  isCollapsed(key: string): boolean { return !!this.collapsed[key]; }

  // --- 2ᵉ version « écarts » (RDL/RDN : brute vs détermination définitive) ---
  /** Vue active du tableau : données brutes ou écarts / détermination définitive. */
  dataView: 'brut' | 'ecarts' = 'brut';
  computingEcarts = false;
  /** Le type propose la 2ᵉ version « écarts » (RDL/RDN). */
  get supportsEcarts(): boolean { return !!this.catalogDef?.ecarts; }
  /** Colonnes de la version écarts (depuis le catalogue). */
  get ecartsChamps(): PieceChampDef[] { return this.catalogDef?.ecarts_champs || []; }
  /** Lignes de la version écarts déjà calculées (persistées dans le payload). */
  get ecartsRows(): any[] { return (this.piece.payload as any)?.rows_ecarts || []; }
  get hasEcarts(): boolean { return this.ecartsRows.length > 0; }

  /** Calcule (ou recalcule) la version écarts côté serveur, puis l'affiche. */
  computeEcarts(): void {
    if (this.computingEcarts) return;
    this.computingEcarts = true;
    this.piecesService.computeEcarts(this.piece.id).subscribe({
      next: (updated) => {
        this.computingEcarts = false;
        this.piece = updated;
        this.dataView = 'ecarts';
        this.toast.success('Écarts calculés', `${this.ecartsRows.length} ligne(s) — écarts vs détermination définitive.`);
        this.saved.emit(updated);
      },
      error: (e) => {
        this.computingEcarts = false;
        this.toast.error('Calcul impossible', e?.error?.detail || 'Calcul des écarts impossible');
      },
    });
  }

  /** Synchronise la pièce après une opération photo-points (add/assign/remove). */
  onPhotoPointsUpdated(updated: Piece): void { this.piece = updated; this.saved.emit(updated); }

  private pointKey(row: any): string { return String(row?.id ?? row?.nom_point ?? '').trim(); }
  /** Points (PPA/PPN) sans photo — bloquent le passage du statut à « Validée ». */
  get pointsWithoutPhoto(): string[] {
    if (!this.isPhotoPoints) return [];
    const rows = this.piece.payload?.rows || [];
    const covered = new Set((this.piece.images || []).map(i => i.point_ref).filter(k => !!k));
    const missing: string[] = [];
    for (const r of rows) {
      const k = this.pointKey(r);
      if (k && !covered.has(k) && !missing.includes(k)) missing.push(k);
    }
    return missing;
  }

  /** Vrai si le SSDGPS est multi-session : la notion de session (portée / niveau) n'a de sens
   * que dans ce cas. En mono-session, la section « Niveau » n'est pas affichée. */
  get isMultiSession(): boolean { return this.ssdgps?.type_ssdgps === 'multi-session'; }

  /** Le niveau est toujours un choix libre de l'utilisateur (§ validators.py),
   * indépendant du niveau par défaut suggéré par le catalogue pour ce type. */
  get showScopeSelector(): boolean { return true; }
  get niveauLabel(): string {
    return this.piece.session
      ? `Niveau Session — Session n°${this.piece.session_numero ?? '?'}`
      : 'Niveau SSDGPS — commune à toutes les sessions';
  }

  changeScope(sessionId: string): void {
    if (this.changingScope) return;
    this.changingScope = true;
    this.piecesService.setScope(this.piece.id, sessionId || null).subscribe({
      next: (updated) => { this.changingScope = false; this.piece = updated; this.toast.success('Succès', 'Portée mise à jour'); this.saved.emit(updated); },
      error: (e) => { this.changingScope = false; this.toast.error('Échec', e?.error?.session?.[0] || 'Changement de portée impossible'); },
    });
  }

  /** Enregistre les champs du formulaire (statut, orientation, versions, commentaire). `silent`
   * (sauvegarde automatique) : pas de toast, indicateur discret ; en cas d'invalidité (PPA/PPN
   * validés sans photo) la sauvegarde est simplement différée (le bandeau d'alerte suffit). */
  saveMeta(silent = false): void {
    if (this.savingMeta) return;
    // PPA/PPN : impossible de valider tant qu'un point n'a pas de photo.
    if (this.metaForm.value.statut === 'valide' && this.isPhotoPoints) {
      const missing = this.pointsWithoutPhoto;
      if (missing.length) {
        if (!silent) this.toast.error('Validation impossible',
          `${missing.length} point(s) sans photo (${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}). Chaque point doit avoir au moins une photo.`);
        return;
      }
    }
    clearTimeout(this.metaSaveTimer);
    this.savingMeta = true; this.emitAutoSaveState();
    this.piecesService.update(this.piece.id, this.metaForm.value).subscribe({
      next: (updated) => {
        this.savingMeta = false; this.piece = updated;
        if (silent) this.flashSaved();
        else { this.emitAutoSaveState(); this.toast.success('Succès', 'Pièce mise à jour'); }
        this.saved.emit(updated);
      },
      error: (e) => {
        this.savingMeta = false; this.emitAutoSaveState();
        if (!silent) this.toast.error('Échec', e?.error?.detail || 'Enregistrement impossible');
      },
    });
  }

  /** Colonnes affichées = champs réellement présents dans les données. Un champ ignoré
   * à l'import (absent des lignes de `payload`) est masqué en consultation/modification.
   * Si aucune ligne, on montre tous les champs (saisie manuelle de départ). */
  // Mémoïsation : `visibleChamps` est passé en @Input à <app-piece-data-table>. Sans cache, le
  // filtre renverrait un NOUVEAU tableau à chaque cycle de détection → l'entrée change à chaque
  // fois et casse la détection de changement d'Angular (page blanche/rendu figé). On renvoie la
  // même référence tant que les `champs` du catalogue et les lignes du payload ne changent pas.
  private _vcChamps: any = null;
  private _vcRows: any = null;
  private _vcImp: any = null;
  private _vcResult: { name: string; label: string; type: string }[] = [];
  get visibleChamps(): { name: string; label: string; type: string }[] {
    const catalog = this.catalogDef?.champs || [];
    const rows = this.piece.payload?.rows || [];
    if (this._vcChamps === catalog && this._vcRows === rows && this._vcImp === this.importViewBrut) return this._vcResult;
    this._vcChamps = catalog;
    this._vcRows = rows;
    this._vcImp = this.importViewBrut;
    // FILTRE-MAÎTRE « import » : ne conserver que les champs importés (les requis toujours),
    // avant le filtre par présence dans les données. Un champ non importé n'est ni éditable ni
    // affiché, même si d'anciennes lignes contiennent encore sa valeur (cascade cohérente).
    const champs = this.applyImportFilter(catalog);
    this._vcResult = !rows.length
      ? champs
      : champs.filter(c => rows.some((r: any) => r && Object.prototype.hasOwnProperty.call(r, c.name)));
    return this._vcResult;
  }

  /** Filtre/réordonne les champs catalogue par la vue « import » de l'opérateur (les champs
   * `required` sont toujours conservés). `undefined` = tous les champs (ordre catalogue). */
  private applyImportFilter(champs: PieceChampDef[]): PieceChampDef[] {
    if (this.importViewBrut == null) return champs;
    const byName = new Map(champs.map(c => [c.name, c]));
    const names = [...this.importViewBrut];
    champs.forEach(c => { if (c.required && !names.includes(c.name)) names.unshift(c.name); });
    return names.map(n => byName.get(n)).filter((c): c is PieceChampDef => !!c);
  }

  // Colonnes des tableaux en CONSULTATION (lecture seule) : `visibleChamps` filtré/réordonné
  // selon la vue « affichage app » de l'opérateur. Mémoïsé (comme visibleChamps) pour préserver
  // la référence tant que l'entrée ne change pas (sinon la détection de changement casse).
  private _avBrutSrc: any = null; private _avBrutCfg: any = null; private _avBrutRes: any[] = [];
  get viewChampsBrut(): { name: string; label: string; type: string }[] {
    const src = this.visibleChamps;
    if (this._avBrutSrc === src && this._avBrutCfg === this.appViewBrut) return this._avBrutRes;
    this._avBrutSrc = src; this._avBrutCfg = this.appViewBrut;
    this._avBrutRes = resolveViewChamps(src, this.appViewBrut);
    return this._avBrutRes;
  }
  private _avEcSrc: any = null; private _avEcCfg: any = null; private _avEcRes: any[] = [];
  get viewChampsEcarts(): PieceChampDef[] {
    const src = this.ecartsChamps;
    if (this._avEcSrc === src && this._avEcCfg === this.appViewEcarts) return this._avEcRes;
    this._avEcSrc = src; this._avEcCfg = this.appViewEcarts;
    this._avEcRes = resolveViewChamps(src, this.appViewEcarts);
    return this._avEcRes;
  }

  // --- Saisie manuelle ---
  private initManualForm(): void {
    const rows = this.piece.payload?.rows?.length ? this.piece.payload.rows : [{}];
    this.manualForm = this.fb.group({ rows: this.fb.array(rows.map((r: any) => this.buildManualRow(r))) });
    // `editRows` alimente le tableau de données éditable (composant app-piece-data-table) : copie
    // profonde des lignes existantes (aucune ligne vide de départ — l'ajout se fait via le tableau).
    this.editRows = (this.piece.payload?.rows || []).map((r: any) => ({ ...r }));
  }
  private buildManualRow(row: any = {}): FormGroup {
    const group: Record<string, any> = {};
    this.visibleChamps.forEach(c => { group[c.name] = [row[c.name] ?? '']; });
    return this.fb.group(group);
  }
  get manualRows(): FormArray { return this.manualForm!.get('rows') as FormArray; }
  addManualRow(): void { this.manualRows.push(this.buildManualRow()); }
  removeManualRow(i: number): void { if (this.manualRows.length > 1) this.manualRows.removeAt(i); }
  /** Vider le tableau : ouvre la modale de confirmation (persisté seulement après « Enregistrer »). */
  showClearConfirm = false;
  clearManualRows(): void {
    if (!this.manualForm || !this.manualRows.length) return;
    this.showClearConfirm = true;
  }
  cancelClearRows(): void { this.showClearConfirm = false; }
  confirmClearRows(): void {
    if (this.manualForm) while (this.manualRows.length) this.manualRows.removeAt(0);
    this.showClearConfirm = false;
  }

  /** Enregistre les données éditées. `silent` (sauvegarde automatique) : pas de toast, mais un
   * indicateur « Enregistré » discret ; `false` (clic explicite) : toast de confirmation. */
  saveManual(silent = false): void {
    if (this.savingManual) return;
    clearTimeout(this.dataSaveTimer);  // une sauvegarde en cours annule un éventuel auto-save en attente
    this.savingManual = true; this.emitAutoSaveState();
    this.piecesService.update(this.piece.id, { payload: { rows: this.editRows } }).subscribe({
      next: (updated) => {
        this.savingManual = false; this.piece = updated;
        if (silent) this.flashSaved();
        else { this.emitAutoSaveState(); this.toast.success('Succès', 'Données enregistrées'); }
        this.saved.emit(updated);
      },
      error: (e) => {
        this.savingManual = false; this.emitAutoSaveState();
        this.toast.error('Échec', e?.error?.detail || 'Enregistrement impossible');
      },
    });
  }

  /** Affiche brièvement l'indicateur « Modifications enregistrées » (sauvegarde auto réussie). */
  private flashSaved(): void {
    this.autoSavedFlash = true; this.emitAutoSaveState();
    setTimeout(() => { this.autoSavedFlash = false; this.emitAutoSaveState(); }, 2500);
  }

  /** Édition d'une ligne dans la grille : met à jour `editRows` et programme une sauvegarde
   * anti-rebond. */
  onEditRowsChange(rows: any[]): void {
    this.editRows = rows;
    this.queueAutoSaveData();
  }

  /** Programme une sauvegarde automatique (anti-rebond) des données éditées. */
  private queueAutoSaveData(): void {
    clearTimeout(this.dataSaveTimer);
    this.dataSaveTimer = setTimeout(() => this.saveManual(true), 600);
  }

  /** Programme une sauvegarde automatique (anti-rebond) des champs du formulaire. */
  private queueAutoSaveMeta(): void {
    clearTimeout(this.metaSaveTimer);
    this.metaSaveTimer = setTimeout(() => this.saveMeta(true), 600);
  }


  /** Enregistrement immédiat déclenché par une suppression en masse confirmée dans le tableau. */
  saveManualRows(rows: any[]): void { this.editRows = rows; this.saveManual(); }

  // --- Galerie d'images (multi) ---
  imagesBusy = false;

  onAddImages(files: File[]): void {
    if (!files.length || this.imagesBusy) return;
    this.imagesBusy = true;
    this.piecesService.addImages(this.piece.id, files).subscribe({
      next: (updated) => {
        this.imagesBusy = false; this.piece = updated;
        this.toast.success('Succès', 'Image(s) ajoutée(s)'); this.saved.emit(updated);
      },
      error: (e) => { this.imagesBusy = false; this.toast.error('Échec', e?.error?.detail || 'Ajout impossible'); },
    });
  }

  onRemoveImage(imageId: number): void {
    if (this.imagesBusy) return;
    this.imagesBusy = true;
    this.piecesService.deleteImage(this.piece.id, imageId).subscribe({
      next: (updated) => {
        this.imagesBusy = false; this.piece = updated;
        this.toast.success('Succès', 'Image supprimée'); this.saved.emit(updated);
      },
      error: (e) => { this.imagesBusy = false; this.toast.error('Échec', e?.error?.detail || 'Suppression impossible'); },
    });
  }

  onReorderImages(orderedIds: number[]): void {
    if (this.imagesBusy) return;
    this.imagesBusy = true;
    this.piecesService.reorderImages(this.piece.id, orderedIds).subscribe({
      next: (updated) => { this.imagesBusy = false; this.piece = updated; this.saved.emit(updated); },
      error: () => { this.imagesBusy = false; this.toast.error('Échec', 'Réordonnancement impossible'); },
    });
  }

  // --- Image (fichier unique — legacy, autres sources) ---
  onReplaceImage(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      this.toast.error('Fichier invalide', 'Sélectionnez une image (jpg/png) ou un PDF.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      this.toast.error('Fichier trop volumineux', 'Taille maximale : 20 Mo.');
      return;
    }
    this.replacingFile = true;
    this.piecesService.replaceFile(this.piece.id, file).subscribe({
      next: (updated) => { this.replacingFile = false; this.piece = updated; this.toast.success('Succès', 'Fichier remplacé'); this.saved.emit(updated); },
      error: (e) => { this.replacingFile = false; this.toast.error('Échec', e?.error?.detail || 'Remplacement impossible'); },
    });
  }

  // --- Réimport CSV/Excel ---
  openReimport(): void { this.reimportOpen = true; this.cancelHtmlReimport(); }
  cancelReimport(): void {
    this.reimportOpen = false; this.reimportFile = null; this.reimportPreview = null; this.reimportMapping = {};
  }
  onReimportFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.reimportFile = file;
    this.reimportPreview = null;
    this.piecesService.previewImport(file, this.piece.type_piece).subscribe({
      next: (preview) => { this.reimportPreview = preview; },
      error: (e) => this.toast.error('Échec', e?.error?.detail || 'Lecture du fichier impossible'),
    });
  }
  onReimportMappingChange(mapping: Record<string, string>): void { this.reimportMapping = mapping; }
  confirmReimport(): void {
    if (!this.reimportFile || this.reimporting) return;
    this.reimporting = true;
    this.piecesService.reimport(this.piece.id, this.reimportFile, this.piece.type_piece, this.reimportMapping).subscribe({
      next: (updated) => {
        this.reimporting = false; this.piece = updated; this.cancelReimport();
        this.initManualForm();  // la grille éditable reflète les données réimportées
        this.toast.success('Succès', 'Données réimportées'); this.saved.emit(updated);
      },
      error: (e) => { this.reimporting = false; this.toast.error('Échec', e?.error?.detail || 'Réimport impossible'); },
    });
  }

  // --- Ré-import HTML TBC (RFB) : remplace les données depuis un nouveau rapport ---
  htmlReimportOpen = false;
  htmlReimportFile: File | null = null;
  htmlReimportRows: any[] | null = null;
  htmlReimportCandidates: TbcReportCandidate[] = [];
  htmlReimportPreviewing = false;
  htmlReimporting = false;

  openHtmlReimport(): void { this.cancelReimport(); this.htmlReimportOpen = true; }
  cancelHtmlReimport(): void {
    this.htmlReimportOpen = false; this.htmlReimportFile = null;
    this.htmlReimportRows = null; this.htmlReimportCandidates = [];
  }

  onHtmlReimportFolder(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;
    this.htmlReimportFile = null; this.htmlReimportRows = null;
    this.htmlReimportPreviewing = true;
    findTbcReports(files, this.piece.type_piece).then(candidates => {
      if (!candidates.length) {
        this.htmlReimportPreviewing = false;
        this.toast.error('Données introuvables', 'Aucun rapport TBC compatible avec cette pièce trouvé dans le dossier sélectionné.');
        return;
      }
      if (candidates.length === 1) { this.previewHtmlReimport(candidates[0].file); return; }
      this.htmlReimportPreviewing = false;
      this.htmlReimportCandidates = candidates;
    });
  }

  previewHtmlReimport(file: File): void {
    this.htmlReimportFile = file;
    this.htmlReimportPreviewing = true;
    this.piecesService.previewHtmlImport(file, this.piece.type_piece).subscribe({
      next: (res) => {
        this.htmlReimportPreviewing = false;
        this.htmlReimportRows = res.rows || [];
        this.toast.success('Rapport analysé', `${res.total_rows} ligne(s) prêtes à remplacer les données.`);
      },
      error: (e) => {
        this.htmlReimportPreviewing = false; this.htmlReimportFile = null;
        this.toast.error('Échec', e?.error?.detail || 'Lecture du rapport HTML impossible');
      },
    });
  }

  confirmHtmlReimport(): void {
    if (!this.htmlReimportFile || !this.htmlReimportRows || this.htmlReimporting) return;
    this.htmlReimporting = true;
    this.piecesService.reimportHtml(this.piece.id, this.htmlReimportFile, this.piece.type_piece, this.htmlReimportRows).subscribe({
      next: (updated) => {
        this.htmlReimporting = false; this.piece = updated; this.cancelHtmlReimport();
        this.initManualForm();  // la grille éditable reflète les nouvelles données
        this.toast.success('Succès', 'Données remplacées depuis le rapport HTML');
        this.saved.emit(updated);
      },
      error: (e) => { this.htmlReimporting = false; this.toast.error('Échec', e?.error?.detail || 'Remplacement impossible'); },
    });
  }

  get previewRows(): any[] { return this.piece.payload?.rows || []; }

  close(): void { this.closed.emit(); }
}
