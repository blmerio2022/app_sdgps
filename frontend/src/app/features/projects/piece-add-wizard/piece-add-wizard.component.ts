import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormArray, FormBuilder, FormGroup } from '@angular/forms';
import { PiecesService, RcSource } from '../../../core/services/pieces.service';
import { ToastService } from '../../../core/services/toast.service';
import { PieceSortConfigService, PieceSortConfig, brutSortLevels } from '../../../core/services/piece-sort-config.service';
import { PieceFieldsConfig, PieceFieldsConfigService } from '../../../core/services/piece-fields-config.service';
import { Piece, PieceChampDef, PieceImportPreview, PieceTypeDef } from '../../../core/models/piece.model';
import { Ssdgps, Session } from '../../../core/models/project.model';
import { formatFieldDate } from '../../../shared/utils/date-format.util';
import { findTbcReports, TbcReportCandidate } from '../tbc-report.util';
import { assembleDeterminationRows, sortDeterminationItems, relabelDeterminationItems,
         fixesLabel, DeterminationFileItem, DetSortKey } from '../rdia.util';

type Step = 'type' | 'scope' | 'source' | 'photos';
type Source = 'image' | 'csv' | 'manuel' | 'html' | 'compute' | 'assemble' | 'assemble-files';

/**
 * Assistant d'ajout d'une pièce, en modal : choix du type applicable, puis du
 * niveau (SSDGPS commun à toutes les sessions, ou Session spécifique — un choix
 * toujours proposé, indépendant du niveau par défaut suggéré par le catalogue
 * pour ce type), puis de la source de données parmi celles disponibles pour ce
 * type — chaque source ouvre le formulaire adapté.
 */
@Component({
  selector: 'app-piece-add-wizard',
  templateUrl: './piece-add-wizard.component.html',
  styleUrls: ['./piece-add-wizard.component.scss'],
})
export class PieceAddWizardComponent implements OnInit {
  @Input() ssdgps!: Ssdgps;
  @Input() sessions: Session[] = [];
  @Input() catalog: PieceTypeDef[] = [];
  @Input() existingPieces: Piece[] = [];
  /** Session pré-sélectionnée à l'ajout depuis une vue session (null = niveau libre). */
  @Input() defaultSessionId: string | null = null;
  /** Rendu inline (page dédiée) plutôt qu'en modale superposée. */
  @Input() embedded = false;
  @Output() created = new EventEmitter<Piece>();
  @Output() cancelled = new EventEmitter<void>();

  step: Step = 'type';
  selectedType: PieceTypeDef | null = null;
  selectedNiveau: 'ssdgps' | 'session' | null = null;
  selectedSessionId: string | null = null;
  selectedSource: Source | null = null;

  // --- Import CSV/Excel ---
  selectedFile: File | null = null;
  importPreview: PieceImportPreview | null = null;
  currentMapping: Record<string, string> = {};
  importing = false;

  // --- Saisie manuelle ---
  manualForm: FormGroup | null = null;
  /** Lignes du tableau de données éditable (composant app-piece-data-table). */
  wizardRows: any[] = [];
  submittingManual = false;

  // --- Images (multi) ---
  selectedImages: File[] = [];
  selectedImagePreviews: string[] = [];
  submittingImages = false;

  // --- Position dans le rapport ---
  insertAtEnd = true;
  customPosition = 1;
  get maxPosition(): number { return this.existingPieces.filter(p => !p.is_deleted).length + 1; }

  private sortConfig: PieceSortConfig = {};
  /** Tri par défaut opérateur (version brute, multi-niveaux) pour le type en cours de création. */
  get defaultSort(): { field: string; dir: 'asc' | 'desc' }[] | null {
    if (!this.selectedType) return null;
    const levels = brutSortLevels(this.sortConfig[this.selectedType.code]);
    return levels.length ? levels : null;
  }

  /** Config des champs de l'opérateur (pour le filtre-maître « import » de la grille manuelle). */
  private fieldsConfig: PieceFieldsConfig = {};

  constructor(
    private piecesService: PiecesService,
    private toast: ToastService,
    private fb: FormBuilder,
    private sortConfigService: PieceSortConfigService,
    private fieldsConfigService: PieceFieldsConfigService,
  ) {}

  ngOnInit(): void {
    this.sortConfigService.get().subscribe(cfg => this.sortConfig = cfg);
    this.fieldsConfigService.get().subscribe(cfg => this.fieldsConfig = cfg as PieceFieldsConfig);
  }

  /** Champs de saisie de la grille manuelle = champs du type filtrés/réordonnés par la vue
   * « import » de l'opérateur (les champs `required` sont toujours conservés). Un champ non
   * importé n'est pas saisissable (cascade cohérente avec l'affichage et le rapport PDF). */
  get manualChamps(): PieceChampDef[] {
    const champs = this.selectedType?.champs || [];
    const names = this.fieldsConfig[this.selectedType?.code as string]?.import?.brut;
    if (names == null) return champs;
    const byName = new Map(champs.map(c => [c.name, c]));
    const ordered = [...names];
    champs.forEach(c => { if (c.required && !ordered.includes(c.name)) ordered.unshift(c.name); });
    return ordered.map(n => byName.get(n)).filter((c): c is PieceChampDef => !!c);
  }

  /** Un SSDGPS multi-session rattache ses pièces à une session précise ; un
   * mono-session les rattache directement au SSDGPS (aucun choix de niveau). */
  get isMulti(): boolean { return this.ssdgps.type_ssdgps === 'multi-session'; }

  get applicableTypes(): PieceTypeDef[] {
    return this.catalog.filter(def =>
      def.source !== 'ui' &&
      (def.natures === 'toutes' || (def.natures as string[]).includes(this.ssdgps.nature_ssdgps)),
    );
  }

  /** Le niveau du catalogue n'est qu'une suggestion par défaut, jamais bloquante :
   * n'importe quel type peut être ajouté plusieurs fois tant que la combinaison
   * (type, session, numéro) diffère — vérifié côté serveur à la confirmation. */
  isTypeDisabled(_def: PieceTypeDef): boolean { return false; }

  // --- Aide à la décision sur les cartes de type -------------------------------

  /** Nombre de pièces de ce type DÉJÀ présentes dans le rapport (hors corbeille). Affiché
   * sur la carte : ajouter un type déjà présent est légitime (types répétables) mais doit
   * être un choix informé, pas une surprise. */
  existingCount(def: PieceTypeDef): number {
    return this.existingPieces.filter(p => p.type_piece === def.code && !p.is_deleted).length;
  }

  /** Icône représentant la source de données attendue par un type. */
  sourceIcon(def: PieceTypeDef): string {
    if (def.computed || def.assemble) return 'fa-calculator';
    return { image: 'fa-image', csv_manuel: 'fa-table', manuel: 'fa-keyboard' }[def.source as string]
      || 'fa-file-lines';
  }

  /** Libellé court de la source, pour la ligne de méta d'une carte. */
  sourceLabel(def: PieceTypeDef): string {
    if (def.computed) return 'Calculée';
    if (def.assemble) return 'Assemblée';
    return { image: 'Images', csv_manuel: 'Tableau', manuel: 'Saisie', ui: 'Automatique' }[def.source as string]
      || 'Données';
  }

  // --- Stepper -----------------------------------------------------------------

  /** Étapes du parcours, dans l'ordre. L'étape « Session » n'existe qu'en multi-session. */
  get wizardSteps(): { key: Step; label: string; icon: string }[] {
    const etapes: { key: Step; label: string; icon: string }[] = [
      { key: 'type', label: 'Type de pièce', icon: 'fa-shapes' },
    ];
    if (this.isMulti) etapes.push({ key: 'scope', label: 'Session', icon: 'fa-clock' });
    etapes.push({ key: 'source', label: 'Source des données', icon: 'fa-database' });
    return etapes;
  }

  /** Rang de l'étape courante (0-indexé) — sert à marquer les étapes faites/à venir. */
  get currentStepIndex(): number {
    // L'étape « photos » prolonge la saisie de la source : elle reste sur le dernier rang.
    const key: Step = this.step === 'photos' ? 'source' : this.step;
    return Math.max(0, this.wizardSteps.findIndex(s => s.key === key));
  }

  /** Une étape déjà franchie est cliquable : revenir en arrière est un besoin courant. */
  goToStep(index: number): void {
    if (index >= this.currentStepIndex) return;
    const target = this.wizardSteps[index];
    if (target.key === 'type') this.backToType();
    else if (target.key === 'scope') { this.selectedSource = null; this.step = 'scope'; }
  }

  selectType(def: PieceTypeDef): void {
    this.selectedType = def;
    if (this.isMulti) {
      // Multi-session : la pièce appartient à une session ; pré-sélectionner celle
      // consultée, l'étape « Session » permet d'en changer.
      this.selectedNiveau = null;
      this.selectedSessionId = this.defaultSessionId;
      this.step = 'scope';
    } else {
      // Mono-session : aucun choix de niveau — pièce rattachée au SSDGPS directement.
      this.selectedNiveau = 'ssdgps';
      this.selectedSessionId = null;
      this.step = 'source';
    }
  }

  chooseNiveauSession(sessionId: string): void { this.selectedNiveau = 'session'; this.selectedSessionId = sessionId; this.step = 'source'; }

  /** Date d'une session au format unifié de l'app (`date_session` s'affiche SANS heure). */
  formatSessionDate(s: Session): string { return formatFieldDate(s.date_session, 'date_session'); }

  /** Position d'insertion : `true` = à la fin du rapport, `false` = position précise.
   * Passe par une méthode plutôt qu'une affectation en ligne pour que le contrôle segmenté
   * reste testable et que la remise à zéro éventuelle vive à un seul endroit. */
  setInsertAtEnd(atEnd: boolean): void { this.insertAtEnd = atEnd; }

  get selectedSessionNumero(): number | undefined {
    return this.sessions.find(s => s.id === this.selectedSessionId)?.numero_session;
  }

  backToType(): void { this.step = 'type'; this.selectedType = null; this.resetSourceState(); }
  /** Depuis l'étape Source : retour au choix de session (multi) ou au type (mono). */
  backToNiveau(): void { this.step = this.isMulti ? 'scope' : 'type'; this.resetSourceState(); }

  sourceAllows(kind: Source): boolean {
    const def = this.selectedType;
    if (!def) return false;
    if (kind === 'image') return def.source === 'image' || def.source === 'image_csv_manuel';
    if (kind === 'csv') return def.source === 'csv_manuel' || def.source === 'image_csv_manuel';
    return def.source === 'manuel' || def.source === 'csv_manuel' || def.source === 'image_csv_manuel';
  }

  private parentRef(): { ssdgps: string; session?: string } {
    return { ssdgps: this.ssdgps.id, session: this.selectedSessionId || undefined };
  }

  private nextNumero(): number | undefined {
    if (!this.selectedType?.repeatable) return undefined;
    const scoped = this.existingPieces.filter(p =>
      p.type_piece === this.selectedType!.code && !p.is_deleted &&
      (p.session || null) === (this.selectedSessionId || null),
    );
    const existing = scoped.map(p => p.numero || 0);
    return existing.length ? Math.max(...existing) + 1 : 1;
  }

  selectSource(kind: Source): void {
    this.selectedSource = kind;
    if (kind === 'manuel') this.initManualForm();
    if (kind === 'html') this.openHtmlModal();
    if (kind === 'compute') this.computeRc();
    if (kind === 'assemble') this.openAssembleModal();
    if (kind === 'assemble-files') this.openAssembleFilesModal();
  }

  /** PPA/PPN : type « photos par point » (chaque point porte un champ `fichier_image`). */
  get isPhotoPoints(): boolean {
    return (this.selectedType?.champs || []).some(c => c.name === 'fichier_image');
  }

  // Pièce créée en attente de l'étape « photos par point » (PPA/PPN).
  createdPiece: Piece | null = null;

  /** Applique la position choisie puis, pour PPA/PPN, ouvre l'étape photos ;
   * sinon notifie la création. */
  private finishCreate(p: Piece, successMessage: string): void {
    const target = this.insertAtEnd ? null : Math.max(1, Math.min(this.customPosition, this.maxPosition)) - 1;
    const done = (piece: Piece) => {
      this.toast.success('Succès', successMessage);
      if (this.isPhotoPoints) { this.createdPiece = piece; this.step = 'photos'; }
      else { this.created.emit(piece); }
    };
    if (target === null || target === p.ordre) { done(p); return; }
    this.piecesService.moveToPosition(p.id, target).subscribe({
      next: (updated) => done(updated),
      error: () => done(p),
    });
  }

  /** Étape photos : synchronise la pièce, puis finalise. */
  onPhotoStepUpdated(p: Piece): void { this.createdPiece = p; }

  private pointKey(row: any): string { return String(row?.id ?? row?.nom_point ?? '').trim(); }
  /** Points (PPA/PPN) sans aucune photo rattachée — bloquent la finalisation. */
  get pointsSansPhoto(): string[] {
    const p = this.createdPiece;
    if (!p) return [];
    const rows = p.payload?.rows || [];
    const covered = new Set((p.images || []).map(i => i.point_ref).filter(k => !!k));
    const missing: string[] = [];
    for (const r of rows) {
      const k = this.pointKey(r);
      if (k && !covered.has(k) && !missing.includes(k)) missing.push(k);
    }
    return missing;
  }
  get canFinishPhotos(): boolean { return this.pointsSansPhoto.length === 0; }

  finishPhotos(): void {
    if (!this.canFinishPhotos) {
      this.toast.error('Photos manquantes', `${this.pointsSansPhoto.length} point(s) sans photo. Chaque point doit avoir au moins une photo.`);
      return;
    }
    if (this.createdPiece) this.created.emit(this.createdPiece);
  }

  // --- Upload d'images (multi) ---
  onImagesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    const valid = files.filter(f => /\.(png|jpe?g|tiff?|webp)$/i.test(f.name) && f.size <= 20 * 1024 * 1024);
    if (valid.length < files.length) {
      this.toast.error('Fichier(s) ignoré(s)', 'Formats acceptés : png/jpg/jpeg/tiff/webp, taille max 20 Mo.');
    }
    valid.forEach(f => {
      this.selectedImages.push(f);
      this.selectedImagePreviews.push(URL.createObjectURL(f));
    });
  }

  removeLocalImage(i: number): void {
    URL.revokeObjectURL(this.selectedImagePreviews[i]);
    this.selectedImages.splice(i, 1);
    this.selectedImagePreviews.splice(i, 1);
  }

  moveLocalImage(i: number, dir: -1 | 1): void {
    const j = i + dir;
    if (j < 0 || j >= this.selectedImages.length) return;
    [this.selectedImages[i], this.selectedImages[j]] = [this.selectedImages[j], this.selectedImages[i]];
    [this.selectedImagePreviews[i], this.selectedImagePreviews[j]] =
      [this.selectedImagePreviews[j], this.selectedImagePreviews[i]];
  }

  /** TIFF n'a pas d'aperçu natif dans un <img>. */
  isPreviewable(f: File): boolean { return !/\.tiff?$/i.test(f.name); }

  private clearLocalImages(): void {
    this.selectedImagePreviews.forEach(u => URL.revokeObjectURL(u));
    this.selectedImages = [];
    this.selectedImagePreviews = [];
  }

  submitImages(): void {
    if (!this.selectedType || !this.selectedImages.length || this.submittingImages) return;
    this.submittingImages = true;
    const files = this.selectedImages;
    this.piecesService.createImagePiece(this.selectedType.code, this.parentRef(), this.nextNumero()).subscribe({
      next: (piece) => {
        this.piecesService.addImages(piece.id, files).subscribe({
          next: (withImages) => {
            this.submittingImages = false; this.clearLocalImages();
            this.finishCreate(withImages, `${files.length} image(s) ajoutée(s)`);
          },
          error: (e) => { this.submittingImages = false; this.toast.error('Échec', e?.error?.detail || 'Ajout des images impossible'); },
        });
      },
      error: (e) => { this.submittingImages = false; this.toast.error('Échec', e?.error?.detail || 'Création de la pièce impossible'); },
    });
  }

  // --- Import CSV/Excel ---
  onImportFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.selectedType) return;
    this.selectedFile = file;
    this.importPreview = null;
    this.piecesService.previewImport(file, this.selectedType.code).subscribe({
      next: (preview) => { this.importPreview = preview; },
      error: (e) => this.toast.error('Échec', e?.error?.detail || 'Lecture du fichier impossible'),
    });
  }

  onMappingChange(mapping: Record<string, string>): void { this.currentMapping = mapping; }

  confirmImport(): void {
    if (!this.selectedFile || !this.selectedType || this.importing) return;
    this.importing = true;
    this.piecesService.confirmImport(this.selectedFile, this.selectedType.code, this.parentRef(), this.currentMapping, this.nextNumero())
      .subscribe({
        next: (p) => { this.importing = false; this.finishCreate(p, 'Import confirmé'); },
        error: (e) => { this.importing = false; this.toast.error('Échec', e?.error?.detail || 'Import impossible'); },
      });
  }

  // --- Import HTML (RFB — rapport TBC) ---
  htmlFile: File | null = null;
  htmlPreviewing = false;
  submittingHtml = false;
  htmlCandidates: TbcReportCandidate[] = [];
  htmlModalOpen = false;

  /** Ouvre / ferme la fenêtre (modale) de sélection du rapport HTML TBC. */
  openHtmlModal(): void { this.htmlModalOpen = true; }
  closeHtmlModal(): void { this.htmlModalOpen = false; }

  // --- Création EN MASSE (RDN — déterminations intermédiaires depuis plusieurs HTML TBC) ---
  bulkModalOpen = false;
  bulkPreviewing = false;
  bulkSubmitting = false;
  bulkCandidates: TbcReportCandidate[] = [];

  /** Type répétable disposant de l'import HTML (RDN) → propose la création en masse. */
  get supportsBulkHtml(): boolean {
    return !!this.selectedType?.repeatable && !!this.selectedType?.html_import;
  }

  openBulkModal(): void { this.bulkCandidates = []; this.bulkModalOpen = true; }
  closeBulkModal(): void { this.bulkModalOpen = false; }

  /** Numéro de détermination qu'aura la pièce de rang `i` (déduit de l'ordre + existants). */
  bulkNumeroFor(i: number): number { return (this.nextNumero() || 1) + i; }

  /** Sélection du DOSSIER contenant PLUSIEURS rapports TBC → liste ordonnable. */
  onBulkFolderSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length || !this.selectedType) return;
    this.bulkPreviewing = true;
    findTbcReports(files, this.selectedType.code).then(candidates => {
      this.bulkPreviewing = false;
      if (!candidates.length) {
        this.toast.error('Données introuvables', 'Aucun rapport TBC compatible trouvé dans le dossier sélectionné.');
        return;
      }
      // Les nouveaux rapports s'ajoutent à la suite (permet de cumuler plusieurs dossiers).
      const known = new Set(this.bulkCandidates.map(c => c.file));
      this.bulkCandidates = [...this.bulkCandidates, ...candidates.filter(c => !known.has(c.file))];
    });
  }

  /** Réordonne un rapport (les numéros de détermination suivent l'ordre de la liste). */
  moveBulk(i: number, dir: -1 | 1): void {
    const j = i + dir;
    if (j < 0 || j >= this.bulkCandidates.length) return;
    const arr = this.bulkCandidates;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  removeBulk(i: number): void { this.bulkCandidates.splice(i, 1); }

  submitBulk(): void {
    if (!this.selectedType || !this.bulkCandidates.length || this.bulkSubmitting) return;
    this.bulkSubmitting = true;
    const files = this.bulkCandidates.map(c => c.file);
    this.piecesService.bulkImportHtml(files, this.selectedType.code, this.parentRef()).subscribe({
      next: (res) => {
        this.bulkSubmitting = false;
        this.bulkModalOpen = false;
        this.toast.success('Création en masse', `${res.count} pièce(s) « ${this.selectedType!.code} » créée(s).`);
        // `created` déclenche le retour à la liste (le payload n'est pas exploité côté page).
        this.created.emit(res.created[res.created.length - 1]);
      },
      error: (e) => { this.bulkSubmitting = false; this.toast.error('Échec', this.errorMessage(e, 'Création en masse impossible')); },
    });
  }

  // --- Calcul automatique (RC — Rapport de contrôle depuis LPA + déterminations) ---
  computing = false;
  computeError: string | null = null;
  submittingCompute = false;
  /** Source de coordonnées calculées réellement utilisée (`rdn` ou `rdia`). */
  rcSource: RcSource | null = null;
  /** Sources disponibles renvoyées par le serveur : si >1, on propose le choix. */
  rcAvailableSources: RcSource[] = [];

  rcSourceLabel(src: RcSource): string {
    return src === 'rdia'
      ? 'Rapport des déterminations intermédiaires assemblé (RDIA)'
      : 'Rapports de la détermination N°k (RDN)';
  }

  /** Génère l'aperçu du RC côté serveur → grille éditable (réutilise `manualForm`).
   * `source` force la source des coordonnées calculées ; sinon le serveur applique son
   * défaut (RDN préférée) et renvoie la source utilisée + celles disponibles. */
  computeRc(source?: RcSource): void {
    if (!this.selectedType) return;
    this.computeError = null;
    this.manualForm = null; this.wizardRows = [];
    this.computing = true;
    this.piecesService.previewComputeRc(this.parentRef(), source).subscribe({
      next: (res) => {
        this.computing = false;
        this.rcSource = res.source;
        this.rcAvailableSources = res.available_sources || [];
        const rows = res.rows?.length ? res.rows : [{}];
        this.setGridData(rows);
        this.toast.success('Rapport de contrôle', `${res.total_rows} ligne(s) calculée(s).`);
      },
      error: (e) => {
        this.computing = false;
        this.computeError = this.errorMessage(e, 'Calcul du rapport de contrôle impossible');
      },
    });
  }

  /** Recalcule l'aperçu à partir de l'autre source (choix utilisateur quand les deux existent). */
  switchRcSource(source: RcSource): void {
    if (this.computing || source === this.rcSource) return;
    this.computeRc(source);
  }

  submitCompute(): void {
    if (!this.manualForm || !this.selectedType || this.submittingCompute) return;
    this.submittingCompute = true;
    this.piecesService.confirmComputeRc(this.parentRef(), this.wizardRows, this.rcSource || undefined).subscribe({
      next: (p) => { this.submittingCompute = false; this.finishCreate(p, 'Rapport de contrôle généré'); },
      error: (e) => { this.submittingCompute = false; this.toast.error('Échec', this.errorMessage(e, 'Création du rapport de contrôle impossible')); },
    });
  }

  // --- Assemblage RDIA (RDL + RDNₖ → « Rapport des déterminations intermédiaires ») ---
  assembleModalOpen = false;
  assembling = false;
  submittingAssemble = false;
  assembleItems: { id: string; label: string; count: number; selected: boolean }[] = [];
  private assembleSourceIds: string[] = [];

  get supportsAssemble(): boolean { return !!this.selectedType?.assemble; }

  /** Ouvre la modale d'assemblage : liste les RDL/RDNₖ du scope (RDL puis RDN par numéro). */
  openAssembleModal(): void {
    const inScope = (p: Piece) => !p.is_deleted && (p.session || null) === (this.selectedSessionId || null);
    const rdl = this.existingPieces.filter(p => p.type_piece === 'RDL' && inScope(p))
      .sort((a, b) => a.ordre - b.ordre);
    const rdn = this.existingPieces.filter(p => p.type_piece === 'RDN' && inScope(p))
      .sort((a, b) => (a.numero || 0) - (b.numero || 0));
    this.assembleItems = [...rdl, ...rdn].map(p => ({
      id: p.id,
      label: p.type_piece === 'RDL' ? 'Libre' : `N°${p.numero}`,
      count: (p.payload?.rows || []).length,
      selected: true,
    }));
    this.assembleModalOpen = true;
  }
  closeAssembleModal(): void { this.assembleModalOpen = false; }
  moveAssemble(i: number, dir: -1 | 1): void {
    const j = i + dir;
    if (j < 0 || j >= this.assembleItems.length) return;
    const a = this.assembleItems;
    [a[i], a[j]] = [a[j], a[i]];
  }
  get assembleSelectedIds(): string[] { return this.assembleItems.filter(x => x.selected).map(x => x.id); }

  /** Assemble les déterminations choisies (aperçu serveur) → grille éditable. */
  runAssemble(): void {
    const ids = this.assembleSelectedIds;
    if (!ids.length || !this.selectedType || this.assembling) return;
    this.assembling = true;
    this.piecesService.previewAssembleRdi(this.parentRef(), ids).subscribe({
      next: (res) => {
        this.assembling = false;
        this.assembleModalOpen = false;
        this.assembleSourceIds = ids;
        const rows = res.rows?.length ? res.rows : [{}];
        this.setGridData(rows);
        this.toast.success('Assemblage', `${res.total_rows} ligne(s) assemblées.`);
      },
      error: (e) => { this.assembling = false; this.toast.error('Échec', this.errorMessage(e, 'Assemblage impossible')); },
    });
  }

  submitAssemble(): void {
    if (!this.manualForm || !this.selectedType || this.submittingAssemble) return;
    this.submittingAssemble = true;
    this.piecesService.confirmAssembleRdi(this.parentRef(), this.assembleSourceIds, this.wizardRows).subscribe({
      next: (p) => { this.submittingAssemble = false; this.finishCreate(p, 'Rapport des déterminations intermédiaires assemblé'); },
      error: (e) => { this.submittingAssemble = false; this.toast.error('Échec', this.errorMessage(e, 'Création impossible')); },
    });
  }

  // --- Assemblage RDIA depuis des FICHIERS de déterminations (CSV/Excel/HTML) ---
  assembleFilesModalOpen = false;
  assembleFilesParsing = false;
  submittingAssembleFiles = false;
  assembleFileItems: DeterminationFileItem[] = [];
  /** Critère de tri actif ; `null` = ordre manuel (les étiquettes restent positionnelles). */
  assembleSortKey: DetSortKey | null = 'fixe';
  assembleSortDir: 1 | -1 = 1;
  fixesLabel = fixesLabel;

  openAssembleFilesModal(): void { this.assembleFilesModalOpen = true; }
  closeAssembleFilesModal(): void { this.assembleFilesModalOpen = false; }
  /** Réinitialise l'import : vide la liste des fichiers de déterminations. */
  resetAssembleFiles(): void { this.assembleFileItems = []; this.assembleSortKey = 'fixe'; this.assembleSortDir = 1; }

  /** Fichiers CSV/Excel sélectionnés → analyse serveur → ajout à la liste ordonnable. */
  onAssembleCsvSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) this.parseAndAddDeterminations(files.map(f => ({ file: f, displayName: f.name })));
  }
  /** Dossier de rapports HTML TBC → résolution cadre→body (findTbcReports) → analyse serveur.
   * Nom affiché = fichier HTML CADRE (frameset), pas le titre du rapport. */
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
        this.toast.success('Analyse', `${res.determinations.length} détermination(s) ajoutée(s).`);
      },
      error: (e) => { this.assembleFilesParsing = false; this.toast.error('Échec', this.errorMessage(e, 'Analyse des fichiers impossible')); },
    });
  }

  /** Applique le tri actif (si défini) puis (re)fige les étiquettes selon la position. */
  private applyAssembleOrder(): void {
    if (this.assembleSortKey) sortDeterminationItems(this.assembleFileItems, this.assembleSortKey, this.assembleSortDir);
    relabelDeterminationItems(this.assembleFileItems);
  }

  /** Tri des fichiers par critère (bascule le sens si déjà actif). */
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
    this.assembleSortKey = null;              // ordre manuel
    relabelDeterminationItems(a);             // étiquettes positionnelles figées
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

  /** Assemble les fichiers (client) → grille éditable. */
  runAssembleFiles(): void {
    if (!this.assembleFileItems.length || !this.selectedType) return;
    const rows = assembleDeterminationRows(this.assembleFileItems);
    this.setGridData(rows);
    this.assembleFilesModalOpen = false;
    this.toast.success('Assemblage', `${rows.length} ligne(s) assemblées.`);
  }

  submitAssembleFiles(): void {
    if (!this.manualForm || !this.selectedType || this.submittingAssembleFiles) return;
    this.submittingAssembleFiles = true;
    this.piecesService.createManual({
      type_piece: this.selectedType.code, parent: this.parentRef(),
      numero: this.nextNumero(), data: { rows: this.wizardRows },
    }).subscribe({
      next: (p) => { this.submittingAssembleFiles = false; this.finishCreate(p, 'Rapport des déterminations intermédiaires assemblé'); },
      error: (e) => { this.submittingAssembleFiles = false; this.toast.error('Échec', this.errorMessage(e, 'Création impossible')); },
    });
  }

  /** Sélection du DOSSIER du rapport TBC (fichier HTML cadre + son dossier « _files »).
   * La détection des rapports (cadre → body, rapports autonomes) est partagée avec la
   * page de modification : cf. `tbc-report.util.ts`. */
  onHtmlFolderSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length || !this.selectedType) return;
    this.manualForm = null; this.wizardRows = [];
    this.htmlFile = null;
    this.htmlPreviewing = true;

    findTbcReports(files, this.selectedType.code).then(candidates => {
      if (!candidates.length) {
        this.htmlPreviewing = false;
        this.toast.error('Données introuvables', 'Aucun rapport TBC compatible avec cette pièce trouvé (fichier cadre ou dossier « _files » manquant ?).');
        return;
      }
      if (candidates.length === 1) {
        this.previewCandidate(candidates[0].file);
        return;
      }
      // Plusieurs rapports → laisser choisir.
      this.htmlPreviewing = false;
      this.htmlCandidates = candidates;
    });
  }

  /** Charge un rapport candidat : parse serveur → grille éditable.
   * `htmlCandidates` est conservé pour permettre « Changer de rapport ». */
  previewCandidate(file: File): void {
    if (!this.selectedType) return;
    this.htmlFile = file;
    this.manualForm = null; this.wizardRows = [];
    this.htmlPreviewing = true;
    this.piecesService.previewHtmlImport(file, this.selectedType.code).subscribe({
      next: (res) => {
        this.htmlPreviewing = false;
        this.htmlModalOpen = false;
        const rows = res.rows?.length ? res.rows : [{}];
        this.setGridData(rows);
        this.toast.success('Import HTML', `${res.total_rows} ligne(s) générée(s).`);
      },
      error: (e) => { this.htmlPreviewing = false; this.htmlFile = null; this.toast.error('Échec', this.errorMessage(e, 'Lecture du rapport HTML impossible')); },
    });
  }

  /** Revenir à la liste des rapports détectés (multi-rapports). */
  backToHtmlChoice(): void { this.manualForm = null; this.wizardRows = []; this.htmlFile = null; }

  /** Extrait un message lisible d'une erreur HTTP DRF (`detail`, erreur par champ, ou chaîne). */
  private errorMessage(e: any, fallback: string): string {
    const err = e?.error;
    if (typeof err === 'string') return err;
    if (err?.detail) return typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail);
    if (err && typeof err === 'object') {
      const first = Object.values(err)[0];
      if (Array.isArray(first) && first.length) return String(first[0]);
      if (typeof first === 'string') return first;
    }
    return fallback;
  }

  submitHtml(): void {
    if (!this.htmlFile || !this.selectedType || !this.manualForm || this.submittingHtml) return;
    this.submittingHtml = true;
    this.piecesService.confirmHtmlImport(
      this.htmlFile, this.selectedType.code, this.parentRef(), this.nextNumero(), this.wizardRows,
    ).subscribe({
      next: (p) => { this.submittingHtml = false; this.finishCreate(p, 'Rapport HTML importé'); },
      error: (e) => { this.submittingHtml = false; this.toast.error('Échec', this.errorMessage(e, 'Import HTML impossible')); },
    });
  }

  // --- Saisie manuelle ---
  private initManualForm(): void { this.setGridData([{}]); }

  /** Alimente la grille éditable (composant app-piece-data-table) et le drapeau de préparation
   * `manualForm`. Copie profonde des lignes ; démarre sur une ligne vide si aucune donnée. */
  private setGridData(rows: any[]): void {
    this.wizardRows = (rows || []).map((r: any) => ({ ...r }));
    this.manualForm = this.fb.group({ rows: this.fb.array((rows.length ? rows : [{}]).map((r: any) => this.buildManualRow(r))) });
  }
  private buildManualRow(row: any = {}): FormGroup {
    const group: Record<string, any> = {};
    this.manualChamps.forEach(c => { group[c.name] = [row[c.name] ?? '']; });
    return this.fb.group(group);
  }
  get manualRows(): FormArray { return this.manualForm!.get('rows') as FormArray; }
  addManualRow(): void { this.manualRows.push(this.buildManualRow()); }
  removeManualRow(i: number): void { if (this.manualRows.length > 1) this.manualRows.removeAt(i); }
  /** Vider le tableau : ouvre la modale de confirmation (persisté seulement à la création). */
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

  submitManual(): void {
    if (!this.manualForm || !this.selectedType || this.submittingManual) return;
    this.submittingManual = true;
    this.piecesService.createManual({
      type_piece: this.selectedType.code, parent: this.parentRef(), numero: this.nextNumero(),
      data: { rows: this.wizardRows },
    }).subscribe({
      next: (p) => { this.submittingManual = false; this.finishCreate(p, 'Pièce enregistrée'); },
      error: (e) => { this.submittingManual = false; this.toast.error('Échec', e?.error?.detail || 'Enregistrement impossible'); },
    });
  }

  cancelSourceForm(): void {
    this.selectedSource = null;
    this.selectedFile = null;
    this.importPreview = null;
    this.currentMapping = {};
    this.manualForm = null; this.wizardRows = [];
    this.htmlFile = null;
    this.htmlCandidates = [];
    this.htmlModalOpen = false;
    this.bulkModalOpen = false;
    this.bulkCandidates = [];
    this.computeError = null;
    this.rcSource = null;
    this.rcAvailableSources = [];
    this.assembleModalOpen = false;
    this.assembleItems = [];
    this.assembleSourceIds = [];
    this.assembleFilesModalOpen = false;
    this.assembleFileItems = [];
    this.clearLocalImages();
  }

  private resetSourceState(): void { this.cancelSourceForm(); }

  close(): void { this.cancelled.emit(); }
}
