import { Directive, ElementRef, HostListener, Input, OnDestroy } from '@angular/core';

/**
 * INFO-BULLE UNIFIÉE DES EN-TÊTES DE TABLEAU (`<th>`) — remplace l'attribut natif `title`.
 *
 * Motivation : le `title` du navigateur n'est pas stylable, s'affiche avec ~1 s de latence, se
 * superpose mal (un `title` imbriqué sur le badge de tri masquait celui de l'en-tête) et mélangeait
 * l'action et la description sur une seule ligne (« Configurer le tri multi-niveaux — <desc> »).
 *
 * Cette directive affiche une carte au design de l'app, avec une STRUCTURE IDENTIQUE partout :
 *   1. le NOM de la colonne (+ pastille de type éventuelle) ;
 *   2. la DESCRIPTION du champ ;
 *   3. l'ÉTAT DE TRI courant (uniquement si la colonne est triée) ;
 *   4. les ACTIONS disponibles (clic / clic droit).
 *
 * L'élément est ajouté à `document.body` (jamais rogné par `overflow` d'un conteneur) ; ses styles
 * sont donc GLOBAUX (`styles.scss`, classe `.app-th-tooltip`).
 *
 * Usage :
 *   <th appTableHeaderTooltip
 *       [tipLabel]="col.label"
 *       [tipDescription]="getFieldDescription(col.field)"
 *       [tipType]="col.type"
 *       [tipSortLevel]="sortLevelOf(col.field)"
 *       [tipSortDir]="sortDirOf(col.field)">
 */
@Directive({ selector: '[appTableHeaderTooltip]' })
export class TableHeaderTooltipDirective implements OnDestroy {
  /** Nom affiché de la colonne (titre de l'info-bulle). */
  @Input() tipLabel = '';
  /** Description fonctionnelle du champ. */
  @Input() tipDescription = '';
  /** Type de donnée (texte, date, ...) — affiché en pastille si fourni. */
  @Input() tipType?: string;
  /** Niveau de tri courant (0 = non trié). */
  @Input() tipSortLevel = 0;
  /** Sens de tri courant. */
  @Input() tipSortDir: '' | 'asc' | 'desc' = '';
  /** Action au clic (ligne « Clic »). Vide = ligne masquée. */
  @Input() tipClickAction = 'configurer le tri multi-niveaux';
  /** Action au clic droit (ligne « Clic droit »). Vide = ligne masquée. */
  @Input() tipContextAction = 'plus d’options';

  private tip?: HTMLElement;
  private showTimer: any;

  constructor(private host: ElementRef<HTMLElement>) {}

  private static readonly TYPE_LABELS: Record<string, string> = {
    text: 'TEXTE', email: 'EMAIL', date: 'DATE', number: 'NOMBRE',
    status: 'STATUT', boolean: 'BOOLÉEN', role: 'RÔLE', actions: 'ACTIONS',
  };

  /** Échappe le texte injecté (les libellés/descriptions viennent de l'API). */
  private escape(value: string): string {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  }

  private buildContent(): string {
    const rows: string[] = [];

    const typeChip = this.tipType
      ? `<span class="tt-type">${this.escape(TableHeaderTooltipDirective.TYPE_LABELS[this.tipType] || this.tipType.toUpperCase())}</span>`
      : '';
    rows.push(`<div class="tt-head"><span class="tt-title">${this.escape(this.tipLabel)}</span>${typeChip}</div>`);

    if (this.tipDescription) {
      rows.push(`<p class="tt-desc">${this.escape(this.tipDescription)}</p>`);
    }

    const meta: string[] = [];
    if (this.tipSortLevel > 0) {
      const dir = this.tipSortDir === 'desc' ? 'décroissant' : 'croissant';
      const icon = this.tipSortDir === 'desc' ? 'fa-arrow-down-wide-short' : 'fa-arrow-up-short-wide';
      meta.push(
        `<span class="tt-row tt-sort"><i class="fas ${icon}"></i>` +
        `Tri : niveau <b>${this.tipSortLevel}</b> · ${dir}</span>`,
      );
    }
    if (this.tipClickAction) {
      meta.push(`<span class="tt-row"><i class="fas fa-arrow-pointer"></i>Clic : ${this.escape(this.tipClickAction)}</span>`);
    }
    if (this.tipContextAction) {
      meta.push(`<span class="tt-row"><i class="fas fa-bars"></i>Clic droit : ${this.escape(this.tipContextAction)}</span>`);
    }
    if (meta.length) rows.push(`<div class="tt-meta">${meta.join('')}</div>`);

    return rows.join('');
  }

  /** Place l'info-bulle sous l'en-tête, recentrée et maintenue dans le viewport. */
  private position(): void {
    if (!this.tip) return;
    const host = this.host.nativeElement.getBoundingClientRect();
    const tip = this.tip.getBoundingClientRect();
    const margin = 8;

    let left = host.left + host.width / 2 - tip.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - tip.width - margin));

    // Sous l'en-tête par défaut ; au-dessus s'il n'y a pas la place.
    let top = host.bottom + margin;
    let placement = 'bottom';
    if (top + tip.height > window.innerHeight - margin) {
      top = host.top - tip.height - margin;
      placement = 'top';
    }
    this.tip.style.left = `${Math.round(left)}px`;
    this.tip.style.top = `${Math.round(Math.max(margin, top))}px`;
    this.tip.dataset['placement'] = placement;
  }

  private show(): void {
    if (this.tip || !this.tipLabel) return;
    // Un menu de filtre de colonne est ouvert : l'info-bulle ne doit JAMAIS s'afficher
    // par-dessus (ni se rouvrir quand l'opérateur survole ce menu).
    if (document.querySelector('.col-filter-menu')) return;
    const tip = document.createElement('div');
    tip.className = 'app-th-tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.innerHTML = this.buildContent();
    document.body.appendChild(tip);
    this.tip = tip;
    this.position();
    // Déclenche la transition d'apparition après insertion.
    requestAnimationFrame(() => this.tip?.classList.add('is-visible'));
  }

  private hide(): void {
    clearTimeout(this.showTimer);
    this.tip?.remove();
    this.tip = undefined;
  }

  @HostListener('mouseenter')
  onEnter(): void {
    clearTimeout(this.showTimer);
    this.showTimer = setTimeout(() => this.show(), 180);
  }

  @HostListener('mouseleave')
  @HostListener('click')
  @HostListener('contextmenu')
  onLeave(): void { this.hide(); }

  @HostListener('window:scroll')
  @HostListener('window:resize')
  onViewportChange(): void { this.hide(); }

  ngOnDestroy(): void { this.hide(); }
}
