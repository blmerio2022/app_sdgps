import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Piece } from '../models/piece.model';

export interface VersionPiece {
  numero: number | null;
  statut: string;
  origine?: string;
  auteur: string;
  date_contenu: string | null;
  remplacee_par?: string;
  archivee_le?: string;
  lignes: number;
  payload?: any;
}

export interface HistoriquePiece { courante: VersionPiece; versions: VersionPiece[]; }

export interface DiffVersions {
  de: number;
  vers: string;
  ajoutees: any[];
  supprimees: any[];
  modifiees: { avant: any; apres: any; colonnes: string[] }[];
  identiques: number;
  autres_cles: string[];
}

/** Historique des versions d'une pièce (contenu archivé à chaque changement). */
@Injectable({ providedIn: 'root' })
export class PieceVersionsService {
  private readonly base = `${environment.apiUrl}/v1/pieces/`;

  constructor(private http: HttpClient) {}

  historique(pieceId: string): Observable<HistoriquePiece> {
    return this.http.get<HistoriquePiece>(`${this.base}${pieceId}/versions/`);
  }

  version(pieceId: string, numero: number): Observable<VersionPiece> {
    return this.http.get<VersionPiece>(`${this.base}${pieceId}/versions/${numero}/`);
  }

  comparer(pieceId: string, numero: number, avec: number | 'courante' = 'courante'): Observable<DiffVersions> {
    return this.http.get<DiffVersions>(`${this.base}${pieceId}/versions/${numero}/comparer/`,
      { params: new HttpParams().set('avec', String(avec)) });
  }

  restaurer(pieceId: string, numero: number): Observable<Piece> {
    return this.http.post<Piece>(`${this.base}${pieceId}/versions/${numero}/restaurer/`, {});
  }
}
