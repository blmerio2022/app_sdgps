import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface EtatMfa { active: boolean; active_le: string | null; codes_secours_restants: number; codes_secours?: string[]; }
export interface SessionCompte {
  id: string; adresse_ip: string | null; agent: string; created_at: string; derniere_activite: string | null;
  expire_le: string | null; double_auth: boolean; courante: boolean;
}

/** Sécurité du compte connecté : double authentification et sessions. */
@Injectable({ providedIn: 'root' })
export class SecuriteService {
  private readonly base = `${environment.apiUrl}/auth/me/`;

  constructor(private http: HttpClient) {}

  etatMfa(): Observable<EtatMfa> { return this.http.get<EtatMfa>(`${this.base}mfa/`); }
  initierMfa(): Observable<{ secret: string; uri: string }> { return this.http.post<{ secret: string; uri: string }>(`${this.base}mfa/initier/`, {}); }
  activerMfa(code: string): Observable<EtatMfa> { return this.http.post<EtatMfa>(`${this.base}mfa/activer/`, { code }); }
  desactiverMfa(motDePasse: string, code: string): Observable<EtatMfa> {
    return this.http.post<EtatMfa>(`${this.base}mfa/desactiver/`, { mot_de_passe: motDePasse, code });
  }
  regenererCodes(code: string): Observable<EtatMfa> { return this.http.post<EtatMfa>(`${this.base}mfa/codes-secours/`, { code }); }

  sessions(): Observable<SessionCompte[]> { return this.http.get<SessionCompte[]>(`${this.base}sessions/`); }
  revoquer(id: string): Observable<{ revoquees: number }> { return this.http.post<{ revoquees: number }>(`${this.base}sessions/${id}/revoquer/`, {}); }
  revoquerAutres(): Observable<{ revoquees: number }> { return this.http.post<{ revoquees: number }>(`${this.base}sessions/revoquer-autres/`, {}); }
}

/** « Chrome · Windows » à partir d'un User-Agent. */
export function appareil(agent: string): string {
  const a = agent || '';
  const nav = /Edg\//.test(a) ? 'Edge' : /Firefox\//.test(a) ? 'Firefox' : /Chrome\//.test(a) ? 'Chrome'
    : /Safari\//.test(a) ? 'Safari' : a ? 'Navigateur' : 'Appareil inconnu';
  const os = /Windows/.test(a) ? 'Windows' : /Android/.test(a) ? 'Android' : /iPhone|iPad/.test(a) ? 'iOS'
    : /Mac OS X/.test(a) ? 'macOS' : /Linux/.test(a) ? 'Linux' : '';
  return os ? `${nav} · ${os}` : nav;
}
