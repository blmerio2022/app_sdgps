import { Component, OnInit } from '@angular/core';
import { CorbeilleService, ElementCorbeille, ResultatLot, TypeElement } from '../../core/services/corbeille.service';
import { ToastService } from '../../core/services/toast.service';

export const TYPES: { type: TypeElement; libelle: string; icone: string }[] = [
  { type: 'projet', libelle: 'Projets', icone: 'fa-diagram-project' },
  { type: 'propriete', libelle: 'Propriétés', icone: 'fa-map-location-dot' },
  { type: 'affaire', libelle: 'Affaires', icone: 'fa-briefcase' },
  { type: 'ssdgps', libelle: 'SDGPS', icone: 'fa-folder-open' },
  { type: 'session', libelle: 'Sessions', icone: 'fa-clock' },
  { type: 'piece', libelle: 'Pièces', icone: 'fa-file-lines' },
];

/**
 * Corbeille générale — tout ce qui a été mis en corbeille, tous niveaux confondus, du plus
 * récemment supprimé au plus ancien : restauration et suppression définitive en lot.
 *
 * ⚠ Exception assumée aux règles de tableaux (colonnes d'audit / configuration des colonnes /
 * tri multi-niveaux) : liste HÉTÉROGÈNE (six types d'éléments) ordonnée par date de
 * suppression, comme le journal d'audit. Chaque opération est journalisée côté serveur.
 */
@Component({
  selector: 'app-corbeille-page',
  templateUrl: './corbeille-page.component.html',
  styleUrls: ['./corbeille-page.component.scss'],
})
export class CorbeillePageComponent implements OnInit {
  readonly types = TYPES;
  elements: ElementCorbeille[] = [];
  chargement = false;
  erreur = '';
  filtreType: TypeElement | 'tous' = 'tous';
  recherche = '';
  selection = new Set<string>();
  occupe = false;
  confirmerPurge = false;

  constructor(private service: CorbeilleService, private toast: ToastService) {}

  ngOnInit(): void { this.charger(); }

  charger(): void {
    this.chargement = true;
    this.erreur = '';
    this.service.lister().subscribe({
      next: r => { this.elements = r.resultats; this.chargement = false; this.selection.clear(); },
      error: e => { this.chargement = false; this.erreur = e?.error?.detail || 'Lecture de la corbeille impossible.'; },
    });
  }

  cle(e: ElementCorbeille): string { return `${e.type}:${e.id}`; }
  icone(t: TypeElement): string { return TYPES.find(x => x.type === t)?.icone || 'fa-circle'; }
  compte(t: TypeElement): number { return this.elements.filter(e => e.type === t).length; }

  get visibles(): ElementCorbeille[] {
    const q = this.recherche.trim().toLowerCase();
    return this.elements.filter(e => (this.filtreType === 'tous' || e.type === this.filtreType)
      && (!q || `${e.titre} ${e.contexte} ${e.deleted_by}`.toLowerCase().includes(q)));
  }
  get selectionnes(): ElementCorbeille[] { return this.elements.filter(e => this.selection.has(this.cle(e))); }
  /** Libellé de la confirmation de suppression définitive (un seul élément). */
  get libellePurge(): string { return this.selectionnes.length === 1 ? this.selectionnes[0].titre : ''; }
  get toutCoche(): boolean { return this.visibles.length > 0 && this.visibles.every(e => this.selection.has(this.cle(e))); }

  basculer(e: ElementCorbeille): void {
    const k = this.cle(e);
    this.selection.has(k) ? this.selection.delete(k) : this.selection.add(k);
  }
  basculerTout(): void {
    const tout = this.toutCoche;
    this.visibles.forEach(e => tout ? this.selection.delete(this.cle(e)) : this.selection.add(this.cle(e)));
  }

  /** Raison pour laquelle la suppression définitive sera refusée (vide : possible). */
  blocage(e: ElementCorbeille): string {
    if (e.verrouille) return 'Dossier figé';
    if (e.enfants_actifs) return `${e.enfants_actifs} sous-élément(s) actif(s)`;
    return '';
  }

  date(iso: string | null): string {
    return iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  }

  restaurer(cibles: ElementCorbeille[]): void {
    if (!cibles.length || this.occupe) return;
    this.occupe = true;
    this.service.restaurer(cibles.map(e => ({ type: e.type, id: e.id }))).subscribe({
      next: r => this.bilan(r, `${r.restaures} élément(s) restauré(s)`),
      error: e => this.echec(e),
    });
  }

  demanderPurge(cibles?: ElementCorbeille[]): void {
    if (cibles) { this.selection.clear(); cibles.forEach(e => this.selection.add(this.cle(e))); }
    if (this.selection.size) this.confirmerPurge = true;
  }

  purger(): void {
    const cibles = this.selectionnes;
    if (!cibles.length || this.occupe) return;
    this.occupe = true;
    this.service.purger(cibles.map(e => ({ type: e.type, id: e.id }))).subscribe({
      next: r => { this.confirmerPurge = false; this.bilan(r, `${r.supprimes} élément(s) supprimé(s) définitivement`); },
      error: e => { this.confirmerPurge = false; this.echec(e); },
    });
  }

  private bilan(r: ResultatLot, message: string): void {
    this.occupe = false;
    if (r.erreurs?.length) {
      this.toast.warning('Opération partielle', `${message}. ${r.erreurs.length} refus : ${r.erreurs[0].detail}`);
    } else {
      this.toast.success('Corbeille', message);
    }
    this.charger();
  }

  private echec(e: any): void {
    this.occupe = false;
    this.toast.error('Corbeille', e?.error?.detail || 'Opération impossible.');
  }
}
