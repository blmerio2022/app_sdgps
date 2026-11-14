import { Component } from '@angular/core';
import { ReseauGpsStore } from '../reseau-gps.store';
import { fr } from './onglet-controle.component';

/**
 * Onglet 4 — densification : à partir des points anciens homogènes, l'application propose
 * l'emplacement des points nouveaux (nombre paramétrable, 0 = automatique) en respectant la
 * norme N11 (tout point de la zone à moins de 5 km d'au moins 3 points de densification).
 * L'opérateur ajoute, déplace ou supprime des points nouveaux puis recalcule le score.
 */
@Component({
  selector: 'app-onglet-densification',
  templateUrl: './onglet-densification.component.html',
  styleUrls: ['./onglet.scss'],
})
export class OngletDensificationComponent {
  readonly fr = fr;

  constructor(public store: ReseauGpsStore) {}

  basculerModeAjout(): void { this.store.modeAjoutCarte = !this.store.modeAjoutCarte; }
  trackIndex(i: number): number { return i; }
}
