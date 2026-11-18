import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { RepriseService, Travail, TypeTravail, ilYa } from '../../../core/services/reprise.service';

/** Clé de stockage des travaux masqués : `{ "<type>:<id>": "<date ISO masquée>" }`. */
export const CLE_MASQUES = 'sdgps.reprise.masques';

const APPARENCE: Record<TypeTravail, { icone: string; libelle: string }> = {
  ssdgps: { icone: 'fa-folder-open', libelle: 'SDGPS' },
  rapport: { icone: 'fa-file-pdf', libelle: 'Rapport' },
  projet: { icone: 'fa-diagram-project', libelle: 'Projet' },
  propriete: { icone: 'fa-map-location-dot', libelle: 'Propriété' },
  affaire: { icone: 'fa-briefcase', libelle: 'Affaire' },
};

/**
 * « Reprendre mon travail » — tableau de bord d'accueil, tous rôles.
 *
 * L'utilisateur qui revient dans l'application retrouve ce qu'il avait commencé sans le
 * terminer, du plus récent au plus ancien : le dernier travail en vedette (« Reprendre là
 * où vous en étiez »), puis les autres. Un travail masqué réapparaît dès qu'il bouge de
 * nouveau (la date masquée est comparée à la dernière activité).
 */
@Component({
  selector: 'app-reprendre-travail',
  templateUrl: './reprendre-travail.component.html',
  styleUrls: ['./reprendre-travail.component.scss'],
})
export class ReprendreTravailComponent implements OnInit {
  /** Lignes affichées avant « Afficher plus ». */
  static readonly PAR_PAGE = 5;

  travaux: Travail[] = [];
  total = 0;
  chargement = true;
  erreur = '';
  tousAffiches = false;
  voirMasques = false;
  private masques: Record<string, string> = {};

  constructor(private service: RepriseService, private router: Router) {}

  ngOnInit(): void {
    this.masques = this.lireMasques();
    this.charger();
  }

  charger(limite = 30): void {
    this.chargement = true;
    this.erreur = '';
    this.service.travaux(limite).subscribe({
      next: r => { this.travaux = r.resultats; this.total = r.total; this.chargement = false; },
      error: () => { this.chargement = false; this.erreur = 'Impossible de retrouver vos travaux en cours.'; },
    });
  }

  // ---- affichage ----
  get visibles(): Travail[] { return this.travaux.filter(t => this.voirMasques || !this.estMasque(t)); }
  get vedette(): Travail | null { return this.visibles[0] || null; }
  get autres(): Travail[] {
    const reste = this.visibles.slice(1);
    return this.tousAffiches ? reste : reste.slice(0, ReprendreTravailComponent.PAR_PAGE);
  }
  get restants(): number { return Math.max(0, this.visibles.length - 1 - this.autres.length); }
  get nbMasques(): number { return this.travaux.filter(t => this.estMasque(t)).length; }

  icone(t: Travail): string { return APPARENCE[t.type]?.icone || 'fa-circle'; }
  /** Préfixe du contexte : le niveau, sauf quand le titre le dit déjà (SDGPS, rapport). */
  libelleType(t: Travail): string {
    if (t.type === 'ssdgps') return t.session ? `Session n°${t.session.numero} ·` : '';
    if (t.type === 'rapport') return '';
    return `${APPARENCE[t.type]?.libelle || ''} ·`;
  }
  quand(t: Travail): string { return ilYa(t.date); }
  dateComplete(t: Travail): string { return new Date(t.date).toLocaleString('fr-FR'); }
  pourcent(t: Travail): number {
    if (t.type === 'rapport') return Math.min(100, t.progression_pct || 0);
    const p = t.progression;
    return p && p.total ? Math.round(100 * p.validees / p.total) : 0;
  }
  /** Ton de la prochaine étape : alerte (renvoi, échec), prêt (tout validé), neutre. */
  ton(t: Travail): 'alerte' | 'pret' | 'neutre' {
    if (t.renvoye || t.statut === 'echec') return 'alerte';
    if (t.type === 'ssdgps' && t.progression && t.progression.total > 0 && t.progression.validees === t.progression.total) return 'pret';
    return 'neutre';
  }

  // ---- navigation ----
  /** Lien relatif → route de la zone courante (opérateur ou admin). */
  private naviguer(lien: string): void {
    const prefixe = this.router.url.startsWith('/admin') ? '/admin/' : '/';
    this.router.navigateByUrl(prefixe + lien);
  }
  continuer(t: Travail): void { this.naviguer(t.lien); }
  ouvrirPiece(t: Travail, e?: Event): void {
    e?.stopPropagation();
    if (t.derniere_piece) this.naviguer(t.derniere_piece.lien);
  }

  // ---- masquer ----
  private cle(t: Travail): string { return `${t.type}:${t.id}`; }
  estMasque(t: Travail): boolean {
    const d = this.masques[this.cle(t)];
    return !!d && new Date(t.date).getTime() <= new Date(d).getTime();
  }
  masquer(t: Travail, e?: Event): void {
    e?.stopPropagation();
    this.masques[this.cle(t)] = t.date;
    this.ecrireMasques();
  }
  afficher(t: Travail, e?: Event): void {
    e?.stopPropagation();
    delete this.masques[this.cle(t)];
    this.ecrireMasques();
  }
  private lireMasques(): Record<string, string> {
    try { return JSON.parse(localStorage.getItem(CLE_MASQUES) || '{}') || {}; } catch { return {}; }
  }
  private ecrireMasques(): void {
    try { localStorage.setItem(CLE_MASQUES, JSON.stringify(this.masques)); } catch { /* stockage indisponible */ }
  }
}
