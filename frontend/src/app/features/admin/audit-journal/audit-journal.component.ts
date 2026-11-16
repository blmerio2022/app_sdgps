import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import {
  AuditEvenement, AuditFiltres, AuditOptions, AuditService, AuditSynthese,
} from '../../../core/services/audit.service';

/** Famille visuelle d'une action (couleur du badge). */
export type FamilleAction = 'connexion' | 'alerte' | 'securite' | 'donnees' | 'ia' | 'autre';

const FAMILLES: Record<string, FamilleAction> = {
  LOGIN_OK: 'connexion',
  LOGIN_FAILED: 'alerte', ACCOUNT_LOCKED: 'alerte', PERMANENT_DELETE: 'alerte',
  PASSWORD_CHANGED: 'securite', PASSWORD_RESET: 'securite', USER_CREATED: 'securite',
  ROLE_CHANGED: 'securite', MEMBER_ADDED: 'securite', AI_CONFIG_CHANGED: 'securite',
  AUDIT_EXPORTED: 'securite',
  MFA_FAILED: 'alerte', SECURITY_ALERT: 'alerte', ACCOUNT_DEACTIVATED: 'alerte',
  MFA_ENABLED: 'securite', MFA_DISABLED: 'securite', SESSION_REVOKED: 'securite',
  BACKUP_CREATED: 'securite', BACKUP_DOWNLOADED: 'securite', BACKUP_RESTORED: 'alerte',
  REPORT_GENERATED: 'donnees', SSDGPS_STATUS_CHANGED: 'donnees',
  DOSSIER_EXPORTED: 'donnees', DOSSIER_IMPORTED: 'donnees',
  AI_CALL: 'ia',
};

export function familleAction(action: string): FamilleAction {
  return FAMILLES[action] || 'autre';
}

/** `2026-11-15` d'une date locale. */
export function jourIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Administration › Journal d'audit — consultation du journal (QUI / QUOI / QUAND,
 * consultations comprises). Réservé à l'administration de l'application.
 *
 * Synthèse de la période filtrée, recherche libre, filtres (action, type d'objet,
 * période, ordre), pagination SERVEUR (le journal grossit sans fin), détail de chaque
 * événement, export CSV (lui-même journalisé).
 *
 * Exception assumée aux règles « colonnes d'audit / configuration des colonnes / tri
 * multi-niveaux » : le journal est append-only (ni modification ni suppression : les
 * colonnes « Modifié… / Supprimé… » n'ont pas d'objet) et paginé côté serveur dans
 * l'ordre chronologique (un tri multi-niveaux côté client ne porterait que sur une page).
 */
@Component({
  selector: 'app-audit-journal',
  templateUrl: './audit-journal.component.html',
  styleUrls: ['./audit-journal.component.scss'],
})
export class AuditJournalComponent implements OnInit, OnDestroy {
  readonly famille = familleAction;
  readonly taillesPage = [25, 50, 100, 200];

  filtres: AuditFiltres = { ordre: 'desc' };
  periode: 'jour' | '7j' | '30j' | 'tout' | 'perso' = '7j';
  evenements: AuditEvenement[] = [];
  total = 0;
  page = 1;
  taille = 50;
  chargement = false;
  erreur = '';
  synthese: AuditSynthese | null = null;
  options: AuditOptions = { actions: [], types_cible: [] };
  ouvert: string | null = null;
  export = false;

  private recherche$ = new Subject<void>();
  private abonnement?: Subscription;

  constructor(private audit: AuditService) {}

  ngOnInit(): void {
    this.choisirPeriode('7j', false);
    this.abonnement = this.recherche$.pipe(debounceTime(350)).subscribe(() => this.recharger());
    this.audit.options().subscribe({ next: o => (this.options = o), error: () => {} });
    this.recharger();
  }

  ngOnDestroy(): void { this.abonnement?.unsubscribe(); }

  get nbPages(): number { return Math.max(1, Math.ceil(this.total / this.taille)); }
  get filtresActifs(): boolean {
    return !!(this.filtres.q || this.filtres.action || this.filtres.cible_type) || this.periode !== '7j';
  }

  // ------------------------------------------------------------ filtres

  onRecherche(): void { this.recherche$.next(); }

  choisirPeriode(p: 'jour' | '7j' | '30j' | 'tout', recharger = true): void {
    this.periode = p;
    const auj = new Date();
    const debut = new Date(auj);
    if (p === '7j') debut.setDate(auj.getDate() - 6);
    if (p === '30j') debut.setDate(auj.getDate() - 29);
    this.filtres.depuis = p === 'tout' ? undefined : jourIso(debut);
    this.filtres.jusqu_a = p === 'tout' ? undefined : jourIso(auj);
    if (recharger) this.recharger();
  }

  onDates(): void { this.periode = 'perso'; this.recharger(); }

  filtrerAction(action: string): void {
    this.filtres.action = this.filtres.action === action ? undefined : action;
    this.recharger();
  }

  basculerOrdre(): void {
    this.filtres.ordre = this.filtres.ordre === 'asc' ? 'desc' : 'asc';
    this.page = 1;
    this.charger();
  }

  reinitialiser(): void {
    this.filtres = { ordre: 'desc' };
    this.choisirPeriode('7j');
  }

  /** Nouveaux filtres : retour en première page, synthèse recalculée. */
  recharger(): void {
    this.page = 1;
    this.charger();
    this.audit.synthese(this.filtres).subscribe({ next: s => (this.synthese = s), error: () => {} });
  }

  // ------------------------------------------------------------ pages

  charger(): void {
    this.chargement = true;
    this.erreur = '';
    this.audit.evenements(this.filtres, this.page, this.taille).subscribe({
      next: r => { this.evenements = r.results; this.total = r.count; this.chargement = false; },
      error: err => {
        this.chargement = false;
        this.erreur = err?.status === 403 ? 'Journal réservé à l\'administration de l\'application.'
                                          : 'Le journal n\'a pas pu être chargé.';
      },
    });
  }

  allerPage(p: number): void {
    const cible = Math.min(Math.max(1, p), this.nbPages);
    if (cible === this.page) return;
    this.page = cible;
    this.charger();
  }

  changerTaille(t: number): void { this.taille = t; this.page = 1; this.charger(); }

  basculerDetail(e: AuditEvenement): void { this.ouvert = this.ouvert === e.id ? null : e.id; }

  // ------------------------------------------------------------ affichage

  /** Détails d'un événement en paires lisibles (valeurs imbriquées en JSON compact). */
  details(e: AuditEvenement): { cle: string; valeur: string }[] {
    return Object.entries(e.details || {})
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([cle, v]) => ({ cle: cle.replace(/_/g, ' '),
                            valeur: typeof v === 'object' ? JSON.stringify(v) : String(v) }));
  }

  // ------------------------------------------------------------ export

  exporter(): void {
    if (this.export) return;
    this.export = true;
    this.erreur = '';
    this.audit.exporter(this.filtres).subscribe({
      next: rep => {
        this.export = false;
        const nom = /filename="([^"]+)"/.exec(rep.headers.get('Content-Disposition') || '')?.[1]
          || 'journal-audit.csv';
        const url = URL.createObjectURL(rep.body as Blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nom;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: async err => {
        this.export = false;
        let detail = '';
        try { detail = JSON.parse(await (err?.error as Blob).text()).detail; } catch { /* corps illisible */ }
        this.erreur = detail || 'L\'export a échoué.';
      },
    });
  }
}
