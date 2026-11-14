import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { Projet, Propriete, Affaire, Ssdgps, Session, SsdgpsTransition } from '../models/project.model';

/**
 * Service CRUD du domaine métier (projets, propriétés, affaires, ssdgps, sessions).
 * Calqué sur OrganizationService. Le scoping RBAC est appliqué côté backend.
 */
@Injectable({ providedIn: 'root' })
export class ProjectsService {
  private base = `${environment.apiUrl}/v1/`;

  constructor(private http: HttpClient) {}

  private list<T>(resource: string, params?: Record<string, any>): Observable<T[]> {
    let httpParams = new HttpParams().set('page_size', '1000');
    if (params) {
      Object.keys(params).forEach(k => {
        if (params[k] !== null && params[k] !== undefined && params[k] !== '') {
          httpParams = httpParams.set(k, params[k]);
        }
      });
    }
    return this.http.get<any>(`${this.base}${resource}/`, { params: httpParams }).pipe(
      map(res => Array.isArray(res) ? res : (res?.results ?? []))
    );
  }

  private restore<T>(resource: string, id: string): Observable<T> {
    return this.http.post<T>(`${this.base}${resource}/${id}/restore/`, {});
  }

  private bulkRestore(resource: string, ids: string[]): Observable<{ restored_count: number }> {
    return this.http.post<{ restored_count: number }>(`${this.base}${resource}/bulk-restore/`, { ids });
  }

  private permanentDelete(resource: string, id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}${resource}/${id}/permanent/`);
  }

  private bulkPermanentDelete(resource: string, ids: string[]): Observable<{ deleted_count: number; errors: any[] }> {
    return this.http.post<{ deleted_count: number; errors: any[] }>(`${this.base}${resource}/permanent-delete/`, { ids });
  }

  // --- Projets ---
  getProjets(params?: Record<string, any>): Observable<Projet[]> { return this.list('projets', params); }
  getProjet(id: string): Observable<Projet> { return this.http.get<Projet>(`${this.base}projets/${id}/`); }
  createProjet(p: Partial<Projet>): Observable<Projet> { return this.http.post<Projet>(`${this.base}projets/`, p); }
  updateProjet(id: string, p: Partial<Projet>): Observable<Projet> { return this.http.patch<Projet>(`${this.base}projets/${id}/`, p); }
  deleteProjet(id: string): Observable<void> { return this.http.delete<void>(`${this.base}projets/${id}/`); }
  restoreProjet(id: string): Observable<Projet> { return this.restore('projets', id); }
  bulkRestoreProjets(ids: string[]): Observable<{ restored_count: number }> { return this.bulkRestore('projets', ids); }

  // --- Propriétés ---
  getProprietes(projetId: string, params?: Record<string, any>): Observable<Propriete[]> { return this.list('proprietes', { projet: projetId, ...params }); }
  getPropriete(id: string): Observable<Propriete> { return this.http.get<Propriete>(`${this.base}proprietes/${id}/`); }
  createPropriete(p: Partial<Propriete>): Observable<Propriete> { return this.http.post<Propriete>(`${this.base}proprietes/`, p); }
  updatePropriete(id: string, p: Partial<Propriete>): Observable<Propriete> { return this.http.patch<Propriete>(`${this.base}proprietes/${id}/`, p); }
  deletePropriete(id: string): Observable<void> { return this.http.delete<void>(`${this.base}proprietes/${id}/`); }
  restorePropriete(id: string): Observable<Propriete> { return this.restore('proprietes', id); }
  bulkRestoreProprietes(ids: string[]): Observable<{ restored_count: number }> { return this.bulkRestore('proprietes', ids); }

  // --- Affaires ---
  getAffaires(proprieteId: string, params?: Record<string, any>): Observable<Affaire[]> { return this.list('affaires', { propriete: proprieteId, ...params }); }
  /** Vue à plat : affaires filtrées par ancêtre (`projet` ou `propriete`). */
  listAffaires(params: Record<string, any>): Observable<Affaire[]> { return this.list('affaires', params); }
  createAffaire(a: Partial<Affaire>): Observable<Affaire> { return this.http.post<Affaire>(`${this.base}affaires/`, a); }
  updateAffaire(id: string, a: Partial<Affaire>): Observable<Affaire> { return this.http.patch<Affaire>(`${this.base}affaires/${id}/`, a); }
  deleteAffaire(id: string): Observable<void> { return this.http.delete<void>(`${this.base}affaires/${id}/`); }
  restoreAffaire(id: string): Observable<Affaire> { return this.restore('affaires', id); }
  bulkRestoreAffaires(ids: string[]): Observable<{ restored_count: number }> { return this.bulkRestore('affaires', ids); }

  // --- SSDGPS ---
  getSsdgps(affaireId: string, params?: Record<string, any>): Observable<Ssdgps[]> { return this.list('ssdgps', { affaire: affaireId, ...params }); }
  /** Tous les SSDGPS d'un projet (à plat, toutes propriétés/affaires confondues). */
  getSsdgpsByProjet(projetId: string, params?: Record<string, any>): Observable<Ssdgps[]> { return this.list('ssdgps', { projet: projetId, ...params }); }
  getSsdgpsById(id: string): Observable<Ssdgps> { return this.http.get<Ssdgps>(`${this.base}ssdgps/${id}/`); }
  createSsdgps(s: Partial<Ssdgps>): Observable<Ssdgps> { return this.http.post<Ssdgps>(`${this.base}ssdgps/`, s); }
  updateSsdgps(id: string, s: Partial<Ssdgps>): Observable<Ssdgps> { return this.http.patch<Ssdgps>(`${this.base}ssdgps/${id}/`, s); }
  deleteSsdgps(id: string): Observable<void> { return this.http.delete<void>(`${this.base}ssdgps/${id}/`); }
  /**
   * Fait avancer un SDGPS dans son cycle de vie : en cours → soumis → validé → clos,
   * avec rejet et réouverture en retour (cf. backend `projects/workflow.py`).
   *
   * Endpoint dédié, et non un `PATCH statut` : chaque passage porte ses règles (toutes
   * les pièces validées pour soumettre, motif pour rejeter) et son contrôle de rôle.
   * `motif` est obligatoire pour `rejeter` et `rouvrir`.
   */
  transitionSsdgps(id: string, action: SsdgpsTransition, motif = ''): Observable<Ssdgps> {
    return this.http.post<Ssdgps>(`${this.base}ssdgps/${id}/transition/`, { action, motif });
  }
  restoreSsdgps(id: string): Observable<Ssdgps> { return this.restore('ssdgps', id); }
  bulkRestoreSsdgps(ids: string[]): Observable<{ restored_count: number }> { return this.bulkRestore('ssdgps', ids); }

  // --- Sessions ---
  getSessions(ssdgpsId: string, params?: Record<string, any>): Observable<Session[]> { return this.list('sessions', { ssdgps: ssdgpsId, ...params }); }
  /** Vue à plat : sessions filtrées par ancêtre (`projet`, `propriete`, `affaire` ou `ssdgps`). */
  listSessions(params: Record<string, any>): Observable<Session[]> { return this.list('sessions', params); }
  /** Vue à plat : SSDGPS filtrés par ancêtre (`projet`, `propriete` ou `affaire`). */
  listSsdgps(params: Record<string, any>): Observable<Ssdgps[]> { return this.list('ssdgps', params); }
  createSession(s: Partial<Session>): Observable<Session> { return this.http.post<Session>(`${this.base}sessions/`, s); }
  updateSession(id: string, s: Partial<Session>): Observable<Session> { return this.http.patch<Session>(`${this.base}sessions/${id}/`, s); }
  deleteSession(id: string): Observable<void> { return this.http.delete<void>(`${this.base}sessions/${id}/`); }
  restoreSession(id: string): Observable<Session> { return this.restore('sessions', id); }
  bulkRestoreSessions(ids: string[]): Observable<{ restored_count: number }> { return this.bulkRestore('sessions', ids); }

  // --- Suppression définitive (corbeille) ---
  permanentDeleteProjet(id: string): Observable<void> { return this.permanentDelete('projets', id); }
  bulkPermanentDeleteProjets(ids: string[]) { return this.bulkPermanentDelete('projets', ids); }
  permanentDeletePropriete(id: string): Observable<void> { return this.permanentDelete('proprietes', id); }
  bulkPermanentDeleteProprietes(ids: string[]) { return this.bulkPermanentDelete('proprietes', ids); }
  permanentDeleteAffaire(id: string): Observable<void> { return this.permanentDelete('affaires', id); }
  bulkPermanentDeleteAffaires(ids: string[]) { return this.bulkPermanentDelete('affaires', ids); }
  permanentDeleteSsdgps(id: string): Observable<void> { return this.permanentDelete('ssdgps', id); }
  bulkPermanentDeleteSsdgps(ids: string[]) { return this.bulkPermanentDelete('ssdgps', ids); }
  permanentDeleteSession(id: string): Observable<void> { return this.permanentDelete('sessions', id); }
  bulkPermanentDeleteSessions(ids: string[]) { return this.bulkPermanentDelete('sessions', ids); }
}
