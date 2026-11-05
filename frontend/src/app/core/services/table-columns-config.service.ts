import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

/** Préférence d'une colonne : champ + visibilité. L'ordre de la liste = ordre d'affichage. */
export interface ColumnPref {
  field: string;
  visible: boolean;
}

/**
 * Configuration des COLONNES par défaut (visibilité + ordre), GÉNÉRIQUE, d'un tableau identifié
 * par une clé (organisations, utilisateurs, projets, explorateur, pièces, ...), propre à
 * l'opérateur. Endpoints : GET/PUT /api/auth/me/table-columns-config/<key>/ (+ POST .../reset/).
 * Héritée par défaut de la configuration du compte super admin (source) et réinitialisable depuis
 * celle-ci. Miroir strict de `TableSortConfigService`.
 */
@Injectable({ providedIn: 'root' })
export class TableColumnsConfigService {
  private base = `${environment.apiUrl}/auth/me/table-columns-config`;
  private cache: { [key: string]: Observable<ColumnPref[]> } = {};

  constructor(private http: HttpClient) {}

  private url(key: string): string { return `${this.base}/${key}/`; }

  /** Normalise la réponse en liste de préférences valides (champ renseigné, `visible` booléen). */
  private normalize(raw: any): ColumnPref[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(c => c && c.field)
      .map(c => ({ field: String(c.field), visible: !!c.visible } as ColumnPref));
  }

  /** Config de la clé (mise en cache ; renvoie [] en cas d'erreur pour ne pas bloquer l'affichage). */
  get(key: string): Observable<ColumnPref[]> {
    if (!this.cache[key]) {
      this.cache[key] = this.http.get<any>(this.url(key)).pipe(
        map(raw => this.normalize(raw)),
        catchError(() => of([] as ColumnPref[])),
        shareReplay(1),
      );
    }
    return this.cache[key];
  }

  save(key: string, columns: ColumnPref[]): Observable<ColumnPref[]> {
    return this.http.put<any>(this.url(key), columns).pipe(
      map(raw => this.normalize(raw)),
      tap(saved => { this.cache[key] = of(saved); }),
    );
  }

  /** Réinitialise la config de la clé avec la configuration SOURCE (compte administrateur). */
  resetToSource(key: string): Observable<ColumnPref[]> {
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
