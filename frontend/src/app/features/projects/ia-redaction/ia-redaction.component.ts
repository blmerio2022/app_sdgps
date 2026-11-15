import { Component, ElementRef, EventEmitter, HostListener, Input, OnInit, Output } from '@angular/core';
import { forkJoin } from 'rxjs';
import { IaPropositionObservation } from '../../../core/models/ia.model';
import { IaService, messageErreurIa } from '../../../core/services/ia.service';
import { PiecesService } from '../../../core/services/pieces.service';

interface LigneObservation extends IaPropositionObservation { retenue: boolean; }

/** Longueur maximale d'une observation (colonne étroite de la page de garde). */
export const LONGUEUR_OBSERVATION = 160;

/**
 * N°6 — Rédaction par l'IA des textes du dossier, sur la page des pièces d'un SDGPS.
 *
 * - « Observations des pièces » : l'IA propose une observation par pièce (colonne
 *   « Observations » de la page de garde) ; l'opérateur relit, corrige, coche ce qu'il
 *   garde, puis enregistre — par l'API habituelle des pièces (droits et verrou compris).
 * - « Note de synthèse » : brouillon de quelques paragraphes sur l'état du dossier, à
 *   copier (soumission à validation, réponse à un contrôleur). Rien n'est enregistré.
 *
 * Masqué tant que l'IA n'est pas activée sur l'instance.
 */
@Component({
  selector: 'app-ia-redaction',
  templateUrl: './ia-redaction.component.html',
  styleUrls: ['./ia-redaction.component.scss'],
})
export class IaRedactionComponent implements OnInit {
  @Input() ssdgpsId!: string;
  /** Dossier figé (soumis / validé / clos) : les observations ne sont plus modifiables. */
  @Input() verrouille = false;
  @Output() enregistre = new EventEmitter<number>();

  readonly longueurMax = LONGUEUR_OBSERVATION;
  disponible = false;
  menuOuvert = false;

  modale: 'observations' | 'synthese' | null = null;
  chargement = false;
  erreur = '';
  lignes: LigneObservation[] = [];
  enregistrement = false;
  synthese = '';
  copie = false;

  constructor(private ia: IaService, private pieces: PiecesService, private hote: ElementRef) {}

  /** Échap referme le menu, puis la fenêtre (sauf pendant un enregistrement). */
  @HostListener('document:keydown.escape')
  echap(): void {
    if (this.menuOuvert) { this.menuOuvert = false; return; }
    if (this.modale) this.fermer();
  }

  /** Un clic hors du composant referme le menu. */
  @HostListener('document:click', ['$event'])
  clicDocument(event: Event): void {
    if (this.menuOuvert && !this.hote.nativeElement.contains(event.target)) this.menuOuvert = false;
  }

  ngOnInit(): void {
    this.ia.disponible$.subscribe(d => (this.disponible = d));
  }

  get nbRetenues(): number { return this.lignes.filter(l => l.retenue && l.observation.trim()).length; }

  basculerMenu(event: Event): void { event.stopPropagation(); this.menuOuvert = !this.menuOuvert; }
  fermerMenu(): void { this.menuOuvert = false; }

  // ---------------------------------------------------------------- observations
  ouvrirObservations(): void {
    if (this.verrouille) return;
    this.menuOuvert = false;
    this.modale = 'observations';
    this.lignes = [];
    this.erreur = '';
    this.chargement = true;
    this.ia.observations(this.ssdgpsId).subscribe({
      next: ({ propositions }) => {
        this.chargement = false;
        this.lignes = (propositions || []).map(p => ({ ...p, retenue: true }));
        if (!this.lignes.length) this.erreur = 'Aucune pièce à commenter dans ce dossier.';
      },
      error: (err) => { this.chargement = false; this.erreur = messageErreurIa(err); },
    });
  }

  toutCocher(valeur: boolean): void { this.lignes.forEach(l => (l.retenue = valeur)); }

  enregistrerObservations(): void {
    const retenues = this.lignes.filter(l => l.retenue && l.observation.trim());
    if (!retenues.length || this.enregistrement) return;
    this.enregistrement = true;
    this.erreur = '';
    forkJoin(retenues.map(l => this.pieces.update(l.piece, {
      commentaire: l.observation.trim().slice(0, LONGUEUR_OBSERVATION),
    } as any))).subscribe({
      next: () => {
        this.enregistrement = false;
        this.modale = null;
        this.enregistre.emit(retenues.length);
      },
      error: (err) => {
        this.enregistrement = false;
        this.erreur = err?.error?.detail || 'L\'enregistrement des observations a échoué.';
      },
    });
  }

  // ---------------------------------------------------------------- synthèse
  ouvrirSynthese(): void {
    this.menuOuvert = false;
    this.modale = 'synthese';
    this.genererSynthese();
  }

  genererSynthese(): void {
    this.synthese = '';
    this.erreur = '';
    this.copie = false;
    this.chargement = true;
    this.ia.synthese(this.ssdgpsId).subscribe({
      next: ({ texte }) => { this.chargement = false; this.synthese = texte || ''; },
      error: (err) => { this.chargement = false; this.erreur = messageErreurIa(err); },
    });
  }

  copierSynthese(): void {
    if (!this.synthese) return;
    navigator.clipboard?.writeText(this.synthese).then(() => {
      this.copie = true;
      setTimeout(() => (this.copie = false), 2000);
    });
  }

  fermer(): void {
    if (this.enregistrement) return;
    this.modale = null;
  }
}
