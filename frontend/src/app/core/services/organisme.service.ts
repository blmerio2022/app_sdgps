import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { OrganismeNiveau1, OrganismeNiveau2 } from '../models/organisme.model';

/**
 * CRUD des organismes premier / deuxième niveau.
 * Déballe la pagination DRF éventuelle (`{ results: [...] }`) comme OrganizationService.
 */
@Injectable({ providedIn: 'root' })
export class OrganismeService {
  private base = `${environment.apiUrl}/v1/`;
  private n1Url = `${this.base}organismes-niveau1/`;
  private n2Url = `${this.base}organismes-niveau2/`;

  constructor(private http: HttpClient) {}

  private buildParams(params?: any): HttpParams {
    let hp = new HttpParams();
    if (params) {
      Object.keys(params).forEach(k => {
        if (params[k] !== null && params[k] !== undefined && params[k] !== '') {
          hp = hp.set(k, params[k]);
        }
      });
    }
    return hp.set('page_size', '1000');
  }

  private unwrap<T>() {
    return map((response: any): T[] => {
      if (Array.isArray(response)) return response;
      if (response && Array.isArray(response.results)) return response.results;
      return [];
    });
  }

  // ---- Niveau 1 ----
  getNiveau1(params?: any): Observable<OrganismeNiveau1[]> {
    return this.http.get<any>(this.n1Url, { params: this.buildParams(params) })
      .pipe(this.unwrap<OrganismeNiveau1>());
  }
  createNiveau1(payload: Partial<OrganismeNiveau1>): Observable<OrganismeNiveau1> {
    return this.http.post<OrganismeNiveau1>(this.n1Url, payload);
  }
  updateNiveau1(id: string, payload: Partial<OrganismeNiveau1>): Observable<OrganismeNiveau1> {
    return this.http.patch<OrganismeNiveau1>(`${this.n1Url}${id}/`, payload);
  }
  deleteNiveau1(id: string): Observable<void> {
    return this.http.delete<void>(`${this.n1Url}${id}/`);
  }
  restoreNiveau1(id: string): Observable<any> {
    return this.http.post(`${this.n1Url}${id}/restore/`, {});
  }
  bulkDeleteNiveau1(ids: string[]): Observable<any> {
    return this.http.post(`${this.n1Url}bulk-delete/`, { ids });
  }
  /** Suppression DÉFINITIVE (irréversible) — corbeille uniquement. */
  permanentDeleteNiveau1(id: string): Observable<void> {
    return this.http.delete<void>(`${this.n1Url}${id}/permanent/`);
  }
  /** Suppression DÉFINITIVE en masse — corbeille uniquement. */
  bulkPermanentDeleteNiveau1(ids: string[]): Observable<any> {
    return this.http.post(`${this.n1Url}permanent-delete/`, { ids });
  }
  bulkRestoreNiveau1(ids: string[]): Observable<any> {
    return this.http.post(`${this.n1Url}bulk-restore/`, { ids });
  }

  // ---- Niveau 2 ----
  getNiveau2(params?: any): Observable<OrganismeNiveau2[]> {
    return this.http.get<any>(this.n2Url, { params: this.buildParams(params) })
      .pipe(this.unwrap<OrganismeNiveau2>());
  }
  createNiveau2(payload: Partial<OrganismeNiveau2>): Observable<OrganismeNiveau2> {
    return this.http.post<OrganismeNiveau2>(this.n2Url, payload);
  }
  updateNiveau2(id: string, payload: Partial<OrganismeNiveau2>): Observable<OrganismeNiveau2> {
    return this.http.patch<OrganismeNiveau2>(`${this.n2Url}${id}/`, payload);
  }
  deleteNiveau2(id: string): Observable<void> {
    return this.http.delete<void>(`${this.n2Url}${id}/`);
  }
  restoreNiveau2(id: string): Observable<any> {
    return this.http.post(`${this.n2Url}${id}/restore/`, {});
  }
  bulkDeleteNiveau2(ids: string[]): Observable<any> {
    return this.http.post(`${this.n2Url}bulk-delete/`, { ids });
  }
  /** Suppression DÉFINITIVE (irréversible) — corbeille uniquement. */
  permanentDeleteNiveau2(id: string): Observable<void> {
    return this.http.delete<void>(`${this.n2Url}${id}/permanent/`);
  }
  /** Suppression DÉFINITIVE en masse — corbeille uniquement. */
  bulkPermanentDeleteNiveau2(ids: string[]): Observable<any> {
    return this.http.post(`${this.n2Url}permanent-delete/`, { ids });
  }
  bulkRestoreNiveau2(ids: string[]): Observable<any> {
    return this.http.post(`${this.n2Url}bulk-restore/`, { ids });
  }
}
