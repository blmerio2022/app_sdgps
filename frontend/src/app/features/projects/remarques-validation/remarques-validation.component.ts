import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { Router } from '@angular/router';
import { EtatRemarques, QualiteDossierService, Remarque, StatutRemarque } from '../../../core/services/qualite-dossier.service';

export interface PieceChoix { id: string; libelle: string; }

/**
 * Remarques de validation par pièce — panneau latéral de la page des pièces.
 *
 * L'encadrement annote une pièce (voire un point / une ligne) ; le rédacteur marque chaque
 * remarque corrigée, avec une réponse s'il le souhaite ; l'encadrement la lève ou la
 * rouvre. Les droits viennent du serveur (`peut_remarquer`, `peut_lever`, `peut_corriger`).
 */
@Component({
  selector: 'app-remarques-validation',
  templateUrl: './remarques-validation.component.html',
  styleUrls: ['./remarques-validation.component.scss'],
})
export class RemarquesValidationComponent implements OnInit {
  @Input() ssdgpsId!: string;
  @Input() projetId!: string;
  @Input() pieces: PieceChoix[] = [];
  /** Filtre initial sur une pièce (ouverture depuis la ligne d'une pièce). */
  @Input() pieceInitiale: string | null = null;
  @Output() fermee = new EventEmitter<void>();
  @Output() changement = new EventEmitter<EtatRemarques>();

  etat: EtatRemarques | null = null;
  chargement = false;
  erreur = '';
  envoi = false;

  filtreStatut: StatutRemarque | 'toutes' = 'toutes';
  filtrePiece: string | 'toutes' = 'toutes';

  // Nouvelle remarque
  texte = '';
  pieceChoisie: string | null = null;
  ligne = '';

  /** Remarque en cours de « marquer corrigée » (zone de réponse ouverte). */
  enCorrection: string | null = null;
  reponse = '';

  constructor(private service: QualiteDossierService, private router: Router) {}

  ngOnInit(): void {
    if (this.pieceInitiale) { this.filtrePiece = this.pieceInitiale; this.pieceChoisie = this.pieceInitiale; }
    this.charger();
  }

  charger(): void {
    this.chargement = true;
    this.service.remarques(this.ssdgpsId).subscribe({
      next: e => this.appliquer(e),
      error: e => { this.chargement = false; this.erreur = e?.error?.detail || 'Lecture des remarques impossible.'; },
    });
  }

  private appliquer(e: EtatRemarques): void {
    this.etat = e;
    this.chargement = false;
    this.envoi = false;
    this.erreur = '';
    this.changement.emit(e);
  }

  private echec(e: any): void {
    this.envoi = false;
    this.erreur = e?.error?.detail || 'Opération impossible.';
  }

  get visibles(): Remarque[] {
    return (this.etat?.remarques || []).filter(r =>
      (this.filtreStatut === 'toutes' || r.statut === this.filtreStatut)
      && (this.filtrePiece === 'toutes' || (this.filtrePiece === 'dossier' ? !r.piece : r.piece === this.filtrePiece)));
  }

  ajouter(): void {
    if (!this.texte.trim() || this.envoi) return;
    this.envoi = true;
    this.service.ajouterRemarque(this.ssdgpsId, this.texte.trim(), this.pieceChoisie, this.ligne.trim()).subscribe({
      next: e => { this.texte = ''; this.ligne = ''; this.appliquer(e); },
      error: e => this.echec(e),
    });
  }

  ouvrirCorrection(r: Remarque): void { this.enCorrection = r.id; this.reponse = ''; }

  operation(r: Remarque, op: 'corriger' | 'lever' | 'rouvrir'): void {
    if (this.envoi) return;
    this.envoi = true;
    this.service.operationRemarque(this.ssdgpsId, r.id, op, op === 'corriger' ? this.reponse.trim() : '').subscribe({
      next: e => { this.enCorrection = null; this.appliquer(e); },
      error: e => this.echec(e),
    });
  }

  retirer(r: Remarque): void {
    if (this.envoi) return;
    this.envoi = true;
    this.service.supprimerRemarque(this.ssdgpsId, r.id).subscribe({ next: e => this.appliquer(e), error: e => this.echec(e) });
  }

  ouvrirPiece(r: Remarque): void {
    if (!r.piece) return;
    const prefixe = this.router.url.startsWith('/admin') ? '/admin' : '';
    this.fermee.emit();
    this.router.navigate([`${prefixe}/projets`, this.projetId, 'pieces', this.ssdgpsId, 'piece', r.piece]);
  }

  date(iso: string | null): string { return iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : ''; }
}
