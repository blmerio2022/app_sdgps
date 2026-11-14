import { Component, ElementRef, HostListener, Input, OnDestroy, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import {
  complementDe, NiveauEntite, nomEntite, porteeDe, projetsBase, SousNiveau, sousNiveauxDe,
} from './sous-niveaux.util';

const LARGEUR_PANNEAU = 360;
const MARGE = 8;

/**
 * Accès aux sous-niveaux « à plat » d'une entité : depuis un projet, une propriété, une
 * affaire ou un SSDGPS multi-session, la liste de TOUS les éléments d'un niveau inférieur.
 *
 * Déclencheur : icône d'arborescence (ligne de tableau) ou bouton « Sous-niveaux » (en-tête).
 * Panneau : l'entité d'origine en tête, puis les niveaux en cascade reliés par un fil —
 * la hiérarchie se lit d'un coup d'œil — avec leur effectif.
 *
 * Le panneau est en position FIXE, calculée depuis le bouton : un menu absolu était rogné
 * par le conteneur défilant des tableaux sur les dernières lignes. Il s'ouvre vers le haut
 * s'il manque de place en dessous.
 */
@Component({
  selector: 'app-sous-niveaux-menu',
  templateUrl: './sous-niveaux-menu.component.html',
  styleUrls: ['./sous-niveaux-menu.component.scss'],
})
export class SousNiveauxMenuComponent implements OnDestroy {
  @Input() niveau!: NiveauEntite;
  @Input() entite: any;
  /** Projet racine (inutile au niveau projet : c'est l'entité elle-même). */
  @Input() projetId: string | null = null;
  /** Libellé : bouton texte (en-tête de page) au lieu d'une icône (ligne de tableau). */
  @Input() libelle = '';
  @ViewChild('trigger') trigger?: ElementRef<HTMLElement>;

  open = false;
  vers: 'bas' | 'haut' = 'bas';
  position: { top?: number; bottom?: number; left: number } = { left: 0 };

  constructor(private router: Router, private el: ElementRef<HTMLElement>) {}

  get options(): SousNiveau[] { return this.entite ? sousNiveauxDe(this.niveau, this.entite) : []; }
  get nom(): string { return nomEntite(this.niveau, this.entite); }
  get complement(): string { return complementDe(this.niveau); }
  /** Décalage de cascade : le premier niveau proposé est à gauche, les suivants s'indentent. */
  retrait(o: SousNiveau): number { return o.rang - (this.options[0]?.rang ?? 0); }

  count(o: SousNiveau): number | null {
    const v = this.entite?.[o.compteur];
    return typeof v === 'number' ? v : null;
  }

  toggle(ev: Event): void {
    ev.stopPropagation();
    if (this.open) { this.fermer(); return; }
    this.placer();
    this.open = true;
    // Les pages défilent dans des conteneurs internes (pas la fenêtre) : écoute en phase
    // de CAPTURE pour fermer le panneau fixe dès que le contenu sous lui bouge.
    document.addEventListener('scroll', this.surDefilement, true);
  }

  fermer(): void {
    this.open = false;
    document.removeEventListener('scroll', this.surDefilement, true);
  }
  private surDefilement = (ev: Event): void => {
    if (!this.el.nativeElement.contains(ev.target as Node)) this.fermer();
  };
  ngOnDestroy(): void { this.fermer(); }

  /** Aligne le panneau sur le bord droit du bouton, en le gardant dans la fenêtre. */
  placer(): void {
    const r = this.trigger?.nativeElement.getBoundingClientRect();
    if (!r) return;
    const hauteur = 72 + this.options.length * 58 + 40;
    const left = Math.min(Math.max(MARGE, r.right - LARGEUR_PANNEAU), window.innerWidth - LARGEUR_PANNEAU - MARGE);
    if (window.innerHeight - r.bottom < hauteur + MARGE && r.top > hauteur + MARGE) {
      this.vers = 'haut';
      this.position = { bottom: window.innerHeight - r.top + 6, left };
    } else {
      this.vers = 'bas';
      this.position = { top: r.bottom + 6, left };
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: Event): void {
    if (this.open && !this.el.nativeElement.contains(ev.target as Node)) this.fermer();
  }
  @HostListener('document:keydown.escape')
  onEscape(): void { if (this.open) this.fermer(); }
  /** Un panneau fixe ne suit pas la mise en page : on le ferme plutôt que de le laisser flotter. */
  @HostListener('window:resize')
  onViewportChange(): void { if (this.open) this.fermer(); }

  go(o: SousNiveau): void {
    this.fermer();
    const projet = this.niveau === 'projet' ? this.entite.id : this.projetId;
    if (!projet) return;
    this.router.navigate([...projetsBase(this.router.url), projet, o.segment], {
      queryParams: porteeDe(this.niveau, this.entite),
    });
  }
}
