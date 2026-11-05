import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { OrgSortLevel } from '../../../core/services/org-sort-config.service';
import { SortableField } from './multi-level-sort.util';

/**
 * Composant PRÉSENTATIONNEL réutilisable du tri MULTI-NIVEAUX : bouton « Trier » + modale de
 * configuration + confirmation de réinitialisation. Design, style et options **strictement
 * identiques** à la liste des organisations (référence unique de l'app). Le composant gère l'UI
 * (ouverture, ajout/retrait/déplacement/effacement des niveaux) et émet :
 *   - `levelsChange` à chaque modification (le parent applique le tri + enregistre) ;
 *   - `resetToSource` quand l'opérateur confirme la réinitialisation depuis le compte admin.
 * Le parent conserve l'état `levels` (source de vérité), fait les appels au service et applique
 * le tri au tableau (cf. `compareByLevels` de `multi-level-sort.util`).
 */
@Component({
  selector: 'app-multi-level-sort',
  templateUrl: './multi-level-sort.component.html',
  styleUrls: ['./multi-level-sort.component.scss'],
})
export class MultiLevelSortComponent {
  /** Champs triables proposés (clé + libellé), propres au tableau. */
  @Input() sortableFields: SortableField[] = [];
  /** Niveaux de tri courants (source de vérité côté parent). */
  @Input() levels: OrgSortLevel[] = [];
  /** Titre affiché dans l'en-tête de la modale. */
  @Input() title = 'Tri multi-niveaux';
  /** Ligne d'aide affichée quand aucun niveau n'est défini. */
  @Input() emptyHint = 'Aucun niveau de tri — ordre par défaut du serveur.';
  /** Indicateurs d'état (pilotés par le parent). */
  @Input() saving = false;
  @Input() savedFlash = false;
  @Input() resetting = false;

  /** Émis à chaque modification des niveaux (nouvelle liste immuable). */
  @Output() levelsChange = new EventEmitter<OrgSortLevel[]>();
  /** Émis quand l'opérateur confirme la réinitialisation avec la configuration source. */
  @Output() resetToSource = new EventEmitter<void>();

  showSortConfig = false;
  showResetConfirm = false;

  /** Ouvre la modale (appelé par le parent : bouton, clic d'en-tête, menu contextuel). */
  open(): void { this.showSortConfig = true; }
  close(): void { this.showSortConfig = false; }

  // ------------------------------------------------------------------ résumé / libellés
  fieldLabel(field: string): string {
    return this.sortableFields.find(f => f.field === field)?.label || field;
  }
  get sortSummary(): string {
    if (!this.levels.length) return 'Aucun tri';
    return this.levels
      .map(l => `${this.fieldLabel(l.field)} ${l.dir === 'desc' ? '↓' : '↑'}`)
      .join('  ·  ');
  }

  // ------------------------------------------------------------------ options de champ
  /** Champs disponibles pour un niveau donné : tous sauf ceux déjà choisis ailleurs. */
  fieldsForLevel(current: OrgSortLevel): SortableField[] {
    const used = new Set(this.levels.filter(l => l !== current).map(l => l.field));
    return this.sortableFields.filter(f => !used.has(f.field));
  }
  private firstUnusedField(): string | null {
    const used = new Set(this.levels.map(l => l.field));
    return this.sortableFields.find(f => !used.has(f.field))?.field || null;
  }
  get canAddLevel(): boolean { return this.levels.length < this.sortableFields.length; }

  // ------------------------------------------------------------------ mutations (émettent)
  private emit(levels: OrgSortLevel[]): void { this.levelsChange.emit(levels); }

  addLevel(): void {
    const field = this.firstUnusedField();
    if (!field) return;
    this.emit([...this.levels, { field, dir: 'asc' }]);
  }
  removeLevel(i: number): void {
    this.emit(this.levels.filter((_, k) => k !== i));
  }
  moveLevelUp(i: number): void {
    if (i <= 0) return;
    const l = [...this.levels]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; this.emit(l);
  }
  moveLevelDown(i: number): void {
    if (i >= this.levels.length - 1) return;
    const l = [...this.levels]; [l[i + 1], l[i]] = [l[i], l[i + 1]]; this.emit(l);
  }
  moveLevelToTop(i: number): void {
    if (i <= 0) return;
    const l = [...this.levels]; const [m] = l.splice(i, 1); l.unshift(m); this.emit(l);
  }
  moveLevelToBottom(i: number): void {
    if (i >= this.levels.length - 1) return;
    const l = [...this.levels]; const [m] = l.splice(i, 1); l.push(m); this.emit(l);
  }
  clearAllLevels(): void {
    if (!this.levels.length) return;
    this.emit([]);
  }
  changeLevelField(i: number, field: string): void {
    if (this.levels.some((l, k) => k !== i && l.field === field)) return; // pas de doublon
    const l = [...this.levels]; l[i] = { ...l[i], field }; this.emit(l);
  }
  changeLevelDir(i: number, dir: 'asc' | 'desc'): void {
    const l = [...this.levels]; l[i] = { ...l[i], dir }; this.emit(l);
  }

  // ------------------------------------------------------------------ réinitialisation
  askResetSort(): void { if (!this.resetting) this.showResetConfirm = true; }
  cancelResetSort(): void { this.showResetConfirm = false; }
  confirmResetSort(): void {
    if (this.resetting) return;
    this.showResetConfirm = false;
    this.resetToSource.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void { this.showSortConfig = false; this.showResetConfirm = false; }
}
