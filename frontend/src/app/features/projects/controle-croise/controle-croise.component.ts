import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { Router } from '@angular/router';
import {
  ControleCroise, PieceRef, QualiteDossierService, ResultatControleCroise,
} from '../../../core/services/qualite-dossier.service';

/**
 * Contrôle croisé des points — modale de la page des pièces.
 *
 * Confronte les noms de points des pièces (LPA, PPA/PPN, ROB/RTLB, déterminations, RDD) et
 * liste les écarts, chacun avec ses points et un lien vers les pièces à corriger. Lecture
 * seule : rien n'est modifié, rien n'est bloqué.
 */
@Component({
  selector: 'app-controle-croise',
  templateUrl: './controle-croise.component.html',
  styleUrls: ['./controle-croise.component.scss'],
})
export class ControleCroiseComponent implements OnInit {
  /** Points affichés par contrôle avant « Afficher tout ». */
  static readonly POINTS_VISIBLES = 24;

  @Input() ssdgpsId!: string;
  @Input() projetId!: string;
  @Input() sessionId: string | null = null;
  @Output() fermee = new EventEmitter<void>();

  resultat: ResultatControleCroise | null = null;
  chargement = false;
  erreur = '';
  deplies = new Set<string>();

  constructor(private service: QualiteDossierService, private router: Router) {}

  ngOnInit(): void { this.lancer(); }

  lancer(): void {
    this.chargement = true;
    this.erreur = '';
    this.service.controleCroise(this.ssdgpsId, this.sessionId).subscribe({
      next: r => { this.resultat = r; this.chargement = false; },
      error: e => { this.chargement = false; this.erreur = e?.error?.detail || 'Le contrôle croisé a échoué.'; },
    });
  }

  get typesControles(): string[] { return Object.keys(this.resultat?.sources || {}); }

  points(c: ControleCroise): string[] {
    return this.deplies.has(c.code) ? c.points : c.points.slice(0, ControleCroiseComponent.POINTS_VISIBLES);
  }
  restants(c: ControleCroise): number { return Math.max(0, c.points.length - this.points(c).length); }
  deplier(c: ControleCroise): void { this.deplies.add(c.code); }

  ouvrirPiece(p: PieceRef): void {
    const prefixe = this.router.url.startsWith('/admin') ? '/admin' : '';
    this.fermee.emit();
    this.router.navigate([`${prefixe}/projets`, this.projetId, 'pieces', this.ssdgpsId, 'piece', p.id]);
  }

  fermer(): void { this.fermee.emit(); }
}
