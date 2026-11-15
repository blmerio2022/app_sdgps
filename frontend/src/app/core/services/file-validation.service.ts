import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type StatutFile = 'soumis' | 'valide';
export type DecisionFile = 'valider' | 'rejeter' | 'clore';

export interface DossierAValider {
  id: string;
  numero_ssdgps: number;
  nature_ssdgps: string;
  type_ssdgps: string;
  statut: string;
  statut_display: string;
  projet_id: string;
  projet_code: string;
  projet_nom: string;
  propriete_nom: string;
  affaire_numero: number;
  organisation: string;
  depuis: string | null;
  attente_jours: number | null;
  par: string;
  redacteur: string;
  coherence: { ok: boolean; erreurs: number; avertissements: number; anomalies: string[]; pieces: number } | null;
}

export interface FileValidation {
  encadrement: boolean;
  statut: StatutFile;
  compteurs: Partial<Record<StatutFile, number>>;
  results: DossierAValider[];
}

export interface ResultatGroupe {
  reussis: number;
  echecs: number;
  resultats: { id: string; ok: boolean; detail?: string; statut?: string }[];
}

/** File de validation de l'encadrement (dossiers soumis / validés à clore). */
@Injectable({ providedIn: 'root' })
export class FileValidationService {
  private readonly base = `${environment.apiUrl}/v1/ssdgps/`;

  constructor(private http: HttpClient) {}

  file(statut: StatutFile = 'soumis'): Observable<FileValidation> {
    return this.http.get<FileValidation>(`${this.base}a-valider/`, { params: new HttpParams().set('statut', statut) });
  }

  decider(ids: string[], action: DecisionFile, motif = ''): Observable<ResultatGroupe> {
    return this.http.post<ResultatGroupe>(`${this.base}transition-groupee/`, { ids, action, motif });
  }
}
