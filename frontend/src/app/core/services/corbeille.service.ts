import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type TypeElement = 'projet' | 'propriete' | 'affaire' | 'ssdgps' | 'session' | 'piece';

export interface ElementCorbeille {
  type: TypeElement;
  libelle_type: string;
  id: string;
  titre: string;
  contexte: string;
  deleted_at: string | null;
  deleted_by: string;
  /** Sous-éléments encore actifs : bloquent la suppression définitive. */
  enfants_actifs: number;
  parent_en_corbeille: boolean;
  /** Pièce d'un dossier figé : ni restauration ni purge. */
  verrouille: boolean;
}

export interface ResultatLot { restaures?: number; supprimes?: number; erreurs: { type: string; id: string; detail: string }[]; }

/** Corbeille générale (projets → pièces) : liste, restauration et purge en lot. */
@Injectable({ providedIn: 'root' })
export class CorbeilleService {
  private readonly base = `${environment.apiUrl}/v1/corbeille/`;

  constructor(private http: HttpClient) {}

  lister(): Observable<{ total: number; resultats: ElementCorbeille[] }> {
    return this.http.get<{ total: number; resultats: ElementCorbeille[] }>(this.base);
  }

  restaurer(elements: { type: TypeElement; id: string }[]): Observable<ResultatLot> {
    return this.http.post<ResultatLot>(`${this.base}restaurer/`, { elements });
  }

  purger(elements: { type: TypeElement; id: string }[]): Observable<ResultatLot> {
    return this.http.post<ResultatLot>(`${this.base}purger/`, { elements });
  }
}
