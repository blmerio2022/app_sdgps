import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface CandidatImport {
  type_piece: string;
  libelle: string;
  score: number;
  champs_reconnus: number;
  champs_total: number;
  nom_reconnu: boolean;
  repetable: boolean;
  niveau: string;
  mapping: Record<string, string>;
  numero_nom: number | null;
}

export type ActionImport = 'creer' | 'remplacer' | 'ignorer';

export interface LignePlan {
  fichier: string;
  lisible: boolean;
  erreur?: string;
  colonnes: string[];
  lignes: number;
  candidats: CandidatImport[];
  type_piece: string | null;
  ambigu?: boolean;
  confiance?: number;
  mapping: Record<string, string>;
  numero: number | null;
  piece_existante?: string | null;
  action: ActionImport;
  doublon?: boolean;
}

export interface PlanImport { ssdgps: string; nature: string; plan: LignePlan[]; }

/** Import en masse : plan proposé par le serveur, puis import unitaire ligne à ligne. */
@Injectable({ providedIn: 'root' })
export class ImportMasseService {
  private readonly base = `${environment.apiUrl}/v1/pieces/`;

  constructor(private http: HttpClient) {}

  plan(ssdgpsId: string, fichiers: File[]): Observable<PlanImport> {
    const fd = new FormData();
    fd.append('ssdgps', ssdgpsId);
    fichiers.forEach(f => fd.append('fichiers', f, f.name));
    return this.http.post<PlanImport>(`${this.base}import-plan/`, fd);
  }

  /** Exécute UNE ligne du plan par l'import unitaire (phase 2 : mapping fourni). */
  importer(ssdgpsId: string, fichier: File, ligne: LignePlan, sessionId: string | null): Observable<any> {
    const fd = new FormData();
    fd.append('fichier', fichier, fichier.name);
    fd.append('type_piece', ligne.type_piece || '');
    fd.append('mapping', JSON.stringify(ligne.mapping || {}));
    if (ligne.action === 'remplacer' && ligne.piece_existante) {
      fd.append('piece_id', ligne.piece_existante);
    } else {
      fd.append('ssdgps', ssdgpsId);
      if (sessionId) fd.append('session', sessionId);
      if (ligne.numero) fd.append('numero', String(ligne.numero));
    }
    return this.http.post(`${this.base}import/`, fd);
  }
}
