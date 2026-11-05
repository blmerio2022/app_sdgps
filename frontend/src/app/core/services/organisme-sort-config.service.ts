import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { OrgSortLevel } from './org-sort-config.service';

export { OrgSortLevel } from './org-sort-config.service';

/**
 * Tri MULTI-NIVEAUX par défaut des tableaux des listes d'ORGANISMES (niveau 1 et niveau 2),
 * propre à l'opérateur. Deux configurations distinctes (les colonnes triables diffèrent).
 * Endpoints : GET/PUT /api/auth/me/organisme-sort-config/<niveau>/ (+ POST .../reset/). Hérité
 * par défaut de la configuration du compte super admin (source) et réinitialisable depuis
 * celle-ci. Miroir de `OrgSortConfigService`.
 */
@Injectable({ providedIn: 'root' })
export class OrganismeSortConfigService {
  private base = `${environment.apiUrl}/auth/me/organisme-sort-config`;
  private cache: { [niveau: number]: Observable<OrgSortLevel[]> } = {};

  constructor(private http: HttpClient) {}

  private url(niveau: number): string { return `${this.base}/${niveau}/`; }

  /** Normalise la réponse en liste de niveaux valides (champ renseigné, sens 'asc'/'desc'). */
  private normalize(raw: any): OrgSortLevel[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(l => l && l.field)
      .map(l => ({ field: String(l.field), dir: l.dir === 'desc' ? 'desc' : 'asc' } as OrgSortLevel));
  }

  /** Config du niveau (mise en cache ; renvoie [] en cas d'erreur pour ne pas bloquer l'affichage). */
  get(niveau: number): Observable<OrgSortLevel[]> {
    if (!this.cache[niveau]) {
      this.cache[niveau] = this.http.get<any>(this.url(niveau)).pipe(
        map(raw => this.normalize(raw)),
        catchError(() => of([] as OrgSortLevel[])),
        shareReplay(1),
      );
    }
    return this.cache[niveau];
  }

  save(niveau: number, levels: OrgSortLevel[]): Observable<OrgSortLevel[]> {
    return this.http.put<any>(this.url(niveau), levels).pipe(
      map(raw => this.normalize(raw)),
      tap(saved => { this.cache[niveau] = of(saved); }),
    );
  }

  /** Réinitialise la config du niveau avec la configuration SOURCE (compte administrateur). */
  resetToSource(niveau: number): Observable<OrgSortLevel[]> {
    return this.http.post<any>(`${this.url(niveau)}reset/`, {}).pipe(
      map(raw => this.normalize(raw)),
      tap(saved => { this.cache[niveau] = of(saved); }),
    );
  }

  clearCache(niveau?: number): void {
    if (niveau == null) this.cache = {};
    else delete this.cache[niveau];
  }
}
