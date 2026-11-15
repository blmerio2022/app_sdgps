import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import {
  CachetRapportOptions, CachetSignature, PagesCachet, PositionCachet,
} from '../../../../core/models/cachet-signature.model';
import {
  BoiteCachet, EtatCachetRapport, TAILLE_MAX_MM, TAILLE_MIN_MM, boiteCachet, bornerTaille,
  ecrireEtat, lireEtat, optionsRapport, ratioCachet, reconcilier,
} from '../cachet.util';

/**
 * Option « Cachet et signature » de la modale Rapport PDF.
 *
 * Un interrupteur ; activé, il déploie la bibliothèque des cachets (choix, création,
 * reprise) et les réglages d'apposition — position, taille, pages — avec une page A4
 * miniature qui montre, en direct, où le cachet tombera.
 *
 * Le dernier choix est mémorisé dans le navigateur : l'opérateur qui tamponne tous ses
 * rapports n'a rien à refaire. `optionsChange` émet les options prêtes pour l'API, ou
 * `null` quand l'option est éteinte (ou qu'aucun cachet n'existe encore).
 */
@Component({
  selector: 'app-cachet-picker',
  templateUrl: './cachet-picker.component.html',
  styleUrls: ['./cachet-picker.component.scss'],
})
export class CachetPickerComponent implements OnInit {
  @Output() optionsChange = new EventEmitter<CachetRapportOptions | null>();

  etat: EtatCachetRapport = lireEtat();
  cachets: CachetSignature[] = [];
  bibliothequeChargee = false;

  readonly tailleMin = TAILLE_MIN_MM;
  readonly tailleMax = TAILLE_MAX_MM;
  readonly positions: { valeur: PositionCachet; libelle: string; icone: string }[] = [
    { valeur: 'bas-gauche', libelle: 'À gauche', icone: 'fa-align-left' },
    { valeur: 'bas-centre', libelle: 'Au centre', icone: 'fa-align-center' },
    { valeur: 'bas-droite', libelle: 'À droite', icone: 'fa-align-right' },
  ];
  readonly choixPages: { valeur: PagesCachet; libelle: string }[] = [
    { valeur: 'toutes', libelle: 'Toutes les pages' },
    { valeur: 'sauf-garde', libelle: 'Sauf la page de garde' },
  ];

  ngOnInit(): void { this.emettre(); }

  get cachetChoisi(): CachetSignature | null {
    return this.cachets.find(c => c.id === this.etat.cachetId) ?? null;
  }

  get boite(): BoiteCachet {
    return boiteCachet(this.etat.position, this.etat.taille, ratioCachet(this.cachetChoisi));
  }

  /** Résumé du réglage courant, affiché sous la miniature. */
  get resume(): string {
    const pos = this.positions.find(p => p.valeur === this.etat.position)?.libelle.toLowerCase() ?? '';
    const pages = this.etat.pages === 'toutes' ? 'sur toutes les pages' : 'sauf sur la page de garde';
    return `${this.etat.taille} mm, en bas ${pos}, ${pages}`;
  }

  basculer(): void {
    this.etat = { ...this.etat, actif: !this.etat.actif };
    this.enregistrer();
  }

  onCachets(liste: CachetSignature[]): void {
    this.cachets = liste;
    this.bibliothequeChargee = true;
    // L'interrupteur garde la position choisie par l'opérateur : sans aucun cachet, il
    // reste ouvert sur l'invitation à en créer un — mais rien n'est apposé (`emettre`).
    const actif = this.etat.actif;
    this.etat = { ...reconcilier(this.etat, liste), actif };
    this.enregistrer();
  }

  choisir(id: string | null): void {
    this.etat = { ...this.etat, cachetId: id };
    this.enregistrer();
  }

  choisirPosition(p: PositionCachet): void { this.etat = { ...this.etat, position: p }; this.enregistrer(); }
  choisirPages(p: PagesCachet): void { this.etat = { ...this.etat, pages: p }; this.enregistrer(); }
  changerTaille(v: any): void { this.etat = { ...this.etat, taille: bornerTaille(v) }; this.enregistrer(); }

  private enregistrer(): void {
    ecrireEtat(this.etat);
    this.emettre();
  }

  private emettre(): void {
    // Tant que la bibliothèque n'est pas chargée, on ne peut garantir que le cachet
    // mémorisé existe encore : on n'annonce rien qui ferait échouer la génération.
    const sur = this.bibliothequeChargee && this.cachets.some(c => c.id === this.etat.cachetId);
    this.optionsChange.emit(sur ? optionsRapport(this.etat) : null);
  }
}
