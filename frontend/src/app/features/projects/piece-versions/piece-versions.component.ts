import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { DiffVersions, HistoriquePiece, PieceVersionsService, VersionPiece } from '../../../core/services/piece-versions.service';
import { Piece } from '../../../core/models/piece.model';

/** Colonnes techniques jamais affichées dans la comparaison. */
const COLONNES_MASQUEES = new Set(['id', '_ordre']);

/**
 * Historique des versions d'une pièce (modale) : versions archivées à chaque changement de
 * contenu, comparaison ligne à ligne avec la version courante, restauration.
 */
@Component({
  selector: 'app-piece-versions',
  templateUrl: './piece-versions.component.html',
  styleUrls: ['./piece-versions.component.scss'],
})
export class PieceVersionsComponent implements OnInit {
  @Input() pieceId!: string;
  /** Dossier figé : la restauration est indisponible (le serveur la refuserait). */
  @Input() verrouille = false;
  @Output() fermee = new EventEmitter<void>();
  @Output() restauree = new EventEmitter<Piece>();

  historique: HistoriquePiece | null = null;
  chargement = true;
  erreur = '';
  selection: VersionPiece | null = null;
  diff: DiffVersions | null = null;
  chargementDiff = false;
  confirmation = false;
  restauration = false;

  constructor(private service: PieceVersionsService) {}

  ngOnInit(): void { this.charger(); }

  charger(): void {
    this.chargement = true; this.erreur = '';
    this.service.historique(this.pieceId).subscribe({
      next: h => {
        this.historique = h; this.chargement = false;
        if (h.versions.length) this.choisir(h.versions[0]);
      },
      error: () => { this.chargement = false; this.erreur = "Chargement de l'historique impossible."; },
    });
  }

  choisir(v: VersionPiece): void {
    if (v.numero === null) return;
    this.selection = v; this.diff = null; this.confirmation = false; this.chargementDiff = true;
    this.service.comparer(this.pieceId, v.numero).subscribe({
      next: d => { this.diff = d; this.chargementDiff = false; },
      error: () => { this.chargementDiff = false; this.erreur = 'Comparaison impossible.'; },
    });
  }

  get identique(): boolean {
    const d = this.diff;
    return !!d && !d.ajoutees.length && !d.supprimees.length && !d.modifiees.length && !d.autres_cles.length;
  }

  restaurer(): void {
    if (!this.selection || this.selection.numero === null || this.verrouille) return;
    this.restauration = true;
    this.service.restaurer(this.pieceId, this.selection.numero).subscribe({
      next: p => { this.restauration = false; this.confirmation = false; this.restauree.emit(p); this.charger(); },
      error: e => { this.restauration = false; this.erreur = e?.error?.detail || 'Restauration impossible.'; },
    });
  }

  /** Colonnes à montrer pour une ligne entière (ajoutée / supprimée). */
  colonnes(row: any): string[] {
    return Object.keys(row || {}).filter(c => !COLONNES_MASQUEES.has(c) && row[c] !== '' && row[c] !== null);
  }

  valeur(v: any): string {
    if (v === null || v === undefined || v === '') return '∅';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }

  origine(v: VersionPiece): string {
    return v.origine === 'restauration' ? 'remplacée par une restauration' : 'remplacée';
  }

  fermer(): void { this.fermee.emit(); }
}
