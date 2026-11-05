import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { ManagedColumn } from './column-config.util';

/**
 * Composant PRÉSENTATIONNEL réutilisable de la CONFIGURATION DES COLONNES : bouton « Colonnes » +
 * modale d'organisation (visibilité + ordre, drag&drop, tout sélectionner/inverser, filtre) +
 * confirmation de réinitialisation. Design, style et options alignés sur `<app-multi-level-sort>`
 * (référence unique de l'app). Le composant gère l'UI et émet :
 *   - `columnsChange` à chaque modification (le parent applique l'affichage + enregistre) ;
 *   - `resetToSource` quand l'opérateur confirme la réinitialisation depuis le compte admin.
 * Le parent conserve l'état `columns` (source de vérité), fait les appels au service et enregistre
 * en auto-save (cf. `TableColumnsConfigService`). **Pas de OK/Annuler : auto-save comme le tri.**
 */
@Component({
  selector: 'app-column-config',
  templateUrl: './column-config.component.html',
  styleUrls: ['./column-config.component.scss'],
})
export class ColumnConfigComponent {
  /** Colonnes courantes (ordonnées, source de vérité côté parent). */
  @Input() columns: ManagedColumn[] = [];
  /** Titre affiché dans l'en-tête de la modale. */
  @Input() title = 'Organiser les colonnes';
  /** Affiche le filtre « toutes / visibles ». */
  @Input() showFilter = true;
  /**
   * Fournit la description d'une colonne à partir de son `field`. Elle est affichée dans la
   * COLONNE dédiée « Description » de la modale (jamais fusionnée avec le nom de la colonne).
   * Optionnel : par défaut aucune description. Le parent branche `[describe]="describeColumn"`
   * (référence stable) pour réutiliser son `getFieldDescription`.
   */
  @Input() describe: (field: string) => string = () => '';
  /** Indicateurs d'état (pilotés par le parent). */
  @Input() saving = false;
  @Input() savedFlash = false;
  @Input() resetting = false;

  /** Émis à chaque modification des colonnes (nouvelle liste immuable, ordre = affichage). */
  @Output() columnsChange = new EventEmitter<ManagedColumn[]>();
  /** Émis quand l'opérateur confirme la réinitialisation avec la configuration source. */
  @Output() resetToSource = new EventEmitter<void>();

  showColumnConfig = false;
  showResetConfirm = false;
  columnFilter: 'all' | 'visible' = 'all';
  showFilterMenu = false;
  draggedIndex: number | null = null;
  dragOverIndex: number | null = null;

  /** Ouvre la modale (appelé par le parent : bouton, menu contextuel). */
  open(): void { this.showColumnConfig = true; }
  close(): void { this.showColumnConfig = false; this.showFilterMenu = false; }

  // ------------------------------------------------------------------ stats / libellés
  get total(): number { return this.columns.length; }
  get visibleCount(): number { return this.columns.filter(c => c.visible).length; }
  get hiddenCount(): number { return this.total - this.visibleCount; }

  /** Colonnes affichées dans la liste selon le filtre (l'ordre reste celui de `columns`). */
  get filteredColumns(): ManagedColumn[] {
    return this.columnFilter === 'visible' ? this.columns.filter(c => c.visible) : this.columns;
  }
  get filterLabel(): string {
    return this.columnFilter === 'visible' ? 'Colonnes visibles' : 'Toutes les colonnes';
  }
  typeLabel(type?: string): string {
    return ({ text: 'TEXTE', email: 'EMAIL', date: 'DATE', number: 'NOMBRE', status: 'STATUT',
      boolean: 'BOOLÉEN', role: 'RÔLE', actions: 'ACTIONS' } as Record<string, string>)[type || 'text'] || 'TEXTE';
  }
  /** Index réel dans `columns` d'une colonne affichée (le filtre peut masquer des lignes). */
  realIndex(col: ManagedColumn): number { return this.columns.indexOf(col); }

  /**
   * Identité d'une ligne pour `*ngFor` : le champ. INDISPENSABLE — chaque modification émet une
   * NOUVELLE liste ; sans `trackBy`, Angular détruirait puis recréerait tous les `<li>`, ce qui
   * ferait retomber le défilement de la modale en haut à chaque clic. Avec `trackBy`, les nœuds
   * DOM sont réutilisés (et simplement déplacés lors d'un réordonnancement) : la position de
   * défilement est conservée.
   */
  trackByField = (_: number, col: ManagedColumn): string => col.field;

  /**
   * Description d'une colonne, affichée dans la COLONNE dédiée « Description » de la modale :
   * `describe()` (fourni par le parent) prioritaire, puis la description portée par la colonne.
   */
  descOf(col: ManagedColumn): string { return this.describe(col.field) || col.description || ''; }

  toggleFilterMenu(event: Event): void { event.stopPropagation(); this.showFilterMenu = !this.showFilterMenu; }
  applyFilter(filter: 'all' | 'visible'): void { this.columnFilter = filter; this.showFilterMenu = false; }

  // ------------------------------------------------------------------ mutations (émettent)
  private emit(columns: ManagedColumn[]): void { this.columnsChange.emit(columns); }
  private cloned(): ManagedColumn[] { return this.columns.map(c => ({ ...c })); }

  toggleVisibility(field: string): void {
    const cols = this.cloned();
    const col = cols.find(c => c.field === field);
    if (!col) return;
    col.visible = !col.visible;
    this.emit(cols);
  }
  selectAll(): void { const c = this.cloned(); c.forEach(x => (x.visible = true)); this.emit(c); }
  deselectAll(): void { const c = this.cloned(); c.forEach(x => (x.visible = false)); this.emit(c); }
  invertSelection(): void { const c = this.cloned(); c.forEach(x => (x.visible = !x.visible)); this.emit(c); }

  moveUp(i: number): void {
    if (i <= 0) return;
    const c = this.cloned(); [c[i - 1], c[i]] = [c[i], c[i - 1]]; this.emit(c);
  }
  moveDown(i: number): void {
    if (i >= this.columns.length - 1) return;
    const c = this.cloned(); [c[i + 1], c[i]] = [c[i], c[i + 1]]; this.emit(c);
  }
  moveToTop(i: number): void {
    if (i <= 0) return;
    const c = this.cloned(); const [m] = c.splice(i, 1); c.unshift(m); this.emit(c);
  }
  moveToBottom(i: number): void {
    if (i >= this.columns.length - 1) return;
    const c = this.cloned(); const [m] = c.splice(i, 1); c.push(m); this.emit(c);
  }

  // ------------------------------------------------------------------ drag & drop
  onDragStart(index: number): void { this.draggedIndex = index; }
  onDragOver(event: DragEvent, index: number): void { event.preventDefault(); this.dragOverIndex = index; }
  onDragLeave(): void { this.dragOverIndex = null; }
  onDrop(index: number): void {
    if (this.draggedIndex === null || this.draggedIndex === index) { this.onDragEnd(); return; }
    const c = this.cloned();
    const [dragged] = c.splice(this.draggedIndex, 1);
    c.splice(index, 0, dragged);
    this.onDragEnd();
    this.emit(c);
  }
  onDragEnd(): void { this.draggedIndex = null; this.dragOverIndex = null; }

  // ------------------------------------------------------------------ réinitialisation
  askReset(): void { if (!this.resetting) this.showResetConfirm = true; }
  cancelReset(): void { this.showResetConfirm = false; }
  confirmReset(): void {
    if (this.resetting) return;
    this.showResetConfirm = false;
    this.resetToSource.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void { this.showColumnConfig = false; this.showResetConfirm = false; this.showFilterMenu = false; }
}
