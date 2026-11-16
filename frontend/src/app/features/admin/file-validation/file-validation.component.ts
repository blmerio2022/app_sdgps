import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import {
  DecisionFile, DossierAValider, FileValidationService, StatutFile,
} from '../../../core/services/file-validation.service';
import { ToastService } from '../../../core/services/toast.service';

/** Au-delà de ce délai d'attente (jours), le dossier est signalé en retard. */
export const ATTENTE_ALERTE_JOURS = 7;

/**
 * File de validation : les dossiers qui attendent une décision de l'encadrement
 * (Admin Organisation de leur organisation, ou administration de l'application).
 *
 * ⚠ Exception assumée aux règles « 7 colonnes d'audit / configuration des colonnes / tri
 * multi-niveaux » : ce n'est pas une liste d'entités mais une FILE DE TRAVAIL, ordonnée par
 * ancienneté de la soumission (premier soumis, premier traité).
 */
@Component({
  selector: 'app-file-validation',
  templateUrl: './file-validation.component.html',
  styleUrls: ['./file-validation.component.scss'],
})
export class FileValidationComponent implements OnInit {
  statut: StatutFile = 'soumis';
  dossiers: DossierAValider[] = [];
  compteurs: Partial<Record<StatutFile, number>> = {};
  encadrement = true;
  chargement = false;
  erreur = '';
  recherche = '';
  selection = new Set<string>();
  /** Décision en attente de confirmation (modale). */
  decision: { action: DecisionFile; ids: string[] } | null = null;
  motif = '';
  envoi = false;
  readonly alerteJours = ATTENTE_ALERTE_JOURS;

  constructor(private service: FileValidationService, private toast: ToastService, private router: Router) {}

  ngOnInit(): void { this.charger(); }

  charger(): void {
    this.chargement = true; this.erreur = '';
    this.service.file(this.statut).subscribe({
      next: f => {
        this.dossiers = f.results; this.compteurs = f.compteurs; this.encadrement = f.encadrement;
        this.selection = new Set([...this.selection].filter(id => f.results.some(d => d.id === id)));
        this.chargement = false;
      },
      error: () => { this.chargement = false; this.erreur = 'Chargement de la file impossible.'; },
    });
  }

  choisir(statut: StatutFile): void {
    if (statut === this.statut) return;
    this.statut = statut; this.selection.clear(); this.charger();
  }

  get visibles(): DossierAValider[] {
    const q = this.recherche.trim().toLowerCase();
    if (!q) return this.dossiers;
    return this.dossiers.filter(d => [d.projet_code, d.projet_nom, d.propriete_nom, d.organisation, d.par,
      d.redacteur, d.nature_ssdgps, `n°${d.numero_ssdgps}`, `sd ${d.affaire_numero}`]
      .some(v => (v || '').toLowerCase().includes(q)));
  }

  get enRetard(): number { return this.dossiers.filter(d => (d.attente_jours ?? 0) > this.alerteJours).length; }

  /** Identifiants sélectionnés (la syntaxe `[...set]` n'est pas admise dans un gabarit AOT). */
  get idsSelection(): string[] { return Array.from(this.selection); }

  basculer(id: string): void { this.selection.has(id) ? this.selection.delete(id) : this.selection.add(id); }
  get toutCoche(): boolean { return this.visibles.length > 0 && this.visibles.every(d => this.selection.has(d.id)); }
  toutBasculer(): void {
    const cocher = !this.toutCoche;
    this.visibles.forEach(d => (cocher ? this.selection.add(d.id) : this.selection.delete(d.id)));
  }

  ouvrir(d: DossierAValider): void {
    const prefixe = this.router.url.startsWith('/admin/') ? '/admin/' : '/';
    this.router.navigateByUrl(`${prefixe}projets/${d.projet_id}/pieces/${d.id}`);
  }

  demander(action: DecisionFile, ids: string[]): void {
    if (!ids.length) return;
    this.decision = { action, ids }; this.motif = '';
  }

  get motifObligatoire(): boolean { return this.decision?.action === 'rejeter'; }

  libelleDecision(action: DecisionFile): string {
    return { valider: 'Valider', rejeter: 'Rejeter', clore: 'Clore' }[action];
  }

  confirmer(): void {
    if (!this.decision || (this.motifObligatoire && !this.motif.trim())) return;
    const { action, ids } = this.decision;
    this.envoi = true;
    this.service.decider(ids, action, this.motif.trim()).subscribe({
      next: r => {
        this.envoi = false; this.decision = null;
        if (r.reussis) this.toast.success('File de validation', `${r.reussis} dossier(s) : décision « ${this.libelleDecision(action)} » enregistrée.`);
        const echec = r.resultats.find(x => !x.ok);
        if (echec) this.toast.error('Dossier(s) non traité(s)', `${r.echecs} refus — ${echec.detail}`);
        ids.forEach(id => this.selection.delete(id));
        this.charger();
      },
      error: e => { this.envoi = false; this.toast.error('Erreur', e?.error?.detail || 'Décision impossible.'); },
    });
  }

  annuler(): void { if (!this.envoi) this.decision = null; }

  attenteLibelle(d: DossierAValider): string {
    if (d.attente_jours === null) return '—';
    if (d.attente_jours === 0) return "aujourd'hui";
    return d.attente_jours === 1 ? '1 jour' : `${d.attente_jours} jours`;
  }

  coherenceLibelle(d: DossierAValider): string {
    const c = d.coherence;
    if (!c) return 'Non contrôlé';
    if (c.ok && !c.avertissements) return 'Cohérent';
    const parts = [];
    if (c.erreurs) parts.push(`${c.erreurs} erreur${c.erreurs > 1 ? 's' : ''}`);
    if (c.avertissements) parts.push(`${c.avertissements} avertissement${c.avertissements > 1 ? 's' : ''}`);
    return parts.join(', ');
  }

  coherenceClasse(d: DossierAValider): string {
    const c = d.coherence;
    if (!c) return 'neutre';
    return c.erreurs ? 'erreur' : (c.avertissements ? 'avert' : 'ok');
  }
}
