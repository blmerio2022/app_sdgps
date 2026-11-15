import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Événement du journal d'audit (lecture seule — le journal ne se modifie jamais). */
export interface AuditEvenement {
  id: string;
  created_at: string;
  action: string;
  action_display: string;
  acteur: number | null;
  acteur_email: string;
  acteur_nom: string | null;
  cible_type: string;
  cible_id: string;
  cible_libelle: string;
  adresse_ip: string | null;
  details: Record<string, any>;
}

export interface AuditPage { count: number; next: string | null; previous: string | null; results: AuditEvenement[]; }

export interface AuditFiltres {
  q?: string;
  action?: string;          // une ou plusieurs actions, séparées par des virgules
  cible_type?: string;
  depuis?: string;          // AAAA-MM-JJ (journée entière) ou date-heure ISO
  jusqu_a?: string;
  ordre?: 'asc' | 'desc';
}

export interface AuditSynthese {
  total: number;
  par_action: { action: string; label: string; total: number }[];
  acteurs_distincts: number;
  echecs_connexion: number;
  premier: string | null;
  dernier: string | null;
}

export interface AuditOptions {
  actions: { value: string; label: string }[];
  types_cible: string[];
}

/**
 * Journal d'audit (`/api/v1/audit-events/`) — réservé à l'administration de
 * l'application (Super Admin, Admin Système). L'export est lui-même journalisé.
 */
@Injectable({ providedIn: 'root' })
export class AuditService {
  private url = `${environment.apiUrl}/v1/audit-events/`;

  constructor(private http: HttpClient) {}

  private params(filtres: AuditFiltres, extra: Record<string, string | number> = {}): HttpParams {
    let p = new HttpParams();
    for (const [cle, valeur] of Object.entries({ ...filtres, ...extra })) {
      if (valeur !== undefined && valeur !== null && String(valeur).trim() !== '') {
        p = p.set(cle, String(valeur).trim());
      }
    }
    return p;
  }

  evenements(filtres: AuditFiltres, page = 1, taille = 50): Observable<AuditPage> {
    return this.http.get<AuditPage>(this.url, { params: this.params(filtres, { page, page_size: taille }) });
  }

  synthese(filtres: AuditFiltres): Observable<AuditSynthese> {
    return this.http.get<AuditSynthese>(`${this.url}synthese/`, { params: this.params(filtres) });
  }

  options(): Observable<AuditOptions> {
    return this.http.get<AuditOptions>(`${this.url}filtres/`);
  }

  /** CSV des événements filtrés (Excel FR) — journalisé côté serveur. */
  exporter(filtres: AuditFiltres): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.url}export/`, {
      params: this.params(filtres), responseType: 'blob', observe: 'response',
    });
  }
}
