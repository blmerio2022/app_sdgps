import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  IaMessage, IaPropositionMapping, IaPropositionObservation, IaReponseAssistant, IaStatut,
} from '../models/ia.model';

/**
 * Intelligence artificielle (`/api/v1/ia/`) — inerte tant que le serveur ne l'a pas
 * activée : `disponible$` vaut alors `false` et les boutons IA restent masqués.
 *
 * Toutes les fonctions PROPOSENT ; l'opérateur relit et décide. Chaque appel est
 * journalisé côté serveur et plafonné en débit.
 */
@Injectable({ providedIn: 'root' })
export class IaService {
  private url = `${environment.apiUrl}/v1/ia/`;
  private statut$?: Observable<IaStatut>;

  constructor(private http: HttpClient) {}

  /** Statut, interrogé une fois par session (une erreur vaut « indisponible »). */
  statut(): Observable<IaStatut> {
    if (!this.statut$) {
      this.statut$ = this.http.get<IaStatut>(`${this.url}statut/`).pipe(
        catchError(() => of({ disponible: false, modele: null })),
        shareReplay(1),
      );
    }
    return this.statut$;
  }

  get disponible$(): Observable<boolean> {
    return this.statut().pipe(map(s => !!s.disponible));
  }

  /** N°4 — compléter la correspondance des colonnes d'un import. */
  mappingColonnes(typePiece: string, colonnes: string[], lignes: string[][],
                  deja: Record<string, string>): Observable<{ propositions: IaPropositionMapping[] }> {
    return this.http.post<{ propositions: IaPropositionMapping[] }>(`${this.url}mapping-colonnes/`, {
      type_piece: typePiece, colonnes, lignes: lignes.slice(0, 5), deja,
    });
  }

  /** N°6 — brouillons d'observations pour les pièces d'un SDGPS. */
  observations(ssdgpsId: string): Observable<{ propositions: IaPropositionObservation[] }> {
    return this.http.post<{ propositions: IaPropositionObservation[] }>(
      `${this.url}observations/`, { ssdgps: ssdgpsId });
  }

  /** N°6 — brouillon de note de synthèse d'un SDGPS. */
  synthese(ssdgpsId: string): Observable<{ texte: string }> {
    return this.http.post<{ texte: string }>(`${this.url}synthese/`, { ssdgps: ssdgpsId });
  }

  /** N°5 — un tour de conversation (l'historique est tenu par le navigateur). */
  assistant(messages: IaMessage[]): Observable<IaReponseAssistant> {
    return this.http.post<IaReponseAssistant>(`${this.url}assistant/`, {
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });
  }
}

/** Message d'erreur lisible d'un appel IA (le serveur renvoie toujours un `detail`). */
export function messageErreurIa(err: any): string {
  if (err?.status === 429) return 'Trop de demandes à l\'IA : patientez quelques minutes.';
  return err?.error?.detail || 'Le service d\'IA n\'a pas pu répondre. Réessayez.';
}
