import { Component, OnDestroy, OnInit } from '@angular/core';
import {
  differences, RegleDuree, TolerancesConfig, TolerancesPayload, TolerancesService,
} from '../../../../core/services/tolerances.service';
import { ToastService } from '../../../../core/services/toast.service';

type Unite = 's' | 'min' | 'h';
const FACTEUR: Record<Unite, number> = { s: 1, min: 60, h: 3600 };

/** Une durée éditée dans l'unité la plus naturelle (40 s, 30 min, 1 h). */
export interface DureeEditee { valeur: number; unite: Unite; }

export function versEdition(secondes: number): DureeEditee {
  if (secondes >= 3600 && secondes % 3600 === 0) return { valeur: secondes / 3600, unite: 'h' };
  if (secondes >= 60 && secondes % 60 === 0) return { valeur: secondes / 60, unite: 'min' };
  return { valeur: secondes, unite: 's' };
}
export function versSecondes(d: DureeEditee): number { return Math.round((Number(d.valeur) || 0) * FACTEUR[d.unite]); }

/**
 * Paramètres › Tolérances : seuils au-delà desquels une valeur est SIGNALÉE dans le rapport
 * SDGPS (cellule encadrée en rouge, ligne teintée, légende sous le tableau).
 *
 * Seules les valeurs qui diffèrent des défauts sont enregistrées (`differences`) : un
 * opérateur continue de bénéficier des défauts pour tout ce qu'il n'a pas modifié.
 */
@Component({
  selector: 'app-tolerances-settings',
  templateUrl: './tolerances-settings.component.html',
  styleUrls: ['./tolerances-settings.component.scss'],
})
export class TolerancesSettingsComponent implements OnInit, OnDestroy {
  cfg: TolerancesConfig | null = null;
  defauts: TolerancesConfig | null = null;
  libelles: Record<string, string> = {};
  loading = true;
  saving = false;
  savedFlash = false;
  error = '';
  /** Durées éditées (valeur + unité), par règle et par mode. */
  durees: Record<string, Record<'statique' | 'stopgo', DureeEditee>> = {};
  /** Mots-clés des modes, édités sous forme de texte « a, b, c ». */
  motsCles = { statique: '', stopgo: '' };
  readonly unites: Unite[] = ['s', 'min', 'h'];
  readonly reglesDuree: ('rob_duree' | 'rtlb_duree')[] = ['rob_duree', 'rtlb_duree'];
  readonly modes: ('statique' | 'stopgo')[] = ['statique', 'stopgo'];
  private timer: any;

  constructor(private service: TolerancesService, private toast: ToastService) {}

  ngOnInit(): void {
    this.service.get().subscribe({
      next: p => { this.apply(p); this.loading = false; },
      error: () => { this.loading = false; this.error = 'Chargement des tolérances impossible.'; },
    });
  }
  ngOnDestroy(): void { clearTimeout(this.timer); }

  private apply(p: TolerancesPayload): void {
    this.cfg = JSON.parse(JSON.stringify(p.effectives));
    this.defauts = p.defauts;
    this.libelles = p.libelles;
    this.reglesDuree.forEach(r => {
      const regle = this.cfg![r] as RegleDuree;
      this.durees[r] = { statique: versEdition(regle.statique_min_s), stopgo: versEdition(regle.stopgo_min_s) };
    });
    this.motsCles = { statique: this.cfg!.modes.statique.join(', '), stopgo: this.cfg!.modes.stopgo.join(', ') };
  }

  /** Recopie les champs édités (durées, centimètres, mots-clés) dans la configuration. */
  private collect(): void {
    if (!this.cfg) return;
    this.reglesDuree.forEach(r => {
      const regle = this.cfg![r] as RegleDuree;
      regle.statique_min_s = versSecondes(this.durees[r].statique);
      regle.stopgo_min_s = versSecondes(this.durees[r].stopgo);
    });
    const mots = (t: string) => t.split(',').map(m => m.trim()).filter(Boolean);
    this.cfg.modes = { statique: mots(this.motsCles.statique), stopgo: mots(this.motsCles.stopgo) };
  }

  /** Écart affiché en centimètres, stocké en mètres. */
  cm(regle: 'ecarts_determinations' | 'rc_ecarts'): number { return Math.round((this.cfg?.[regle].max_m || 0) * 1000) / 10; }
  setCm(regle: 'ecarts_determinations' | 'rc_ecarts', v: any): void {
    if (this.cfg) { this.cfg[regle].max_m = Math.max(0, Number(v) || 0) / 100; this.changed(); }
  }

  /** La règle s'écarte-t-elle des valeurs par défaut ? (badge « Personnalisé ») */
  modifie(cle: keyof TolerancesConfig): boolean {
    if (!this.cfg || !this.defauts) return false;
    this.collect();
    return JSON.stringify(this.cfg[cle]) !== JSON.stringify(this.defauts[cle]);
  }

  defautDuree(r: 'rob_duree' | 'rtlb_duree', mode: 'statique' | 'stopgo'): string {
    const d = this.defauts?.[r];
    if (!d) return '';
    const e = versEdition(d[`${mode}_min_s`]);
    return `${d[`${mode}_limite_acceptee`] ? '≥' : '>'} ${e.valeur} ${e.unite}`;
  }

  get motsClesValides(): boolean {
    return this.motsCles.statique.split(',').some(m => m.trim()) && this.motsCles.stopgo.split(',').some(m => m.trim());
  }

  /** Enregistrement automatique (anti-rebond). */
  changed(): void {
    if (!this.cfg || !this.defauts || !this.motsClesValides) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), 600);
  }

  save(): void {
    if (!this.cfg || !this.defauts) return;
    this.collect();
    this.saving = true; this.error = '';
    this.service.save(differences(this.cfg, this.defauts)).subscribe({
      next: () => { this.saving = false; this.savedFlash = true; setTimeout(() => (this.savedFlash = false), 2500); },
      error: e => { this.saving = false; this.error = e?.error?.detail || 'Enregistrement impossible.'; },
    });
  }

  reset(): void {
    if (!confirm('Revenir aux tolérances par défaut ?')) return;
    clearTimeout(this.timer);
    this.service.reset().subscribe({
      next: p => { this.apply(p); this.toast.success('Tolérances', 'Valeurs par défaut rétablies.'); },
      error: () => this.toast.error('Erreur', 'Réinitialisation impossible'),
    });
  }
}
