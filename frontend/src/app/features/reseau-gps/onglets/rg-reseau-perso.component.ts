import { Component, Input } from '@angular/core';
import { ControleNorme, ResultatDensification, ResultatPersonnalise } from '../../../core/services/reseau-gps.service';
import { ContexteReseau, ReseauGpsStore } from '../reseau-gps.store';
import { fr } from './onglet-controle.component';

/**
 * Réseau PERSONNALISÉ : l'opérateur part du réseau affiché (ou d'un réseau vide), ajoute,
 * retire ou modifie des lignes de base — sur la carte (clic point A puis point B ; clic sur
 * une ligne pour la retirer) ou dans la liste — et l'application recalcule aussitôt les
 * contrôles et le score sur 100.
 */
@Component({
  selector: 'app-rg-reseau-perso',
  templateUrl: './rg-reseau-perso.component.html',
  styleUrls: ['./onglet.scss', './rg-reseau-perso.component.scss'],
})
export class RgReseauPersoComponent {
  @Input() contexte: ContexteReseau = 'controle';
  /** Score de référence (variante recommandée / densification calculée) pour comparer. */
  @Input() scoreReference: number | null = null;
  readonly fr = fr;
  nouvelleA = '';
  nouvelleB = '';

  constructor(public store: ReseauGpsStore) {}

  get perso() { return this.store.perso[this.contexte]; }
  get noms(): string[] { return this.store.nomsContexte(this.contexte); }
  get enEdition(): boolean { return this.store.editionLignes === this.contexte; }

  get resultat(): ResultatPersonnalise | ResultatDensification | null { return this.perso?.resultat ?? null; }

  get controles(): ControleNorme[] {
    const r = this.resultat;
    if (!r) return [];
    return 'reseau' in r ? r.reseau.controles : r.controles;
  }

  get indicateurs() {
    const r = this.resultat;
    if (!r) return null;
    return 'reseau' in r ? r.reseau.indicateurs : r.indicateurs;
  }

  get admissible(): boolean | null {
    const r = this.resultat;
    if (!r) return null;
    return 'reseau' in r ? r.reseau.admissible : r.admissible;
  }

  get score(): number | null { return this.store.scorePerso(this.contexte); }

  get ecart(): number | null {
    return this.score === null || this.scoreReference === null ? null : this.score - this.scoreReference;
  }

  personnaliser(vide = false): void {
    this.store.personnaliser(this.contexte);
    if (vide && this.perso) {
      this.perso.lignes = [];
      this.store.evaluerPerso(this.contexte, true);
      this.store.rafraichirVue();
    }
  }

  basculerEdition(): void {
    if (this.enEdition) this.store.terminerEditionLignes();
    else this.store.commencerEditionLignes(this.contexte);
  }

  abandonner(): void {
    if (window.confirm('Abandonner le réseau personnalisé ? Ses lignes de base seront perdues.')) {
      this.store.abandonnerPerso(this.contexte);
    }
  }

  modifier(k: number, cote: 0 | 1, valeur: string, select: HTMLSelectElement): void {
    const l = this.perso?.lignes[k];
    if (!l) return;
    const a = cote === 0 ? valeur : l[0];
    const b = cote === 1 ? valeur : l[1];
    if (!this.store.modifierLigne(this.contexte, k, a, b)) select.value = l[cote];   // refus : valeur d'origine
  }

  ajouter(): void {
    if (this.store.ajouterLigne(this.contexte, this.nouvelleA, this.nouvelleB)) this.nouvelleB = '';
  }

  /** Longueur d'une ligne (km), d'après les coordonnées des points. */
  longueurKm(a: string, b: string): number | null {
    const pts = this.store.pointsContexte(this.contexte);
    const p = pts.find(x => x.nom_point === a), q = pts.find(x => x.nom_point === b);
    if (!p || !q) return null;
    return Math.hypot(Number(p.x_m) - Number(q.x_m), Number(p.y_m) - Number(q.y_m)) / 1000;
  }

  tropLongue(a: string, b: string): boolean {
    const l = this.longueurKm(a, b);
    return l !== null && l > Number(this.store.longueurMaxKm);
  }

  trackIndex(i: number): number { return i; }
}
