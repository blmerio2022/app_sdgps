import { Component } from '@angular/core';
import { ToastService } from '../../../core/services/toast.service';
import { ReseauGpsStore } from '../reseau-gps.store';

/**
 * Panneau des actions en masse sur la sélection de la carte : points anciens (activer,
 * désactiver, ne garder qu'eux, homogènes ou non, supprimer), points nouveaux (supprimer),
 * lignes de base (retirer, relier les points sélectionnés), et pour tous : recadrer,
 * exporter en CSV, générer un réseau pour une zone à partir de la sélection.
 */
@Component({
  selector: 'app-rg-selection',
  templateUrl: './rg-selection.component.html',
  styleUrls: ['./rg-selection.component.scss'],
})
export class RgSelectionComponent {
  replie = false;

  constructor(public store: ReseauGpsStore, private toast: ToastService) {}

  get nbAnciens(): number { return this.store.anciensSelectionnes.length; }
  get nbNouveaux(): number { return this.store.nouveauxSelectionnes.length; }
  get nbLignes(): number { return this.store.lignesSelectionnees.length; }
  get total(): number { return this.store.selection.size; }

  get reseauEditable(): boolean { return ['controle', 'densification'].includes(this.store.onglet); }

  /** Ne garder actifs que les points anciens sélectionnés. */
  garderSeulement(): void {
    const noms = new Set(this.store.anciensSelectionnes.map(a => a.nom_point));
    this.store.anciens.forEach(a => {
      const garder = noms.has(a.nom_point);
      if (a.retenu !== garder) {
        a.retenu = garder;
        a.motifEcart = garder ? '' : 'Hors de la sélection retenue';
      }
    });
    this.store.toutInvalider();
  }

  supprimer(): void {
    const n = this.nbAnciens + this.nbNouveaux;
    if (n && window.confirm(`Retirer ${n} point(s) de la liste ? Leurs lignes de base disparaissent aussi.`)) {
      this.store.supprimerSelection();
    }
  }

  retirerLignes(): void {
    const n = this.store.retirerLignesSelection();
    if (n) this.toast.success('Sélection', `${n} ligne(s) de base retirée(s) du réseau personnalisé.`);
  }

  relier(): void {
    const n = this.store.relierSelection();
    this.toast.success('Sélection', n ? `${n} ligne(s) de base ajoutée(s).` : 'Les points sont déjà reliés.');
  }

  genererDepuisSelection(): void {
    this.store.paramZone = { ...this.store.paramZone, source: 'selection', mode: 'triangulation',
                             zoneId: this.store.paramZone.zoneId || this.store.zoneEtudeId };
    this.store.choisirOnglet('controle');
  }

  exporter(): void {
    const blob = new Blob([this.store.selectionEnCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'selection-points.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
