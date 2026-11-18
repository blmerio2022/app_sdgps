import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type TypeTravail = 'ssdgps' | 'rapport' | 'projet' | 'propriete' | 'affaire';

/** Un travail commencé et non terminé (cf. backend `projects/reprise.py`). */
export interface Travail {
  type: TypeTravail;
  id: string;
  /** Dernière intervention de l'utilisateur (ISO). */
  date: string;
  titre: string;
  contexte: string;
  /** Prochaine étape, en clair (« 2 pièces à valider », « Créer le SDGPS »…). */
  a_faire?: string;
  /** Lien RELATIF (préfixé `/admin/` dans la zone admin). */
  lien: string;
  statut?: string;
  statut_display?: string;
  renvoye?: boolean;
  motif?: string;
  progression?: { validees: number; total: number };
  progression_pct?: number;
  etape?: string;
  erreur?: string;
  session?: { numero: number } | null;
  derniere_piece?: { type_piece: string; libelle: string; statut: string; statut_display: string; lien: string } | null;
}

export interface Reprise { total: number; resultats: Travail[]; }

@Injectable({ providedIn: 'root' })
export class RepriseService {
  private readonly url = `${environment.apiUrl}/v1/reprise/`;

  constructor(private http: HttpClient) {}

  travaux(limite = 12): Observable<Reprise> {
    return this.http.get<Reprise>(this.url, { params: new HttpParams().set('limite', String(limite)) });
  }
}

/** « il y a 3 h », « hier », « il y a 4 j », puis la date (« 12/07/2026 »). */
export function ilYa(iso: string, maintenant: Date = new Date()): string {
  const d = new Date(iso);
  const s = Math.max(0, Math.round((maintenant.getTime() - d.getTime()) / 1000));
  if (s < 60) return 'à l’instant';
  const min = Math.floor(s / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.floor(h / 24);
  if (j === 1) return 'hier';
  if (j < 30) return `il y a ${j} j`;
  return d.toLocaleDateString('fr-FR');
}
