import { Component, Injectable, OnInit } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export type Mesure = 'crees' | 'soumis' | 'valides' | 'rejetes' | 'clos' | 'rapports';

export interface Activite {
  periode: { depuis: string; jusqu_a: string };
  totaux: Record<Mesure, number>;
  delai_validation_jours: number | null;
  taux_rejet: number | null;
  en_attente: number;
  par_mois: ({ mois: string } & Record<Mesure, number>)[];
  operateurs: { id: number; nom: string; email: string; crees: number; soumissions: number; rejets_recus: number;
                rapports: number; appels_ia: number; jetons_ia: number }[];
}

@Injectable({ providedIn: 'root' })
export class ActiviteService {
  constructor(private http: HttpClient) {}
  charger(depuis?: string, jusquA?: string): Observable<Activite> {
    let params = new HttpParams();
    if (depuis) params = params.set('depuis', depuis);
    if (jusquA) params = params.set('jusqu_a', jusquA);
    return this.http.get<Activite>(`${environment.apiUrl}/v1/analytics/activite/`, { params });
  }
}

export const LIBELLES_MESURES: Record<Mesure, string> = {
  crees: 'Dossiers créés', soumis: 'Soumissions', valides: 'Validations', rejetes: 'Rejets',
  clos: 'Clôtures', rapports: 'Rapports générés',
};
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** « 2026-11 » → « nov. 26 ». */
export function libelleMois(m: string): string {
  const [a, mm] = m.split('-');
  return `${MOIS[Number(mm) - 1]} ${a.slice(2)}`;
}

/** Échelle « propre » de l'axe : 1, 2, 5 × 10^n au-dessus du maximum. */
export function echelle(max: number): number {
  if (max <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  return [1, 2, 5, 10].map(k => k * p).find(v => v >= max)!;
}

/**
 * Tableau de bord d'activité (encadrement) : tuiles de synthèse, un indicateur mensuel à la
 * fois (barres, une seule série : pas de légende), tableau par opérateur.
 *
 * ⚠ Exception assumée aux règles de tableaux (colonnes d'audit, configuration des colonnes) :
 * le tableau par opérateur est un agrégat calculé, pas une liste d'entités.
 */
@Component({
  selector: 'app-activite',
  templateUrl: './activite.component.html',
  styleUrls: ['./activite.component.scss'],
})
export class ActiviteComponent implements OnInit {
  donnees: Activite | null = null;
  chargement = false;
  erreur = '';
  mesure: Mesure = 'crees';
  periode: '3m' | '6m' | '12m' = '12m';
  survol: number | null = null;
  tri: 'crees' | 'soumissions' | 'rejets_recus' | 'rapports' | 'appels_ia' = 'crees';
  readonly mesures = Object.keys(LIBELLES_MESURES) as Mesure[];
  readonly libelles = LIBELLES_MESURES;

  constructor(private service: ActiviteService) {}

  ngOnInit(): void { this.charger(); }

  charger(): void {
    const fin = new Date();
    const debut = new Date(fin.getFullYear(), fin.getMonth() - ({ '3m': 2, '6m': 5, '12m': 11 }[this.periode]), 1);
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    this.chargement = true; this.erreur = '';
    this.service.charger(iso(debut), iso(fin)).subscribe({
      next: d => { this.donnees = d; this.chargement = false; },
      error: e => {
        this.chargement = false;
        this.erreur = e?.status === 403 ? "Le tableau de bord d'activité est réservé à l'encadrement." : 'Chargement impossible.';
      },
    });
  }

  choisirPeriode(p: '3m' | '6m' | '12m'): void { this.periode = p; this.charger(); }

  get barres(): { mois: string; libelle: string; valeur: number; hauteur: number }[] {
    const lignes = this.donnees?.par_mois || [];
    const max = this.max;
    return lignes.map(l => ({ mois: l.mois, libelle: libelleMois(l.mois), valeur: l[this.mesure],
                              hauteur: max ? (100 * l[this.mesure]) / max : 0 }));
  }

  get max(): number { return echelle(Math.max(0, ...(this.donnees?.par_mois || []).map(l => l[this.mesure]))); }

  get graduations(): number[] { const m = this.max; return [m, m / 2, 0]; }

  get operateurs() {
    return [...(this.donnees?.operateurs || [])].sort((a, b) => b[this.tri] - a[this.tri] || a.nom.localeCompare(b.nom));
  }

  pourcent(v: number | null): string { return v === null ? '—' : `${Math.round(v * 100)} %`; }
  jetons(n: number): string { return n >= 1000 ? `${(n / 1000).toFixed(1)} k` : String(n); }
}
