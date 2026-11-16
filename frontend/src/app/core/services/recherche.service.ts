import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface ResultatRecherche { type: string; id: string; titre: string; sous_titre: string; lien: string; }
export interface GroupeRecherche { type: string; libelle: string; resultats: ResultatRecherche[]; }
export interface ReponseRecherche { q: string; groupes: GroupeRecherche[]; total: number; }

const CLE_RECENTS = 'sdgps.recherche.recents';
const MAX_RECENTS = 6;

/** Recherche globale (Ctrl+K) + derniers résultats ouverts (mémorisés dans le navigateur). */
@Injectable({ providedIn: 'root' })
export class RechercheService {
  constructor(private http: HttpClient) {}

  rechercher(q: string): Observable<ReponseRecherche> {
    return this.http.get<ReponseRecherche>(`${environment.apiUrl}/v1/recherche/`, { params: new HttpParams().set('q', q) });
  }

  recents(): ResultatRecherche[] {
    try { return JSON.parse(localStorage.getItem(CLE_RECENTS) || '[]'); } catch { return []; }
  }

  memoriser(r: ResultatRecherche): void {
    const liste = [r, ...this.recents().filter(x => x.lien !== r.lien)].slice(0, MAX_RECENTS);
    localStorage.setItem(CLE_RECENTS, JSON.stringify(liste));
  }

  oublier(): void { localStorage.removeItem(CLE_RECENTS); }
}

export const ICONES_RECHERCHE: Record<string, string> = {
  ssdgps: 'fa-file-signature', projet: 'fa-project-diagram', propriete: 'fa-map-location-dot',
  affaire: 'fa-folder-open', point: 'fa-location-crosshairs',
};
