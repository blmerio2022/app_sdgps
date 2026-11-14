import { Component, ElementRef, HostListener, Input } from '@angular/core';
import { Router } from '@angular/router';
import {
  NiveauEntite, porteeDe, projetsBase, SousNiveau, sousNiveauxDe,
} from './sous-niveaux.util';

/**
 * Bouton « Sous-niveaux » d'une ligne de tableau : ouvre un menu listant tous les niveaux
 * inférieurs de l'entité (avec leurs effectifs) et mène à la vue à plat correspondante —
 * ex. depuis une propriété : toutes ses affaires, tous ses SSDGPS, toutes ses sessions.
 */
@Component({
  selector: 'app-sous-niveaux-menu',
  template: `
    <div class="sn-wrap" *ngIf="options.length">
      <button type="button" class="sn-trigger" [ngClass]="libelle ? 'btn btn-secondary' : 'btn-icon'" [class.open]="open"
              (click)="toggle($event)" title="Afficher les sous-niveaux à plat" aria-haspopup="menu" [attr.aria-expanded]="open">
        <i class="fas fa-sitemap"></i><ng-container *ngIf="libelle"> {{ libelle }} <i class="fas fa-caret-down"></i></ng-container>
      </button>
      <div class="sn-menu" *ngIf="open" role="menu" (click)="$event.stopPropagation()">
        <div class="sn-head">Afficher, à plat</div>
        <button type="button" class="sn-item" role="menuitem" *ngFor="let o of options" (click)="go(o)">
          <i class="fas" [ngClass]="o.icon"></i>
          <span class="sn-label">{{ o.label }}</span>
          <span class="sn-count" *ngIf="count(o) !== null">{{ count(o) }}</span>
        </button>
      </div>
    </div>`,
  styleUrls: ['./sous-niveaux-menu.component.scss'],
})
export class SousNiveauxMenuComponent {
  @Input() niveau!: NiveauEntite;
  @Input() entite: any;
  /** Projet racine (inutile au niveau projet : c'est l'entité elle-même). */
  @Input() projetId: string | null = null;
  /** Libellé : bouton texte (en-tête de page) au lieu d'une icône (ligne de tableau). */
  @Input() libelle = '';
  open = false;

  constructor(private router: Router, private el: ElementRef<HTMLElement>) {}

  get options(): SousNiveau[] { return this.entite ? sousNiveauxDe(this.niveau, this.entite) : []; }

  count(o: SousNiveau): number | null {
    const v = this.entite?.[o.compteur];
    return typeof v === 'number' ? v : null;
  }

  toggle(ev: Event): void { ev.stopPropagation(); this.open = !this.open; }

  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: Event): void {
    if (this.open && !this.el.nativeElement.contains(ev.target as Node)) this.open = false;
  }

  go(o: SousNiveau): void {
    this.open = false;
    const projet = this.niveau === 'projet' ? this.entite.id : this.projetId;
    if (!projet) return;
    this.router.navigate([...projetsBase(this.router.url), projet, o.segment], {
      queryParams: porteeDe(this.niveau, this.entite),
    });
  }
}
