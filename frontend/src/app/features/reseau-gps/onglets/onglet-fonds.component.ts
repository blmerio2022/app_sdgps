import { Component } from '@angular/core';
import { FondCatalogue } from '../../../core/services/reseau-gps.service';
import { TypeFond, validerFond } from '../fonds-carte';
import { ReseauGpsStore } from '../reseau-gps.store';

/**
 * Onglet « Fonds de carte » : mes fonds (choisir, retirer), catalogue construit par
 * l'application (par catégorie, licence affichée) et ajout d'un fond personnalisé guidé.
 */
@Component({
  selector: 'app-onglet-fonds',
  templateUrl: './onglet-fonds.component.html',
  styleUrls: ['./onglet.scss', './onglet-fonds.component.scss'],
})
export class OngletFondsComponent {
  nouveau: { nom: string; type: TypeFond; url: string; couches: string; attribution: string } = this.vide();
  erreur = '';

  constructor(public store: ReseauGpsStore) {}

  catalogueDe(categorie: string): FondCatalogue[] {
    return (this.store.referentiel?.fonds.catalogue || []).filter(f => f.categorie === categorie);
  }

  ajouterPersonnel(): void {
    const e = validerFond(this.nouveau);
    if (e) { this.erreur = e; return; }
    this.store.ajouterFondPersonnel(this.nouveau);
    this.nouveau = this.vide();
    this.erreur = '';
  }

  private vide() { return { nom: '', type: 'xyz' as TypeFond, url: '', couches: '', attribution: '' }; }
}
