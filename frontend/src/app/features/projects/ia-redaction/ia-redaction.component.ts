import { Component, ElementRef, EventEmitter, HostListener, Input, OnInit, Output } from '@angular/core';
import { IaObservationArchivee } from '../../../core/models/ia.model';
import { Piece } from '../../../core/models/piece.model';
import { IaService, messageErreurIa } from '../../../core/services/ia.service';
import { PiecesService } from '../../../core/services/pieces.service';

/** Longueur maximale d'une observation (colonne étroite de la page de garde). */
export const LONGUEUR_OBSERVATION = 160;
/** Types jamais repris dans la page de garde (ni observation). */
const TYPES_EXCLUS = ['PGSDGPS'];

/** Une pièce dans le gestionnaire d'observations. */
export interface LigneObservation {
  piece: string;
  designation: string;
  actuelle: string;          // observation enregistrée
  texte: string;             // texte en cours d'édition (proposition de l'IA ou saisie)
  propose: boolean;          // texte proposé par l'IA, pas encore enregistré
  selection: boolean;
  consigne: string;          // indication propre à la pièce pour l'IA
  guider: boolean;           // zone de consigne dépliée
  enCours: boolean;          // régénération en cours pour cette pièce
  historique: IaObservationArchivee[] | null;
}

/**
 * N°6 — Observations des pièces et note de synthèse, sur la page des pièces d'un SDGPS.
 *
 * Gestionnaire d'observations (colonne « Observations » de la page de garde) :
 * - rédaction par l'IA de toutes les pièces ou de la sélection, guidée par une
 *   consigne générale et/ou une consigne par pièce ; régénération d'une pièce ;
 * - édition libre, suppression d'une observation ou de toutes ;
 * - historique par pièce et restauration : toute version remplacée ou supprimée est
 *   ARCHIVÉE côté serveur, rien n'est jamais perdu.
 * L'enregistrement passe par l'API dédiée (`observations/appliquer/`), qui archive
 * l'ancienne version ; un dossier figé refuse toute modification.
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
  redaction = false;
  erreur = '';
  info = '';
  lignes: LigneObservation[] = [];
  consigne = '';
  enregistrement = false;
  confirmeTout = false;
  synthese = '';
  copie = false;

  constructor(private ia: IaService, private pieces: PiecesService, private hote: ElementRef) {}

  ngOnInit(): void {
    this.ia.disponible$.subscribe(d => (this.disponible = d));
  }

  /** Échap referme le menu, puis la fenêtre (sauf pendant un enregistrement). */
  @HostListener('document:keydown.escape')
  echap(): void {
    if (this.menuOuvert) { this.menuOuvert = false; return; }
    if (this.confirmeTout) { this.confirmeTout = false; return; }
    if (this.modale) this.fermer();
  }

  /** Un clic hors du composant referme le menu. */
  @HostListener('document:click', ['$event'])
  clicDocument(event: Event): void {
    if (this.menuOuvert && !this.hote.nativeElement.contains(event.target)) this.menuOuvert = false;
  }

  // ---------------------------------------------------------------- état dérivé

  get aEnregistrer(): LigneObservation[] {
    return this.lignes.filter(l => l.texte.trim() !== l.actuelle.trim());
  }
  get selection(): LigneObservation[] { return this.lignes.filter(l => l.selection); }
  get nbActuelles(): number { return this.lignes.filter(l => l.actuelle.trim()).length; }
  get toutSelectionne(): boolean { return !!this.lignes.length && this.lignes.every(l => l.selection); }

  basculerMenu(event: Event): void { event.stopPropagation(); this.menuOuvert = !this.menuOuvert; }

  // ---------------------------------------------------------------- ouverture

  ouvrirObservations(): void {
    this.menuOuvert = false;
    this.modale = 'observations';
    this.erreur = '';
    this.info = '';
    this.consigne = '';
    this.confirmeTout = false;
    this.chargement = true;
    this.pieces.listBySsdgps(this.ssdgpsId, false).subscribe({
      next: liste => {
        this.lignes = liste
          .filter(p => !p.is_deleted && !TYPES_EXCLUS.includes(p.type_piece))
          .sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0))
          .map(p => this.ligne(p));
        this.chargement = false;
        if (!this.lignes.length) this.erreur = 'Aucune pièce dans ce dossier.';
      },
      error: err => { this.chargement = false; this.erreur = messageErreurIa(err); },
    });
  }

  private ligne(p: Piece): LigneObservation {
    const actuelle = (p.commentaire || '').trim();
    return {
      piece: p.id, designation: designation(p), actuelle, texte: actuelle, propose: false,
      selection: false, consigne: '', guider: false, enCours: false, historique: null,
    };
  }

  // ---------------------------------------------------------------- rédaction par l'IA

  /** Rédige toutes les pièces, ou la sélection s'il y en a une. */
  rediger(lignes: LigneObservation[] = this.selection.length ? this.selection : this.lignes): void {
    if (this.verrouille || !lignes.length || this.redaction) return;
    this.redaction = true;
    this.erreur = '';
    this.info = '';
    lignes.forEach(l => (l.enCours = true));
    const consignes = Object.fromEntries(lignes.filter(l => l.consigne.trim()).map(l => [l.piece, l.consigne]));
    this.ia.observations(this.ssdgpsId, {
      pieces: lignes.length === this.lignes.length ? undefined : lignes.map(l => l.piece),
      consigne: this.consigne, consignes,
    }).subscribe({
      next: ({ propositions }) => {
        const parPiece = new Map((propositions || []).map(p => [p.piece, p.observation]));
        let n = 0;
        for (const l of lignes) {
          l.enCours = false;
          const texte = parPiece.get(l.piece);
          if (texte) { l.texte = texte; l.propose = true; n++; }
        }
        this.redaction = false;
        this.info = n ? `${n} observation(s) proposée(s) — relisez avant d'enregistrer.`
                      : 'L\'IA n\'a rien proposé : reformulez la consigne ou réessayez.';
      },
      error: err => {
        lignes.forEach(l => (l.enCours = false));
        this.redaction = false;
        this.erreur = messageErreurIa(err);
      },
    });
  }

  regenerer(l: LigneObservation): void { this.rediger([l]); }

  /** Abandonne la proposition (ou l'édition) et revient au texte enregistré. */
  annulerEdition(l: LigneObservation): void { l.texte = l.actuelle; l.propose = false; }

  toutSelectionner(valeur: boolean): void { this.lignes.forEach(l => (l.selection = valeur)); }

  // ---------------------------------------------------------------- enregistrement et suppression

  enregistrer(): void {
    const lignes = this.aEnregistrer;
    if (!lignes.length || this.enregistrement || this.verrouille) return;
    this.enregistrement = true;
    this.erreur = '';
    this.ia.appliquerObservations(this.ssdgpsId, lignes.map(l => ({ piece: l.piece, texte: l.texte.trim() })))
      .subscribe({
        next: r => {
          lignes.forEach(l => { l.actuelle = l.texte.trim().slice(0, LONGUEUR_OBSERVATION); l.texte = l.actuelle;
                                 l.propose = false; l.historique = null; });
          this.enregistrement = false;
          this.info = `${r.modifiees} observation(s) enregistrée(s). Les versions précédentes sont archivées.`;
          this.enregistre.emit(r.modifiees);
        },
        error: err => { this.enregistrement = false; this.erreur = messageErreurIa(err); },
      });
  }

  /** Supprime l'observation ENREGISTRÉE d'une pièce (archivée, restaurable). */
  supprimer(l: LigneObservation): void {
    if (this.verrouille || !l.actuelle) return;
    this.ia.supprimerObservations(this.ssdgpsId, [l.piece]).subscribe({
      next: () => {
        l.actuelle = '';
        if (!l.propose) l.texte = '';
        l.historique = null;
        this.info = `Observation de « ${l.designation} » supprimée (archivée).`;
        this.enregistre.emit(1);
      },
      error: err => (this.erreur = messageErreurIa(err)),
    });
  }

  supprimerSelection(): void {
    const cibles = this.selection.filter(l => l.actuelle);
    if (this.verrouille || !cibles.length) return;
    this.ia.supprimerObservations(this.ssdgpsId, cibles.map(l => l.piece)).subscribe({
      next: r => {
        cibles.forEach(l => { l.actuelle = ''; if (!l.propose) l.texte = ''; l.historique = null; });
        this.info = `${r.supprimees} observation(s) supprimée(s) (archivées).`;
        this.enregistre.emit(r.supprimees);
      },
      error: err => (this.erreur = messageErreurIa(err)),
    });
  }

  supprimerTout(): void {
    if (this.verrouille) return;
    this.confirmeTout = false;
    this.ia.supprimerObservations(this.ssdgpsId, 'toutes').subscribe({
      next: r => {
        this.lignes.forEach(l => { l.actuelle = ''; if (!l.propose) l.texte = ''; l.historique = null; });
        this.info = `${r.supprimees} observation(s) supprimée(s) — toutes restent restaurables depuis l'historique.`;
        this.enregistre.emit(r.supprimees);
      },
      error: err => (this.erreur = messageErreurIa(err)),
    });
  }

  // ---------------------------------------------------------------- historique

  basculerHistorique(l: LigneObservation): void {
    if (l.historique) { l.historique = null; return; }
    this.ia.historiqueObservations(this.ssdgpsId, l.piece).subscribe({
      next: h => (l.historique = h),
      error: err => (this.erreur = messageErreurIa(err)),
    });
  }

  restaurer(l: LigneObservation, a: IaObservationArchivee): void {
    if (this.verrouille) return;
    this.ia.restaurerObservation(a.id).subscribe({
      next: r => {
        l.actuelle = r.texte;
        l.texte = r.texte;
        l.propose = false;
        l.historique = null;
        this.info = `Version du ${new Date(a.created_at).toLocaleString('fr-FR')} restaurée.`;
        this.enregistre.emit(1);
      },
      error: err => (this.erreur = messageErreurIa(err)),
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
    if (this.modale === 'observations' && this.aEnregistrer.length
        && !confirm('Des observations proposées ou modifiées ne sont pas enregistrées. Fermer quand même ?')) {
      return;
    }
    this.modale = null;
  }
}

/** Désignation lisible d'une pièce : libellé du type, numéro, session. */
export function designation(p: Piece): string {
  const base = p.type_piece_display || p.type_piece;
  const numero = p.numero ? ` n°${p.numero}` : '';
  const session = p.session_numero ? ` · session ${p.session_numero}` : '';
  return `${base}${numero}${session}`;
}
