import { Injectable } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type TypeRessourceTbc = 'etude_modele' | 'ruban';

/** Ressource TBC déposée (cf. backend `ressources/views.py::serialiser`). */
export interface RessourceTbc {
  id: string;
  type_ressource: TypeRessourceTbc;
  libelle: string;
  nom_fichier: string;
  taille: number;
  description: string;
  organisation: { id: string; nom: string } | null;
  source: 'organisation' | 'application';
  created_at: string;
  updated_at: string;
  created_by_email: string | null;
  updated_by_email: string | null;
  peut_gerer: boolean;
}

export interface RessourceDisponible {
  type_ressource: TypeRessourceTbc;
  libelle: string;
  conseil: string;
  ressource: RessourceTbc | null;
}

export interface NiveauRessources {
  /** null = ressources de l'APPLICATION (repli de toutes les organisations). */
  organisation: { id: string; nom: string } | null;
  ressources: Record<TypeRessourceTbc, RessourceTbc | null>;
}

export interface GestionRessources {
  niveaux: NiveauRessources[];
  extensions: Record<TypeRessourceTbc, string[]>;
  taille_max: number;
}

@Injectable({ providedIn: 'root' })
export class RessourcesTbcService {
  private readonly url = `${environment.apiUrl}/v1/ressources-tbc/`;

  constructor(private http: HttpClient) {}

  /** Ressources à télécharger pour l'utilisateur (celles de son organisation, sinon de l'application). */
  disponibles(): Observable<{ ressources: RessourceDisponible[]; peut_gerer: boolean }> {
    return this.http.get<{ ressources: RessourceDisponible[]; peut_gerer: boolean }>(this.url);
  }

  gestion(): Observable<GestionRessources> {
    return this.http.get<GestionRessources>(`${this.url}gestion/`);
  }

  /** Dépose (ou remplace) la ressource d'un niveau ; `organisationId` null = application. */
  deposer(type: TypeRessourceTbc, fichier: File, organisationId: string | null, description = ''): Observable<RessourceTbc> {
    const fd = new FormData();
    fd.append('type_ressource', type);
    fd.append('fichier', fichier, fichier.name);
    fd.append('description', description);
    if (organisationId) fd.append('organisation', organisationId);
    return this.http.post<RessourceTbc>(this.url, fd);
  }

  modifierDescription(id: string, description: string): Observable<RessourceTbc> {
    return this.http.patch<RessourceTbc>(`${this.url}${id}/`, { description });
  }

  retirer(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}${id}/`);
  }

  telecharger(id: string): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.url}${id}/fichier/`, { responseType: 'blob', observe: 'response' });
  }
}

/** Déclenche l'enregistrement d'un blob dans le navigateur. */
export function enregistrerBlob(blob: Blob, nom: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
