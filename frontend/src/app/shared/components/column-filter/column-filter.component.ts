import {
  Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, Output, ViewChild,
} from '@angular/core';
import {
  ColumnFacet, DateNode, buildDateTree, distinctColumnValues, defaultFormat, filterKindLabel,
  normalizeSearch, rawValueMap,
} from './column-filter.util';

/** Hauteur minimale du menu : en deçà, la liste des valeurs deviendrait inutilisable. */
const MIN_MENU_HEIGHT = 220;

/**
 * FILTRE DE COLONNE façon Excel — bouton entonnoir dans l'en-tête + menu déroulant contenant :
 *   - les options du menu contextuel de colonne (tri multi-niveaux, masquer, organiser) ;
 *   - un champ de RECHERCHE ;
 *   - la ZONE DES VALEURS de la colonne (cases à cocher, « (Tout sélectionner) », compteurs).
 *
 * Composant PRÉSENTATIONNEL : il calcule les valeurs distinctes à l'ouverture à partir des lignes
 * fournies, et émet la sélection validée. Le parent conserve la map des filtres et l'applique dans
 * son pipeline de filtrage (cf. `rowMatchesColumnFilters`).
 *
 * Comme dans Excel, le filtre porte sur la valeur AFFICHÉE : le parent passe le même formateur que
 * celui utilisé pour le rendu des cellules (`[format]`).
 */
@Component({
  selector: 'app-column-filter',
  templateUrl: './column-filter.component.html',
  styleUrls: ['./column-filter.component.scss'],
})
export class ColumnFilterComponent implements OnDestroy {
  /** Champ de la colonne filtrée. */
  @Input() field = '';
  /** Libellé de la colonne (titre du menu). */
  @Input() label = '';
  /** Lignes servant au calcul des valeurs distinctes (liste de base, hors filtre de cette colonne). */
  @Input() rows: any[] = [];
  /** Formateur d'affichage d'une cellule (doit refléter le rendu du tableau). */
  @Input() format: (row: any, field: string) => string = defaultFormat;
  /** Valeurs actuellement retenues (`null` = colonne non filtrée). */
  @Input() selected: string[] | null = null;
  /** Type de la colonne : pilote le tri et la présentation des valeurs (comme Excel). */
  @Input() type?: string;

  /** Émis à la validation : valeurs retenues, ou `null` pour retirer le filtre. */
  @Output() selectedChange = new EventEmitter<string[] | null>();
  /** Options reprises du menu contextuel de colonne. */
  @Output() openSort = new EventEmitter<void>();
  @Output() hideColumn = new EventEmitter<void>();
  @Output() openColumnConfig = new EventEmitter<void>();

  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('menu') private menuRef?: ElementRef<HTMLElement>;

  open = false;
  search = '';
  /** Position du menu (ancré au bouton, en `position: fixed` pour ne pas être rogné). */
  menuTop = 0;
  menuLeft = 0;
  /** Hauteur maximale calculée pour que le menu tienne ENTIÈREMENT dans la fenêtre. */
  menuMaxHeight = 0;

  /** Valeurs distinctes calculées à l'ouverture. */
  facets: ColumnFacet[] = [];
  /** Arborescence Année ▸ Mois ▸ Jour (colonnes de type date uniquement). */
  dateTree: DateNode[] = [];
  /** Valeurs non interprétables en date (vides, « — »…), listées à plat sous l'arbre. */
  dateOthers: ColumnFacet[] = [];
  /** Nœuds dépliés de l'arborescence. */
  private expanded = new Set<string>();
  /** Sélection en cours d'édition (validée seulement au clic sur « Appliquer »). */
  private draft = new Set<string>();

  constructor(private host: ElementRef<HTMLElement>) {}

  /** Vrai si un filtre est actif sur cette colonne. */
  get isFiltered(): boolean { return Array.isArray(this.selected); }

  // ------------------------------------------------------------------ ouverture / fermeture
  toggle(event: Event): void {
    event.stopPropagation();
    this.open ? this.close() : this.openMenu(event);
  }

  private openMenu(event: Event): void {
    this.facets = distinctColumnValues(this.rows, this.field, this.format, this.type);
    this.buildTree();
    // Aucune sélection enregistrée = tout est retenu (comportement Excel).
    this.draft = new Set(this.selected ?? this.facets.map(f => f.value));
    this.search = '';
    this.anchor = (event.currentTarget as HTMLElement) || this.host.nativeElement;
    this.open = true;
    // Le menu n'existe qu'après le rendu : on le déplace puis on le positionne. Le minuteur est
    // conservé pour être annulé si le menu est refermé (ou le composant détruit) entre-temps —
    // sans quoi un menu orphelin serait rattaché à <body>.
    clearTimeout(this.openTimer);
    this.openTimer = setTimeout(() => {
      if (!this.open) return;
      this.detachToBody();
      this.position();
      this.searchInput?.nativeElement.focus();
    }, 0);
  }

  /** Minuteur du rendu différé (détachement + positionnement). */
  private openTimer: any;

  /** Bouton d'ancrage du menu (conservé pour le positionnement). */
  private anchor?: HTMLElement;

  /**
   * Sort le menu du `<th>` pour l'attacher à `document.body`. INDISPENSABLE : tant qu'il est un
   * descendant de l'en-tête, (1) survoler le menu redéclenche le `mouseenter` du `<th>` et fait
   * réapparaître l'info-bulle par-dessus, (2) les clics internes remontent jusqu'au `<th>` et
   * ouvrent la modale de tri, (3) il est rogné/masqué par l'en-tête collant.
   * L'encapsulation Angular repose sur des attributs portés par l'élément : les styles et les
   * liaisons continuent de fonctionner après le déplacement.
   */
  private detachToBody(): void {
    const el = this.menuRef?.nativeElement;
    if (el && el.parentElement !== document.body) document.body.appendChild(el);
  }

  /**
   * Ancre le menu sous le bouton et garantit qu'il tient ENTIÈREMENT dans la fenêtre :
   * bascule au-dessus quand le bas manque de place, et borne la hauteur (la liste des valeurs
   * défile alors à l'intérieur du menu).
   */
  private position(): void {
    const el = this.menuRef?.nativeElement;
    const btn = this.anchor;
    if (!el || !btn) return;

    const r = btn.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const width = el.offsetWidth || 268;

    // Horizontal : aligné au bouton, ramené dans la fenêtre.
    let left = r.left;
    if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
    this.menuLeft = Math.max(margin, left);

    // Vertical : on choisit le côté offrant le plus de place, puis on borne la hauteur.
    const spaceBelow = window.innerHeight - r.bottom - gap - margin;
    const spaceAbove = r.top - gap - margin;
    const natural = el.scrollHeight;

    if (natural <= spaceBelow || spaceBelow >= spaceAbove) {
      this.menuMaxHeight = Math.max(MIN_MENU_HEIGHT, spaceBelow);
      this.menuTop = r.bottom + gap;
    } else {
      this.menuMaxHeight = Math.max(MIN_MENU_HEIGHT, spaceAbove);
      this.menuTop = Math.max(margin, r.top - gap - Math.min(natural, this.menuMaxHeight));
    }

    el.style.top = `${Math.round(this.menuTop)}px`;
    el.style.left = `${Math.round(this.menuLeft)}px`;
    el.style.maxHeight = `${Math.round(this.menuMaxHeight)}px`;
  }

  close(): void {
    clearTimeout(this.openTimer);
    this.open = false;
    this.search = '';
    this.anchor = undefined;
  }

  ngOnDestroy(): void {
    // Le menu ayant pu être déplacé dans <body>, on s'assure qu'il ne survit pas au composant.
    clearTimeout(this.openTimer);
    this.open = false;
    this.menuRef?.nativeElement.remove();
  }

  // ------------------------------------------------------------------ liste des valeurs
  /** Valeurs affichées, restreintes par la recherche (insensible casse/accents). */
  get visibleFacets(): ColumnFacet[] {
    const q = normalizeSearch(this.search);
    if (!q) return this.facets;
    return this.facets.filter(f => normalizeSearch(f.label).includes(q));
  }

  // ------------------------------------------------------------------ adaptation au TYPE
  /** Intitulé du type de filtre affiché dans l'en-tête (vocabulaire Excel). */
  get kindLabel(): string { return filterKindLabel(this.type); }

  /** Vrai si la colonne est présentée en arborescence chronologique. */
  get isDateMode(): boolean { return this.type === 'date' && this.dateTree.length > 0; }

  /** Vrai si les valeurs doivent être alignées à droite (chiffres). */
  get isNumeric(): boolean { return this.type === 'number'; }

  private buildTree(): void {
    if (this.type !== 'date') { this.dateTree = []; this.dateOthers = []; return; }
    const raws = rawValueMap(this.rows, this.field, this.format);
    const { tree, others } = buildDateTree(this.facets, raws);
    this.dateTree = tree;
    this.dateOthers = others;
    // Une seule année : on la déplie d'emblée (évite un clic inutile).
    this.expanded = tree.length === 1 ? new Set([tree[0].key]) : new Set();
  }

  isExpanded(node: DateNode): boolean { return this.expanded.has(node.key); }
  toggleExpand(node: DateNode, event: Event): void {
    event.stopPropagation();
    this.expanded.has(node.key) ? this.expanded.delete(node.key) : this.expanded.add(node.key);
  }

  /** État de la case d'un nœud : toutes ses feuilles cochées / une partie / aucune. */
  nodeChecked(node: DateNode): boolean { return node.values.every(v => this.draft.has(v)); }
  nodePartial(node: DateNode): boolean {
    return !this.nodeChecked(node) && node.values.some(v => this.draft.has(v));
  }

  /** Coche/décoche un nœud ET toutes les dates qu'il couvre (comme Excel). */
  toggleNode(node: DateNode): void {
    if (this.nodeChecked(node)) node.values.forEach(v => this.draft.delete(v));
    else node.values.forEach(v => this.draft.add(v));
  }

  isChecked(value: string): boolean { return this.draft.has(value); }

  toggleValue(value: string): void {
    this.draft.has(value) ? this.draft.delete(value) : this.draft.add(value);
  }

  /** État de la case « (Tout sélectionner) » sur les valeurs VISIBLES (comme Excel). */
  get allVisibleChecked(): boolean {
    const v = this.visibleFacets;
    return v.length > 0 && v.every(f => this.draft.has(f.value));
  }
  get someVisibleChecked(): boolean {
    const v = this.visibleFacets;
    return v.some(f => this.draft.has(f.value)) && !this.allVisibleChecked;
  }

  toggleAllVisible(): void {
    const visible = this.visibleFacets;
    if (this.allVisibleChecked) visible.forEach(f => this.draft.delete(f.value));
    else visible.forEach(f => this.draft.add(f.value));
  }

  /**
   * Valeurs qui seront RÉELLEMENT appliquées.
   * Quand une recherche est active, la validation porte sur les seuls résultats de la recherche
   * (comportement d'Excel) : sans cela, le brouillon contenant encore toutes les valeurs, le
   * composant conclurait « tout est retenu » et n'appliquerait aucun filtre.
   */
  get appliedValues(): string[] {
    if (this.search) return this.visibleFacets.filter(f => this.draft.has(f.value)).map(f => f.value);
    return [...this.draft];
  }

  /** Compteur du pied de menu : reflète ce qui sera appliqué. */
  get selectedCount(): number { return this.appliedValues.length; }

  // ------------------------------------------------------------------ validation
  /**
   * Applique : `null` si tout est retenu (pas de filtre), sinon la liste des valeurs.
   * `stopPropagation` : garde-fou pour que le clic n'atteigne jamais le `<th>` (qui ouvrirait
   * la modale de tri multi-niveaux).
   */
  apply(event?: Event): void {
    event?.stopPropagation();
    const values = this.appliedValues;
    // Tout est retenu → aucun filtre (on n'enregistre pas un filtre inutile).
    const all = this.facets.length > 0 && values.length === this.facets.length;
    this.selectedChange.emit(all ? null : values);
    this.close();
  }

  /** Retire le filtre de la colonne. */
  clear(event?: Event): void {
    event?.stopPropagation();
    this.selectedChange.emit(null);
    this.close();
  }

  /** Désactivé quand aucune valeur n'est cochée (filtrerait tout le tableau). */
  get canApply(): boolean { return this.appliedValues.length > 0; }

  // ------------------------------------------------------------------ options du menu contextuel
  onSort(event?: Event): void { event?.stopPropagation(); this.close(); this.openSort.emit(); }
  onHide(event?: Event): void { event?.stopPropagation(); this.close(); this.hideColumn.emit(); }
  onColumns(event?: Event): void { event?.stopPropagation(); this.close(); this.openColumnConfig.emit(); }

  // ------------------------------------------------------------------ fermeture externe
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.open) return;
    const target = event.target as Node;
    // Le menu vivant dans <body>, il ne fait plus partie du host : on teste les deux.
    const inHost = this.host.nativeElement.contains(target);
    const inMenu = !!this.menuRef?.nativeElement.contains(target);
    if (!inHost && !inMenu) this.close();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void { if (this.open) this.close(); }

  @HostListener('window:resize')
  @HostListener('window:scroll')
  onViewportChange(): void { if (this.open) this.close(); }

  /** `trackBy` : évite de recréer les lignes de la liste à chaque frappe dans la recherche. */
  trackByValue = (_: number, f: ColumnFacet): string => f.value;
}
