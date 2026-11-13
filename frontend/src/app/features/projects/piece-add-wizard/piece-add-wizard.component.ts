import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormArray, FormBuilder, FormGroup } from '@angular/forms';
import { PiecesService, RcSource } from '../../../core/services/pieces.service';
import { ToastService } from '../../../core/services/toast.service';
import { PieceSortConfigService, PieceSortConfig, brutSortLevels } from '../../../core/services/piece-sort-config.service';
import { PieceFieldsConfig, PieceFieldsConfigService } from '../../../core/services/piece-fields-config.service';
import { Piece, PieceChampDef, PieceImportPreview, PieceTypeDef } from '../../../core/models/piece.model';
import { Ssdgps, Session } from '../../../core/models/project.model';
import { formatFieldDate, formatDateTime } from '../../../shared/utils/date-format.util';
import { classifyColorMode, compressionLabel, readExifDate } from '../piece-image-meta.util';
import { findTbcReports, TbcReportCandidate } from '../tbc-report.util';
import { PdfRenderService } from '../../../core/services/pdf-render.service';
import { PdfPageResult } from '../pdf-page-editor/pdf-page-editor.component';
import { assembleDeterminationRows, sortDeterminationItems, relabelDeterminationItems,
         fixesLabel, DeterminationFileItem, DetSortKey } from '../rdia.util';

/**
 * Étapes du parcours. La phase « Source des données » est éclatée en sous-étapes dont le
 * nombre dépend du type de pièce : `method` (choix de la façon de fournir les données —
 * uniquement quand le type en propose plusieurs), `data` (saisie/import proprement dit),
 * `place` (récapitulatif + position dans le rapport), et `photos` (PPA/PPN uniquement,
 * après création).
 */
type Step = 'type' | 'scope' | 'method' | 'data' | 'map' | 'place' | 'photos';
type Source = 'image' | 'csv' | 'manuel' | 'html' | 'compute' | 'assemble' | 'assemble-files';

/** Une façon de fournir les données, telle que présentée en carte à la sous-étape « Méthode ».
 * `bulk` est une ACTION (création en masse) et non une `Source` menant à un formulaire. */
interface MethodChoice { id: Source | 'bulk'; icon: string; title: string; desc: string; }

/** Image locale sélectionnée (pas encore envoyée) : fichier + URL d'aperçu (objectURL) et
 * métadonnées techniques lues côté client (dimensions, type d'image, compression, dates),
 * pour le panneau de détails et l'orientation recommandée. Mêmes rubriques que la galerie
 * de consultation d'une pièce — cf. `piece-image-meta.util.ts`. */
interface LocalImage {
  file: File;
  url: string;
  width: number | null;
  height: number | null;
  /** Type d'image (« Couleur », « Niveaux de gris », « Noir & blanc ») ; '' si indéterminé. */
  modeCouleur: string;
  /** Libellé de compression déduit du format ; '' si connu seulement après import (TIFF). */
  compression: string;
  /** Date de prise de vue (EXIF) ; `null` si le format n'en porte pas. */
  dateCreation: Date | null;
  /** Dernière modification du fichier — exactement ce que le serveur enregistrera. */
  dateModification: Date;
}

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
  /** Type imposé par l'hôte (assistant de création d'un SDGPS : la pièce suivante de la
   * liste de contrôle). Renseigné, l'étape « Type » est sautée et le parcours démarre
   * directement sur la phase suivante. */
  @Input() presetTypeCode: string | null = null;
  @Output() created = new EventEmitter<Piece>();
  @Output() cancelled = new EventEmitter<void>();
  /** Type en cours de création (`null` tant qu'aucun n'est choisi) — la page hôte s'en sert
   * pour titrer « Ajouter une nouvelle pièce de type … ». */
  @Output() typeSelected = new EventEmitter<PieceTypeDef | null>();

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
  localImages: LocalImage[] = [];
  /** Image mise en avant dans le panneau de détails (index dans `localImages`). */
  selectedImageIndex = 0;
  /** Visionneuse plein écran de l'image sélectionnée. */
  imageLightboxOpen = false;
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
    if (this.presetTypeCode) {
      const def = this.catalog.find(d => d.code === this.presetTypeCode);
      if (def) this.selectType(def);
    }
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

  /** L'étape « Session » n'a lieu d'être que si le rattachement est AMBIGU : SSDGPS
   * multi-session ET aucune session de contexte. Quand l'ajout part d'une session donnée,
   * cette session est la destination par défaut de la pièce — l'étape ne ferait que
   * redemander une réponse déjà connue. */
  get needsSessionStep(): boolean { return this.isMulti && !this.defaultSessionId; }

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

  // --- Sous-étapes de la phase « Source des données » --------------------------

  /** Façons de fournir les données pour le type courant, dans l'ordre d'affichage.
   * SOURCE DE VÉRITÉ UNIQUE : la sous-étape « Méthode » (cartes), le décompte qui décide
   * de l'afficher ou non, et l'auto-sélection quand il n'y en a qu'une, en dérivent tous. */
  get sourceChoices(): MethodChoice[] {
    const def = this.selectedType;
    if (!def) return [];
    const c: MethodChoice[] = [];
    if (this.sourceAllows('image') && !this.isPhotoPoints)
      c.push({ id: 'image', icon: 'fa-images', title: 'Importer des images',
        desc: 'Une ou plusieurs images, rendues en pleine page dans le rapport.' });
    if (this.sourceAllows('csv'))
      c.push({ id: 'csv', icon: 'fa-file-csv', title: 'Importer un fichier CSV / Excel',
        desc: 'Vous associez ensuite chaque colonne du fichier au champ correspondant.' });
    if (this.sourceAllows('manuel'))
      c.push({ id: 'manuel', icon: 'fa-keyboard', title: 'Saisie manuelle',
        desc: 'Un tableau vide à remplir directement dans l\'application.' });
    if (def.html_import)
      c.push({ id: 'html', icon: 'fa-file-code', title: 'Importer un rapport HTML (TBC)',
        desc: 'Les lignes sont extraites automatiquement du rapport produit par TBC.' });
    if (this.supportsBulkHtml)
      c.push({ id: 'bulk', icon: 'fa-layer-group', title: `Créer plusieurs ${def.code} en une fois`,
        desc: 'Un dossier de rapports TBC produit une pièce par rapport détecté.' });
    if (def.computed)
      c.push({ id: 'compute', icon: 'fa-calculator', title: 'Calculer automatiquement',
        desc: 'Croise la liste des points anciens (LPA) avec les déterminations du dossier.' });
    if (this.supportsAssemble) {
      c.push({ id: 'assemble', icon: 'fa-object-group', title: 'Assembler depuis le dossier',
        desc: 'Réunit les déterminations déjà présentes dans ce dossier en un seul rapport.' });
      c.push({ id: 'assemble-files', icon: 'fa-file-import', title: 'Importer puis assembler des fichiers',
        desc: 'Mêmes règles, mais depuis des fichiers CSV, Excel ou HTML de votre disque.' });
    }
    return c;
  }

  /** Pièce dont la SEULE façon de fournir les données est l'import d'images (RDC, CCSPA,
   * CDC, CLC…). Ces pièces n'ont ni tableau ni méthode à choisir : l'étape « Données » se
   * réduit au dépôt des images, et la méthode doit être ANNONCÉE puisqu'elle n'a jamais été
   * proposée (sous-étape « Méthode » sautée faute d'alternative). */
  get isImageOnly(): boolean {
    const choices = this.sourceChoices;
    return choices.length === 1 && choices[0].id === 'image';
  }

  // --- Stepper -----------------------------------------------------------------

  /** Étapes du parcours, dans l'ordre. « Session » n'existe qu'en multi-session, et la phase
   * source se scinde en `method` (si ≥ 2 façons de fournir les données), `data`, `place` et,
   * pour les pièces à photos par point (PPA/PPN), `photos`. Tant qu'aucun type n'est choisi,
   * la phase source reste une pastille unique (on ne connaît pas encore ses sous-étapes). */
  get wizardSteps(): { key: Step; label: string; icon: string }[] {
    const s: { key: Step; label: string; icon: string }[] = [
      { key: 'type', label: 'Type de pièce', icon: 'fa-shapes' },
    ];
    if (this.needsSessionStep) s.push({ key: 'scope', label: 'Session', icon: 'fa-clock' });
    if (!this.selectedType) {
      s.push({ key: 'data', label: 'Source des données', icon: 'fa-database' });
      return s;
    }
    if (this.sourceChoices.length > 1) s.push({ key: 'method', label: 'Méthode', icon: 'fa-list-check' });
    // Import CSV/Excel : le fichier est déposé DANS l'étape « Méthode » ; l'étape suivante
    // « Colonnes » réunit le mapping et l'aperçu des premières lignes sous deux onglets.
    if (this.selectedSource === 'csv') {
      s.push({ key: 'map', label: 'Colonnes', icon: 'fa-table-columns' });
    } else {
      s.push({ key: 'data', label: 'Données', icon: 'fa-table' });
    }
    s.push({ key: 'place', label: 'Placement', icon: 'fa-map-pin' });
    if (this.isPhotoPoints) s.push({ key: 'photos', label: 'Photos', icon: 'fa-camera' });
    return s;
  }

  /** Rang de l'étape courante (0-indexé) — sert à marquer les étapes faites/à venir. */
  get currentStepIndex(): number {
    return Math.max(0, this.wizardSteps.findIndex(s => s.key === this.step));
  }

  /** Une étape déjà franchie est cliquable : revenir en arrière est un besoin courant.
   * Revenir à `method` (ou avant) réinitialise la source ; revenir à `data` conserve la saisie. */
  goToStep(index: number): void {
    if (index >= this.currentStepIndex) return;
    const target = this.wizardSteps[index];
    switch (target.key) {
      case 'type': this.backToType(); break;
      case 'scope': this.resetSourceState(); this.step = 'scope'; break;
      case 'method': this.resetSourceState(); this.step = 'method'; break;
      case 'data': this.step = 'data'; break;
      // Revenir à « Colonnes » (mapping + aperçu) conserve fichier et mapping.
      case 'map': this.step = 'map'; break;
    }
  }

  selectType(def: PieceTypeDef): void {
    this.selectedType = def;
    this.typeSelected.emit(def);
    if (this.needsSessionStep) {
      // Multi-session SANS session de contexte : le rattachement doit être choisi.
      this.selectedNiveau = null;
      this.selectedSessionId = null;
      this.step = 'scope';
    } else if (this.isMulti) {
      // Multi-session AVEC session de contexte : la pièce est rattachée à cette session,
      // sans étape intermédiaire (la question n'a qu'une réponse possible).
      this.selectedNiveau = 'session';
      this.selectedSessionId = this.defaultSessionId;
      this.enterSourcePhase();
    } else {
      // Mono-session : aucun choix de niveau — pièce rattachée au SSDGPS directement.
      this.selectedNiveau = 'ssdgps';
      this.selectedSessionId = null;
      this.enterSourcePhase();
    }
  }

  chooseNiveauSession(sessionId: string): void {
    this.selectedNiveau = 'session';
    this.selectedSessionId = sessionId;
    this.enterSourcePhase();
  }

  /** Entrée dans la phase source : si le type propose plusieurs façons de fournir les données,
   * on affiche la sous-étape « Méthode » ; sinon on saute directement à « Données » en
   * pré-sélectionnant l'unique façon disponible (une étape à un seul choix n'apporte rien). */
  private enterSourcePhase(): void {
    const choices = this.sourceChoices;
    if (choices.length > 1) { this.step = 'method'; return; }
    const sole = choices[0];
    if (sole && sole.id !== 'bulk') { this.selectSource(sole.id); return; }
    // Filet de sécurité (aucune façon déclarée) : saisie manuelle d'un tableau vide.
    this.selectedSource = 'manuel'; this.step = 'data'; this.initManualForm();
  }

  /** Choix d'une carte de méthode : la création en masse ouvre sa modale, les autres
   * ouvrent le formulaire de la sous-étape « Données ». */
  selectMethod(m: MethodChoice): void {
    if (m.id === 'bulk') { this.openBulkModal(); return; }
    this.selectSource(m.id);
  }

  /** Date d'une session au format unifié de l'app (`date_session` s'affiche SANS heure). */
  formatSessionDate(s: Session): string { return formatFieldDate(s.date_session, 'date_session'); }

  /** Position d'insertion : `true` = à la fin du rapport, `false` = position précise.
   * Passe par une méthode plutôt qu'une affectation en ligne pour que le contrôle segmenté
   * reste testable et que la remise à zéro éventuelle vive à un seul endroit. */
  setInsertAtEnd(atEnd: boolean): void { this.insertAtEnd = atEnd; }

  get selectedSessionNumero(): number | undefined {
    return this.sessions.find(s => s.id === this.selectedSessionId)?.numero_session;
  }

  backToType(): void {
    // Type imposé par l'hôte : il n'y a pas d'autre type à choisir ici — revenir en
    // arrière, c'est rendre la main à l'hôte (la liste de contrôle de l'assistant).
    if (this.presetTypeCode) { this.cancelled.emit(); return; }
    this.step = 'type'; this.selectedType = null; this.typeSelected.emit(null); this.resetSourceState();
  }
  /** Depuis la sous-étape « Méthode » : retour au choix de session quand cette étape existe,
   * sinon directement au choix du type. */
  backToNiveau(): void {
    if (this.needsSessionStep) { this.resetSourceState(); this.step = 'scope'; }
    else this.backToType();
  }

  /** Retour depuis « Données » : vers « Méthode » quand il y a un choix à refaire, sinon
   * directement vers l'étape précédente (la sous-étape « Méthode » n'existe pas). */
  backFromData(): void {
    if (this.sourceChoices.length > 1) { this.resetSourceState(); this.step = 'method'; }
    else this.backToNiveau();
  }

  /** Retour depuis « Colonnes » vers « Méthode & import » — fichier et méthode conservés
   * (on revient sur la zone de dépôt, pas sur les cartes). */
  backFromMap(): void { this.step = 'method'; }

  /** Retour depuis « Placement » vers la dernière sous-étape de données — saisie conservée.
   * Pour l'import CSV, c'est « Colonnes » ; pour les autres sources, « Données ». */
  backToData(): void { this.step = this.selectedSource === 'csv' ? 'map' : 'data'; }

  /** Passage de « Données » (ou « Aperçu ») à « Placement » : n'avance que si la saisie est exploitable. */
  goToPlace(): void { if (this.canContinueFromData) this.step = 'place'; }

  /** La saisie de la sous-étape « Données » est-elle prête à être créée ? (Critère par source.) */
  get canContinueFromData(): boolean {
    switch (this.selectedSource) {
      case 'image': return this.localImages.length > 0;
      case 'csv': return !!this.importPreview;
      case null: return false;
      default: return !!this.manualForm;   // manuel / html / compute / assemble / assemble-files
    }
  }

  // --- Import CSV/Excel : étape « Méthode & import » puis « Colonnes » (onglets) ---------

  /** Onglet actif de l'étape « Colonnes » : mapping des colonnes ou aperçu des premières lignes. */
  mapTab: 'mapping' | 'preview' = 'mapping';
  /** Champs effectivement mappés (colonne source associée), pour l'aperçu et le récapitulatif. */
  mappedPreviewChamps: PieceChampDef[] = [];
  /** Lignes d'échantillon (issues du serveur) reprojetées via le mapping, pour l'aperçu. */
  mappedPreviewRows: any[] = [];

  /** Nombre de champs mappés / nombre total de champs cibles — pour les jetons d'aperçu. */
  get importMappedCount(): number { return Object.keys(this.currentMapping || {}).length; }
  get importTotalChamps(): number { return this.importPreview?.champs.length || 0; }

  /** Bascule d'onglet dans « Colonnes » : (re)construit l'aperçu à l'entrée de l'onglet Aperçu
   * pour qu'il reflète le mapping courant. */
  setMapTab(tab: 'mapping' | 'preview'): void {
    if (tab === 'preview') this.buildMappedPreview();
    this.mapTab = tab;
  }

  /** « Méthode & import » → « Colonnes » : n'avance qu'une fois le fichier lu. Ouvre sur
   * l'onglet Mapping. */
  goToMap(): void {
    if (!this.importPreview) return;
    this.mapTab = 'mapping';
    this.step = 'map';
  }

  /** Abandonne le fichier choisi et revient au choix de méthode (cartes). */
  deselectMethod(): void {
    this.selectedSource = null;
    this.selectedFile = null;
    this.importPreview = null;
    this.currentMapping = {};
    this.mappedPreviewChamps = []; this.mappedPreviewRows = [];
    this.dragOver = false;
    this.step = 'method';
  }

  /** Construit l'aperçu (échantillon serveur reprojeté selon le mapping courant). READ-ONLY :
   * la création réelle relit le fichier côté serveur (`confirmImport`) — l'aperçu ne fait que
   * montrer ce qui sera importé, il n'est pas une source de données éditable. */
  private buildMappedPreview(): void {
    const pv = this.importPreview;
    if (!pv) { this.mappedPreviewChamps = []; this.mappedPreviewRows = []; return; }
    const champs = pv.champs.filter(c => this.currentMapping[c.name]);
    this.mappedPreviewChamps = champs;
    this.mappedPreviewRows = (pv.preview_rows || []).map(raw => {
      const o: any = {};
      champs.forEach(c => {
        const idx = pv.columns.indexOf(this.currentMapping[c.name]);
        o[c.name] = idx >= 0 ? (raw[idx] ?? '') : '';
      });
      return o;
    });
  }

  /** Une création (quelle que soit la source) est-elle en cours ? — pour l'état du bouton « Créer ». */
  get submitting(): boolean {
    return this.submittingImages || this.importing || this.submittingManual || this.submittingHtml
      || this.submittingCompute || this.submittingAssemble || this.submittingAssembleFiles;
  }

  /** Bouton « Créer » de la sous-étape « Placement » : aiguille vers la création propre à la
   * source retenue. La position (fin / précise) est déjà fixée sur cette même sous-étape et
   * appliquée par `finishCreate`. */
  submitCurrent(): void {
    switch (this.selectedSource) {
      case 'image': this.submitImages(); break;
      case 'csv': this.confirmImport(); break;
      case 'manuel': this.submitManual(); break;
      case 'html': this.submitHtml(); break;
      case 'compute': this.submitCompute(); break;
      case 'assemble': this.submitAssemble(); break;
      case 'assemble-files': this.submitAssembleFiles(); break;
    }
  }

  /** Libellé lisible de la source retenue (récapitulatif de la sous-étape « Placement »). */
  methodLabel(src: Source | null): string {
    return ({
      image: 'Images', csv: 'Import CSV / Excel', manuel: 'Saisie manuelle',
      html: 'Import HTML (TBC)', compute: 'Calcul automatique',
      assemble: 'Assemblage du dossier', 'assemble-files': 'Import & assemblage de fichiers',
    } as Record<string, string>)[src as string] || '—';
  }

  /** Résumé du contenu saisi, pour le récapitulatif avant création. */
  get contentSummary(): string {
    if (this.selectedSource === 'image') return `${this.localImages.length} image(s)`;
    if (this.selectedSource === 'csv') return this.selectedFile?.name || 'fichier sélectionné';
    return `${this.wizardRows.length} ligne(s)`;
  }

  /** Numéro que portera la pièce (types répétables) — exposé pour le récapitulatif. */
  get previewNumero(): number | undefined { return this.nextNumero(); }

  /** Lignes du récapitulatif de la sous-étape « Placement » (type, rattachement, méthode, contenu…). */
  get placementRecap(): { icon: string; label: string; value: string }[] {
    const r: { icon: string; label: string; value: string }[] = [];
    if (this.selectedType) r.push({ icon: 'fa-shapes', label: 'Type', value: `${this.selectedType.code} — ${this.selectedType.nom}` });
    if (this.selectedNiveau === 'session') r.push({ icon: 'fa-clock', label: 'Rattachement', value: `Session n°${this.selectedSessionNumero}` });
    else r.push({ icon: 'fa-globe', label: 'Rattachement', value: 'Commun au SSDGPS' });
    r.push({ icon: 'fa-wand-magic-sparkles', label: 'Méthode', value: this.methodLabel(this.selectedSource) });
    r.push({ icon: 'fa-table-list', label: 'Contenu', value: this.contentSummary });
    if (this.selectedType?.repeatable) {
      const n = this.nextNumero();
      if (n) r.push({ icon: 'fa-hashtag', label: 'Numéro', value: `n°${n}` });
    }
    return r;
  }

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
    // L'import CSV/Excel réunit choix de méthode ET dépôt du fichier sur la MÊME étape
    // (« Méthode ») ; on ne passe à « Colonnes » (mapping + aperçu) qu'une fois le fichier lu.
    this.step = kind === 'csv' ? 'method' : 'data';
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

  /** Survol d'une zone de dépôt (import CSV comme images) : une seule zone est visible à la
   * fois, un indicateur unique suffit donc pour l'état « prêt à déposer ». */
  dragOver = false;
  onDragOver(e: DragEvent): void { e.preventDefault(); this.dragOver = true; }
  onDragLeave(e: DragEvent): void { e.preventDefault(); this.dragOver = false; }
  onCsvDrop(e: DragEvent): void {
    e.preventDefault(); this.dragOver = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) this.ingestImportFile(f);
  }
  onImagesDrop(e: DragEvent): void {
    e.preventDefault(); this.dragOver = false;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) this.ingestImages(files);
  }

  // --- Upload d'images (multi) ---
  onImagesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.ingestImages(files);
  }

  /** Taille maximale par image (2 Mo) — plafond strict, image plus lourde rejetée. */
  static readonly MAX_IMAGE_BYTES = 2 * 1024 * 1024;

  /** Ajoute des images (dépôt ou parcours) après filtrage format ET taille (≤ 2 Mo). Lit les
   * dimensions côté client pour le panneau de détails et l'orientation recommandée. */
  // --- PDF d'images : édition des pages avant import -------------------------------
  /** PDF en cours d'édition (un à la fois) et ceux qui attendent leur tour. */
  pdfEditing: File | null = null;
  private pdfQueue: File[] = [];

  /** Pages retenues d'un PDF : ce sont désormais des images ordinaires (JPEG ≤ 2 Mo). */
  onPdfPages(results: PdfPageResult[]): void {
    this.pdfEditing = null;
    this.ingestImages(results.map(r => r.file));
    if (results.length) this.toast.success('PDF importé', `${results.length} page(s) ajoutée(s) comme images.`);
    this.nextPdf();
  }
  onPdfCancelled(): void { this.pdfEditing = null; this.nextPdf(); }
  private nextPdf(): void { this.pdfEditing = this.pdfQueue.shift() || null; }

  private ingestImages(files: File[]): void {
    // Un PDF n'est pas importé tel quel : ses pages passent d'abord par l'éditeur de pages
    // (suppression, ordre, rotation), qui les rend en images.
    const pdfs = files.filter(f => PdfRenderService.isPdf(f));
    if (pdfs.length) {
      this.pdfQueue.push(...pdfs);
      if (!this.pdfEditing) this.nextPdf();
      files = files.filter(f => !PdfRenderService.isPdf(f));
      if (!files.length) return;
    }
    const wellFormatted = files.filter(f => /\.(png|jpe?g|tiff?|webp)$/i.test(f.name));
    const tooBig = wellFormatted.filter(f => f.size > PieceAddWizardComponent.MAX_IMAGE_BYTES);
    const valid = wellFormatted.filter(f => f.size <= PieceAddWizardComponent.MAX_IMAGE_BYTES);
    if (wellFormatted.length < files.length) {
      this.toast.error('Fichier(s) ignoré(s)', 'Formats acceptés : png, jpg, jpeg, tiff, webp, pdf.');
    }
    if (tooBig.length) {
      this.toast.error('Image(s) trop lourde(s)', `${tooBig.length} image(s) > 2 Mo ignorée(s). Chaque image doit peser 2 Mo au maximum.`);
    }
    const wasEmpty = this.localImages.length === 0;
    valid.forEach(f => {
      const li: LocalImage = {
        file: f, url: URL.createObjectURL(f), width: null, height: null,
        // Déductibles immédiatement (sans décoder l'image).
        modeCouleur: '', compression: compressionLabel(f.name),
        dateCreation: null, dateModification: new Date(f.lastModified),
      };
      this.localImages.push(li);
      this.readImageMeta(li);
    });
    if (wasEmpty && this.localImages.length) this.selectedImageIndex = 0;
  }

  /** Complète les métadonnées nécessitant une lecture du fichier : dimensions et type
   * d'image (décodage via <img> — impossible pour le TIFF), puis date EXIF de prise de vue. */
  private readImageMeta(li: LocalImage): void {
    readExifDate(li.file).then(d => { if (d) li.dateCreation = d; });
    if (!this.isPreviewable(li.file)) return;
    const probe = new Image();
    probe.onload = () => {
      li.width = probe.naturalWidth;
      li.height = probe.naturalHeight;
      li.modeCouleur = classifyColorMode(probe);
    };
    probe.src = li.url;
  }

  /** Date au format unifié de l'app ; « — » si absente (cf. `formatDateTime`). */
  formatImageDate(d: Date | null): string { return formatDateTime(d); }

  /** Présentation des images choisies : vignettes ou liste détaillée — même bascule que la
   * galerie de consultation d'une pièce. */
  imageViewMode: 'grid' | 'list' = 'grid';
  setImageViewMode(mode: 'grid' | 'list'): void { this.imageViewMode = mode; }

  /** Image mise en avant dans le panneau de détails. */
  get selectedLocalImage(): LocalImage | null {
    if (!this.localImages.length) return null;
    return this.localImages[this.selectedImageIndex] || this.localImages[0];
  }
  selectLocalImage(i: number): void { this.selectedImageIndex = i; }

  removeLocalImage(i: number): void {
    URL.revokeObjectURL(this.localImages[i].url);
    this.localImages.splice(i, 1);
    if (this.selectedImageIndex >= this.localImages.length) {
      this.selectedImageIndex = Math.max(0, this.localImages.length - 1);
    }
  }

  moveLocalImage(i: number, dir: -1 | 1): void {
    const j = i + dir;
    if (j < 0 || j >= this.localImages.length) return;
    [this.localImages[i], this.localImages[j]] = [this.localImages[j], this.localImages[i]];
    if (this.selectedImageIndex === i) this.selectedImageIndex = j;
    else if (this.selectedImageIndex === j) this.selectedImageIndex = i;
  }

  /** TIFF n'a pas d'aperçu natif dans un <img>. */
  isPreviewable(f: File): boolean { return !/\.tiff?$/i.test(f.name); }

  /** Format « métier » d'une image locale (extension en majuscules). */
  imageFormat(li: LocalImage): string {
    const m = li.file.name.match(/\.([a-z0-9]+)$/i);
    return m ? m[1].toUpperCase() : '—';
  }

  /** Orientation d'une image locale d'après ses dimensions (`null` tant qu'inconnues). */
  imageOrientation(li: LocalImage | null): 'portrait' | 'paysage' | null {
    if (!li || li.width == null || li.height == null) return null;
    return li.width > li.height ? 'paysage' : 'portrait';
  }

  /** Orientation « automatique » de la pièce image : orientation dominante des images
   * importées (l'affichage pleine page suit le contenu). `null` avant tout import exploitable. */
  get imagesOrientation(): 'portrait' | 'paysage' | null {
    let p = 0, l = 0;
    for (const li of this.localImages) {
      const o = this.imageOrientation(li);
      if (o === 'portrait') p++; else if (o === 'paysage') l++;
    }
    if (!p && !l) return null;
    return l > p ? 'paysage' : 'portrait';
  }

  /** Message de recommandation dimensions/ratio ADAPTÉ à l'orientation automatique de la pièce
   * (déduite des images) : portrait ≈ 3:4, paysage ≈ 4:3 ; neutre tant qu'aucune image n'est lue. */
  get imageRecommendation(): { ratio: string; dims: string; orient: string } {
    const o = this.imagesOrientation;
    if (o === 'paysage') return { orient: 'paysage', ratio: '4:3', dims: '1754 × 1240 px' };
    if (o === 'portrait') return { orient: 'portrait', ratio: '3:4', dims: '1240 × 1754 px' };
    return { orient: 'portrait ou paysage', ratio: '3:4 ou 4:3', dims: '≈ 1240 × 1754 px (portrait) ou 1754 × 1240 px (paysage)' };
  }

  /** Taille lisible d'un nombre d'octets (o / Ko / Mo…). */
  humanSize(bytes: number): string {
    if (!bytes) return '—';
    const units = ['o', 'Ko', 'Mo', 'Go'];
    let n = bytes, u = 0;
    while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
    return `${u === 0 ? n : n.toFixed(1)} ${units[u]}`;
  }

  // Visionneuse plein écran de l'image sélectionnée (aperçu web uniquement).
  openImageLightbox(): void {
    if (this.selectedLocalImage && this.isPreviewable(this.selectedLocalImage.file)) this.imageLightboxOpen = true;
  }
  closeImageLightbox(): void { this.imageLightboxOpen = false; }

  private clearLocalImages(): void {
    this.localImages.forEach(li => URL.revokeObjectURL(li.url));
    this.localImages = [];
    this.selectedImageIndex = 0;
    this.imageLightboxOpen = false;
  }

  submitImages(): void {
    if (!this.selectedType || !this.localImages.length || this.submittingImages) return;
    this.submittingImages = true;
    const files = this.localImages.map(li => li.file);
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
    if (file) this.ingestImportFile(file);
  }

  /** Lit un fichier CSV/Excel (dépôt ou parcours) : aperçu serveur des colonnes + échantillon. */
  private ingestImportFile(file: File): void {
    if (!this.selectedType) return;
    this.selectedFile = file;
    this.importPreview = null;
    this.mappedPreviewChamps = []; this.mappedPreviewRows = [];
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
    this.mappedPreviewChamps = []; this.mappedPreviewRows = [];
    this.mapTab = 'mapping';
    this.dragOver = false;
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
