import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { OrgSortLevel } from './org-sort-config.service';

export { OrgSortLevel } from './org-sort-config.service';

/**
 * Tri MULTI-NIVEAUX par défaut, GÉNÉRIQUE, d'un tableau identifié par une clé (utilisateurs,
 * projets, explorateur, ...), propre à l'opérateur. Endpoints :
 * GET/PUT /api/auth/me/table-sort-config/<key>/ (+ POST .../reset/). Hérité par défaut de la
 * configuration du compte super admin (source) et réinitialisable depuis celle-ci. Mutualise le
 * mécanisme des services dédiés (`OrgSortConfigService`, etc.) pour les listes sans champ propre.
 */
@Injectable({ providedIn: 'root' })
export class TableSortConfigService {
  private base = `${environment.apiUrl}/auth/me/table-sort-config`;
  private cache: { [key: string]: Observable<OrgSortLevel[]> } = {};

  constructor(private http: HttpClient) {}

  private url(key: string): string { return `${this.base}/${key}/`; }

  /** Normalise la réponse en liste de niveaux valides (champ renseigné, sens 'asc'/'desc'). */
  private normalize(raw: any): OrgSortLevel[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(l => l && l.field)
      .map(l => ({ field: String(l.field), dir: l.dir === 'desc' ? 'desc' : 'asc' } as OrgSortLevel));
  }

  /** Config de la clé (mise en cache ; renvoie [] en cas d'erreur pour ne pas bloquer l'affichage). */
  get(key: string): Observable<OrgSortLevel[]> {
    if (!this.cache[key]) {
      this.cache[key] = this.http.get<any>(this.url(key)).pipe(
        map(raw => this.normalize(raw)),
        catchError(() => of([] as OrgSortLevel[])),
        shareReplay(1),
      );
    }
    return this.cache[key];
  }

  save(key: string, levels: OrgSortLevel[]): Observable<OrgSortLevel[]> {
    return this.http.put<any>(this.url(key), levels).pipe(
      map(raw => this.normalize(raw)),
      tap(saved => { this.cache[key] = of(saved); }),
    );
  }

  /** Réinitialise la config de la clé avec la configuration SOURCE (compte administrateur). */
  resetToSource(key: string): Observable<OrgSortLevel[]> {
    return this.http.post<any>(`${this.url(key)}reset/`, {}).pipe(
      map(raw => this.normalize(raw)),
      tap(saved => { this.cache[key] = of(saved); }),
    );
  }

  clearCache(key?: string): void {
    if (key == null) this.cache = {};
    else delete this.cache[key];
  }
}
