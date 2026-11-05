import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

/** Un niveau de tri multi-niveaux de la liste des organisations (champ + sens). */
export interface OrgSortLevel { field: string; dir: 'asc' | 'desc'; }

/**
 * Tri MULTI-NIVEAUX par défaut du tableau de la liste des ORGANISATIONS, propre à l'opérateur.
 * Endpoint : GET/PUT /api/auth/me/org-sort-config/ (+ POST .../reset/). Hérité par défaut de la
 * configuration du compte super admin (source) et réinitialisable depuis celle-ci.
 * Miroir de `SsdgpsSortConfigService`.
 */
@Injectable({ providedIn: 'root' })
export class OrgSortConfigService {
  private url = `${environment.apiUrl}/auth/me/org-sort-config/`;
  private cache$?: Observable<OrgSortLevel[]>;

  constructor(private http: HttpClient) {}

  /** Normalise la réponse en liste de niveaux valides (champ renseigné, sens 'asc'/'desc'). */
  private normalize(raw: any): OrgSortLevel[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(l => l && l.field)
      .map(l => ({ field: String(l.field), dir: l.dir === 'desc' ? 'desc' : 'asc' } as OrgSortLevel));
  }

  /** Config (mise en cache ; renvoie [] en cas d'erreur pour ne pas bloquer l'affichage). */
  get(): Observable<OrgSortLevel[]> {
    if (!this.cache$) {
      this.cache$ = this.http.get<any>(this.url).pipe(
        map(raw => this.normalize(raw)),
        catchError(() => of([] as OrgSortLevel[])),
        shareReplay(1),
      );
    }
    return this.cache$;
  }

  save(levels: OrgSortLevel[]): Observable<OrgSortLevel[]> {
    return this.http.put<any>(this.url, levels).pipe(
      map(raw => this.normalize(raw)),
      tap(saved => { this.cache$ = of(saved); }),
    );
  }

  /** Réinitialise la config de l'opérateur avec la configuration SOURCE (compte administrateur). */
  resetToSource(): Observable<OrgSortLevel[]> {
    return this.http.post<any>(`${this.url}reset/`, {}).pipe(
      map(raw => this.normalize(raw)),
      tap(saved => { this.cache$ = of(saved); }),
    );
  }

  clearCache(): void { this.cache$ = undefined; }
}
