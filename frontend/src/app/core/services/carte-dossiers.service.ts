import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface DossierCarte {
  id: string;
  titre: string;
  nature: string;
  statut: string;
  statut_display: string;
  contexte: string;
  lat: number;
  lon: number;
  nb_points: number;
  source: 'LPA' | 'RDD';
  zone: string;
  /** Zone Lambert absente des PPA/PPN : zone Nord supposée. */
  zone_supposee: boolean;
  lien: string;
}

export interface CarteDossiers { dossiers: DossierCarte[]; sans_position: number; total: number; }

/** Couleur d'un statut de SDGPS (mêmes teintes que les badges de l'application). */
export const COULEURS_STATUT: Record<string, string> = {
  en_cours: '#f39c12', soumis: '#5a9bd5', valide: '#2ecc71', clos: '#95a5a6',
};

@Injectable({ providedIn: 'root' })
export class CarteDossiersService {
  private readonly url = `${environment.apiUrl}/v1/carte-dossiers/`;

  constructor(private http: HttpClient) {}

  charger(): Observable<CarteDossiers> {
    return this.http.get<CarteDossiers>(this.url);
  }
}
