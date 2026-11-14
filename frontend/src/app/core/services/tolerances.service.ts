import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface RegleDuree {
  actif: boolean;
  statique_min_s: number; statique_limite_acceptee: boolean;
  stopgo_min_s: number; stopgo_limite_acceptee: boolean;
}
export interface RegleEcart { actif: boolean; max_m: number; }

export interface TolerancesConfig {
  rob_duree: RegleDuree;
  rtlb_duree: RegleDuree;
  rfb_fermeture: { actif: boolean };
  ecarts_determinations: RegleEcart;
  rc_ecarts: RegleEcart;
  modes: { statique: string[]; stopgo: string[] };
}

export interface TolerancesPayload {
  /** Ce que l'opérateur a modifié (le reste = valeurs par défaut). */
  config: Partial<TolerancesConfig>;
  /** Configuration appliquée au rapport. */
  effectives: TolerancesConfig;
  defauts: TolerancesConfig;
  libelles: Record<string, string>;
}

/** Tolérances de l'opérateur (cf. backend `pieces/tolerances.py`). */
@Injectable({ providedIn: 'root' })
export class TolerancesService {
  private url = `${environment.apiUrl}/auth/me/tolerances/`;

  constructor(private http: HttpClient) {}

  get(): Observable<TolerancesPayload> { return this.http.get<TolerancesPayload>(this.url); }
  save(config: Partial<TolerancesConfig>): Observable<TolerancesPayload> { return this.http.put<TolerancesPayload>(this.url, config); }
  reset(): Observable<TolerancesPayload> { return this.http.post<TolerancesPayload>(`${this.url}reset/`, {}); }
}

/** Ne garde que ce qui diffère des valeurs par défaut : l'opérateur hérite ainsi des
 * évolutions futures des défauts pour tout ce qu'il n'a pas touché. */
export function differences(effectives: TolerancesConfig, defauts: TolerancesConfig): Partial<TolerancesConfig> {
  const out: any = {};
  (Object.keys(defauts) as (keyof TolerancesConfig)[]).forEach(cle => {
    const d: any = defauts[cle], e: any = effectives[cle];
    const diff: any = {};
    Object.keys(d).forEach(champ => {
      if (JSON.stringify(e?.[champ]) !== JSON.stringify(d[champ])) diff[champ] = e[champ];
    });
    if (Object.keys(diff).length) out[cle] = diff;
  });
  return out;
}
