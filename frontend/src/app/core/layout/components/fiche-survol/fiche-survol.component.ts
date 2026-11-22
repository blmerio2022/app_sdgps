import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { Fiche, FicheService } from '../../../services/fiche.service';
import { TypeFiche } from '../../interfaces/menu.interface';

/** Cible du survol : élément métier + rectangle du crumb (coordonnées écran). */
export interface CibleFiche {
  type: TypeFiche;
  id: string;
  rect: { left: number; bottom: number; width: number };
}

const ICONES: Record<TypeFiche, string> = {
  projet: 'fa-folder-open', propriete: 'fa-map-location-dot', affaire: 'fa-briefcase',
  ssdgps: 'fa-satellite-dish', session: 'fa-calendar-day', piece: 'fa-file-lines',
};
const LARGEUR = 360;
const MARGE = 12;

/**
 * Fiche affichée au SURVOL d'un élément du fil d'Ariane. Positionnée en `fixed` sous le
 * crumb : les crumbs sont découpés en flèches (`clip-path`), une bulle placée dedans serait
 * rognée. Le survol de la fiche elle-même la garde ouverte (`survolee`).
 */
@Component({
  selector: 'app-fiche-survol',
  templateUrl: './fiche-survol.component.html',
  styleUrls: ['./fiche-survol.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FicheSurvolComponent implements OnChanges, OnDestroy {
  @Input() cible: CibleFiche | null = null;
  @Output() survolee = new EventEmitter<boolean>();

  fiche: Fiche | null = null;
  chargement = false;
  erreur = false;
  gauche = 0;
  haut = 0;
  flecheGauche = 24;
  private sub?: Subscription;

  constructor(private service: FicheService, private cdr: ChangeDetectorRef) {}

  get icone(): string { return this.cible ? ICONES[this.cible.type] : 'fa-circle-info'; }

  ngOnChanges(): void {
    this.sub?.unsubscribe();
    this.fiche = null;
    this.erreur = false;
    if (!this.cible) { this.chargement = false; return; }
    this.positionner(this.cible.rect);
    this.chargement = true;
    this.sub = this.service.fiche(this.cible.type, this.cible.id).subscribe({
      next: f => { this.fiche = f; this.chargement = false; this.cdr.markForCheck(); },
      error: () => { this.erreur = true; this.chargement = false; this.cdr.markForCheck(); },
    });
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  /** Sous le crumb, alignée sur son bord gauche, jamais hors de l'écran ; la flèche vise son centre. */
  positionner(rect: CibleFiche['rect']): void {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    this.gauche = Math.max(MARGE, Math.min(rect.left, vw - LARGEUR - MARGE));
    this.haut = rect.bottom + 10;
    const centre = rect.left + Math.min(rect.width, 220) / 2;
    this.flecheGauche = Math.max(18, Math.min(centre - this.gauche, LARGEUR - 18));
  }

  /** Classe de la pastille de statut (couleur sémantique). */
  classeStatut(statut?: string | null): string {
    switch (statut) {
      case 'valide': case 'termine': case 'cloture': return 'st-ok';
      case 'soumis': return 'st-info';
      case 'rejete': return 'st-ko';
      case 'clos': case 'archive': return 'st-neutre';
      default: return 'st-cours';
    }
  }
}
