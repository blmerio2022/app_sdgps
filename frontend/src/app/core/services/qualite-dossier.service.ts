import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

// ---------------------------------------------------------------- contrôle croisé
export interface PieceRef { id: string; type_piece: string; libelle: string; }

export interface ControleCroise {
  code: string;
  gravite: 'erreur' | 'avertissement';
  titre: string;
  message: string;
  points: string[];
  nombre: number;
  pieces: PieceRef[];
}

export interface ResultatControleCroise {
  ok: boolean;
  erreurs: number;
  avertissements: number;
  controles: ControleCroise[];
  sources: Record<string, { pieces: number; points: number }>;
}

// ---------------------------------------------------------------- remarques
export type StatutRemarque = 'ouverte' | 'corrigee' | 'levee';

export interface Remarque {
  id: string;
  piece: string | null;
  piece_libelle: string;
  ligne: string;
  texte: string;
  statut: StatutRemarque;
  statut_display: string;
  reponse: string;
  auteur: string;
  created_at: string;
  corrigee_par: string;
  corrigee_at: string | null;
  levee_par: string;
  levee_at: string | null;
  peut_supprimer: boolean;
}

export interface EtatRemarques {
  remarques: Remarque[];
  ouvertes: number;
  corrigees: number;
  levees: number;
  peut_remarquer: boolean;
  peut_lever: boolean;
  peut_corriger: boolean;
}

/** Qualité du dossier : contrôle croisé des points et remarques de validation par pièce. */
@Injectable({ providedIn: 'root' })
export class QualiteDossierService {
  private readonly base = `${environment.apiUrl}/v1/ssdgps/`;

  constructor(private http: HttpClient) {}

  controleCroise(ssdgpsId: string, sessionId?: string | null): Observable<ResultatControleCroise> {
    let params = new HttpParams();
    if (sessionId) params = params.set('session', sessionId);
    return this.http.get<ResultatControleCroise>(`${this.base}${ssdgpsId}/controle-croise/`, { params });
  }

  remarques(ssdgpsId: string): Observable<EtatRemarques> {
    return this.http.get<EtatRemarques>(`${this.base}${ssdgpsId}/remarques/`);
  }

  ajouterRemarque(ssdgpsId: string, texte: string, piece?: string | null, ligne?: string): Observable<EtatRemarques> {
    return this.http.post<EtatRemarques>(`${this.base}${ssdgpsId}/remarques/`,
      { texte, piece: piece || null, ligne: ligne || '' });
  }

  operationRemarque(ssdgpsId: string, id: string, op: 'corriger' | 'lever' | 'rouvrir', reponse = ''):
      Observable<EtatRemarques> {
    return this.http.post<EtatRemarques>(`${this.base}${ssdgpsId}/remarques/${id}/${op}/`, { reponse });
  }

  supprimerRemarque(ssdgpsId: string, id: string): Observable<EtatRemarques> {
    return this.http.delete<EtatRemarques>(`${this.base}${ssdgpsId}/remarques/${id}/`);
  }
}
