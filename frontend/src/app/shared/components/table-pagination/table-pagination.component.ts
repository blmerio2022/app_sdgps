import { Component, EventEmitter, Input, Output } from '@angular/core';

/** Options standard du nombre d'éléments par page, identiques dans TOUTE l'app. */
export const PAGE_SIZE_OPTIONS: readonly number[] = [5, 10, 25, 50, 100];

/** Nombre d'éléments par page par DÉFAUT, identique dans toute l'app. */
export const DEFAULT_PAGE_SIZE = 5;

/**
 * PAGINATION DE TABLEAU — composant partagé (pied de tableau).
 *
 * Unifie le design et le comportement de la pagination des 7 tableaux de l'app : sélecteur
 * « Éléments par page », plage affichée (« 1–5 sur 42 ») et navigation première/précédente/
 * suivante/dernière.
 *
 * Composant PRÉSENTATIONNEL. Il émet des événements GRANULAIRES (`first`/`prev`/`next`/`last`)
 * plutôt qu'un numéro de page : chaque tableau conserve ainsi sa propre logique de
 * rafraîchissement (certains recalculent une tranche, d'autres passent par un getter).
 */
@Component({
  selector: 'app-table-pagination',
  templateUrl: './table-pagination.component.html',
  styleUrls: ['./table-pagination.component.scss'],
})
export class TablePaginationComponent {
  /** Page courante (1-based). */
  @Input() page = 1;
  /** Nombre d'éléments par page. */
  @Input() pageSize: number = DEFAULT_PAGE_SIZE;
  /** Nombre TOTAL d'éléments après filtrage (sert à la plage et au nombre de pages). */
  @Input() total = 0;
  /** Options proposées ; par défaut les options standard de l'app. */
  @Input() pageSizeOptions: readonly number[] = PAGE_SIZE_OPTIONS;
  /** Libellé de l'entité au pluriel, affiché dans la plage (« sur 42 organismes »). */
  @Input() entityPlural = '';

  @Output() pageSizeChange = new EventEmitter<number>();
  @Output() first = new EventEmitter<void>();
  @Output() prev = new EventEmitter<void>();
  @Output() next = new EventEmitter<void>();
  @Output() last = new EventEmitter<void>();

  /** Nombre de pages (au moins 1, même sans élément). */
  get totalPages(): number {
    return Math.max(1, Math.ceil((this.total || 0) / (this.pageSize || DEFAULT_PAGE_SIZE)));
  }

  get isFirst(): boolean { return this.page <= 1; }
  get isLast(): boolean { return this.page >= this.totalPages; }

  /** Premier élément affiché (1-based) ; 0 quand la liste est vide. */
  get rangeStart(): number {
    return this.total ? (this.page - 1) * this.pageSize + 1 : 0;
  }

  /** Dernier élément affiché, borné au total. */
  get rangeEnd(): number {
    return Math.min(this.page * this.pageSize, this.total || 0);
  }

  onPageSizeChange(value: string | number): void {
    const size = Number(value);
    if (size > 0 && size !== this.pageSize) this.pageSizeChange.emit(size);
  }
}
