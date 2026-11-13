import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  AssistantPayload, AssistantResult, ModeleSsdgps, PlanSsdgps, ValidationGroupee,
} from '../models/modele-ssdgps.model';

/**
 * Modèles de SDGPS (de l'application + personnels) et assistant de création d'un dossier.
 * Les droits sont tenus par le backend : `modifiable` n'est qu'une garde d'affichage.
 */
@Injectable({ providedIn: 'root' })
export class ModelesSsdgpsService {
  private base = `${environment.apiUrl}/v1/`;
  private url = `${this.base}modeles-ssdgps/`;

  constructor(private http: HttpClient) {}

  list(nature?: string): Observable<ModeleSsdgps[]> {
    let params = new HttpParams().set('page_size', '1000');
    if (nature) params = params.set('nature', nature);
    return this.http.get<any>(this.url, { params }).pipe(
      map(res => Array.isArray(res) ? res : (res?.results ?? [])),
    );
  }

  get(id: string): Observable<ModeleSsdgps> { return this.http.get<ModeleSsdgps>(`${this.url}${id}/`); }
  create(m: Partial<ModeleSsdgps>): Observable<ModeleSsdgps> { return this.http.post<ModeleSsdgps>(this.url, m); }
  update(id: string, m: Partial<ModeleSsdgps>): Observable<ModeleSsdgps> {
    return this.http.patch<ModeleSsdgps>(`${this.url}${id}/`, m);
  }
  delete(id: string): Observable<void> { return this.http.delete<void>(`${this.url}${id}/`); }

  /** Copie PERSONNELLE d'un modèle visible (point de départ d'un modèle personnalisé). */
  duplicate(id: string, nom?: string): Observable<ModeleSsdgps> {
    return this.http.post<ModeleSsdgps>(`${this.url}${id}/dupliquer/`, nom ? { nom } : {});
  }

  /** Enregistre les pièces d'un dossier existant comme modèle personnel. */
  fromSsdgps(ssdgpsId: string, nom: string, description = ''): Observable<ModeleSsdgps> {
    return this.http.post<ModeleSsdgps>(`${this.url}depuis-ssdgps/`, { ssdgps: ssdgpsId, nom, description });
  }

  // --- Assistant & liste de contrôle --------------------------------------------------

  /** Crée en UNE transaction projet → propriété → affaire → SDGPS (chaque niveau existant ou nouveau). */
  createDossier(payload: AssistantPayload): Observable<AssistantResult> {
    return this.http.post<AssistantResult>(`${this.base}ssdgps/assistant/`, payload);
  }

  getPlan(ssdgpsId: string): Observable<PlanSsdgps> {
    return this.http.get<PlanSsdgps>(`${this.base}ssdgps/${ssdgpsId}/plan/`);
  }

  applyModele(ssdgpsId: string, modeleId: string): Observable<PlanSsdgps> {
    return this.http.post<PlanSsdgps>(`${this.base}ssdgps/${ssdgpsId}/appliquer-modele/`, { modele: modeleId });
  }

  /** Valide d'un coup les pièces non validées (toutes, ou `ids`). Les échecs sont rendus un par un. */
  validatePieces(ssdgpsId: string, ids?: string[]): Observable<ValidationGroupee> {
    return this.http.post<ValidationGroupee>(`${this.base}ssdgps/${ssdgpsId}/valider-pieces/`, ids ? { ids } : {});
  }
}
