import { Component, EventEmitter, Input, Output } from '@angular/core';
import { from, of } from 'rxjs';
import { catchError, concatMap, map } from 'rxjs/operators';
import { CandidatImport, ImportMasseService, LignePlan } from '../../../core/services/import-masse.service';

export interface SessionChoix { id: string; numero_session: number; }

type Etape = 'depot' | 'plan' | 'import' | 'fin';
interface Resultat { fichier: string; ok: boolean; detail: string; }

/**
 * Import en masse d'un dossier (modale) : déposer tous les fichiers d'un levé, vérifier le
 * plan proposé (type, numéro, session, créer / remplacer / ignorer), puis importer.
 * Chaque ligne passe par l'import unitaire : mêmes contrôles côté serveur.
 */
@Component({
  selector: 'app-import-masse',
  templateUrl: './import-masse.component.html',
  styleUrls: ['./import-masse.component.scss'],
})
export class ImportMasseComponent {
  @Input() ssdgpsId!: string;
  /** Sessions du SDGPS (multi-session : une pièce de niveau session doit en choisir une). */
  @Input() sessions: SessionChoix[] = [];
  @Input() multiSession = false;
  @Output() fermee = new EventEmitter<void>();
  @Output() termine = new EventEmitter<number>();

  etape: Etape = 'depot';
  fichiers: File[] = [];
  plan: LignePlan[] = [];
  sessionParLigne: Record<number, string | null> = {};
  analyse = false;
  erreur = '';
  survol = false;
  progression = 0;
  resultats: Resultat[] = [];

  constructor(private service: ImportMasseService) {}

  // ---- étape 1 : dépôt ----
  ajouter(liste: FileList | File[] | null): void {
    if (!liste) return;
    const deja = new Set(this.fichiers.map(f => f.name + f.size));
    Array.from(liste).forEach(f => {
      if (deja.has(f.name + f.size)) return;
      deja.add(f.name + f.size);
      this.fichiers.push(f);
    });
  }
  onDrop(ev: DragEvent): void { ev.preventDefault(); this.survol = false; this.ajouter(ev.dataTransfer?.files || null); }
  onDragOver(ev: DragEvent): void { ev.preventDefault(); this.survol = true; }
  retirer(i: number): void { this.fichiers.splice(i, 1); }

  analyser(): void {
    if (!this.fichiers.length) return;
    this.analyse = true; this.erreur = '';
    this.service.plan(this.ssdgpsId, this.fichiers).subscribe({
      next: p => {
        this.plan = p.plan; this.analyse = false; this.etape = 'plan';
        this.sessionParLigne = {};
        this.plan.forEach((_, i) => (this.sessionParLigne[i] = null));
      },
      error: e => { this.analyse = false; this.erreur = e?.error?.detail || 'Analyse des fichiers impossible.'; },
    });
  }

  // ---- étape 2 : plan ----
  candidat(l: LignePlan): CandidatImport | undefined { return l.candidats.find(c => c.type_piece === l.type_piece); }

  changerType(l: LignePlan, type: string | null): void {
    l.type_piece = type;
    const c = this.candidat(l);
    l.mapping = c ? { ...c.mapping } : {};
    l.numero = c?.repetable ? (l.numero || c.numero_nom || 1) : null;
    l.piece_existante = null;   // l'existant n'est connu que pour le type proposé
    l.action = type ? 'creer' : 'ignorer';
  }

  sessionRequise(l: LignePlan): boolean {
    return this.multiSession && this.candidat(l)?.niveau === 'session' && l.action === 'creer';
  }

  /** Pourquoi la ligne ne peut pas être importée telle quelle (vide = prête). */
  blocage(l: LignePlan, i: number): string {
    if (l.action === 'ignorer') return '';
    if (!l.type_piece) return 'Choisissez un type';
    if (!Object.keys(l.mapping || {}).length) return 'Aucune colonne reconnue';
    if (this.candidat(l)?.repetable && !l.numero) return 'Numéro requis';
    if (this.sessionRequise(l) && !this.sessionParLigne[i]) return 'Session requise';
    return '';
  }

  get aImporter(): number { return this.plan.filter(l => l.action !== 'ignorer').length; }
  get pret(): boolean { return this.aImporter > 0 && this.plan.every((l, i) => !this.blocage(l, i)); }
  pourcent(c?: CandidatImport | null): number { return Math.round(Math.min(1, c?.score || 0) * 100); }

  // ---- étape 3 : import ----
  importer(): void {
    if (!this.pret) return;
    this.etape = 'import'; this.progression = 0; this.resultats = [];
    const travaux = this.plan.map((l, i) => ({ l, i, f: this.fichiers.find(x => x.name === l.fichier) }))
      .filter(t => t.l.action !== 'ignorer' && t.f);
    const total = travaux.length;
    from(travaux).pipe(
      concatMap(t => this.service.importer(this.ssdgpsId, t.f!, t.l, this.sessionParLigne[t.i]).pipe(
        map(() => ({ fichier: t.l.fichier, ok: true, detail: t.l.action === 'remplacer' ? 'remplacée' : 'créée' })),
        catchError(e => of({ fichier: t.l.fichier, ok: false, detail: this.messageErreur(e) })),
      )),
    ).subscribe({
      next: r => { this.resultats.push(r); this.progression = Math.round(100 * this.resultats.length / total); },
      complete: () => { this.etape = 'fin'; this.termine.emit(this.reussis); },
    });
  }

  get reussis(): number { return this.resultats.filter(r => r.ok).length; }

  messageErreur(e: any): string {
    const d = e?.error;
    if (!d) return 'Échec de l’import';
    if (typeof d.detail === 'string') return d.detail;
    const premier = Object.entries(d)[0] as [string, any] | undefined;
    return premier ? `${premier[0]} : ${Array.isArray(premier[1]) ? premier[1][0] : premier[1]}` : 'Échec de l’import';
  }

  fermer(): void { if (this.etape !== 'import') this.fermee.emit(); }
}
